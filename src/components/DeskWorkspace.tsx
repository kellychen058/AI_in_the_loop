'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePersona } from '@/context/PersonaContext';
import { groupDeskTasks, type DeskBucket } from '@/lib/deskQueue';
import { getAssignerId, isPm } from '@/lib/taskRoles';
import { ArrowLeftIcon, PlusIcon, SplitPaneIcon } from './Icons';
import { MeetingIngestPanel } from './MeetingIngestPanel';
import { TaskContract } from './TaskContract';
import { Banner, buttonClass, hoursText, memberName } from './ui';

const BUCKETS: { key: DeskBucket; label: string; empty: string }[] = [
  { key: 'action', label: 'Needs You', empty: 'Nothing waiting on you right now.' },
  { key: 'waiting', label: 'Waiting', empty: 'No proposals waiting on teammates.' },
  { key: 'scheduled', label: 'Scheduled', empty: 'No confirmed bookings yet.' },
];

const TONE_DOT: Record<string, string> = {
  crimson: 'bg-[#BE123C]',
  amber: 'bg-[#B45309]',
  iris: 'bg-[#4338CA]',
  emerald: 'bg-[#047857]',
  neutral: 'bg-[#78716C]',
};

const TONE_TEXT: Record<string, string> = {
  crimson: 'text-[#BE123C]',
  amber: 'text-[#B45309]',
  iris: 'text-[#4338CA]',
  emerald: 'text-[#047857]',
  neutral: 'text-[#57534E]',
};

export function DeskWorkspace() {
  const { db, loading, error, currentUser, refreshDb } = usePersona();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTaskId = searchParams.get('task');

  const [bucket, setBucket] = useState<DeskBucket>('action');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(urlTaskId);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(urlTaskId));
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [duetMode, setDuetMode] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const userIsPm = isPm(currentUser);
  const nowIso = new Date().toISOString();

  const grouped = useMemo(
    () => groupDeskTasks(db?.tasks ?? [], currentUser, nowIso),
    [db?.tasks, currentUser, nowIso],
  );

  // Sync URL ?task= param when navigating from Week or Ledger
  useEffect(() => {
    if (urlTaskId) {
      setSelectedTaskId(urlTaskId);
      setMobileDetailOpen(true);
    }
  }, [urlTaskId]);

  // Keep a valid task selected when switching buckets or personas
  const currentList = grouped[bucket];
  const allVisible = useMemo(
    () => [...grouped.action, ...grouped.waiting, ...grouped.scheduled],
    [grouped],
  );

  const selectedTask = useMemo(() => {
    if (!db) return undefined;
    if (selectedTaskId) {
      const exact = db.tasks.find((t) => t.id === selectedTaskId);
      if (exact) return exact;
    }
    return currentList[0]?.task ?? allVisible[0]?.task;
  }, [db, selectedTaskId, currentList, allVisible]);

  // Guarded J/K keyboard navigation (never fires in inputs/textareas/selects/contenteditable)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        !target ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && userIsPm) {
        e.preventDefault();
        setIntakeOpen((v) => !v);
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      if (currentList.length === 0) return;
      const idx = currentList.findIndex((item) => item.task.id === selectedTask?.id);
      const nextIdx =
        e.key === 'j'
          ? Math.min(currentList.length - 1, idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
      const next = currentList[nextIdx]?.task;
      if (next) selectTask(next.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
    setMobileDetailOpen(true);
    router.replace(`/?task=${encodeURIComponent(taskId)}`, { scroll: false });
  }

  async function handleDone(message: string, tone: 'success' | 'error' = 'success') {
    setToast({ message, tone });
    await refreshDb({ broadcast: true });
  }

  // Duet Mode actor IDs (PM left, selected task's assignee right)
  const pmMember = db?.members.find((m) => m.role === 'pm');
  const duetAssigneeId =
    selectedTask?.currentProposal.assigneeId &&
    selectedTask.currentProposal.assigneeId !== pmMember?.id
      ? selectedTask.currentProposal.assigneeId
      : db?.members.find((m) => m.role !== 'pm')?.id;

  return (
    <div className="space-y-4">
      {/* Top PM Intake Command Bar + Duet Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {userIsPm ? (
            <button
              type="button"
              onClick={() => setIntakeOpen((v) => !v)}
              className={intakeOpen ? buttonClass.primary : buttonClass.secondary}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {intakeOpen ? 'Hide Meeting Notes Intake' : 'Paste Meeting Notes / + New Task'}
              <kbd className="ml-1 hidden rounded border border-current/20 px-1 font-mono text-[10px] opacity-70 sm:inline">
                ⌘K
              </kbd>
            </button>
          ) : (
            <div className="text-xs text-[#57534E]">
              Viewing your personal Desk as <strong className="text-[#111827]">{currentUser?.name}</strong>.
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDuetMode((v) => !v)}
            className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors xl:inline-flex ${
              duetMode
                ? 'border-[#111827] bg-[#111827] text-white'
                : 'border-[#D1CCC2] bg-white text-[#111827] hover:bg-[#F7F6F2]'
            }`}
            title="Live two-party split screen (PM left, Assignee right)"
          >
            <SplitPaneIcon className="h-3.5 w-3.5" />
            {duetMode ? 'Exit Duet Mode' : 'Duet Mode'}
          </button>
        </div>
      </div>

      {/* Live polite region for toast & turn announcements */}
      <div aria-live="polite" className="space-y-2">
        {error ? <Banner tone="error" title="Failed to load state">{error}</Banner> : null}
        {toast ? (
          <Banner tone={toast.tone} onDismiss={() => setToast(null)}>
            {toast.message}
          </Banner>
        ) : null}
      </div>

      {/* Expandable Meeting Intake Sheet (PM only) */}
      {userIsPm && intakeOpen && currentUser ? (
        <MeetingIngestPanel
          currentUserId={currentUser.id}
          onChanged={() => refreshDb({ broadcast: true })}
          onExtracted={(firstId) => {
            setBucket('action');
            if (firstId) {
              selectTask(firstId);
              setIntakeOpen(false);
            }
          }}
          onClose={() => setIntakeOpen(false)}
        />
      ) : null}

      {/* DUET MODE (Desktop >=1280px): Horizontal Task Strip + 2 Actor Panes */}
      {duetMode && db && pmMember && duetAssigneeId ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {db.tasks.map((t) => {
              const active = t.id === selectedTask?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTask(t.id)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-[#111827] bg-[#111827] text-white'
                      : 'border-[#D1CCC2] bg-white text-[#111827] hover:bg-[#F7F6F2]'
                  }`}
                >
                  {t.title}{' '}
                  <span className="ml-1 font-mono text-[10px] opacity-75">
                    v{t.currentProposal.version}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedTask ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-[#E5E2DC] bg-white px-3 py-1.5 text-xs font-bold text-[#111827]">
                  <span>PM Pane · {pmMember.name}</span>
                  <span className="font-mono text-[11px] font-medium text-[#78716C]">Assigner</span>
                </div>
                <TaskContract
                  key={`pm-${selectedTask.id}`}
                  task={selectedTask}
                  db={db}
                  currentUserId={pmMember.id}
                  onSelectTask={selectTask}
                  onDone={handleDone}
                  compact
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-[#E5E2DC] bg-white px-3 py-1.5 text-xs font-bold text-[#111827]">
                  <span>Assignee Pane · {memberName(db.members, duetAssigneeId)}</span>
                  <span className="font-mono text-[11px] font-medium text-[#78716C]">
                    Counterparty
                  </span>
                </div>
                <TaskContract
                  key={`ic-${selectedTask.id}-${duetAssigneeId}`}
                  task={selectedTask}
                  db={db}
                  currentUserId={duetAssigneeId}
                  onSelectTask={selectTask}
                  onDone={handleDone}
                  compact
                />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#D1CCC2] bg-white p-10 text-center text-sm text-[#78716C]">
              No tasks yet. Use <strong>Paste Meeting Notes</strong> above to extract drafts and
              watch the live handshake across both panes.
            </div>
          )}
        </div>
      ) : (
        /* STANDARD DESK: Compact Unified Queue + Focused Task Contract */
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          {/* Left Unified Queue */}
          <aside
            className={`overflow-hidden rounded-xl border border-[#E5E2DC] bg-white shadow-sm ${
              mobileDetailOpen ? 'hidden lg:block' : 'block'
            }`}
          >
            <div
              role="tablist"
              aria-label="Task queue buckets"
              className="grid grid-cols-3 border-b border-[#E5E2DC] bg-[#F7F6F2]"
            >
              {BUCKETS.map((b) => {
                const active = bucket === b.key;
                const count = grouped[b.key].length;
                return (
                  <button
                    key={b.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setBucket(b.key)}
                    className={`border-b-2 px-2 py-2.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'border-[#111827] bg-white text-[#111827]'
                        : 'border-transparent text-[#57534E] hover:text-[#111827]'
                    }`}
                  >
                    {b.label}{' '}
                    <span className="font-mono text-[10px] opacity-75 tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>

            {loading ? (
              <p className="p-4 text-xs text-[#78716C]">Loading workspace…</p>
            ) : currentList.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#78716C]">
                <p>{BUCKETS.find((b) => b.key === bucket)?.empty}</p>
                {userIsPm && bucket === 'action' ? (
                  <button
                    type="button"
                    onClick={() => setIntakeOpen(true)}
                    className={`${buttonClass.secondary} mt-3`}
                  >
                    Paste Meeting Notes
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y divide-[#E5E2DC]">
                {currentList.map(({ task, meta }) => {
                  const selected = task.id === selectedTask?.id;
                  const counterparty =
                    getAssignerId(task) === currentUser?.id
                      ? memberName(db?.members ?? [], task.currentProposal.assigneeId).split(' ')[0]
                      : memberName(db?.members ?? [], getAssignerId(task)).split(' ')[0];
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => selectTask(task.id)}
                        className={`block w-full px-3.5 py-3 text-left transition-colors ${
                          selected
                            ? 'bg-[#F3F2ED] shadow-[inset_3px_0_0_#111827]'
                            : 'bg-white hover:bg-[#FAF9F6]'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-[#111827]">
                            {task.title}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#57534E] tabular-nums">
                            {hoursText(task.currentProposal.estimatedHours)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                          <span
                            className={`inline-flex items-center gap-1.5 font-semibold ${TONE_TEXT[meta.badgeTone]}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[meta.badgeTone]}`} />
                            {meta.badgeLabel}
                          </span>
                          <span className="truncate text-[#78716C]">{counterparty}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right Focused Task Contract Canvas */}
          <section className={mobileDetailOpen ? 'block' : 'hidden lg:block'}>
            {mobileDetailOpen ? (
              <button
                type="button"
                onClick={() => setMobileDetailOpen(false)}
                className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#111827] lg:hidden"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
                Back to Queue
              </button>
            ) : null}

            {selectedTask && db && currentUser ? (
              <TaskContract
                key={selectedTask.id}
                task={selectedTask}
                db={db}
                currentUserId={currentUser.id}
                onSelectTask={selectTask}
                onDone={handleDone}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-[#D1CCC2] bg-white p-10 text-center">
                <p className="text-sm font-semibold text-[#111827]">No task selected</p>
                <p className="mt-1 text-xs text-[#57534E]">
                  {userIsPm
                    ? 'Paste meeting notes to extract AI task drafts, or pick an item from your queue.'
                    : 'Pick any proposal or confirmed booking from your queue to inspect its contract.'}
                </p>
                {userIsPm ? (
                  <button
                    type="button"
                    onClick={() => setIntakeOpen(true)}
                    className={`${buttonClass.primary} mt-4`}
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Paste Meeting Notes
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
