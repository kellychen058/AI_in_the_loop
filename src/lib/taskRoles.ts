import type { Task } from './types';

/** The assigner is whoever last proposed this task to someone other than themselves. */
export function getAssignerId(task: Task): string {
  for (let i = task.proposalHistory.length - 1; i >= 0; i -= 1) {
    const proposal = task.proposalHistory[i];
    if (proposal.proposedBy !== proposal.assigneeId) return proposal.proposedBy;
  }
  return task.currentProposal.proposedBy;
}

/** Who must accept, counter or decline the current version, if anyone. */
export function getResponderId(task: Task): string | undefined {
  if (task.status === 'pending_assignee') return task.currentProposal.assigneeId;
  if (task.status === 'counter_proposed') return getAssignerId(task);
  return undefined;
}

export type InboxSection = 'action' | 'waiting' | 'confirmed';

export function getInboxSection(task: Task, userId: string): InboxSection | undefined {
  const isAssignee = task.currentProposal.assigneeId === userId;
  const isAssigner = getAssignerId(task) === userId;
  if (task.status === 'sync_failed') return isAssignee || isAssigner ? 'action' : undefined;
  if (task.status === 'confirmed') return isAssignee || isAssigner ? 'confirmed' : undefined;
  const responderId = getResponderId(task);
  if (!responderId) return undefined;
  if (responderId === userId) return 'action';
  return isAssignee || isAssigner ? 'waiting' : undefined;
}
