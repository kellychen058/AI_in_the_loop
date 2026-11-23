import { getCheckInStatus } from './checkIn';
import { getAssignerId, getResponderId, isPm } from './taskRoles';
import type { Task, TeamMember } from './types';

export type DeskBucket = 'action' | 'waiting' | 'scheduled';

export interface DeskClassification {
  bucket: DeskBucket;
  priority: number;
  badgeLabel: string;
  badgeTone: 'crimson' | 'amber' | 'iris' | 'emerald' | 'neutral';
}

export function classifyTaskForDesk(
  task: Task,
  user: Pick<TeamMember, 'id' | 'role'>,
  now?: string,
): DeskClassification | null {
  const isAssignee = task.currentProposal.assigneeId === user.id;
  const isAssigner = getAssignerId(task) === user.id;
  const userIsPm = isPm(user);

  if (task.status === 'draft') {
    if (!userIsPm) return null;
    return {
      bucket: 'action',
      priority: 60,
      badgeLabel: task.aiGenerated ? 'Draft to review' : 'Manual draft',
      badgeTone: task.aiGenerated ? 'iris' : 'neutral',
    };
  }

  if (task.status === 'sync_failed') {
    if (!isAssigner && !isAssignee) return null;
    return {
      bucket: 'action',
      priority: 10,
      badgeLabel: 'Sync failed · Retry',
      badgeTone: 'crimson',
    };
  }

  if (task.status === 'rejected') {
    if (isAssigner) {
      return {
        bucket: 'action',
        priority: 20,
        badgeLabel: task.calendarEventIds.length > 0 ? 'Replacement declined' : 'Declined · Reassign',
        badgeTone: 'crimson',
      };
    }
    if (isAssignee && task.calendarEventIds.length > 0) {
      return {
        bucket: 'scheduled',
        priority: 70,
        badgeLabel: 'Booked · vPrev live',
        badgeTone: 'emerald',
      };
    }
    return null;
  }

  if (task.status === 'confirmed') {
    if (!isAssigner && !isAssignee) return null;
    const checkIn = getCheckInStatus(task, now);
    if (isAssignee && checkIn.needsAssigneeAction) {
      return {
        bucket: 'action',
        priority: 30,
        badgeLabel: checkIn.lastReminder ? 'Check-in reminded' : 'Check-in due',
        badgeTone: 'amber',
      };
    }
    if (isAssigner && checkIn.needsPmAlert) {
      return {
        bucket: 'action',
        priority: 30,
        badgeLabel: `Check-in ${Math.floor(checkIn.elapsedHours)}h overdue`,
        badgeTone: 'amber',
      };
    }
    return {
      bucket: 'scheduled',
      priority: 80,
      badgeLabel: `Booked · v${task.confirmedVersion ?? task.currentProposal.version}`,
      badgeTone: 'emerald',
    };
  }

  // Pending or counter-proposed
  const responderId = getResponderId(task);
  const isSigning =
    (task.status === 'pending_assignee' || task.status === 'counter_proposed') &&
    task.confirmedVersion === task.currentProposal.version;

  if (isSigning && (isAssigner || isAssignee)) {
    return {
      bucket: 'waiting',
      priority: 5,
      badgeLabel: 'Signing & syncing',
      badgeTone: 'neutral',
    };
  }

  if (responderId === user.id) {
    return {
      bucket: 'action',
      priority: task.status === 'counter_proposed' ? 40 : 50,
      badgeLabel:
        task.status === 'counter_proposed'
          ? `Counter v${task.currentProposal.version}`
          : `Proposal v${task.currentProposal.version}`,
      badgeTone: task.status === 'counter_proposed' ? 'amber' : 'iris',
    };
  }

  if (isAssigner || isAssignee) {
    return {
      bucket: 'waiting',
      priority: 55,
      badgeLabel: `Awaiting v${task.currentProposal.version}`,
      badgeTone: 'neutral',
    };
  }

  return null;
}

export function groupDeskTasks(
  tasks: Task[],
  user: Pick<TeamMember, 'id' | 'role'> | null,
  now?: string,
): Record<DeskBucket, { task: Task; meta: DeskClassification }[]> {
  const grouped: Record<DeskBucket, { task: Task; meta: DeskClassification }[]> = {
    action: [],
    waiting: [],
    scheduled: [],
  };
  if (!user) return grouped;

  for (const task of tasks) {
    const meta = classifyTaskForDesk(task, user, now);
    if (meta) grouped[meta.bucket].push({ task, meta });
  }

  for (const list of Object.values(grouped)) {
    list.sort(
      (a, b) =>
        a.meta.priority - b.meta.priority || b.task.updatedAt.localeCompare(a.task.updatedAt),
    );
  }
  return grouped;
}

export function countDeskActionItems(
  tasks: Task[],
  user: Pick<TeamMember, 'id' | 'role'>,
  now?: string,
): number {
  let count = 0;
  for (const task of tasks) {
    const meta = classifyTaskForDesk(task, user, now);
    if (meta?.bucket === 'action') count += 1;
  }
  return count;
}
