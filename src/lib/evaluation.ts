import type { AppDatabase, AuditLogEntry, RejectionRecord, TaskStatus } from './types';

const HOUR_MS = 60 * 60 * 1000;
const STATUSES: TaskStatus[] = [
  'draft',
  'pending_assignee',
  'counter_proposed',
  'rejected',
  'confirmed',
  'sync_failed',
];

export function isRejectionOverridden(
  rejection: RejectionRecord,
  auditLog: AuditLogEntry[],
): boolean {
  return auditLog.some(
    (entry) =>
      entry.action === 'rejected_option_overridden' &&
      entry.metadata?.priorRejectionId === rejection.id,
  );
}

export interface EvaluationSummary {
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  aiGeneratedTasks: number;
  manualTasks: number;
  meetingsIngested: number;
  proposals: number;
  proposalsWithConflict: number;
  counterProposals: number;
  rejections: number;
  activeRejectionBlocks: number;
  overriddenRejections: number;
  confirmations: number;
  calendarSyncFailures: number;
  reschedules: number;
  avgHoursToConfirmation: number | null;
  unapprovedCalendarBlocks: number;
}

export function summarizeEvaluation(db: AppDatabase): EvaluationSummary {
  const count = (action: AuditLogEntry['action']) =>
    db.auditLog.filter((entry) => entry.action === action).length;
  const tasksByStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const task of db.tasks) tasksByStatus[task.status] += 1;

  const overridden = db.rejections.filter((r) => isRejectionOverridden(r, db.auditLog)).length;

  const firstProposed = new Map<string, number>();
  const durations: number[] = [];
  for (const entry of [...db.auditLog].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (!entry.taskId) continue;
    const at = Date.parse(entry.timestamp);
    if (entry.action === 'task_proposed' && !firstProposed.has(entry.taskId)) {
      firstProposed.set(entry.taskId, at);
    } else if (entry.action === 'task_confirmed' && firstProposed.has(entry.taskId)) {
      durations.push((at - firstProposed.get(entry.taskId)!) / HOUR_MS);
      firstProposed.delete(entry.taskId);
    }
  }

  const taskById = new Map(db.tasks.map((task) => [task.id, task]));
  const unapprovedCalendarBlocks = db.calendarEvents.filter((event) => {
    if (event.kind !== 'work_block') return false;
    const task = event.taskId ? taskById.get(event.taskId) : undefined;
    return !task || task.confirmedVersion === undefined;
  }).length;

  return {
    totalTasks: db.tasks.length,
    tasksByStatus,
    aiGeneratedTasks: db.tasks.filter((task) => task.aiGenerated).length,
    manualTasks: db.tasks.filter((task) => !task.aiGenerated).length,
    meetingsIngested: count('meeting_ingested'),
    proposals: count('task_proposed'),
    proposalsWithConflict: db.auditLog.filter(
      (entry) => entry.action === 'task_proposed' && entry.metadata?.workloadStatus === 'conflict',
    ).length,
    counterProposals: count('task_counter_proposed'),
    rejections: db.rejections.length,
    activeRejectionBlocks: db.rejections.length - overridden,
    overriddenRejections: overridden,
    confirmations: count('task_confirmed'),
    calendarSyncFailures: count('calendar_sync_failed'),
    reschedules: count('task_rescheduled'),
    avgHoursToConfirmation:
      durations.length > 0
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100
        : null,
    unapprovedCalendarBlocks,
  };
}

export function buildEvaluationExport(db: AppDatabase, exportedAt = new Date().toISOString()) {
  return {
    exportedAt,
    summaryMetrics: summarizeEvaluation(db),
    tasks: db.tasks,
    rejections: db.rejections.map((rejection) => ({
      ...rejection,
      status: isRejectionOverridden(rejection, db.auditLog) ? 'overridden' : 'active_block',
    })),
    auditLog: db.auditLog,
  };
}
