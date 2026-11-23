'use client';

import { usePersona } from '@/context/PersonaContext';

export default function DecisionsPage() {
  const { db, loading, currentUser } = usePersona();

  return (
    <div className="space-y-6">
      <div>
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          Wave 0 Walking Skeleton · Full UI built in Issue #15
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Decisions &amp; Rejection Audit Log
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Active persona:{' '}
          <strong className="text-slate-900">
            {currentUser ? `${currentUser.name} (${currentUser.role.toUpperCase()})` : 'Loading…'}
          </strong>
          . Issue #15 replaces this starter view with the full rejection memory table, filterable
          audit timeline, evaluation JSON export, and CP2 prompt evaluation suite.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Recorded Rejections
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : (db?.rejections.length ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Audit Log Entries
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : (db?.auditLog.length ?? 0)}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Seeded Rejection Memory</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {(db?.rejections ?? []).map((record) => (
            <li key={record.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  {record.taskTitle} ({record.estimatedHours}h)
                </p>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Rejected by {record.rejectedBy}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{record.reason}</p>
              <p className="mt-1 text-xs text-slate-500">{record.workloadSnapshot.explanation}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
