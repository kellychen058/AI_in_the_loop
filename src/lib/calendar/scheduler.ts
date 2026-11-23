import type { CalendarEvent, ProposedBlock, ScheduleBlocksResult, TeamMember } from '@/lib/types';

const HOUR_MS = 60 * 60 * 1000;
const SLOT_MS = 30 * 60 * 1000;
const MIN_BLOCK_MS = HOUR_MS;
const MAX_BLOCK_MS = 4 * HOUR_MS;

interface Interval {
  start: number;
  end: number;
}

function roundUpToSlot(ms: number): number {
  return Math.ceil(ms / SLOT_MS) * SLOT_MS;
}

function toHours(ms: number): number {
  return Math.round((ms / HOUR_MS) * 100) / 100;
}

function freeGaps(window: Interval, busy: Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const slot of busy) {
    if (slot.end <= cursor) continue;
    if (slot.start >= window.end) break;
    if (slot.start > cursor) gaps.push({ start: cursor, end: slot.start });
    cursor = Math.max(cursor, slot.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps;
}

/**
 * Greedily packs the member's earliest free Mon–Fri working time (local server time)
 * between `now` (rounded up to the next 30 min) and `deadline` into 1–4h work blocks.
 */
export function findWorkBlocks(params: {
  member: TeamMember;
  estimatedHours: number;
  deadline: string;
  existingEvents: CalendarEvent[];
  now?: string;
  excludeTaskId?: string;
}): ScheduleBlocksResult {
  const { member, existingEvents, excludeTaskId } = params;
  const estimatedHours = Number.isFinite(params.estimatedHours)
    ? Math.max(0, params.estimatedHours)
    : 0;
  const startMs = roundUpToSlot(params.now ? new Date(params.now).getTime() : Date.now());
  const deadlineMs = new Date(params.deadline).getTime();
  const startHour = member.workdayStartHour ?? 9;
  const endHour = member.workdayEndHour ?? 18;

  const totalMs = Math.round(estimatedHours * HOUR_MS);
  let remainingMs = totalMs;
  const blocks: ProposedBlock[] = [];

  if (remainingMs > 0 && Number.isFinite(startMs) && Number.isFinite(deadlineMs)) {
    const busy: Interval[] = existingEvents
      .filter(
        (event) =>
          event.memberId === member.id && !(excludeTaskId && event.taskId === excludeTaskId),
      )
      .map((event) => ({
        start: new Date(event.start).getTime(),
        end: new Date(event.end).getTime(),
      }))
      .filter((slot) => Number.isFinite(slot.start) && Number.isFinite(slot.end))
      .sort((a, b) => a.start - b.start);

    const day = new Date(startMs);
    day.setHours(0, 0, 0, 0);

    while (remainingMs > 0 && day.getTime() < deadlineMs) {
      const weekday = day.getDay();
      if (weekday !== 0 && weekday !== 6) {
        const workStart = new Date(day);
        workStart.setHours(startHour, 0, 0, 0);
        const workEnd = new Date(day);
        workEnd.setHours(endHour, 0, 0, 0);
        const window = {
          start: Math.max(workStart.getTime(), startMs),
          end: Math.min(workEnd.getTime(), deadlineMs),
        };

        if (window.end > window.start) {
          for (const gap of freeGaps(window, busy)) {
            let cursor = gap.start;
            while (remainingMs > 0) {
              const available = gap.end - cursor;
              if (available < Math.min(MIN_BLOCK_MS, remainingMs)) break;
              const length = Math.min(MAX_BLOCK_MS, remainingMs, available);
              blocks.push({
                start: new Date(cursor).toISOString(),
                end: new Date(cursor + length).toISOString(),
              });
              // A 30-min break after a full 4h block keeps continuous focus time capped at 4h.
              cursor += length === MAX_BLOCK_MS ? length + SLOT_MS : length;
              remainingMs -= length;
            }
            if (remainingMs <= 0) break;
          }
        }
      }
      day.setDate(day.getDate() + 1);
    }
  }

  return {
    blocks,
    scheduledHours: toHours(totalMs - remainingMs),
    unscheduledHours: toHours(remainingMs),
  };
}
