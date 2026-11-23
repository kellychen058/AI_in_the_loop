'use client';

import type { CalendarEvent, TeamMember } from '@/lib/types';
import { hoursText } from './ui';
import { memberDotClass } from './WeekCalendarGrid';

const STATUS = {
  ok: { label: 'OK', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  near: { label: 'Near Capacity', bar: 'bg-amber-500', text: 'text-amber-700' },
  over: { label: 'Overloaded', bar: 'bg-red-500', text: 'text-red-700' },
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
}: {
  members: TeamMember[];
  events: CalendarEvent[];
  weekStart: Date;
  weekEnd: Date;
}) {
  return (
    <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Weekly capacity</h2>
        <p className="text-xs text-slate-500">Weekly hours − meetings − confirmed task blocks</p>
      </div>
      {members.map((member) => {
        const mine = events.filter((e) => e.memberId === member.id);
        const meetingHours = hoursIn(mine.filter((e) => e.kind === 'meeting'), weekStart.getTime(), weekEnd.getTime());
        const taskHours = hoursIn(mine.filter((e) => e.kind === 'work_block'), weekStart.getTime(), weekEnd.getTime());
        const remaining = member.weeklyHours - meetingHours - taskHours;
        const status =
          remaining < 0 ? STATUS.over : remaining / member.weeklyHours < 0.2 ? STATUS.near : STATUS.ok;
        const pct = (value: number) => `${Math.min(100, (value / member.weeklyHours) * 100)}%`;
        return (
          <div key={member.id} className="space-y-1.5 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <span className={`h-2.5 w-2.5 rounded-full ${memberDotClass(members, member.id)}`} />
                {member.name}
              </span>
              <span className={`text-xs font-semibold ${status.text}`}>{status.label}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${hoursText(remaining)} free of ${member.weeklyHours}h`}>
              <div className="bg-slate-400" style={{ width: pct(meetingHours) }} />
              <div className={status.bar} style={{ width: pct(taskHours) }} />
            </div>
            <dl className="grid grid-cols-2 gap-x-2 text-[11px] text-slate-600">
              <dt>Weekly hours</dt>
              <dd className="text-right">{hoursText(member.weeklyHours)}</dd>
              <dt>Meetings</dt>
              <dd className="text-right">{hoursText(meetingHours)}</dd>
              <dt>Confirmed tasks</dt>
              <dd className="text-right">{hoursText(taskHours)}</dd>
              <dt className="font-semibold text-slate-800">Remaining</dt>
              <dd className="text-right font-semibold text-slate-800">{hoursText(remaining)}</dd>
            </dl>
          </div>
        );
      })}
    </aside>
  );
}
