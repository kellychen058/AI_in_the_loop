'use client';

import { useState } from 'react';
import { CheckInPanel } from './CheckInPanel';
import type { InboxSection } from '@/lib/taskRoles';
import { getAssignerId, getResponderId, isPm } from '@/lib/taskRoles';
import type { RejectionRecord, Task, TeamMember } from '@/lib/types';
import { CounterProposeModal } from './CounterProposeModal';
import { ReassignModal } from './ReassignModal';
import { RescheduleModal } from './RescheduleModal';
import {
  apiFetch,
  Banner,
  buttonClass,
  errorText,
  formatBlock,
  formatDateTime,
  hoursText,
  inputClass,
  memberName,
  Spinner,
  StatusPill,
} from './ui';
import { WorkloadMeter } from './WorkloadMeter';

function blockHours(task: Task): number {
  return task.currentProposal.proposedBlocks.reduce(
    (sum, b) => sum + (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000,
    0,
  );
}

export function ProposalCard({
  task,
  section,
  members,
  allTasks,
  rejections,
  currentUserId,
  onDone,
}: {
  task: Task;
  section: InboxSection;
  members: TeamMember[];
  allTasks: Task[];
  rejections: RejectionRecord[];
  currentUserId: string;
  onDone: (message: string, tone?: 'success' | 'error') => Promise<void>;
}) {
  const proposal = task.currentProposal;
  const assignerId = getAssignerId(task);
  const canRespond = getResponderId(task) === currentUserId;
  const isAssigningPm = assignerId === currentUserId && isPm(members.find((m) => m.id === currentUserId));
  const lastRejection =
    task.status === 'rejected' ? rejections.filter((r) => r.taskId === task.id).at(-1) : undefined;
  const [modal, setModal] = useState<null | 'counter' | 'reschedule' | 'reassign'>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<null | 'accept' | 'decline' | 'retry' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: 'accept' | 'decline') {
    setBusy(action);
    setError(null);
    const result = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/respond`, {
      method: 'POST',
      body: {
        actorId: currentUserId,
        expectedVersion: proposal.version,
        action,
        ...(action === 'decline' ? { reason } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    const updated = result.data.task;
    if (action === 'decline') {
      await onDone(`Declined "${task.title}" — reason logged in /decisions.`);
    } else if (updated.status === 'sync_failed') {
      await onDone(
        `Confirmed "${task.title}" but calendar sync failed: ${updated.syncError ?? ''}`,
        'error',
      );
    } else {
      await onDone(
        `Confirmed "${task.title}" (v${updated.currentProposal.version}) and synced ${updated.calendarEventIds.length} work block(s) to the calendar.`,
      );
    }
  }

  async function retrySync() {
    setBusy('retry');
    setError(null);
    const result = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/retry-sync`, {
      method: 'POST',
      body: { actorId: currentUserId },
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    await onDone(`Synced ${result.data.task.calendarEventIds.length} work block(s) for "${task.title}".`);
  }

  async function deleteTask() {
    setBusy('delete');
    setError(null);
    const query = new URLSearchParams({ id: task.id, actorId: currentUserId });
    const result = await apiFetch(`/api/tasks?${query}`, { method: 'DELETE' });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    await onDone(`Deleted "${task.title}". The decline stays in /decisions.`);
  }

  const scheduled = blockHours(task);
  const unscheduled = Math.max(0, proposal.estimatedHours - scheduled);
  const isCommitted = task.status === 'confirmed';

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        task.status === 'sync_failed' ? 'border-red-300' : section === 'action' ? 'border-indigo-300' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{task.title}</h3>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-white">v{proposal.version}</span>
            {task.aiGenerated ? (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">✦ AI Suggested</span>
            ) : null}
            <StatusPill status={task.status} />
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {memberName(members, assignerId)} → <strong>{memberName(members, proposal.assigneeId)}</strong> ·{' '}
            {hoursText(proposal.estimatedHours)} · due {formatDateTime(proposal.deadline)}
            {proposal.proposedBy !== assignerId ? ` · counter by ${memberName(members, proposal.proposedBy)}` : ''}
          </p>
        </div>
      </div>

      {task.description ? <p className="mt-2 text-sm text-slate-700">{task.description}</p> : null}
      {task.sourceQuote ? (
        <blockquote className="mt-2 border-l-2 border-indigo-300 pl-2 text-xs italic text-slate-500">
          “{task.sourceQuote}”
        </blockquote>
      ) : null}

      {proposal.overrideRejectedReason ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <strong>Re-proposed after a prior rejection because:</strong> {proposal.overrideRejectedReason}
        </div>
      ) : null}
      {proposal.note ? (
        <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
          <strong>Note from {memberName(members, proposal.proposedBy)}:</strong> {proposal.note}
        </p>
      ) : null}

      {task.status === 'rejected' && isAssigningPm ? (
        <div className="mt-3 rounded-lg border-2 border-rose-300 bg-rose-50 p-3 text-sm text-rose-950" role="alert">
          <p className="font-semibold">
            ✕ {memberName(members, lastRejection?.rejectedBy ?? proposal.assigneeId)} declined this task
            {lastRejection ? ` on ${formatDateTime(lastRejection.createdAt)}` : ''}
          </p>
          {lastRejection ? (
            <blockquote className="mt-1 border-l-2 border-rose-300 pl-2 text-xs italic">
              “{lastRejection.reason}”
            </blockquote>
          ) : null}
          <p className="mt-1 text-xs">Reassign it to someone else, or delete it.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonClass.primary} onClick={() => setModal('reassign')} disabled={busy !== null}>
              Reassign to Someone Else
            </button>
            {confirmDelete ? (
              <>
                <button type="button" className={buttonClass.danger} onClick={deleteTask} disabled={busy !== null}>
                  {busy === 'delete' ? <Spinner /> : null} Confirm Delete
                </button>
                <button type="button" className={buttonClass.secondary} onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={buttonClass.danger} onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                Delete Task
              </button>
            )}
          </div>
        </div>
      ) : null}

      {task.status === 'sync_failed' ? (
        <div className="mt-3">
          <Banner tone="error" title="Calendar sync failed — confirmed, but not on the calendar yet">
            {task.syncError}
          </Banner>
        </div>
      ) : null}

      <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs">
        <p className="font-semibold text-slate-700">
          {isCommitted ? 'Work blocks on calendar' : 'Proposed calendar work blocks'}
          {isCommitted ? '' : ' — written only after both sides confirm'}
        </p>
        {proposal.proposedBlocks.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {proposal.proposedBlocks.map((block) => (
              <li
                key={block.start}
                className={`rounded px-2 py-0.5 font-mono ${
                  isCommitted ? 'bg-indigo-100 text-indigo-800' : 'border border-dashed border-indigo-400 text-indigo-700'
                }`}
              >
                {formatBlock(block)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-slate-500">No free slot found before the deadline.</p>
        )}
        {unscheduled > 0 ? (
          <p className="mt-1 text-amber-800">⚠ {hoursText(unscheduled)} could not be placed before the deadline.</p>
        ) : null}
      </div>

      {!isCommitted && task.status !== 'sync_failed' && task.status !== 'rejected' ? (
        <div className="mt-3">
          <WorkloadMeter
            members={members}
            assigneeId={proposal.assigneeId}
            deadline={proposal.deadline}
            estimatedHours={proposal.estimatedHours}
            excludeTaskId={task.id}
          />
        </div>
      ) : null}

      {isCommitted ? (
        <CheckInPanel task={task} members={members} currentUserId={currentUserId} isAssigningPm={isAssigningPm} onDone={onDone} />
      ) : null}

      {task.proposalHistory.length > 0 ? (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Proposal history ({task.proposalHistory.length} version{task.proposalHistory.length === 1 ? '' : 's'})
          </summary>
          <ol className="mt-1 space-y-1">
            {task.proposalHistory.map((p, index) => {
              const prev = task.proposalHistory[index - 1];
              const changed = (field: boolean) => (prev && field ? 'font-semibold text-violet-700' : '');
              return (
                <li key={p.version} className="rounded border border-slate-100 p-1.5">
                  <span className="font-mono">v{p.version}</span> by {memberName(members, p.proposedBy)} ·{' '}
                  <span className={changed(prev?.assigneeId !== p.assigneeId)}>{memberName(members, p.assigneeId)}</span> ·{' '}
                  <span className={changed(prev?.estimatedHours !== p.estimatedHours)}>{hoursText(p.estimatedHours)}</span> · due{' '}
                  <span className={changed(prev?.deadline !== p.deadline)}>{formatDateTime(p.deadline)}</span>
                  {p.note ? ` — “${p.note}”` : ''}
                  {task.confirmedVersion === p.version ? ' ✓ confirmed' : ''}
                </li>
              );
            })}
          </ol>
        </details>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {canRespond && section === 'action' ? (
          <>
            <button type="button" className={buttonClass.primary} onClick={() => respond('accept')} disabled={busy !== null}>
              {busy === 'accept' ? <Spinner /> : '✓'} Accept &amp; Sync to Calendar
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => setModal('counter')} disabled={busy !== null}>
              Propose New Deadline / Hours
            </button>
            <button type="button" className={buttonClass.danger} onClick={() => setDeclineOpen((v) => !v)} disabled={busy !== null}>
              Decline with Reason
            </button>
          </>
        ) : null}
        {task.status === 'sync_failed' ? (
          <button type="button" className={buttonClass.primary} onClick={retrySync} disabled={busy !== null}>
            {busy === 'retry' ? <Spinner /> : '↻'} Retry Calendar Sync
          </button>
        ) : null}
        {isCommitted && isAssigningPm ? (
          <button type="button" className={buttonClass.secondary} onClick={() => setModal('reschedule')}>
            Reschedule
          </button>
        ) : null}
        {section === 'waiting' ? (
          <p className="text-xs text-slate-500">
            Waiting on {memberName(members, getResponderId(task))} to respond to v{proposal.version}.
          </p>
        ) : null}
      </div>

      {declineOpen ? (
        <div className="mt-3 space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
          <label className="block text-xs font-medium text-slate-700">
            Reason (required — saved to rejection memory so AI won&apos;t re-suggest this)
            <textarea className={`${inputClass} mt-1`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button"
            className={buttonClass.danger}
            onClick={() => respond('decline')}
            disabled={busy !== null || !reason.trim()}
          >
            {busy === 'decline' ? <Spinner /> : null} Confirm Decline
          </button>
        </div>
      ) : null}

      {modal === 'counter' ? (
        <CounterProposeModal
          task={task}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setModal(null)}
          onDone={async (message) => {
            setModal(null);
            await onDone(message);
          }}
        />
      ) : null}
      {modal === 'reassign' ? (
        <ReassignModal
          task={task}
          members={members}
          allTasks={allTasks}
          rejections={rejections}
          currentUserId={currentUserId}
          onClose={() => setModal(null)}
          onDone={async (message) => {
            setModal(null);
            await onDone(message);
          }}
        />
      ) : null}
      {modal === 'reschedule' ? (
        <RescheduleModal
          task={task}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setModal(null)}
          onDone={async (message) => {
            setModal(null);
            await onDone(message);
          }}
        />
      ) : null}
    </article>
  );
}
