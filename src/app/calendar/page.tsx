'use client';

import { usePersona } from '@/context/PersonaContext';

export default function CalendarPage() {
  const { db, loading, currentUser } = usePersona();

  const meetings = db?.calendarEvents.filter((event) => event.kind === 'meeting') ?? [];
  const workBlocks = db?.calendarEvents.filter((event) => event.kind === 'work_block') ?? [];
  const myEvents = db?.calendarEvents.filter((event) => event.memberId === currentUser?.id) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          Wave 0 Walking Skeleton · Full UI built in Issue #14
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Shared Team Calendar
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Active persona:{' '}
          <strong className="text-slate-900">
            {currentUser ? `${currentUser.name} (${currentUser.role.toUpperCase()})` : 'Loading…'}
          </strong>
          . Issue #14 adds the Mon–Fri 09:00–18:00 weekly grid, member capacity sidebar,{' '}
          <code>.ics</code> export, and the simulated calendar failure toggle.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Team Meetings
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{loading ? '…' : meetings.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Confirmed Work Blocks
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : workBlocks.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Active Persona Events
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{loading ? '…' : myEvents.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Sync Failure Simulation
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : db?.settings.simulateCalendarFailure ? 'ON' : 'OFF'}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Scheduled Events for {currentUser?.name ?? 'Active Persona'}
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {myEvents.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="text-sm font-medium text-slate-900">{event.title}</p>
                <p className="text-xs text-slate-500">
                  {new Date(event.start).toLocaleString()} → {new Date(event.end).toLocaleTimeString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  event.kind === 'work_block'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {event.kind === 'work_block' ? 'Work Block' : 'Meeting'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
