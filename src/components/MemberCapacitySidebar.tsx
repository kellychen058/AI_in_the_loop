'use client';

import type { CalendarEvent, TeamMember } from '@/lib/types';
import { hoursText } from './ui';
import { memberDotClass } from './WeekCalendarGrid';

const STATUS = {
  ok: { label: 'Healthy', bar: 'bg-[#047857]', text: 'text-[#047857]' },
  near: { label: 'Near cap', bar: 'bg-[#B45309]', text: 'text-[#B45309]' },
  over: { label: 'Overloaded', bar: 'bg-[#BE123C]', text: 'text-[#BE123C]' },
} as const;

function hoursIn(events: CalendarEvent[], startMs: number, endMs: number): number {
  return events.reduce((sum, e) => {
    const start = Math.max(Date.parse(e.start), startMs);
    const end = Math.min(Date.parse(e.end), endMs);
    return end > start ? sum + (end - start) / 3_600_000 : sum;
  }, 0);
}

export function MemberCapacitySidebar({
  members,
  events,
  weekStart,
  weekEnd,
  selectedMemberId = 'all',
  onSelectMember,
}: {
  members: TeamMember[];
  events: CalendarEvent[];
  weekStart: Date;
  weekEnd: Date;
  selectedMemberId?: string;
  onSelectMember?: (memberId: string) => void;
}) {
  return (
    <aside className="space-y-3 rounded-xl border border-[#E5E2DC] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#57534E]">
            Team Capacity
          </h2>
          <p className="text-[11px] text-[#78716C]">Click a teammate to filter week</p>
        </div>
        {selectedMemberId !== 'all' && onSelectMember ? (
          <button
            type="button"
            onClick={() => onSelectMember('all')}
            className="text-[11px] font-semibold text-[#111827] underline"
          >
            All
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        {members.map((member) => {
          const mine = events.filter((e) => e.memberId === member.id);
          const meetingHours = hoursIn(
            mine.filter((e) => e.kind === 'meeting'),
            weekStart.getTime(),
            weekEnd.getTime(),
          );
          const taskHours = hoursIn(
            mine.filter((e) => e.kind === 'work_block'),
            weekStart.getTime(),
            weekEnd.getTime(),
          );
          const remaining = member.weeklyHours - meetingHours - taskHours;
          const status =
            remaining < 0
              ? STATUS.over
              : remaining / member.weeklyHours < 0.2
                ? STATUS.near
                : STATUS.ok;
          const pct = (value: number) => `${Math.min(100, (value / member.weeklyHours) * 100)}%`;
          const active = selectedMemberId === member.id;

          return (
            <button
              key={member.id}
              type="button"
              onClick={() => onSelectMember?.(active ? 'all' : member.id)}
              className={`block w-full rounded-lg border p-2.5 text-left transition-colors ${
                active
                  ? 'border-[#111827] bg-[#F7F6F2] ring-1 ring-[#111827]'
                  : 'border-[#E5E2DC] bg-white hover:bg-[#FAF9F6]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-[#111827]">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${memberDotClass(members, member.id)}`}
                  />
                  {member.name}
                </span>
                <span className={`font-mono text-[11px] font-bold tabular-nums ${status.text}`}>
                  {hoursText(remaining)} / {member.weeklyHours}h
                </span>
              </div>
              <div
                className="my-1.5 flex h-1.5 overflow-hidden rounded-full bg-[#ECEAE4]"
                role="img"
                aria-label={`${hoursText(remaining)} free of ${member.weeklyHours}h`}
              >
                <div className="bg-[#A8A29E]" style={{ width: pct(meetingHours) }} />
                <div className={status.bar} style={{ width: pct(taskHours) }} />
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-[#57534E] tabular-nums">
                <span>
                  {hoursText(meetingHours)} mtgs · {hoursText(taskHours)} booked
                </span>
                <span className={status.text}>{status.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
