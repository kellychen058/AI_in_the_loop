import { randomUUID } from 'node:crypto';
import { getCalendarAdapter, type CalendarAdapter } from './calendar/adapter';
import { findWorkBlocks } from './calendar/scheduler';
import { readDb, updateDb } from './store';
import type {
  AffectedDependentTask,
  AppDatabase,
  AuditLogEntry,
  RejectionCheckResult,
  RejectionRecord,
  Task,
  TaskProposal,
  TaskStatus,
  TeamMember,
  WorkloadBreakdown,
} from './types';
import { calculateMemberWorkload, findAffectedDependentTasks } from './workload';

export class WorkflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export async function runWorkflowRoute(
  handler: () => Promise<unknown>,
  successStatus = 200,
): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return Response.json(await handler(), { status: successStatus, headers });
  } catch (error) {
    if (error instanceof WorkflowError) {
      return Response.json(
        { code: error.code, message: error.message, ...error.details },
        { status: error.status, headers },
      );
    }
    const message = error instanceof Error ? error.message : 'Unexpected workflow error.';
    return Response.json({ code: 'INTERNAL_ERROR', message }, { status: 500, headers });
  }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => undefined);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new WorkflowError(400, 'INVALID_INPUT', 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

function badInput(message: string): WorkflowError {
  return new WorkflowError(400, 'INVALID_INPUT', message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badInput(`"${field}" is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badInput(`"${field}" must be a string.`);
  return value.trim() === '' ? undefined : value.trim();
}

function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw badInput(`"${field}" must be a valid ISO-8601 date.`);
  }
  return new Date(value).toISOString();
}

function requireHours(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw badInput(`"${field}" must be a positive number of hours.`);
  }
  return value;
}

function requireMember(db: AppDatabase, id: unknown, field: string): TeamMember {
  const memberId = requireText(id, field);
  const member = db.members.find((m) => m.id === memberId);
  if (!member) throw badInput(`Unknown team member "${memberId}" for "${field}".`);
  return member;
}

function requireTask(db: AppDatabase, taskId: string): Task {
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) throw new WorkflowError(404, 'TASK_NOT_FOUND', `Task "${taskId}" was not found.`);
  return task;
}

function requireStatus(task: Task, allowed: TaskStatus[], operation: string): void {
  if (!allowed.includes(task.status)) {
    throw new WorkflowError(
      409,
      'INVALID_STATE',
      `Cannot ${operation} a task in "${task.status}" status (allowed: ${allowed.join(', ')}).`,
    );
  }
}

function requireDependencies(db: AppDatabase, taskId: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw badInput('"dependsOnTaskIds" must be an array of task ids.');
  }
  for (const id of value as string[]) {
    if (id === taskId || !db.tasks.some((t) => t.id === id)) {
      throw badInput(`Invalid dependency "${id}".`);
    }
  }
  return [...new Set(value as string[])];
}

/** The assigner is whoever last proposed this task to someone other than themselves. */
export function getAssignerId(task: Task): string {
  for (let i = task.proposalHistory.length - 1; i >= 0; i -= 1) {
    const proposal = task.proposalHistory[i];
    if (proposal.proposedBy !== proposal.assigneeId) return proposal.proposedBy;
  }
  return task.currentProposal.proposedBy;
}

function isConfirming(task: Task): boolean {
  return (
    (task.status === 'pending_assignee' || task.status === 'counter_proposed') &&
    task.confirmedVersion === task.currentProposal.version
  );
}

function memberName(db: AppDatabase, id: string): string {
  return db.members.find((m) => m.id === id)?.name ?? id;
}

function appendAudit(db: AppDatabase, entry: Omit<AuditLogEntry, 'id'>): void {
  db.auditLog.push({ id: `aud-${randomUUID()}`, ...entry });
}

function computeWorkload(
  db: AppDatabase,
  task: Task,
  member: TeamMember,
  deadline: string,
  hours: number,
  now: string,
): WorkloadBreakdown {
  return calculateMemberWorkload({
    member,
    deadline,
    newTaskHours: hours,
    calendarEvents: db.calendarEvents,
    tasks: db.tasks,
    now,
    excludeTaskId: task.id,
  });
}

function buildProposal(params: {
  db: AppDatabase;
  task: Task;
  assignee: TeamMember;
  deadline: string;
  estimatedHours: number;
  proposedBy: string;
  note?: string;
  overrideRejectedReason?: string;
  now: string;
}): TaskProposal {
  const { db, task, assignee, deadline, estimatedHours, now } = params;
  const { blocks } = findWorkBlocks({
    member: assignee,
    estimatedHours,
    deadline,
    existingEvents: db.calendarEvents.filter((e) => e.memberId === assignee.id),
    now,
    excludeTaskId: task.id,
  });
  return {
    version: task.currentProposal.version + 1,
    assigneeId: assignee.id,
    deadline,
    estimatedHours,
    proposedBlocks: blocks,
    proposedBy: params.proposedBy,
    ...(params.note ? { note: params.note } : {}),
    ...(params.overrideRejectedReason
      ? { overrideRejectedReason: params.overrideRejectedReason }
      : {}),
    createdAt: now,
  };
}

function applyProposal(task: Task, proposal: TaskProposal, status: TaskStatus): void {
  task.currentProposal = proposal;
  task.proposalHistory.push(proposal);
  task.status = status;
  task.updatedAt = proposal.createdAt;
}

const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

export function checkRejectedReproposal(params: {
  db: AppDatabase;
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  availableHours: number;
  overrideRejectedReason?: string;
}): RejectionCheckResult {
  const title = normalizeTitle(params.taskTitle);
  const matches = params.db.rejections.filter(
    (r) =>
      r.rejectedAssigneeId === params.assigneeId &&
      (r.taskId === params.taskId || normalizeTitle(r.taskTitle) === title),
  );
  if (matches.length === 0) return { blocked: false };

  const deadlineMs = Date.parse(params.deadline);
  const unchanged = [...matches]
    .reverse()
    .find(
      (r) =>
        deadlineMs <= Date.parse(r.rejectedDeadline) &&
        params.availableHours <= r.workloadSnapshot.availableHours &&
        params.estimatedHours >= r.estimatedHours,
    );
  if (!unchanged) return { blocked: false, priorRejection: matches[matches.length - 1] };

  if (params.overrideRejectedReason?.trim()) {
    return { blocked: false, priorRejection: unchanged, overridden: true };
  }
  return {
    blocked: true,
    code: 'PREVIOUSLY_REJECTED',
    message:
      'This assignment was previously rejected under similar or tighter conditions. Provide a "What changed?" justification to proceed.',
    priorRejection: unchanged,
  };
}

export async function listTasks(params: {
  status?: string;
  assigneeId?: string;
  dbPath?: string;
}): Promise<Task[]> {
  const db = await readDb(params.dbPath);
  return db.tasks.filter(
    (t) =>
      (!params.status || t.status === params.status) &&
      (!params.assigneeId || t.currentProposal.assigneeId === params.assigneeId),
  );
}

export async function createDraftTask(params: {
  actorId: string;
  title: string;
  description?: string;
  sourceQuote?: string;
  meetingId?: string;
  estimatedHours: number;
  assigneeId?: string;
  deadline?: string;
  dependsOnTaskIds?: string[];
  now?: string;
  dbPath?: string;
}): Promise<Task> {
  let created: Task | undefined;
  await updateDb((db) => {
    const now = params.now ?? new Date().toISOString();
    const actor = requireMember(db, params.actorId, 'actorId');
    const id = `task-${randomUUID()}`;
    const task: Task = {
      id,
      meetingId: optionalText(params.meetingId, 'meetingId') ?? 'manual',
      title: requireText(params.title, 'title'),
      description: optionalText(params.description, 'description') ?? '',
      sourceQuote: optionalText(params.sourceQuote, 'sourceQuote') ?? '',
      aiGenerated: false,
      dependsOnTaskIds:
        params.dependsOnTaskIds === undefined
          ? []
          : requireDependencies(db, id, params.dependsOnTaskIds),
      status: 'draft',
      currentProposal: {
        version: 0,
        assigneeId:
          params.assigneeId === undefined ? '' : requireMember(db, params.assigneeId, 'assigneeId').id,
        deadline: params.deadline === undefined ? '' : requireIsoDate(params.deadline, 'deadline'),
        estimatedHours: requireHours(params.estimatedHours, 'estimatedHours'),
        proposedBlocks: [],
        proposedBy: actor.id,
        createdAt: now,
      },
      proposalHistory: [],
      calendarEventIds: [],
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.push(task);
    appendAudit(db, {
      timestamp: now,
      actorId: actor.id,
      action: 'task_drafted',
      taskId: id,
      summary: `${actor.name} manually drafted "${task.title}".`,
    });
    created = task;
  }, params.dbPath);
  return created!;
}

export async function updateDraftTask(params: {
  taskId: string;
  title?: string;
  description?: string;
  sourceQuote?: string;
  estimatedHours?: number;
  assigneeId?: string;
  deadline?: string;
  dependsOnTaskIds?: string[];
  now?: string;
  dbPath?: string;
}): Promise<Task> {
  let updated: Task | undefined;
  await updateDb((db) => {
    const task = requireTask(db, requireText(params.taskId, 'id'));
    requireStatus(task, ['draft'], 'edit');
    if (params.title !== undefined) task.title = requireText(params.title, 'title');
    if (params.description !== undefined) {
      task.description = optionalText(params.description, 'description') ?? '';
    }
    if (params.sourceQuote !== undefined) {
      task.sourceQuote = optionalText(params.sourceQuote, 'sourceQuote') ?? '';
    }
    if (params.estimatedHours !== undefined) {
      task.currentProposal.estimatedHours = requireHours(params.estimatedHours, 'estimatedHours');
    }
    if (params.assigneeId !== undefined) {
      task.currentProposal.assigneeId = requireMember(db, params.assigneeId, 'assigneeId').id;
    }
    if (params.deadline !== undefined) {
      task.currentProposal.deadline = requireIsoDate(params.deadline, 'deadline');
    }
    if (params.dependsOnTaskIds !== undefined) {
      task.dependsOnTaskIds = requireDependencies(db, task.id, params.dependsOnTaskIds);
    }
    task.updatedAt = params.now ?? new Date().toISOString();
    updated = task;
  }, params.dbPath);
  return updated!;
}

export async function deleteDraftTask(params: { taskId: string; dbPath?: string }): Promise<void> {
  await updateDb((db) => {
    const task = requireTask(db, requireText(params.taskId, 'id'));
    requireStatus(task, ['draft'], 'delete');
    if (db.tasks.some((t) => t.dependsOnTaskIds.includes(task.id))) {
      throw new WorkflowError(409, 'HAS_DEPENDENTS', 'Other tasks depend on this draft.');
    }
    db.tasks = db.tasks.filter((t) => t.id !== task.id);
  }, params.dbPath);
}

export async function proposeTask(params: {
  taskId: string;
  actorId: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  note?: string;
  overrideRejectedReason?: string;
  title?: string;
  description?: string;
  dependsOnTaskIds?: string[];
  now?: string;
  dbPath?: string;
}): Promise<{ task: Task; workload: WorkloadBreakdown }> {
  let result: { task: Task; workload: WorkloadBreakdown } | undefined;
  await updateDb((db) => {
    const now = params.now ?? new Date().toISOString();
    const task = requireTask(db, params.taskId);
    requireStatus(task, ['draft', 'rejected'], 'propose');
    const actor = requireMember(db, params.actorId, 'actorId');
    const assignee = requireMember(db, params.assigneeId, 'assigneeId');
    if (actor.id === assignee.id) {
      throw badInput('The assigner and assignee must be different people.');
    }
    const deadline = requireIsoDate(params.deadline, 'deadline');
    const estimatedHours = requireHours(params.estimatedHours, 'estimatedHours');
    const title = params.title === undefined ? task.title : requireText(params.title, 'title');
    const overrideReason = optionalText(params.overrideRejectedReason, 'overrideRejectedReason');

    const workload = computeWorkload(db, task, assignee, deadline, estimatedHours, now);
    const check = checkRejectedReproposal({
      db,
      taskId: task.id,
      taskTitle: title,
      assigneeId: assignee.id,
      deadline,
      estimatedHours,
      availableHours: workload.availableHours,
      overrideRejectedReason: overrideReason,
    });
    if (check.blocked) {
      throw new WorkflowError(409, check.code, check.message, {
        priorRejection: check.priorRejection,
        workload,
      });
    }

    task.title = title;
    if (params.description !== undefined) {
      task.description = optionalText(params.description, 'description') ?? '';
    }
    if (params.dependsOnTaskIds !== undefined) {
      task.dependsOnTaskIds = requireDependencies(db, task.id, params.dependsOnTaskIds);
    }
    const proposal = buildProposal({
      db,
      task,
      assignee,
      deadline,
      estimatedHours,
      proposedBy: actor.id,
      note: optionalText(params.note, 'note'),
      overrideRejectedReason: check.overridden ? overrideReason : undefined,
      now,
    });
    applyProposal(task, proposal, 'pending_assignee');

    if (check.overridden) {
      appendAudit(db, {
        timestamp: now,
        actorId: actor.id,
        action: 'rejected_option_overridden',
        taskId: task.id,
        summary: `${actor.name} re-proposed "${task.title}" to ${assignee.name} despite a prior rejection: ${overrideReason}`,
        metadata: {
          priorRejectionId: check.priorRejection?.id,
          overrideRejectedReason: overrideReason,
          version: proposal.version,
        },
      });
    }
    appendAudit(db, {
      timestamp: now,
      actorId: actor.id,
      action: 'task_proposed',
      taskId: task.id,
      summary: `${actor.name} proposed "${task.title}" to ${assignee.name} (v${proposal.version}, ${estimatedHours}h).`,
      metadata: { version: proposal.version, workloadStatus: workload.status },
    });
    result = { task, workload };
  }, params.dbPath);
  return result!;
}

export async function respondToProposal(params: {
  taskId: string;
  actorId: string;
  expectedVersion: number;
  action: 'accept' | 'counter' | 'decline';
  newDeadline?: string;
  newEstimatedHours?: number;
  note?: string;
  reason?: string;
  now?: string;
  calendar?: CalendarAdapter;
  dbPath?: string;
}): Promise<{ task: Task; workload?: WorkloadBreakdown }> {
  let result: { task: Task; workload?: WorkloadBreakdown } | undefined;
  let toSync: Task | undefined;

  await updateDb((db) => {
    const now = params.now ?? new Date().toISOString();
    const task = requireTask(db, params.taskId);
    const actor = requireMember(db, params.actorId, 'actorId');
    if (!['accept', 'counter', 'decline'].includes(params.action)) {
      throw badInput('"action" must be one of accept, counter, decline.');
    }
    if (!Number.isInteger(params.expectedVersion)) {
      throw badInput('"expectedVersion" must be an integer.');
    }
    if (params.expectedVersion !== task.currentProposal.version) {
      throw new WorkflowError(
        409,
        'VERSION_CONFLICT',
        'Proposal version changed; please refresh before confirming.',
        { currentVersion: task.currentProposal.version },
      );
    }
    requireStatus(task, ['pending_assignee', 'counter_proposed'], 'respond to');
    if (isConfirming(task)) {
      throw new WorkflowError(409, 'CONFIRMATION_IN_PROGRESS', 'This version is already being confirmed.');
    }

    const proposal = task.currentProposal;
    const assignerId = getAssignerId(task);
    const responderId = task.status === 'pending_assignee' ? proposal.assigneeId : assignerId;
    if (actor.id !== responderId) {
      throw new WorkflowError(
        403,
        'NOT_YOUR_TURN',
        `Only ${memberName(db, responderId)} can respond to v${proposal.version}.`,
      );
    }
    const assignee = requireMember(db, proposal.assigneeId, 'assigneeId');

    if (params.action === 'accept') {
      const accepterIsAssignee = actor.id === proposal.assigneeId;
      task.confirmedVersion = proposal.version;
      task.confirmedByAssigneeAt = accepterIsAssignee ? now : proposal.createdAt;
      task.confirmedByAssignerAt = accepterIsAssignee ? proposal.createdAt : now;
      task.updatedAt = now;
      appendAudit(db, {
        timestamp: now,
        actorId: actor.id,
        action: 'task_confirmed',
        taskId: task.id,
        summary: `${actor.name} confirmed "${task.title}" (v${proposal.version}, ${proposal.estimatedHours}h).`,
        metadata: { version: proposal.version },
      });
      toSync = structuredClone(task);
      result = { task };
      return;
    }

    if (params.action === 'counter') {
      const deadline = requireIsoDate(params.newDeadline, 'newDeadline');
      const estimatedHours =
        params.newEstimatedHours === undefined
          ? proposal.estimatedHours
          : requireHours(params.newEstimatedHours, 'newEstimatedHours');
      const workload = computeWorkload(db, task, assignee, deadline, estimatedHours, now);
      const counter = buildProposal({
        db,
        task,
        assignee,
        deadline,
        estimatedHours,
        proposedBy: actor.id,
        note: optionalText(params.note, 'note'),
        now,
      });
      applyProposal(
        task,
        counter,
        task.status === 'pending_assignee' ? 'counter_proposed' : 'pending_assignee',
      );
      appendAudit(db, {
        timestamp: now,
        actorId: actor.id,
        action: 'task_counter_proposed',
        taskId: task.id,
        summary: `${actor.name} counter-proposed "${task.title}" (v${counter.version}: ${estimatedHours}h by ${deadline}).`,
        metadata: { fromVersion: proposal.version, version: counter.version, note: counter.note },
      });
      result = { task, workload };
      return;
    }

    const reason = requireText(params.reason, 'reason');
    const workload = computeWorkload(
      db,
      task,
      assignee,
      proposal.deadline,
      proposal.estimatedHours,
      now,
    );
    const rejection: RejectionRecord = {
      id: `rej-${randomUUID()}`,
      taskId: task.id,
      taskTitle: task.title,
      rejectedAssigneeId: assignee.id,
      rejectedDeadline: proposal.deadline,
      estimatedHours: proposal.estimatedHours,
      reason,
      rejectedBy: actor.id,
      workloadSnapshot: workload,
      createdAt: now,
    };
    db.rejections.push(rejection);
    task.status = 'rejected';
    task.updatedAt = now;
    appendAudit(db, {
      timestamp: now,
      actorId: actor.id,
      action: 'task_rejected',
      taskId: task.id,
      summary: `${actor.name} declined "${task.title}" (v${proposal.version}): ${reason}`,
      metadata: {
        rejectionId: rejection.id,
        version: proposal.version,
        availableHours: workload.availableHours,
        estimatedHours: proposal.estimatedHours,
      },
    });
    result = { task, workload };
  }, params.dbPath);

  if (!toSync) return result!;

  // Synced outside the DB transaction: the adapter writes through the same store queue.
  const calendar = params.calendar ?? getCalendarAdapter(params.dbPath);
  const confirmed = toSync;
  let outcome: { eventIds: string[] } | { error: string };
  try {
    outcome = await calendar.syncTaskBlocks({
      task: confirmed,
      blocks: confirmed.currentProposal.proposedBlocks,
    });
  } catch (error) {
    outcome = { error: error instanceof Error ? error.message : 'Calendar sync failed.' };
  }

  await updateDb((db) => {
    const now = params.now ?? new Date().toISOString();
    const task = requireTask(db, confirmed.id);
    const version = confirmed.currentProposal.version;
    if ('error' in outcome) {
      task.status = 'sync_failed';
      task.syncError = outcome.error;
      appendAudit(db, {
        timestamp: now,
        actorId: params.actorId,
        action: 'calendar_sync_failed',
        taskId: task.id,
        summary: `Calendar sync failed for "${task.title}" (v${version}): ${outcome.error}`,
        metadata: { version },
      });
    } else {
      task.status = 'confirmed';
      task.calendarEventIds = outcome.eventIds;
      delete task.syncError;
      appendAudit(db, {
        timestamp: now,
        actorId: params.actorId,
        action: 'calendar_synced',
        taskId: task.id,
        summary: `Synced ${outcome.eventIds.length} work block(s) for "${task.title}" (v${version}).`,
        metadata: { version, eventIds: outcome.eventIds },
      });
    }
    task.updatedAt = now;
    result = { task };
  }, params.dbPath);
  return result!;
}

export async function rescheduleTask(params: {
  taskId: string;
  actorId: string;
  newAssigneeId?: string;
  newDeadline: string;
  newEstimatedHours?: number;
  note?: string;
  now?: string;
  dbPath?: string;
}): Promise<{
  task: Task;
  workload: WorkloadBreakdown;
  affectedDependents: AffectedDependentTask[];
}> {
  let result:
    | { task: Task; workload: WorkloadBreakdown; affectedDependents: AffectedDependentTask[] }
    | undefined;
  await updateDb((db) => {
    const now = params.now ?? new Date().toISOString();
    const task = requireTask(db, params.taskId);
    requireStatus(task, ['confirmed', 'sync_failed'], 'reschedule');
    const actor = requireMember(db, params.actorId, 'actorId');
    const assignerId = getAssignerId(task);
    if (actor.id !== assignerId) {
      throw new WorkflowError(
        403,
        'NOT_ASSIGNER',
        `Only the assigner (${memberName(db, assignerId)}) can reschedule this task.`,
      );
    }
    const previous = task.currentProposal;
    const assignee =
      params.newAssigneeId === undefined
        ? requireMember(db, previous.assigneeId, 'assigneeId')
        : requireMember(db, params.newAssigneeId, 'newAssigneeId');
    if (assignee.id === actor.id) {
      throw badInput('The assigner and assignee must be different people.');
    }
    const deadline = requireIsoDate(params.newDeadline, 'newDeadline');
    const estimatedHours =
      params.newEstimatedHours === undefined
        ? previous.estimatedHours
        : requireHours(params.newEstimatedHours, 'newEstimatedHours');

    const workload = computeWorkload(db, task, assignee, deadline, estimatedHours, now);
    const affectedDependents = findAffectedDependentTasks({
      taskId: task.id,
      newDeadline: deadline,
      tasks: db.tasks,
    });
    const proposal = buildProposal({
      db,
      task,
      assignee,
      deadline,
      estimatedHours,
      proposedBy: actor.id,
      note: optionalText(params.note, 'note'),
      now,
    });
    applyProposal(task, proposal, 'pending_assignee');
    delete task.syncError;

    appendAudit(db, {
      timestamp: now,
      actorId: actor.id,
      action: 'task_rescheduled',
      taskId: task.id,
      summary: `${actor.name} rescheduled "${task.title}" to v${proposal.version} (${assignee.name}, ${estimatedHours}h by ${deadline}); awaiting re-confirmation.`,
      metadata: {
        fromVersion: previous.version,
        version: proposal.version,
        previousAssigneeId: previous.assigneeId,
        affectedDependents,
      },
    });
    result = { task, workload, affectedDependents };
  }, params.dbPath);
  return result!;
}
