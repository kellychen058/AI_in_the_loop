import type {
  AffectedDependentTask,
  AppDatabase,
  RejectionCheckResult,
  Task,
  WorkloadBreakdown,
} from './types';

// Wave 0 compiling stub — full confirmation state machine & rejection guard owned by Issue #10.

export function checkRejectedReproposal(_params: {
  db: AppDatabase;
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  availableHours: number;
  overrideRejectedReason?: string;
}): RejectionCheckResult {
  return { blocked: false };
}

export async function proposeTask(_params: {
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
  dbPath?: string;
}): Promise<{ task: Task; workload: WorkloadBreakdown }> {
  throw new Error('proposeTask is a Wave 0 stub — full implementation owned by Issue #10.');
}

export async function respondToProposal(_params: {
  taskId: string;
  actorId: string;
  expectedVersion: number;
  action: 'accept' | 'counter' | 'decline';
  newDeadline?: string;
  newEstimatedHours?: number;
  note?: string;
  reason?: string;
  dbPath?: string;
}): Promise<{ task: Task; workload?: WorkloadBreakdown }> {
  throw new Error('respondToProposal is a Wave 0 stub — full implementation owned by Issue #10.');
}

export async function rescheduleTask(_params: {
  taskId: string;
  actorId: string;
  newAssigneeId?: string;
  newDeadline: string;
  newEstimatedHours?: number;
  note?: string;
  dbPath?: string;
}): Promise<{
  task: Task;
  workload: WorkloadBreakdown;
  affectedDependents: AffectedDependentTask[];
}> {
  throw new Error('rescheduleTask is a Wave 0 stub — full implementation owned by Issue #10.');
}
