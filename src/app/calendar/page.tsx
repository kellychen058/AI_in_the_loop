'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { HandshakeStrip } from '@/components/HandshakeStrip';
import { MemberCapacitySidebar } from '@/components/MemberCapacitySidebar';
import { ReceiptRail } from '@/components/ReceiptRail';
import { Banner, buttonClass, Drawer, formatDateTime, memberName, StatusPill } from '@/components/ui';
import {
  memberColorIndex,
  memberDotClass,
  OTHER_MEETING_COLOR,
  OWN_MEETING_COLORS,
  WeekCalendarGrid,
  type GridEvent,
  type TaskSpan,
} from '@/components/WeekCalendarGrid';
import { usePersona } from '@/context/PersonaContext';
import { getWorkweekMonday } from '@/lib/seed';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function CalendarPage() {
  const { db, error, currentUser } = usePersona();
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [weekOffset, setWeekOffset] = useState(0);
  const [showPreviews, setShowPreviews] = useState(true);
  const [mobileDayIdx, setMobileDayIdx] = useState(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d - 1 : 0;
  });
  const [selected, setSelected] = useState<GridEvent | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TaskSpan | null>(null);

  const members = useMemo(() => db?.members ?? [], [db]);

  const { monday, weekEnd, days } = useMemo(() => {
    const start = getWorkweekMonday(new Date());
    start.setDate(start.getDate() + weekOffset * 7);
    const list = Array.from({ length: 5 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
    return { monday: start, weekEnd: new Date(start.getTime() + 5 * DAY_MS), days: list };
  }, [weekOffset]);

  const visibleMemberIds = memberFilter === 'all' ? members.map((m) => m.id) : [memberFilter];

  const events = useMemo<GridEvent[]>(() => {
    if (!db) return [];
    const committed: GridEvent[] = db.calendarEvents.map((e) => ({ ...e }));
    const previews: GridEvent[] = showPreviews
      ? db.tasks
          .filter((t) => t.status === 'pending_assignee' || t.status === 'counter_proposed')
          .flatMap((t) =>
            t.currentProposal.proposedBlocks.map((block, i) => ({
              id: `preview-${t.id}-v${t.currentProposal.version}-${i}`,
              memberId: t.currentProposal.assigneeId,
              title: t.title,
              start: block.start,
              end: block.end,
              kind: 'preview' as const,
              taskId: t.id,
            })),
          )
      : [];
    return [...committed, ...previews].filter(
      (e) => Date.parse(e.end) > monday.getTime() && Date.parse(e.start) < weekEnd.getTime(),
    );
  }, [db, showPreviews, monday, weekEnd]);

  const exportHref =
    memberFilter === 'all'
      ? '/api/calendar/export'
      : `/api/calendar/export?memberId=${encodeURIComponent(memberFilter)}`;

  const drawerTaskId = selected?.taskId ?? selectedSpan?.taskId;
  const drawerTask = drawerTaskId ? db?.tasks.find((t) => t.id === drawerTaskId) : undefined;
  const drawerAudit = drawerTaskId
    ? (db?.auditLog.filter((e) => e.taskId === drawerTaskId) ?? [])
    : [];
  const ownColor = currentUser ? memberColorIndex(members, currentUser.id) : 0;

  // Mobile single-day agenda events
  const activeMobileDay = days[mobileDayIdx] ?? days[0];
  const mobileDayEvents = useMemo(() => {
    if (!activeMobileDay) return [];
    const start = new Date(activeMobileDay);
    start.setHours(0, 0, 0, 0);
    const end = new Date(activeMobileDay);
    end.setHours(23, 59, 59, 999);
    const visible = new Set(visibleMemberIds);
    return events
      .filter(
        (e) =>
          visible.has(e.memberId) &&
          Date.parse(e.end) > start.getTime() &&
          Date.parse(e.start) < end.getTime(),
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  }, [activeMobileDay, events, visibleMemberIds]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#111827]">Living Team Schedule</h1>
          <p className="text-xs text-[#57534E]">
            Week of{' '}
            {monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}{' '}
            · Solid blocks are mutually confirmed; dashed ghosts await a second signature.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#D1CCC2] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#111827]">
            <input
              type="checkbox"
              checked={showPreviews}
              onChange={(e) => setShowPreviews(e.target.checked)}
              className="accent-[#111827]"
            />
            Pending Ghosts
          </label>
          <div className="inline-flex rounded-lg border border-[#D1CCC2] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-[#57534E] hover:bg-[#F7F6F2] hover:text-[#111827]"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              disabled={weekOffset === 0}
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-[#111827] hover:bg-[#F7F6F2] disabled:opacity-40"
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="rounded-md px-2.5 py-1 text-xs font-semibold text-[#57534E] hover:bg-[#F7F6F2] hover:text-[#111827]"
            >
              Next
            </button>
          </div>
          <a href={exportHref} download className={buttonClass.secondary}>
            Export .ics
          </a>
        </div>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}

      {db ? (
        <>
          {/* Compact Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#57534E]">
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-3 w-4 rounded-sm border ${OWN_MEETING_COLORS[ownColor]}`} />
              Your meeting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`inline-block h-3 w-4 rounded-sm border ${OTHER_MEETING_COLOR}`} />
              Team meeting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-3 w-4 rounded-sm border-l-[3px] border-l-[#0F766E] bg-[#CCFBF1]`}
              />
              Confirmed work block
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm border-[1.5px] border-dashed border-[#047857] bg-[#ECFDF5]" />
              Pending ghost (not booked)
            </span>
          </div>

          {/* Mobile Single-Day Agenda (<768px) */}
          <section className="space-y-3 md:hidden">
            <div className="grid grid-cols-5 gap-1.5">
              {days.map((day, idx) => (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setMobileDayIdx(idx)}
                  className={`rounded-lg border py-1.5 text-center text-xs font-semibold ${
                    mobileDayIdx === idx
                      ? 'border-[#111827] bg-[#111827] text-white'
                      : 'border-[#E5E2DC] bg-white text-[#57534E]'
                  }`}
                >
                  {day.toLocaleDateString('en-US', { weekday: 'short' })}
                </button>
              ))}
            </div>

            <div className="space-y-2 rounded-xl border border-[#E5E2DC] bg-white p-3">
              {mobileDayEvents.length === 0 ? (
                <p className="py-4 text-center text-xs text-[#78716C]">
                  No scheduled blocks for this day.
                </p>
              ) : (
                mobileDayEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setSelected(ev)}
                    className={`block w-full rounded-lg border px-3 py-2 text-left text-xs ${
                      ev.kind === 'meeting'
                        ? 'bg-hatch-meeting border-[#D1CCC2] text-[#57534E]'
                        : ev.kind === 'work_block'
                          ? 'border-[#5EEAD4] border-l-[3px] border-l-[#0F766E] bg-[#CCFBF1] text-[#111827]'
                          : 'border-dashed border-[#047857] bg-[#ECFDF5] text-[#047857]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                      <span>
                        {new Date(ev.start).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                        –
                        {new Date(ev.end).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </span>
                      <span>{memberName(members, ev.memberId)}</span>
                    </div>
                    <p className="mt-0.5 font-semibold">
                      {ev.kind === 'preview' ? 'Pending: ' : ''}
                      {ev.title.replace(/^Work:\s*/, '')}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* Desktop Week Grid + Interactive Capacity Sidebar */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px] lg:items-start">
            <div className="hidden md:block">
              <WeekCalendarGrid
                monday={monday}
                members={members}
                visibleMemberIds={visibleMemberIds}
                events={events}
                tasks={db.tasks}
                currentUserId={currentUser?.id}
                onSelect={(ev) => {
                  setSelectedSpan(null);
                  setSelected(ev);
                }}
                onSelectSpan={(sp) => {
                  setSelected(null);
                  setSelectedSpan(sp);
                }}
              />
            </div>
            <MemberCapacitySidebar
              members={members}
              events={db.calendarEvents}
              weekStart={monday}
              weekEnd={weekEnd}
              selectedMemberId={memberFilter}
              onSelectMember={setMemberFilter}
            />
          </div>
        </>
      ) : (
        <p className="text-xs text-[#78716C]">Loading calendar…</p>
      )}

      {/* Slide-Over Task / Event Inspector Drawer */}
      {selected || selectedSpan ? (
        <Drawer
          title={selected ? selected.title.replace(/^Work:\s*/, '') : selectedSpan!.title}
          subtitle={
            selected
              ? selected.kind === 'meeting'
                ? 'Scheduled Team Meeting'
                : selected.kind === 'work_block'
                  ? 'Confirmed Task Work Block'
                  : 'Pending Proposal Ghost — Not Yet Booked'
              : 'Mutually Confirmed Task Span'
          }
          onClose={() => {
            setSelected(null);
            setSelectedSpan(null);
          }}
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 rounded-xl border border-[#E5E2DC] bg-white p-3.5 text-xs">
              {selected?.kind === 'meeting' ? (
                <>
                  <dt className="text-[#78716C]">Attendees</dt>
                  <dd className="space-y-1">
                    {(selected.attendeeIds ?? [selected.memberId]).map((id) => (
                      <div key={id} className="flex items-center gap-1.5 font-medium text-[#111827]">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${memberDotClass(members, id)}`}
                        />
                        {memberName(members, id)}
                        {id === currentUser?.id ? (
                          <span className="text-[#78716C]">(you)</span>
                        ) : null}
                      </div>
                    ))}
                  </dd>
                </>
              ) : (
                <>
                  <dt className="text-[#78716C]">Owner</dt>
                  <dd className="font-semibold text-[#111827]">
                    {memberName(members, selected?.memberId ?? selectedSpan?.assigneeId)}
                  </dd>
                </>
              )}

              {selected ? (
                <>
                  <dt className="text-[#78716C]">Time Slot</dt>
                  <dd className="font-mono text-[#111827] tabular-nums">
                    {formatDateTime(selected.start)} –{' '}
                    {new Date(selected.end).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </dd>
                </>
              ) : null}

              {drawerTask ? (
                <>
                  <dt className="text-[#78716C]">Status</dt>
                  <dd>
                    <StatusPill status={drawerTask.status} />
                  </dd>
                  <dt className="text-[#78716C]">Deadline</dt>
                  <dd className="font-mono font-semibold text-[#111827] tabular-nums">
                    {formatDateTime(drawerTask.currentProposal.deadline)}
                  </dd>
                </>
              ) : null}
            </dl>

            {drawerTask ? (
              <>
                <HandshakeStrip task={drawerTask} members={members} />
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/?task=${encodeURIComponent(drawerTask.id)}`}
                    className={buttonClass.primary}
                  >
                    Open Contract in Desk
                  </Link>
                  <Link href="/decisions" className={buttonClass.secondary}>
                    Open Trust Ledger
                  </Link>
                </div>
                <div className="rounded-xl border border-[#E5E2DC] bg-white p-3.5">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                    Task Receipts ({drawerAudit.length})
                  </p>
                  <ReceiptRail entries={drawerAudit} members={members} />
                </div>
              </>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}
