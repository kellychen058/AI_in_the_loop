'use client';

import { usePersona } from '@/context/PersonaContext';

export default function WorkspacePage() {
  const { db, loading, error, currentUser, refreshDb } = usePersona();

  const draftCount = db?.tasks.filter((task) => task.status === 'draft').length ?? 0;
  const pendingCount =
    db?.tasks.filter(
      (task) => task.status === 'pending_assignee' || task.status === 'counter_proposed',
    ).length ?? 0;
  const confirmedCount = db?.tasks.filter((task) => task.status === 'confirmed').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
            Wave 0 Walking Skeleton · Full UI built in Issue #12
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            Assigner Workspace
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Active persona:{' '}
            <strong className="text-slate-900">
              {currentUser ? `${currentUser.name} (${currentUser.role.toUpperCase()})` : 'Loading…'}
            </strong>
            . Issue #12 replaces this starter view with meeting-note AI extraction, draft editing,
            live workload meters, and the previously-rejected guard.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refreshDb()}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Refresh State
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load state: {error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Meetings" value={loading ? '…' : String(db?.meetings.length ?? 0)} />
        <StatCard label="Draft Tasks" value={loading ? '…' : String(draftCount)} />
        <StatCard label="Awaiting Confirmation" value={loading ? '…' : String(pendingCount)} />
        <StatCard label="Confirmed Tasks" value={loading ? '…' : String(confirmedCount)} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Seeded Team Snapshot</h2>
        <p className="mt-1 text-xs text-slate-500">
          Live data fetched from <code className="rounded bg-slate-100 px-1 py-0.5">/api/state</code>{' '}
          (local JSON store auto-seeded for the active Mon–Fri workweek).
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(db?.members ?? []).map((member) => {
            const meetingCount =
              db?.calendarEvents.filter(
                (event) => event.memberId === member.id && event.kind === 'meeting',
              ).length ?? 0;
            const workBlockCount =
              db?.calendarEvents.filter(
                (event) => event.memberId === member.id && event.kind === 'work_block',
              ).length ?? 0;

            return (
              <div
                key={member.id}
                className={`rounded-lg border p-3.5 ${
                  currentUser?.id === member.id
                    ? 'border-indigo-300 bg-indigo-50/40'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{member.name}</span>
                  <span className="text-xs uppercase text-slate-500">{member.role}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {member.weeklyHours}h/wk · {member.workdayStartHour}:00–{member.workdayEndHour}:00
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {meetingCount} meetings · {workBlockCount} confirmed work blocks
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
