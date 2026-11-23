'use client';

import { useState } from 'react';
import { ProposalCard } from '@/components/ProposalCard';
import { Banner, buttonClass } from '@/components/ui';
import { usePersona } from '@/context/PersonaContext';
import { getInboxSection, type InboxSection } from '@/lib/taskRoles';
import type { Task } from '@/lib/types';

const SECTIONS: { key: InboxSection; title: string; empty: string }[] = [
  { key: 'action', title: 'Needs Your Action', empty: 'Nothing waiting on you.' },
  { key: 'waiting', title: 'Waiting on Others', empty: 'No proposals waiting on teammates.' },
  { key: 'confirmed', title: 'Confirmed Tasks', empty: 'No confirmed tasks yet.' },
];

export default function InboxPage() {
  const { db, loading, error, currentUser, refreshDb } = usePersona();
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const grouped: Record<InboxSection, Task[]> = { action: [], waiting: [], confirmed: [] };
  if (db && currentUser) {
    for (const task of db.tasks) {
      const section = getInboxSection(task, currentUser.id);
      if (section) grouped[section].push(task);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
  }

  async function handleDone(message: string, tone: 'success' | 'error' = 'success') {
    setToast({ message, tone });
    await refreshDb();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inbox &amp; Negotiation</h1>
          <p className="mt-1 text-sm text-slate-600">
            Viewing as <strong>{currentUser?.name ?? '…'}</strong>. Switch persona in the header to act
            as the other party. Updates every 3s.
          </p>
        </div>
        <button type="button" onClick={() => void refreshDb()} className={buttonClass.secondary}>
          Refresh
        </button>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
      {toast ? (
        <Banner tone={toast.tone} onDismiss={() => setToast(null)}>
          {toast.message}
        </Banner>
      ) : null}
      {db?.settings.simulateCalendarFailure ? (
        <Banner tone="warning" title="Calendar sync failure simulation is ON">
          Accepting a task will fail to sync until it is turned off on the Calendar page.
        </Banner>
      ) : null}

      {SECTIONS.map(({ key, title, empty }) => (
        <section key={key} className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {title}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                key === 'action' && grouped.action.length > 0 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {grouped[key].length}
            </span>
          </h2>
          {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
          {!loading && grouped[key].length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">{empty}</p>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">
            {currentUser
              ? grouped[key].map((task) => (
                  <ProposalCard
                    key={`${task.id}-${task.currentProposal.version}-${task.status}`}
                    task={task}
                    section={key}
                    members={db?.members ?? []}
                    currentUserId={currentUser.id}
                    onDone={handleDone}
                  />
                ))
              : null}
          </div>
        </section>
      ))}
    </div>
  );
}
