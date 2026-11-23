'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getWorkweekMonday } from '@/lib/seed';
import type { CalendarEvent, ProposedBlock, ScheduleBlocksResult, TeamMember } from '@/lib/types';
import { apiFetch, formatDateTime, hoursText, memberName, Spinner } from './ui';

const DAY_MS = 24 * 60 * 60 * 1000;

function totalBlockHours(blocks: ProposedBlock[]): number {
  return blocks.reduce(
    (sum, b) => sum + Math.max(0, (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000),
    0,
  );
}

function sameLocalDay(iso: string, day: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

function durationHours(start: string, end: string): number {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000);
}

export function MiniCalendarStrip({
  members,
  assigneeId,
  deadline,
  estimatedHours,
  calendarEvents,
  frozenBlocks,
  excludeTaskId,
  isCommitted = false,
}: {
  members: TeamMember[];
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  calendarEvents: CalendarEvent[];
  /** When set (e.g. reviewing a submitted proposal), displays these exact frozen blocks instead of calling preview API. */
  frozenBlocks?: ProposedBlock[];
  excludeTaskId?: string;
  isCommitted?: boolean;
}) {
  const [preview, setPreview] = useState<ScheduleBlocksResult | null>(null);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  const shouldFetchLive =
    frozenBlocks === undefined &&
    Boolean(assigneeId) &&
    Boolean(deadline) &&
    Number.isFinite(estimatedHours) &&
    estimatedHours > 0;

  useEffect(() => {
    if (!shouldFetchLive) {
      setPreview(null);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch<ScheduleBlocksResult>('/api/calendar', {
          method: 'POST',
          body: { memberId: assigneeId, estimatedHours, deadline, excludeTaskId },
          signal: controller.signal,
        });
        if (seq !== seqRef.current) return;
        if (res.ok) setPreview(res.data);
      } catch {
        // Ignore aborted preview fetches
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [shouldFetchLive, assigneeId, deadline, estimatedHours, excludeTaskId]);

  const blocks = frozenBlocks ?? preview?.blocks ?? [];
  const scheduledHours =
    frozenBlocks !== undefined
      ? totalBlockHours(frozenBlocks)
      : (preview?.scheduledHours ?? 0);
  const unscheduledHours =
    frozenBlocks !== undefined
      ? Math.max(0, estimatedHours - scheduledHours)
      : (preview?.unscheduledHours ?? 0);

  // Anchor strip to first proposed block or deadline workweek so next-week deadlines never look empty.
  const monday = useMemo(() => {
    const anchorIso = blocks[0]?.start ?? (deadline || new Date().toISOString());
    const anchorDate = new Date(anchorIso);
    return getWorkweekMonday(Number.isNaN(anchorDate.getTime()) ? new Date() : anchorDate);
  }, [blocks, deadline]);

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => new Date(monday.getTime() + i * DAY_MS)),
    [monday],
  );

  const memberEvents = useMemo(
    () => calendarEvents.filter((e) => e.memberId === assigneeId),
    [calendarEvents, assigneeId],
  );

  if (!assigneeId) {
    return (
      <div className="rounded-lg border border-dashed border-[#D1CCC2] bg-[#F7F6F2] px-3 py-2.5 text-xs text-[#78716C]">
        Select an assignee above to preview how work blocks fit into their week.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2 font-semibold text-[#111827]">
          <span>
            Decision on Calendar — {memberName(members, assigneeId)} (Week of{' '}
            {monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
          </span>
          {loading ? (
            <span className="inline-flex items-center gap-1 font-normal text-[#78716C]">
              <Spinner /> placing
            </span>
          ) : null}
        </div>
        <span
          className={`font-mono font-semibold tabular-nums ${
            unscheduledHours > 0 ? 'text-[#BE123C]' : 'text-[#047857]'
          }`}
        >
          {isCommitted ? 'Booked' : 'Placed'}: {hoursText(scheduledHours)} of{' '}
          {hoursText(estimatedHours)}
          {unscheduledHours > 0 ? ` · ${hoursText(unscheduledHours)} unplaced` : ' · fits cleanly'}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {days.map((day) => {
          const dayMtgs = memberEvents.filter(
            (e) => e.kind === 'meeting' && sameLocalDay(e.start, day),
          );
          const mtgHrs = dayMtgs.reduce((s, e) => s + durationHours(e.start, e.end), 0);
          const dayBooked = memberEvents.filter(
            (e) =>
              e.kind === 'work_block' &&
              e.taskId !== excludeTaskId &&
              sameLocalDay(e.start, day),
          );
          const dayOwnBooked = excludeTaskId
            ? memberEvents.filter(
                (e) =>
                  e.kind === 'work_block' &&
                  e.taskId === excludeTaskId &&
                  sameLocalDay(e.start, day),
              )
            : [];
          const dayProposed = blocks.filter((b) => sameLocalDay(b.start, day));
          const isDeadlineDay = Boolean(deadline) && sameLocalDay(deadline, day);

          return (
            <div
              key={day.toISOString()}
              className={`min-h-[68px] rounded-md border bg-white p-1.5 ${
                isDeadlineDay ? 'border-[#E5E2DC] border-r-[3px] border-r-[#111827]' : 'border-[#E5E2DC]'
              }`}
            >
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[#78716C]">
                <span>
                  {day.toLocaleDateString('en-US', { weekday: 'short' })} {day.getDate()}
                </span>
                {isDeadlineDay ? (
                  <span className="font-bold text-[#111827]">Due</span>
                ) : null}
              </div>

              <div className="space-y-1">
                {mtgHrs > 0 ? (
                  <div
                    className="bg-hatch-meeting truncate rounded border border-[#D1CCC2] px-1.5 py-0.5 text-[10px] font-medium text-[#57534E]"
                    title={dayMtgs.map((m) => m.title).join(', ')}
                  >
                    Mtgs {hoursText(mtgHrs)}
                  </div>
                ) : null}

                {dayBooked.map((ev) => (
                  <div
                    key={ev.id}
                    className="truncate rounded border-l-2 border-l-[#2563EB] bg-[#DBEAFE] px-1.5 py-0.5 text-[10px] font-semibold text-[#111827]"
                    title={`${ev.title} (${hoursText(durationHours(ev.start, ev.end))})`}
                  >
                    {ev.title.replace(/^Work:\s*/, '')} ({hoursText(durationHours(ev.start, ev.end))})
                  </div>
                ))}

                {dayOwnBooked.map((ev) => (
                  <div
                    key={ev.id}
                    className="truncate rounded border-l-2 border-l-[#0F766E] bg-[#CCFBF1] px-1.5 py-0.5 text-[10px] font-semibold text-[#111827]"
                    title={`Live booked block: ${ev.title}`}
                  >
                    Live: {hoursText(durationHours(ev.start, ev.end))}
                  </div>
                ))}

                {!isCommitted &&
                  dayProposed.map((blk) => (
                    <div
                      key={blk.start}
                      className="truncate rounded border border-dashed border-[#047857] bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-semibold text-[#047857]"
                      title={`Proposed slot: ${formatDateTime(blk.start)}`}
                    >
                      New {hoursText(durationHours(blk.start, blk.end))}
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {unscheduledHours > 0 ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#FECDD3] bg-[#FFF1F2] px-2.5 py-1.5 text-[11px] font-semibold text-[#BE123C]">
          <span>
            {hoursText(unscheduledHours)} will not fit before {formatDateTime(deadline)} — extend
            deadline, trim scope, or accept partial placement explicitly.
          </span>
          <span className="font-mono tabular-nums">
            {hoursText(scheduledHours)} / {hoursText(estimatedHours)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
