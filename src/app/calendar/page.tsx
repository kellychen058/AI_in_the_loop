'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MemberCapacitySidebar } from '@/components/MemberCapacitySidebar';
import { Banner, buttonClass, errorText, formatDateTime, apiFetch, memberName, Modal, StatusPill } from '@/components/ui';
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
  const { db, error, refreshDb, currentUser } = usePersona();
  const [memberFilter, setMemberFilter] = useState<string>('all');
  const [weekOffset, setWeekOffset] = useState(0);
  const [showPreviews, setShowPreviews] = useState(false);
  const [selected, setSelected] = useState<GridEvent | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TaskSpan | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const members = useMemo(() => db?.members ?? [], [db]);
  const simulateFailure = db?.settings.simulateCalendarFailure ?? false;

  const { monday, weekEnd } = useMemo(() => {
    const start = getWorkweekMonday(new Date());
    start.setDate(start.getDate() + weekOffset * 7);
    return { monday: start, weekEnd: new Date(start.getTime() + 5 * DAY_MS) };
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

  async function toggleFailure() {
    setToggling(true);
    setToggleError(null);
    const result = await apiFetch('/api/calendar', {
      method: 'PATCH',
      body: { simulateCalendarFailure: !simulateFailure },
    });
    setToggling(false);
    if (!result.ok) setToggleError(errorText(result));
    await refreshDb();
  }

  const exportHref =
    memberFilter === 'all' ? '/api/calendar/export' : `/api/calendar/export?memberId=${encodeURIComponent(memberFilter)}`;
  const selectedTask = selected?.taskId ? db?.tasks.find((t) => t.id === selected.taskId) : undefined;
  const spanTask = selectedSpan ? db?.tasks.find((t) => t.id === selectedSpan.taskId) : undefined;
  const ownColor = currentUser ? memberColorIndex(members, currentUser.id) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Shared Team Calendar</h1>
          <p className="mt-1 text-sm text-slate-600">
            Meetings and confirmed work blocks. Work blocks appear only after both sides confirm.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {simulateFailure ? (
            <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
              ⚠ Sync failure simulation ON
            </span>
          ) : null}
          <button
            type="button"
            role="switch"
            aria-checked={simulateFailure}
            onClick={toggleFailure}
            disabled={toggling || !db}
            className={simulateFailure ? buttonClass.danger : buttonClass.secondary}
          >
            Simulate Calendar Sync Failure: {simulateFailure ? 'ON' : 'OFF'}
          </button>
          <a href={exportHref} download className={buttonClass.secondary}>
            Export .ics
          </a>
          <button type="button" onClick={() => void refreshDb()} className={buttonClass.secondary}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
      {toggleError ? <Banner tone="error">{toggleError}</Banner> : null}
      {simulateFailure ? (
        <Banner tone="warning" title="Calendar provider outage is being simulated">
          New confirmations will end in <code>sync_failed</code>. Turn this off, then use{' '}
          <strong>Retry Calendar Sync</strong> in the Inbox to recover.
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Member filter">
          {[{ id: 'all', label: 'All Team' }, ...members.map((m) => ({ id: m.id, label: `${m.name.split(' ')[0]} (${m.role})` }))].map(
            (tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={memberFilter === tab.id}
                onClick={() => setMemberFilter(tab.id)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  memberFilter === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={showPreviews} onChange={(e) => setShowPreviews(e.target.checked)} />
            Show Pending Previews (dashed)
          </label>
          <button type="button" className={buttonClass.secondary} onClick={() => setWeekOffset((w) => w - 1)}>
            ← Prev
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
            Current Workweek
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => setWeekOffset((w) => w + 1)}>
            Next →
          </button>
        </div>
      </div>

      {db ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>
              Week of {monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`inline-block h-3 w-4 rounded-sm border ${OWN_MEETING_COLORS[ownColor]}`} /> your meeting
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`inline-block h-3 w-4 rounded-sm border ${OTHER_MEETING_COLOR}`} /> other meeting
            </span>
            <span className="inline-flex items-center gap-1">
              <span className={`inline-block h-3 w-4 rounded-sm ${currentUser ? memberDotClass(members, currentUser.id) : 'bg-indigo-600'}`} />{' '}
              confirmed work block
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-4 rounded-sm border-2 border-dashed border-slate-500" /> pending preview (not on
              calendar)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex h-3 w-8 items-center justify-end rounded-sm border border-slate-400 border-r-4 border-r-slate-700 bg-slate-100" />
              <span className="rounded bg-slate-700 px-1 text-[10px] font-bold text-white">⚑ 18:00</span> confirmed task span +
              deadline
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <WeekCalendarGrid
              monday={monday}
              members={members}
              visibleMemberIds={visibleMemberIds}
              events={events}
              tasks={db.tasks}
              currentUserId={currentUser?.id}
              onSelect={setSelected}
              onSelectSpan={setSelectedSpan}
            />
            <MemberCapacitySidebar members={members} events={db.calendarEvents} weekStart={monday} weekEnd={weekEnd} />
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}

      {selected ? (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Type</dt>
            <dd>
              {selected.kind === 'meeting'
                ? 'Existing meeting'
                : selected.kind === 'work_block'
                  ? 'Confirmed task work block'
                  : 'Pending preview — not written to the calendar yet'}
            </dd>
            {selected.kind === 'meeting' ? (
              <>
                <dt className="text-slate-500">Attendees ({(selected.attendeeIds ?? [selected.memberId]).length})</dt>
                <dd>
                  <ul className="space-y-0.5">
                    {(selected.attendeeIds ?? [selected.memberId]).map((id) => (
                      <li key={id} className="flex items-center gap-1.5">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${memberDotClass(members, id)}`} />
                        {memberName(members, id)}
                        {id === currentUser?.id ? <span className="text-xs text-slate-500">(you)</span> : null}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : (
              <>
                <dt className="text-slate-500">Member</dt>
                <dd>{memberName(members, selected.memberId)}</dd>
              </>
            )}
            <dt className="text-slate-500">Time</dt>
            <dd>
              {formatDateTime(selected.start)} – {new Date(selected.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </dd>
            {selectedTask ? (
              <>
                <dt className="text-slate-500">Task</dt>
                <dd className="font-medium">{selectedTask.title}</dd>
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusPill status={selectedTask.status} />
                </dd>
                <dt className="text-slate-500">Assignee</dt>
                <dd>{memberName(members, selectedTask.currentProposal.assigneeId)}</dd>
                <dt className="text-slate-500">Version</dt>
                <dd>
                  {selectedTask.confirmedVersion ? `Confirmed v${selectedTask.confirmedVersion}` : 'Not confirmed'}
                  {selectedTask.currentProposal.version !== selectedTask.confirmedVersion
                    ? ` · current proposal v${selectedTask.currentProposal.version}`
                    : ''}
                </dd>
                <dt className="text-slate-500">Deadline</dt>
                <dd>{formatDateTime(selectedTask.currentProposal.deadline)}</dd>
              </>
            ) : null}
          </dl>
          {selected.taskId ? (
            <div className="mt-4 flex gap-2">
              <Link href="/inbox" className={buttonClass.secondary}>
                Open in Inbox
              </Link>
              <Link href="/decisions" className={buttonClass.secondary}>
                View decision log
              </Link>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {selectedSpan ? (
        <Modal title={selectedSpan.title} onClose={() => setSelectedSpan(null)}>
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">Type</dt>
            <dd>Confirmed task span</dd>
            <dt className="text-slate-500">Assignee</dt>
            <dd className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${memberDotClass(members, selectedSpan.assigneeId)}`} />
              {memberName(members, selectedSpan.assigneeId)}
            </dd>
            <dt className="text-slate-500">Two-party confirmed</dt>
            <dd>{formatDateTime(selectedSpan.confirmedAt)}</dd>
            <dt className="text-slate-500">Deadline</dt>
            <dd className="font-medium">⚑ {formatDateTime(selectedSpan.deadline)}</dd>
            {spanTask ? (
              <>
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusPill status={spanTask.status} />
                </dd>
                <dt className="text-slate-500">Version</dt>
                <dd>
                  {spanTask.confirmedVersion ? `Confirmed v${spanTask.confirmedVersion}` : 'Not confirmed'}
                  {spanTask.currentProposal.version !== spanTask.confirmedVersion
                    ? ` · current proposal v${spanTask.currentProposal.version}`
                    : ''}
                </dd>
              </>
            ) : null}
          </dl>
          <div className="mt-4 flex gap-2">
            <Link href="/inbox" className={buttonClass.secondary}>
              Open in Inbox
            </Link>
            <Link href="/decisions" className={buttonClass.secondary}>
              View decision log
            </Link>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
