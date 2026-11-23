import type { Task, TeamMember } from '@/lib/types';

export interface GridEvent {
  id: string;
  memberId: string;
  title: string;
  start: string;
  end: string;
  kind: 'meeting' | 'work_block' | 'preview';
  taskId?: string;
  attendeeIds?: string[];
}

export const MEMBER_PALETTE_SIZE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export function memberColorIndex(members: TeamMember[], memberId: string): number {
  const index = members.findIndex((m) => m.id === memberId);
  return (index < 0 ? 0 : index) % MEMBER_PALETTE_SIZE;
}

/** Colour index for a meeting block, or null when it should stay gray. */
export function meetingColorIndex(
  members: TeamMember[],
  attendeeIds: string[],
  currentUserId: string | undefined,
): number | null {
  if (!currentUserId || !attendeeIds.includes(currentUserId)) return null;
  return memberColorIndex(members, currentUserId);
}

export function normalizeMeetingTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function memberOrder(members: TeamMember[], id: string): number {
  const index = members.findIndex((m) => m.id === id);
  return index < 0 ? members.length : index;
}

/**
 * Merges per-member copies of the same meeting (title + start + end) into one event with
 * every attendee, then keeps only meetings and blocks that involve a visible member.
 */
export function consolidateEvents(
  events: GridEvent[],
  members: TeamMember[],
  visibleMemberIds: string[],
): GridEvent[] {
  const visible = new Set(visibleMemberIds);
  const meetings = new Map<string, GridEvent>();
  const result: GridEvent[] = [];

  for (const event of events) {
    if (event.kind !== 'meeting') {
      if (visible.has(event.memberId)) result.push(event);
      continue;
    }
    const key = `${normalizeMeetingTitle(event.title)}|${Date.parse(event.start)}|${Date.parse(event.end)}`;
    const existing = meetings.get(key);
    const attendees = event.attendeeIds ?? [event.memberId];
    if (existing) {
      for (const id of attendees) {
        if (!existing.attendeeIds!.includes(id)) existing.attendeeIds!.push(id);
      }
    } else {
      const merged: GridEvent = { ...event, attendeeIds: [...attendees] };
      meetings.set(key, merged);
      result.push(merged);
    }
  }

  return result.filter((event) => {
    if (event.kind !== 'meeting') return true;
    event.attendeeIds!.sort((a, b) => memberOrder(members, a) - memberOrder(members, b));
    event.memberId = event.attendeeIds![0];
    return event.attendeeIds!.some((id) => visible.has(id));
  });
}

export interface ColumnPlacement {
  column: number;
  columns: number;
}

/**
 * Google-Calendar-style placement: transitively overlapping items form a cluster; each item
 * takes the first free column and every item in the cluster shares the cluster's column count.
 */
export function layoutOverlapColumns(
  items: { id: string; startMs: number; endMs: number }[],
): Map<string, ColumnPlacement> {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const placements = new Map<string, ColumnPlacement>();
  let cluster: { id: string; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const item of cluster) placements.set(item.id, { column: item.column, columns: columnEnds.length });
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (item.startMs >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let column = columnEnds.findIndex((end) => end <= item.startMs);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(item.endMs);
    } else {
      columnEnds[column] = item.endMs;
    }
    cluster.push({ id: item.id, column });
    clusterEnd = Math.max(clusterEnd, item.endMs);
  }
  flush();
  return placements;
}

export interface TaskSpan {
  taskId: string;
  title: string;
  assigneeId: string;
  confirmedAt: string;
  deadline: string;
  startDay: number;
  endDay: number;
  continuesFromPrevWeek: boolean;
  continuesToNextWeek: boolean;
  deadlineInWeek: boolean;
  deadlineLabel: string;
  row: number;
}

export function isTwoPartyConfirmed(task: Task): boolean {
  return task.confirmedVersion !== undefined && (task.status === 'confirmed' || task.status === 'sync_failed');
}

export function twoPartyConfirmedAt(task: Task): string {
  const stamps = [task.confirmedByAssignerAt, task.confirmedByAssigneeAt].filter((s): s is string => Boolean(s));
  if (stamps.length === 0) return task.updatedAt;
  return stamps.reduce((latest, s) => (Date.parse(s) > Date.parse(latest) ? s : latest));
}

function localDayIndex(iso: string, monday: Date): number {
  const date = new Date(iso);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const base = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()).getTime();
  return Math.round((day - base) / DAY_MS);
}

export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Spans from two-party confirmation to deadline, clamped to Mon–Fri and packed into rows. */
export function computeTaskSpans(tasks: Task[], monday: Date, visibleMemberIds: string[]): TaskSpan[] {
  const visible = new Set(visibleMemberIds);
  const spans: TaskSpan[] = [];

  for (const task of tasks) {
    const assigneeId = task.currentProposal.assigneeId;
    if (!isTwoPartyConfirmed(task) || !visible.has(assigneeId)) continue;
    const confirmedAt = twoPartyConfirmedAt(task);
    const deadline = task.currentProposal.deadline;
    const endIndex = localDayIndex(deadline, monday);
    const startIndex = Math.min(localDayIndex(confirmedAt, monday), endIndex);
    if (endIndex < 0 || startIndex > 4) continue;
    spans.push({
      taskId: task.id,
      title: task.title,
      assigneeId,
      confirmedAt,
      deadline,
      startDay: Math.max(startIndex, 0),
      endDay: Math.min(endIndex, 4),
      continuesFromPrevWeek: startIndex < 0,
      continuesToNextWeek: endIndex > 4,
      deadlineInWeek: endIndex <= 4,
      deadlineLabel: formatLocalTime(deadline),
      row: 0,
    });
  }

  return packSpanRows(spans);
}

export function packSpanRows<T extends { startDay: number; endDay: number; row: number }>(spans: T[]): T[] {
  const sorted = [...spans].sort((a, b) => a.startDay - b.startDay || b.endDay - a.endDay);
  const rowEnds: number[] = [];
  for (const span of sorted) {
    let row = rowEnds.findIndex((end) => end < span.startDay);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(span.endDay);
    } else {
      rowEnds[row] = span.endDay;
    }
    span.row = row;
  }
  return sorted;
}
