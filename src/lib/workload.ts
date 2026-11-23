import type {
  AffectedDependentTask,
  AppDatabase,
  CalendarEvent,
  Task,
  TaskStatus,
  TeamMember,
  WorkloadBreakdown,
  WorkloadStatus,
} from './types';

/**
 * Deterministic workload conflict engine (Issue #8).
 *
 * available = (weeklyHours / 5) * workdaysInWindow
 *             - meeting hours inside the window
 *             - hours of existing confirmed / pending tasks due by the deadline
 *
 * conflict      : newTaskHours > available
 * near_capacity : less than 20% of available remains after the new task
 * ok            : otherwise
 *
 * Every function takes an explicit `now` so tests never depend on the wall clock.
 * Workday hours are interpreted in the server's local time, the same convention
 * `src/lib/seed.ts` uses to build the demo week.
 */

const HOUR_MS = 60 * 60 * 1000;
const NEAR_CAPACITY_RATIO = 0.2;

/** Task statuses whose hours already count against a member's capacity. */
const COMMITTED_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'confirmed',
  'pending_assignee',
]);

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatHours(value: number): string {
  return `${round1(value).toFixed(1)}h`;
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function overlapHours(startA: number, endA: number, startB: number, endB: number): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return end > start ? (end - start) / HOUR_MS : 0;
}

/**
 * Counts Mon–Fri workdays between `windowStartMs` and `windowEndMs`.
 * A partial first or last day counts as the fraction of that day's working hours
 * ([workdayStartHour, workdayEndHour], local time) that falls inside the window.
 */
export function countWorkdaysInWindow(params: {
  windowStartMs: number;
  windowEndMs: number;
  workdayStartHour: number;
  workdayEndHour: number;
}): number {
  const { windowStartMs, windowEndMs, workdayStartHour, workdayEndHour } = params;
  const spanHours = workdayEndHour - workdayStartHour;
  if (!(windowEndMs > windowStartMs) || !(spanHours > 0)) return 0;

  const day = new Date(windowStartMs);
  day.setHours(0, 0, 0, 0);

  let workdays = 0;
  while (day.getTime() < windowEndMs) {
    const weekday = day.getDay(); // 0 = Sun, 6 = Sat
    if (weekday !== 0 && weekday !== 6) {
      const dayStart = new Date(day.getTime());
      dayStart.setHours(workdayStartHour, 0, 0, 0);
      const dayEnd = new Date(day.getTime());
      dayEnd.setHours(workdayEndHour, 0, 0, 0);
      workdays +=
        overlapHours(windowStartMs, windowEndMs, dayStart.getTime(), dayEnd.getTime()) / spanHours;
    }
    day.setDate(day.getDate() + 1);
  }
  return workdays;
}

function statusLabel(status: WorkloadStatus): string {
  if (status === 'conflict') return 'Conflict';
  if (status === 'near_capacity') return 'Near capacity';
  return 'OK';
}

function buildExplanation(params: {
  name: string;
  proratedWorkHours: number;
  scheduledMeetingHours: number;
  existingTaskHours: number;
  rawAvailableHours: number;
  availableHours: number;
  newTaskHours: number;
  remainingAfterTask: number;
  status: WorkloadStatus;
  deadlinePassed: boolean;
}): string {
  const p = params;
  const math =
    `${p.name} has ${formatHours(p.proratedWorkHours)} prorated budget` +
    ` − ${formatHours(p.scheduledMeetingHours)} meetings` +
    ` − ${formatHours(p.existingTaskHours)} existing tasks` +
    ` = ${formatHours(p.availableHours)} available`;
  const overbooked =
    p.rawAvailableHours < 0 ? ` (already overbooked by ${formatHours(-p.rawAvailableHours)})` : '';
  const pastDeadline = p.deadlinePassed ? ' (deadline is not in the future)' : '';

  let outcome: string;
  if (p.status === 'conflict') {
    outcome = `${formatHours(p.newTaskHours)} task exceeds capacity by ${formatHours(-p.remainingAfterTask)}`;
  } else if (p.status === 'near_capacity') {
    outcome = `${formatHours(p.newTaskHours)} task leaves only ${formatHours(p.remainingAfterTask)}, under 20% of available time`;
  } else {
    outcome = `${formatHours(p.newTaskHours)} task leaves ${formatHours(p.remainingAfterTask)}`;
  }
  return `${math}${overbooked}${pastDeadline}; ${outcome} (${statusLabel(p.status)}).`;
}

export function calculateMemberWorkload(params: {
  member: TeamMember;
  deadline: string;
  newTaskHours: number;
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  now?: string;
  excludeTaskId?: string;
}): WorkloadBreakdown {
  const { member, deadline, newTaskHours, calendarEvents, tasks, excludeTaskId } = params;
  const windowStart = params.now ?? new Date().toISOString();
  const windowStartMs = toMs(windowStart);
  const windowEndMs = toMs(deadline);
  const deadlinePassed = !(windowEndMs > windowStartMs);

  const workdaysInWindow = countWorkdaysInWindow({
    windowStartMs,
    windowEndMs,
    workdayStartHour: member.workdayStartHour,
    workdayEndHour: member.workdayEndHour,
  });
  const proratedWorkHours = round1((member.weeklyHours / 5) * workdaysInWindow);

  const scheduledMeetingHours = deadlinePassed
    ? 0
    : round1(
        calendarEvents
          .filter((event) => event.memberId === member.id && event.kind === 'meeting')
          .reduce(
            (sum, event) =>
              sum + overlapHours(toMs(event.start), toMs(event.end), windowStartMs, windowEndMs),
            0,
          ),
      );

  const existingTaskHours = round1(
    tasks
      .filter(
        (task) =>
          task.id !== excludeTaskId &&
          COMMITTED_STATUSES.has(task.status) &&
          task.currentProposal.assigneeId === member.id &&
          toMs(task.currentProposal.deadline) <= windowEndMs,
      )
      .reduce((sum, task) => sum + task.currentProposal.estimatedHours, 0),
  );

  const rawAvailableHours = round1(proratedWorkHours - scheduledMeetingHours - existingTaskHours);
  const availableHours = Math.max(0, rawAvailableHours);
  const remainingAfterTask = round1(availableHours - newTaskHours);
  const remainingRatio = availableHours > 0 ? round4(remainingAfterTask / availableHours) : -1;

  let status: WorkloadStatus;
  if (remainingAfterTask < 0) status = 'conflict';
  else if (remainingRatio < NEAR_CAPACITY_RATIO) status = 'near_capacity';
  else status = 'ok';

  return {
    memberId: member.id,
    windowStart,
    windowEnd: deadline,
    workdaysInWindow: round4(workdaysInWindow),
    proratedWorkHours,
    scheduledMeetingHours,
    existingTaskHours,
    availableHours,
    newTaskHours,
    remainingAfterTask,
    remainingRatio,
    status,
    explanation: buildExplanation({
      name: member.name,
      proratedWorkHours,
      scheduledMeetingHours,
      existingTaskHours,
      rawAvailableHours,
      availableHours,
      newTaskHours,
      remainingAfterTask,
      status,
      deadlinePassed,
    }),
  };
}

export function checkAllMembersWorkload(params: {
  db: AppDatabase;
  deadline: string;
  newTaskHours: number;
  now?: string;
  excludeTaskId?: string;
}): WorkloadBreakdown[] {
  return params.db.members.map((member) =>
    calculateMemberWorkload({
      member,
      deadline: params.deadline,
      newTaskHours: params.newTaskHours,
      calendarEvents: params.db.calendarEvents,
      tasks: params.db.tasks,
      now: params.now,
      excludeTaskId: params.excludeTaskId,
    }),
  );
}

/**
 * Lists tasks that depend on `taskId` and would now be due before it,
 * because `taskId`'s new deadline is later than their current deadline.
 */
export function findAffectedDependentTasks(params: {
  taskId: string;
  newDeadline: string;
  tasks: Task[];
}): AffectedDependentTask[] {
  const newDeadlineMs = toMs(params.newDeadline);
  const parent = params.tasks.find((task) => task.id === params.taskId);
  const parentLabel = parent ? `"${parent.title}"` : params.taskId;

  return params.tasks
    .filter(
      (task) =>
        task.id !== params.taskId &&
        task.dependsOnTaskIds.includes(params.taskId) &&
        newDeadlineMs > toMs(task.currentProposal.deadline),
    )
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      assigneeId: task.currentProposal.assigneeId,
      currentDeadline: task.currentProposal.deadline,
      reason:
        `Depends on ${parentLabel}, whose new deadline (${params.newDeadline}) is later than ` +
        `this task's deadline (${task.currentProposal.deadline}).`,
    }));
}

export interface WorkloadRequest {
  deadline: string;
  estimatedHours: number;
  memberId?: string;
  excludeTaskId?: string;
  taskId?: string;
}

export type WorkloadRequestParseResult =
  | { ok: true; value: WorkloadRequest }
  | { ok: false; message: string };

function optionalString(
  body: Record<string, unknown>,
  key: string,
): { ok: true; value?: string } | { ok: false; message: string } {
  const value = body[key];
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: `${key} must be a non-empty string when provided.` };
  }
  return { ok: true, value };
}

/** Validates the JSON body of `POST /api/workload`. */
export function parseWorkloadRequest(body: unknown): WorkloadRequestParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const record = body as Record<string, unknown>;

  const { deadline, estimatedHours } = record;
  if (typeof deadline !== 'string' || deadline.trim() === '' || Number.isNaN(toMs(deadline))) {
    return { ok: false, message: 'deadline must be a valid ISO 8601 date string.' };
  }
  if (typeof estimatedHours !== 'number' || !Number.isFinite(estimatedHours) || estimatedHours < 0) {
    return { ok: false, message: 'estimatedHours must be a number greater than or equal to 0.' };
  }

  const value: WorkloadRequest = { deadline, estimatedHours };
  for (const key of ['memberId', 'excludeTaskId', 'taskId'] as const) {
    const parsed = optionalString(record, key);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) value[key] = parsed.value;
  }
  return { ok: true, value };
}
