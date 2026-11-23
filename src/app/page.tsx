'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MeetingIngestPanel } from '@/components/MeetingIngestPanel';
import { TaskDraftCard } from '@/components/TaskDraftCard';
import { Banner, buttonClass } from '@/components/ui';
import { usePersona } from '@/context/PersonaContext';
import { getAssignerId, isPm } from '@/lib/taskRoles';

export default function WorkspacePage() {
  const { db, loading, error, currentUser, refreshDb } = usePersona();
  const [toast, setToast] = useState<string | null>(null);
  const router = useRouter();
  const nonPm = currentUser !== null && !isPm(currentUser);

  useEffect(() => {
    if (nonPm) router.replace('/inbox');
  }, [nonPm, router]);

  if (nonPm) {
    return (
      <p className="py-12 text-center text-sm text-slate-500">
        Only PMs can assign tasks. Taking you to your inbox…
      </p>
    );
  }

  const tasks = db?.tasks ?? [];
  const drafts = tasks
    .filter((task) => task.status === 'draft')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const declined = tasks.filter(
    (task) => task.status === 'rejected' && currentUser && getAssignerId(task) === currentUser.id,
  );
  const awaiting = tasks.filter(
    (task) => task.status === 'pending_assignee' || task.status === 'counter_proposed',
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Assigner Workspace</h1>
          <p className="mt-1 text-sm text-slate-600">
            Acting as <strong>{currentUser?.name ?? '…'}</strong>. Paste notes → review AI drafts →
            check workload → submit for two-party confirmation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/inbox" className={buttonClass.secondary}>
            {awaiting} awaiting confirmation →
          </Link>
          <button type="button" onClick={() => void refreshDb()} className={buttonClass.secondary}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
      {toast ? (
        <Banner tone="success" title="Proposal submitted" onDismiss={() => setToast(null)}>
          {toast}
        </Banner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          {currentUser ? (
            <MeetingIngestPanel currentUserId={currentUser.id} onChanged={refreshDb} />
          ) : null}
        </div>

        <div className="space-y-4">
          {declined.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                Declined — re-propose or reassign ({declined.length})
              </h2>
              {declined.map((task) => (
                <TaskDraftCard
                  key={`${task.id}-${task.currentProposal.version}`}
                  task={task}
                  members={db?.members ?? []}
                  allTasks={tasks}
                  rejections={db?.rejections ?? []}
                  currentUserId={currentUser!.id}
                  onChanged={refreshDb}
                  onProposed={setToast}
                />
              ))}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              2. Review &amp; edit drafts ({drafts.length})
            </h2>
            {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
            {!loading && drafts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                No drafts yet. Load the sample notes and click <strong>Extract Tasks with AI</strong>,
                or add a task manually.
              </div>
            ) : null}
            {currentUser
              ? drafts.map((task) => (
                  <TaskDraftCard
                    key={task.id}
                    task={task}
                    members={db?.members ?? []}
                    allTasks={tasks}
                    rejections={db?.rejections ?? []}
                    currentUserId={currentUser.id}
                    onChanged={refreshDb}
                    onProposed={setToast}
                  />
                ))
              : null}
          </section>
        </div>
      </div>
    </div>
  );
}
