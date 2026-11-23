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
import { FlagIcon } from './Icons';

export { memberColorIndex, type GridEvent, type TaskSpan };

const START_HOUR = 9;
const END_HOUR = 18;
const HOUR_PX = 52;
const SPAN_ROW_PX = 26;
const DAY_MS = 24 * 60 * 60 * 1000;

// Pastel washes with solid left accent bars and AAA #111827 Ink text (>= 7:1 contrast)
const MEMBER_WORK_STYLES = [
  'bg-[#EDE9FE] border-[#C4B5FD] border-l-[3px] border-l-[#6D28D9] text-[#111827]',
  'bg-[#FCE7F3] border-[#F9A8D4] border-l-[3px] border-l-[#BE185D] text-[#111827]',
  'bg-[#CCFBF1] border-[#5EEAD4] border-l-[3px] border-l-[#0F766E] text-[#111827]',
  'bg-[#DBEAFE] border-[#93C5FD] border-l-[3px] border-l-[#1D4ED8] text-[#111827]',
];
const MEMBER_DOTS = ['bg-[#6D28D9]', 'bg-[#BE185D]', 'bg-[#0F766E]', 'bg-[#1D4ED8]'];
const PREVIEW_COLORS = [
  'border-[#6D28D9] text-[#4C1D95] bg-[#F5F3FF]/85',
  'border-[#BE185D] text-[#831843] bg-[#FDF2F8]/85',
  'border-[#0F766E] text-[#134E4A] bg-[#F0FDFA]/85',
  'border-[#1D4ED8] text-[#1E3A8A] bg-[#EFF6FF]/85',
];
export const OWN_MEETING_COLORS = [
  'bg-hatch-meeting border-[#C4B5FD] border-l-[3px] border-l-[#6D28D9] text-[#111827]',
  'bg-hatch-meeting border-[#F9A8D4] border-l-[3px] border-l-[#BE185D] text-[#111827]',
  'bg-hatch-meeting border-[#5EEAD4] border-l-[3px] border-l-[#0F766E] text-[#111827]',
  'bg-hatch-meeting border-[#93C5FD] border-l-[3px] border-l-[#1D4ED8] text-[#111827]',
];
export const OTHER_MEETING_COLOR = 'bg-hatch-meeting border-[#D1CCC2] text-[#57534E]';
const SPAN_COLORS = [
  'bg-[#EDE9FE] border-[#C4B5FD] text-[#111827]',
  'bg-[#FCE7F3] border-[#F9A8D4] text-[#111827]',
  'bg-[#CCFBF1] border-[#5EEAD4] text-[#111827]',
  'bg-[#DBEAFE] border-[#93C5FD] text-[#111827]',
];
const DEADLINE_CAP_COLORS = [
  'border-r-[3px] border-r-[#6D28D9]',
  'border-r-[3px] border-r-[#BE185D]',
  'border-r-[3px] border-r-[#0F766E]',
  'border-r-[3px] border-r-[#1D4ED8]',
];
const DEADLINE_PILL_COLORS = ['bg-[#6D28D9]', 'bg-[#BE185D]', 'bg-[#0F766E]', 'bg-[#1D4ED8]'];

export function memberDotClass(members: TeamMember[], memberId: string): string {
  return MEMBER_DOTS[memberColorIndex(members, memberId)];
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
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mr-1 inline h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
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
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-0.5 text-[9px] font-bold text-white ${memberDotClass(members, memberId)}`}
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
    <div className="grid grid-cols-[56px_minmax(0,1fr)] border-b border-[#E5E2DC] bg-[#F7F6F2]">
      <div className="flex flex-col items-end justify-center px-1.5 py-1.5 font-mono text-[9px] font-bold uppercase leading-tight text-[#78716C]">
        <span>Spans</span>
        <span>Due</span>
      </div>
      <div
        className="relative border-l border-[#E5E2DC] py-1"
        style={{ height: Math.max(rows, 1) * SPAN_ROW_PX + 8 }}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={i > 0 ? 'border-l border-[#E5E2DC]/60' : ''} />
          ))}
        </div>
        {spans.length === 0 ? (
          <p className="relative px-2 py-1 text-[11px] text-[#78716C]">
            No mutually confirmed task spans this week.
          </p>
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
              className={`absolute flex items-center gap-1 overflow-hidden border px-1.5 text-left text-[11px] font-semibold leading-none shadow-sm hover:z-10 hover:ring-2 hover:ring-[#111827] ${SPAN_COLORS[color]} ${cap} ${
                span.continuesFromPrevWeek ? 'rounded-l-none' : 'rounded-l'
              } ${span.continuesToNextWeek ? 'rounded-r-none' : 'rounded-r'}`}
              style={{
                top: 4 + span.row * SPAN_ROW_PX,
                height: SPAN_ROW_PX - 4,
                left: `calc(${(span.startDay / 5) * 100}% + 2px)`,
                width: `calc(${((span.endDay - span.startDay + 1) / 5) * 100}% - 4px)`,
              }}
            >
              <MemberChip members={members} memberId={span.assigneeId} />
              <span className="min-w-0 flex-1 truncate">{span.title}</span>
              {span.deadlineInWeek ? (
                <span
                  data-testid="deadline-marker"
                  className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9.5px] font-bold text-white tabular-nums ${DEADLINE_PILL_COLORS[color]}`}
                >
                  <FlagIcon className="h-2.5 w-2.5" />
                  {span.deadlineLabel}
                </span>
              ) : null}
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
  const now = new Date();
  const todayKey = now.toDateString();
  const nowMinutes = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  const showNowLine = nowMinutes >= 0 && nowMinutes <= (END_HOUR - START_HOUR) * 60;
  const nowTopPx = (nowMinutes / 60) * HOUR_PX;

  const shown = consolidateEvents(events, members, visibleMemberIds);
  const spans = computeTaskSpans(tasks, monday, visibleMemberIds);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E5E2DC] bg-white shadow-sm">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))] border-b border-[#E5E2DC] bg-[#F7F6F2] text-xs font-semibold text-[#57534E]">
          <div />
          {days.map((day) => {
            const isToday = day.toDateString() === todayKey;
            return (
              <div
                key={day.toISOString()}
                className={`border-l border-[#E5E2DC] px-2.5 py-2 ${
                  isToday ? 'bg-[#FFF1F2]/60 text-[#BE123C]' : ''
                }`}
              >
                <span>
                  {day.toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                {isToday ? (
                  <span className="ml-1.5 font-mono text-[10px] font-bold uppercase">Today</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <TaskSpanStrip spans={spans} members={members} onSelectSpan={onSelectSpan} />

        <div className="grid grid-cols-[56px_repeat(5,minmax(0,1fr))]">
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((hour, i) => (
              <div
                key={hour}
                className="absolute right-2 font-mono text-[10px] text-[#78716C] tabular-nums"
                style={{ top: i * HOUR_PX - 6 }}
              >
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayStart = new Date(day);
            dayStart.setHours(START_HOUR, 0, 0, 0);
            const dayEnd = new Date(day);
            dayEnd.setHours(END_HOUR, 0, 0, 0);
            const isToday = day.toDateString() === todayKey;
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
                className="relative border-l border-[#E5E2DC]"
                style={{ height: hours.length * HOUR_PX }}
              >
                {hours.map((hour, i) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-[#F3F2ED]"
                    style={{ top: i * HOUR_PX }}
                  />
                ))}

                {/* Live Now indicator rendered underneath event blocks (z-0 vs pills z-10) */}
                {isToday && showNowLine ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-0 border-t-2 border-[#BE123C]"
                    style={{ top: nowTopPx }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[#BE123C]" />
                  </div>
                ) : null}

                {dayEvents.map(({ event, startMs, endMs }) => {
                  const { column, columns } = placements.get(event.id) ?? { column: 0, columns: 1 };
                  const top = ((startMs - dayStart.getTime()) / 3_600_000) * HOUR_PX;
                  const height = Math.max(((endMs - startMs) / 3_600_000) * HOUR_PX - 2, 18);
                  const attendees = event.attendeeIds ?? [event.memberId];
                  const names = attendees.map((id) => members.find((m) => m.id === id)?.name ?? id);
                  let style: string;
                  if (event.kind === 'meeting') {
                    const own = meetingColorIndex(members, attendees, currentUserId);
                    style = own === null ? OTHER_MEETING_COLOR : OWN_MEETING_COLORS[own];
                  } else {
                    const color = memberColorIndex(members, event.memberId);
                    style =
                      event.kind === 'work_block'
                        ? MEMBER_WORK_STYLES[color]
                        : `${PREVIEW_COLORS[color]} border-dashed border-[1.5px]`;
                  }
                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-testid={`grid-${event.kind}`}
                      onClick={() => onSelect(event)}
                      title={`${event.title} — ${names.join(', ')}`}
                      className={`absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition-shadow hover:z-20 hover:ring-2 hover:ring-[#111827] ${style}`}
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${(column / columns) * 100}% + 2px)`,
                        width: `calc(${100 / columns}% - 4px)`,
                      }}
                    >
                      <span className="flex items-start">
                        {event.kind === 'meeting' ? <MeetingIcon /> : null}
                        <span className="line-clamp-2 font-semibold">
                          {event.kind === 'preview' ? 'Pending: ' : ''}
                          {event.title.replace(/^Work: /, '')}
                        </span>
                      </span>
                      {height > 30 ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-0.5">
                          {event.kind === 'meeting' && attendees.length > 1 ? (
                            <span className="mr-0.5 rounded bg-white/80 px-1 font-mono text-[9px] font-semibold text-[#57534E]">
                              {attendees.length}
                            </span>
                          ) : null}
                          {event.kind === 'meeting' ? (
                            attendees.map((id) => (
                              <MemberChip key={id} members={members} memberId={id} />
                            ))
                          ) : (
                            <span className="font-mono text-[10px] opacity-80">
                              {initials(names[0])}
                            </span>
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
