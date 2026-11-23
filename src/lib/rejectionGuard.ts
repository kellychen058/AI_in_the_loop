import type { AppDatabase, RejectionCheckResult, RejectionRecord } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Returns every prior decline record that matches the (assignee, taskId | normalizedTitle) pair
 * and still holds under the candidate deadline, available hours, and estimated hours.
 */
export function getBlockingRejections(params: {
  rejections: RejectionRecord[];
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  availableHours: number;
}): { matches: RejectionRecord[]; blocking: RejectionRecord[] } {
  const title = normalizeTaskTitle(params.taskTitle);
  const matches = params.rejections.filter(
    (r) =>
      r.rejectedAssigneeId === params.assigneeId &&
      (r.taskId === params.taskId || normalizeTaskTitle(r.taskTitle) === title),
  );
  if (matches.length === 0) return { matches: [], blocking: [] };

  const deadlineMs = Date.parse(params.deadline);
  const blocking = matches.filter(
    (r) =>
      deadlineMs <= Date.parse(r.rejectedDeadline) &&
      params.availableHours <= r.workloadSnapshot.availableHours &&
      params.estimatedHours >= r.estimatedHours,
  );
  return { matches, blocking };
}

export function checkRejectedReproposal(params: {
  db: Pick<AppDatabase, 'rejections'>;
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  availableHours: number;
  overrideRejectedReason?: string;
}): RejectionCheckResult {
  const { matches, blocking } = getBlockingRejections({
    rejections: params.db.rejections,
    taskId: params.taskId,
    taskTitle: params.taskTitle,
    assigneeId: params.assigneeId,
    deadline: params.deadline,
    estimatedHours: params.estimatedHours,
    availableHours: params.availableHours,
  });
  if (matches.length === 0) return { blocked: false };

  const unchanged = blocking[blocking.length - 1];
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

export interface UnlockLevers {
  isBlocked: boolean;
  blockingRecords: RejectionRecord[];
  priorMatches: RejectionRecord[];
  /** Suggested next-workday deadline strictly after max(blocking.rejectedDeadline). */
  suggestedNextDeadlineIso?: string;
  /** Strictly below min(blocking.estimatedHours) and capped at current availableHours when positive. */
  suggestedFitHours?: number;
  /** Strict minimum hours below which the guard clears. */
  strictMaxHours?: number;
  /** Available hours threshold above which the guard clears. */
  requiredAvailableAbove?: number;
}

/**
 * Computes concrete, honest unlock paths across ALL blocking rejections for a candidate assignee.
 */
export function computeUnlockLevers(params: {
  rejections: RejectionRecord[];
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  availableHours: number;
}): UnlockLevers {
  const { matches, blocking } = getBlockingRejections(params);
  if (blocking.length === 0) {
    return { isBlocked: false, blockingRecords: [], priorMatches: matches };
  }

  const maxDeadlineMs = Math.max(...blocking.map((r) => Date.parse(r.rejectedDeadline)));
  const nextDate = new Date(maxDeadlineMs + DAY_MS);
  while (nextDate.getDay() === 0 || nextDate.getDay() === 6) {
    nextDate.setDate(nextDate.getDate() + 1);
  }
  nextDate.setHours(18, 0, 0, 0);

  const minRejectedHours = Math.min(...blocking.map((r) => r.estimatedHours));
  const maxSnapshotAvailable = Math.max(...blocking.map((r) => r.workloadSnapshot.availableHours));

  // Honest fit suggestion: prefer fitting within actual free capacity (rounded to 0.5h) when strictly below rejected hours.
  const floorHalf = (n: number) => Math.floor(n * 2) / 2;
  const maxAllowed = Math.max(0.5, floorHalf(minRejectedHours - 0.5));
  const fitCandidate =
    params.availableHours >= 0.5
      ? Math.min(maxAllowed, floorHalf(params.availableHours))
      : undefined;

  return {
    isBlocked: true,
    blockingRecords: blocking,
    priorMatches: matches,
    suggestedNextDeadlineIso: nextDate.toISOString(),
    suggestedFitHours: fitCandidate && fitCandidate >= 0.5 ? fitCandidate : undefined,
    strictMaxHours: minRejectedHours,
    requiredAvailableAbove: maxSnapshotAvailable,
  };
}
