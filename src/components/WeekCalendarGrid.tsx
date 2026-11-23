'use client';

import {
  computeTaskSpans,
  consolidateEvents,
  layoutOverlapColumns,
  meetingColorIndex,
  memberColorIndex,
  type GridEvent,
  type TaskSpan,
} from '@/lib/calendar/layout';
import type { Task, TeamMember } from '@/lib/types';

export { memberColorIndex, type GridEvent, type TaskSpan };

const START_HOUR = 9;
const END_HOUR = 18;
const HOUR_PX = 52;
const SPAN_ROW_PX = 24;
const DAY_MS = 24 * 60 * 60 * 1000;

const MEMBER_COLORS = [
  'bg-violet-600 border-violet-700 text-white',
  'bg-pink-600 border-pink-700 text-white',
  'bg-teal-600 border-teal-700 text-white',
  'bg-blue-600 border-blue-700 text-white',
];
const PREVIEW_COLORS = [
  'border-violet-500 text-violet-800 bg-violet-50/70',
  'border-pink-500 text-pink-800 bg-pink-50/70',
  'border-teal-500 text-teal-800 bg-teal-50/70',
  'border-blue-500 text-blue-800 bg-blue-50/70',
];
export const OWN_MEETING_COLORS = [
  'bg-violet-100 border-violet-300 border-l-4 border-l-violet-600 text-violet-900',
  'bg-pink-100 border-pink-300 border-l-4 border-l-pink-600 text-pink-900',
  'bg-teal-100 border-teal-300 border-l-4 border-l-teal-600 text-teal-900',
  'bg-blue-100 border-blue-300 border-l-4 border-l-blue-600 text-blue-900',
];
export const OTHER_MEETING_COLOR = 'bg-slate-200 border-slate-300 text-slate-700';
const SPAN_COLORS = [
  'bg-violet-100 border-violet-400 text-violet-900',
  'bg-pink-100 border-pink-400 text-pink-900',
  'bg-teal-100 border-teal-400 text-teal-900',
  'bg-blue-100 border-blue-400 text-blue-900',
];
const DEADLINE_CAP_COLORS = [
  'border-r-4 border-r-violet-700',
  'border-r-4 border-r-pink-700',
  'border-r-4 border-r-teal-700',
  'border-r-4 border-r-blue-700',
];
const DEADLINE_PILL_COLORS = ['bg-violet-700', 'bg-pink-700', 'bg-teal-700', 'bg-blue-700'];

export function memberDotClass(members: TeamMember[], memberId: string): string {
  return MEMBER_COLORS[memberColorIndex(members, memberId)].split(' ')[0];
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function MeetingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-0.5 inline h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

function MemberChip({ members, memberId }: { members: TeamMember[]; memberId: string }) {
  const name = members.find((m) => m.id === memberId)?.name ?? memberId;
  return (
    <span
      title={name}
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-0.5 text-[9px] font-semibold text-white ${memberDotClass(members, memberId)}`}
    >
      {initials(name)}
    </span>
  );
}

function TaskSpanStrip({
  spans,
  members,
  onSelectSpan,
}: {
  spans: TaskSpan[];
  members: TeamMember[];
  onSelectSpan: (span: TaskSpan) => void;
}) {
  const rows = spans.reduce((max, s) => Math.max(max, s.row + 1), 0);
  return (
    <div className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-slate-200 bg-white">
      <div className="px-1.5 py-1.5 text-right text-[10px] font-semibold uppercase leading-tight text-slate-400">
        Tasks<br />⚑ Due
      </div>
      <div className="relative border-l border-slate-200 py-1" style={{ height: Math.max(rows, 1) * SPAN_ROW_PX + 8 }}>
        <div className="pointer-events-none absolute inset-0 grid grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={i > 0 ? 'border-l border-slate-100' : ''} />
          ))}
        </div>
        {spans.length === 0 ? (
          <p className="relative px-2 py-0.5 text-[11px] text-slate-400">No two-party confirmed tasks this week.</p>
        ) : null}
        {spans.map((span) => {
          const color = memberColorIndex(members, span.assigneeId);
          const name = members.find((m) => m.id === span.assigneeId)?.name ?? span.assigneeId;
          const cap = span.deadlineInWeek ? DEADLINE_CAP_COLORS[color] : '';
          return (
            <button
              key={span.taskId}
              type="button"
              data-testid="task-span"
              onClick={() => onSelectSpan(span)}
              title={`${span.title} — ${name} · due ${new Date(span.deadline).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}`}
              className={`absolute flex items-center gap-1 overflow-hidden border px-1 text-left text-[11px] font-medium leading-none shadow-sm hover:z-10 hover:ring-2 hover:ring-indigo-400 ${SPAN_COLORS[color]} ${cap} ${
                span.continuesFromPrevWeek ? 'rounded-l-none' : 'rounded-l'
              } ${span.continuesToNextWeek ? 'rounded-r-none' : 'rounded-r'}`}
              style={{
                top: 4 + span.row * SPAN_ROW_PX,
                height: SPAN_ROW_PX - 4,
                left: `calc(${(span.startDay / 5) * 100}% + 2px)`,
                width: `calc(${((span.endDay - span.startDay + 1) / 5) * 100}% - 4px)`,
              }}
            >
              {span.continuesFromPrevWeek ? <span aria-label="continues from previous week">◀</span> : null}
              <MemberChip members={members} memberId={span.assigneeId} />
              <span className="min-w-0 flex-1 truncate">{span.title}</span>
              {span.deadlineInWeek ? (
                <span
                  data-testid="deadline-marker"
                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-white ${DEADLINE_PILL_COLORS[color]}`}
                >
                  ⚑ {span.deadlineLabel}
                </span>
              ) : null}
              {span.continuesToNextWeek ? <span aria-label="continues to next week">▶</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WeekCalendarGrid({
  monday,
  members,
  visibleMemberIds,
  events,
  tasks,
  currentUserId,
  onSelect,
  onSelectSpan,
}: {
  monday: Date;
  members: TeamMember[];
  visibleMemberIds: string[];
  events: GridEvent[];
  tasks: Task[];
  currentUserId?: string;
  onSelect: (event: GridEvent) => void;
  onSelectSpan: (span: TaskSpan) => void;
}) {
  const days = Array.from({ length: 5 }, (_, i) => new Date(monday.getTime() + i * DAY_MS));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const todayKey = new Date().toDateString();
  const shown = consolidateEvents(events, members, visibleMemberIds);
  const spans = computeTaskSpans(tasks, monday, visibleMemberIds);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))] border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
          <div />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={`border-l border-slate-200 px-2 py-2 ${day.toDateString() === todayKey ? 'bg-indigo-50 text-indigo-700' : ''}`}
            >
              {day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          ))}
        </div>

        <TaskSpanStrip spans={spans} members={members} onSelectSpan={onSelectSpan} />

        <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))]">
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((hour, i) => (
              <div key={hour} className="absolute right-2 text-[11px] text-slate-400" style={{ top: i * HOUR_PX - 6 }}>
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayStart = new Date(day);
            dayStart.setHours(START_HOUR, 0, 0, 0);
            const dayEnd = new Date(day);
            dayEnd.setHours(END_HOUR, 0, 0, 0);
            const dayEvents = shown
              .filter((e) => Date.parse(e.end) > dayStart.getTime() && Date.parse(e.start) < dayEnd.getTime())
              .map((event) => ({
                event,
                startMs: Math.max(Date.parse(event.start), dayStart.getTime()),
                endMs: Math.min(Date.parse(event.end), dayEnd.getTime()),
              }));
            const placements = layoutOverlapColumns(
              dayEvents.map(({ event, startMs, endMs }) => ({ id: event.id, startMs, endMs })),
            );
            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-slate-200"
                style={{ height: hours.length * HOUR_PX }}
              >
                {hours.map((hour, i) => (
                  <div key={hour} className="absolute inset-x-0 border-t border-slate-100" style={{ top: i * HOUR_PX }} />
                ))}
                {dayEvents.map(({ event, startMs, endMs }) => {
                  const { column, columns } = placements.get(event.id) ?? { column: 0, columns: 1 };
                  const top = ((startMs - dayStart.getTime()) / 3_600_000) * HOUR_PX;
                  const height = Math.max(((endMs - startMs) / 3_600_000) * HOUR_PX - 2, 14);
                  const attendees = event.attendeeIds ?? [event.memberId];
                  const names = attendees.map((id) => members.find((m) => m.id === id)?.name ?? id);
                  let style: string;
                  if (event.kind === 'meeting') {
                    const own = meetingColorIndex(members, attendees, currentUserId);
                    style = own === null ? OTHER_MEETING_COLOR : OWN_MEETING_COLORS[own];
                  } else {
                    const color = memberColorIndex(members, event.memberId);
                    style =
                      event.kind === 'work_block' ? MEMBER_COLORS[color] : `${PREVIEW_COLORS[color]} border-dashed border-2`;
                  }
                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-testid={`grid-${event.kind}`}
                      onClick={() => onSelect(event)}
                      title={`${event.title} — ${names.join(', ')}`}
                      className={`absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm hover:z-10 hover:ring-2 hover:ring-indigo-400 ${style}`}
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${(column / columns) * 100}% + 1px)`,
                        width: `calc(${100 / columns}% - 2px)`,
                      }}
                    >
                      <span className="flex items-start">
                        {event.kind === 'meeting' ? <MeetingIcon /> : null}
                        <span className="line-clamp-2 font-medium">
                          {event.kind === 'preview' ? 'Pending: ' : ''}
                          {event.title.replace(/^Work: /, '')}
                        </span>
                      </span>
                      {height > 28 ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-0.5">
                          {event.kind === 'meeting' && attendees.length > 1 ? (
                            <span className="mr-0.5 rounded bg-white/70 px-1 text-[9px] font-semibold text-slate-700">
                              {attendees.length} members
                            </span>
                          ) : null}
                          {event.kind === 'meeting' ? (
                            attendees.map((id) => <MemberChip key={id} members={members} memberId={id} />)
                          ) : (
                            <span className="opacity-80">{initials(names[0])}</span>
                          )}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
