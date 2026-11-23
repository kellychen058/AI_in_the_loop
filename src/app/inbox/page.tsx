'use client';

import { usePersona } from '@/context/PersonaContext';

export default function InboxPage() {
  const { db, loading, currentUser } = usePersona();

  const assignedTasks =
    db?.tasks.filter((task) => task.currentProposal.assigneeId === currentUser?.id) ?? [];
  const needsAction =
    db?.tasks.filter((task) => {
      if (!currentUser) return false;
      if (task.status === 'pending_assignee') {
        return task.currentProposal.assigneeId === currentUser.id;
      }
      if (task.status === 'counter_proposed') {
        return task.currentProposal.proposedBy !== currentUser.id;
      }
      if (task.status === 'sync_failed') {
        return (
          task.currentProposal.assigneeId === currentUser.id ||
          task.currentProposal.proposedBy === currentUser.id
        );
      }
      return false;
    }) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          Wave 0 Walking Skeleton · Full UI built in Issue #13
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Assignee Inbox &amp; Negotiation
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Viewing inbox as{' '}
          <strong className="text-slate-900">
            {currentUser ? `${currentUser.name} (${currentUser.role.toUpperCase()})` : 'Loading…'}
          </strong>
          . Issue #13 adds proposal review cards, versioned Accept / Counter-propose / Decline
          actions, reschedule modals, and sync-failure retry.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Needs Your Action
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : needsAction.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Assigned to Active Persona
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : assignedTasks.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Total Team Tasks
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {loading ? '…' : (db?.tasks.length ?? 0)}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          Tasks Assigned to {currentUser?.name ?? 'Current Persona'}
        </h2>
        {assignedTasks.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No tasks currently assigned to this persona. Switch persona in the header (try Carol Wu
            or David Wang) to inspect seeded confirmed tasks.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {assignedTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500">
                    v{task.currentProposal.version} · {task.currentProposal.estimatedHours}h ·
                    Depends on:{' '}
                    {task.dependsOnTaskIds.length > 0 ? task.dependsOnTaskIds.join(', ') : 'None'}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  {task.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
