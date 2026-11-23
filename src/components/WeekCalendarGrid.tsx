'use client';

import type { TeamMember } from '@/lib/types';

export interface GridEvent {
  id: string;
  memberId: string;
  title: string;
  start: string;
  end: string;
  kind: 'meeting' | 'work_block' | 'preview';
  taskId?: string;
}

const START_HOUR = 9;
const END_HOUR = 18;
const HOUR_PX = 52;
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

export function memberColorIndex(members: TeamMember[], memberId: string): number {
  const index = members.findIndex((m) => m.id === memberId);
  return (index < 0 ? 0 : index) % MEMBER_COLORS.length;
}

export function memberDotClass(members: TeamMember[], memberId: string): string {
  return MEMBER_COLORS[memberColorIndex(members, memberId)].split(' ')[0];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function MeetingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-0.5 inline h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

export function WeekCalendarGrid({
  monday,
  members,
  visibleMemberIds,
  events,
  onSelect,
}: {
  monday: Date;
  members: TeamMember[];
  visibleMemberIds: string[];
  events: GridEvent[];
  onSelect: (event: GridEvent) => void;
}) {
  const days = Array.from({ length: 5 }, (_, i) => new Date(monday.getTime() + i * DAY_MS));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const lanes = visibleMemberIds.length;
  const todayKey = new Date().toDateString();

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
              {lanes > 1 ? (
                <div className="mt-1 flex gap-0.5">
                  {visibleMemberIds.map((id) => (
                    <span key={id} className="flex-1 truncate text-center text-[10px] font-normal text-slate-500">
                      {initials(members.find((m) => m.id === id)?.name ?? id)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

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
            const dayEvents = events.filter(
              (e) => Date.parse(e.end) > dayStart.getTime() && Date.parse(e.start) < dayEnd.getTime(),
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
                {dayEvents.map((event) => {
                  const lane = visibleMemberIds.indexOf(event.memberId);
                  if (lane < 0) return null;
                  const start = Math.max(Date.parse(event.start), dayStart.getTime());
                  const end = Math.min(Date.parse(event.end), dayEnd.getTime());
                  const top = ((start - dayStart.getTime()) / 3_600_000) * HOUR_PX;
                  const height = Math.max(((end - start) / 3_600_000) * HOUR_PX - 2, 14);
                  const color = memberColorIndex(members, event.memberId);
                  const name = members.find((m) => m.id === event.memberId)?.name ?? event.memberId;
                  const style =
                    event.kind === 'meeting'
                      ? 'bg-slate-200 border-slate-300 text-slate-700'
                      : event.kind === 'work_block'
                        ? MEMBER_COLORS[color]
                        : `${PREVIEW_COLORS[color]} border-dashed border-2`;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onSelect(event)}
                      title={`${event.title} — ${name}`}
                      className={`absolute overflow-hidden rounded border px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm hover:z-10 hover:ring-2 hover:ring-indigo-400 ${style}`}
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 2px)`,
                      }}
                    >
                      <span className="flex items-start">
                        {event.kind === 'meeting' ? <MeetingIcon /> : null}
                        <span className="line-clamp-3">
                          {event.kind === 'preview' ? 'Pending: ' : ''}
                          {event.title.replace(/^Work: /, '')}
                        </span>
                      </span>
                      {lanes === 1 || height > 40 ? (
                        <span className="block opacity-75">{initials(name)}</span>
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
