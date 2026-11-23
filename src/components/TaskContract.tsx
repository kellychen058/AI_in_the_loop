'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CHECK_IN_DAY_OPTIONS, checkInDaysLabel } from '@/lib/checkIn';
import { computeUnlockLevers } from '@/lib/rejectionGuard';
import { getAssignerId, getResponderId, isPm } from '@/lib/taskRoles';
import type {
  AffectedDependentTask,
  AppDatabase,
  AssignmentSuggestion,
  CheckInDaysBefore,
  RejectionRecord,
  Task,
  WorkloadBreakdown,
} from '@/lib/types';
import { CheckInPanel } from './CheckInPanel';
import { HandshakeStrip } from './HandshakeStrip';
import { CheckIcon, RefreshIcon, SparkleIcon, XIcon } from './Icons';
import { MiniCalendarStrip } from './MiniCalendarStrip';
import { ReceiptRail } from './ReceiptRail';
import {
  apiFetch,
  Banner,
  buttonClass,
  defaultDeadline,
  errorText,
  formatDateTime,
  fromDateInput,
  hoursText,
  inputClass,
  memberName,
  Spinner,
  toDateInput,
  WORKLOAD_STYLES,
} from './ui';

const DECLINE_CHIPS = [
  'Overloaded this week',
  'Missing prerequisite dependency',
  'Better fit for another teammate',
] as const;

interface WorkloadResponse {
  breakdowns: WorkloadBreakdown[];
  affectedDependents: AffectedDependentTask[];
}

function blockHours(task: Task): number {
  return task.currentProposal.proposedBlocks.reduce(
    (sum, b) => sum + Math.max(0, (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000),
    0,
  );
}

function HighlightedTranscript({ rawNotes, quote }: { rawNotes: string; quote: string }) {
  if (!quote) return <p className="whitespace-pre-wrap font-mono text-[11px] text-[#57534E]">{rawNotes}</p>;
  const parts = rawNotes.split(quote);
  if (parts.length === 1) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-[#B45309]">
          Source excerpt not found verbatim in stored meeting notes.
        </p>
        <p className="whitespace-pre-wrap font-mono text-[11px] text-[#57534E]">{rawNotes}</p>
      </div>
    );
  }
  return (
    <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#57534E]">
      {parts.map((part, idx) => (
        <span key={idx}>
          {part}
          {idx < parts.length - 1 ? (
            <mark className="rounded bg-[#EEF2FF] px-0.5 font-semibold text-[#4338CA] ring-1 ring-[#C7D2FE]">
              {quote}
            </mark>
          ) : null}
        </span>
      ))}
    </p>
  );
}

export function TaskContract({
  task,
  db,
  currentUserId,
  onSelectTask,
  onDone,
  compact = false,
}: {
  task: Task;
  db: AppDatabase;
  currentUserId: string;
  onSelectTask?: (taskId: string) => void;
  onDone: (message: string, tone?: 'success' | 'error') => Promise<void>;
  compact?: boolean;
}) {
  const members = db.members;
  const currentUser = members.find((m) => m.id === currentUserId);
  const userIsPm = isPm(currentUser);
  const assignerId = getAssignerId(task);
  const isAssigningPm = assignerId === currentUserId && userIsPm;
  const canRespond = getResponderId(task) === currentUserId;
  const isDraft = task.status === 'draft';
  const isRejected = task.status === 'rejected';
  const isConfirmed = task.status === 'confirmed';
  const isSyncFailed = task.status === 'sync_failed';
  const isEditableDraft = (isDraft || (isRejected && isAssigningPm)) && userIsPm;

  const meeting = db.meetings.find((m) => m.id === task.meetingId);
  const usedFallbackAi = meeting?.usedFallbackAi ?? false;
  const draftWasEdited = isDraft && task.updatedAt !== task.createdAt;
  const proposal = task.currentProposal;

  // Draft / Reassign editor state (preserved across 3s polls because component is keyed by task.id)
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [hours, setHours] = useState(String(proposal.estimatedHours));
  const [assigneeId, setAssigneeId] = useState(proposal.assigneeId);
  const [deadlineInput, setDeadlineInput] = useState(
    toDateInput(proposal.deadline || defaultDeadline()),
  );
  const [dependsOn, setDependsOn] = useState<string[]>(task.dependsOnTaskIds);
  const [checkInDays, setCheckInDays] = useState<CheckInDaysBefore | null>(
    task.checkInDaysBefore ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const [editBaselineUpdatedAt, setEditBaselineUpdatedAt] = useState<string>(task.updatedAt);
  const [suggestion, setSuggestion] = useState<AssignmentSuggestion | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blockingDependentIds, setBlockingDependentIds] = useState<string[]>([]);

  // Inline responder / reschedule panels
  const [inlinePanel, setInlinePanel] = useState<null | 'counter' | 'decline' | 'reschedule'>(null);
  const [counterDeadlineInput, setCounterDeadlineInput] = useState(toDateInput(proposal.deadline));
  const [counterHours, setCounterHours] = useState(String(proposal.estimatedHours));
  const [counterAssigneeId, setCounterAssigneeId] = useState(proposal.assigneeId);
  const [counterCheckIn, setCounterCheckIn] = useState<CheckInDaysBefore | null>(
    task.checkInDaysBefore ?? null,
  );
  const [counterNote, setCounterNote] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [staleBanner, setStaleBanner] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync non-dirty fields when server task updates
  useEffect(() => {
    if (!dirty) {
      setTitle(task.title);
      setDescription(task.description);
      setHours(String(task.currentProposal.estimatedHours));
      setAssigneeId(task.currentProposal.assigneeId);
      setDeadlineInput(toDateInput(task.currentProposal.deadline || defaultDeadline()));
      setDependsOn(task.dependsOnTaskIds);
      setCheckInDays(task.checkInDaysBefore ?? null);
      setEditBaselineUpdatedAt(task.updatedAt);
    }
  }, [task, dirty]);

  useEffect(() => {
    if (inlinePanel === null) {
      setCounterDeadlineInput(toDateInput(task.currentProposal.deadline));
      setCounterHours(String(task.currentProposal.estimatedHours));
      setCounterAssigneeId(task.currentProposal.assigneeId);
      setCounterCheckIn(task.checkInDaysBefore ?? null);
    }
  }, [task.currentProposal.deadline, task.currentProposal.estimatedHours, task.currentProposal.assigneeId, task.checkInDaysBefore, inlinePanel]);

  const activeDeadline = isEditableDraft
    ? deadlineInput
      ? fromDateInput(deadlineInput)
      : ''
    : inlinePanel === 'counter' || inlinePanel === 'reschedule'
      ? counterDeadlineInput
        ? fromDateInput(counterDeadlineInput)
        : ''
      : proposal.deadline;

  const activeHours = isEditableDraft
    ? Number(hours)
    : inlinePanel === 'counter' || inlinePanel === 'reschedule'
      ? Number(counterHours)
      : proposal.estimatedHours;

  const activeAssigneeId = isEditableDraft
    ? assigneeId
    : inlinePanel === 'reschedule'
      ? counterAssigneeId
      : proposal.assigneeId;

  const hoursValid = Number.isFinite(activeHours) && activeHours > 0;

  // Live workload check (sequence-guarded)
  const [workloadData, setWorkloadData] = useState<WorkloadResponse | null>(null);
  const workloadSeqRef = useRef(0);
  useEffect(() => {
    if (!activeDeadline || !hoursValid) return;
    const seq = ++workloadSeqRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<WorkloadResponse>('/api/workload', {
          method: 'POST',
          body: {
            deadline: activeDeadline,
            estimatedHours: activeHours,
            excludeTaskId: task.id,
            taskId: task.id,
          },
          signal: controller.signal,
        });
        if (seq !== workloadSeqRef.current) return;
        if (res.ok) setWorkloadData(res.data);
      } catch {
        // Ignore aborts
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeDeadline, activeHours, hoursValid, task.id, db.tasks, db.calendarEvents]);

  const breakdownByMember = useMemo(() => {
    const map = new Map<string, WorkloadBreakdown>();
    for (const b of workloadData?.breakdowns ?? []) map.set(b.memberId, b);
    return map;
  }, [workloadData]);

  const eligibleMembers = useMemo(
    () => members.filter((m) => m.id !== currentUserId),
    [members, currentUserId],
  );

  const selectedBreakdown = activeAssigneeId ? breakdownByMember.get(activeAssigneeId) : undefined;

  const unlockLevers = useMemo(() => {
    if (!isEditableDraft || !activeAssigneeId || !activeDeadline || !hoursValid || !selectedBreakdown) {
      return null;
    }
    return computeUnlockLevers({
      rejections: db.rejections,
      taskId: task.id,
      taskTitle: title,
      assigneeId: activeAssigneeId,
      deadline: activeDeadline,
      estimatedHours: activeHours,
      availableHours: selectedBreakdown.availableHours,
    });
  }, [
    isEditableDraft,
    activeAssigneeId,
    activeDeadline,
    hoursValid,
    selectedBreakdown,
    db.rejections,
    task.id,
    title,
    activeHours,
  ]);

  const bestFitAlternative = useMemo(() => {
    const candidates = eligibleMembers
      .filter((m) => m.id !== activeAssigneeId)
      .map((m) => ({ member: m, breakdown: breakdownByMember.get(m.id) }))
      .filter((x): x is { member: (typeof members)[number]; breakdown: WorkloadBreakdown } =>
        Boolean(x.breakdown),
      )
      .sort((a, b) => b.breakdown.remainingAfterTask - a.breakdown.remainingAfterTask);
    return candidates[0];
  }, [eligibleMembers, activeAssigneeId, breakdownByMember]);

  const lastRejection = isRejected
    ? db.rejections.filter((r) => r.taskId === task.id).at(-1)
    : undefined;

  const taskAudit = useMemo(
    () => db.auditLog.filter((e) => e.taskId === task.id),
    [db.auditLog, task.id],
  );

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      if (!dirty) setEditBaselineUpdatedAt(task.updatedAt);
      setter(v);
      setDirty(true);
      setError(null);
      setStaleBanner(null);
    };
  }

  function pickMember(id: string) {
    if (!dirty) setEditBaselineUpdatedAt(task.updatedAt);
    setAssigneeId(id);
    setOverrideOpen(false);
    setOverrideReason('');
    setDirty(true);
    setError(null);
  }

  async function askAi() {
    if (!hoursValid || !activeDeadline || !title.trim()) {
      setError('Title, estimated hours, and deadline are required for a suggestion.');
      return;
    }
    setBusy('suggest');
    setError(null);
    const res = await apiFetch<AssignmentSuggestion>('/api/tasks/suggest', {
      method: 'POST',
      body: {
        taskId: task.id,
        excludeMemberId: currentUserId,
        title,
        description,
        estimatedHours: activeHours,
        deadline: activeDeadline,
      },
    });
    setBusy(null);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    setSuggestion(res.data);
    if (res.data.suggestedAssigneeId && res.data.suggestedAssigneeId !== currentUserId) {
      pickMember(res.data.suggestedAssigneeId);
    }
    if (res.data.suggestedDeadline) {
      markDirty(setDeadlineInput)(toDateInput(res.data.suggestedDeadline));
    }
  }

  async function saveDraft() {
    setBusy('save');
    setError(null);
    const res = await apiFetch<{ task: Task }>('/api/tasks', {
      method: 'PATCH',
      body: {
        id: task.id,
        actorId: currentUserId,
        expectedUpdatedAt: editBaselineUpdatedAt,
        title,
        description,
        ...(hoursValid ? { estimatedHours: activeHours } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(activeDeadline ? { deadline: activeDeadline } : {}),
        dependsOnTaskIds: dependsOn,
        checkInDaysBefore: checkInDays,
      },
    });
    setBusy(null);
    if (res.status === 409 && res.data.code === 'STALE_DRAFT') {
      setStaleBanner(
        'This draft was updated in another session while you were editing. Review the latest terms or click Save again to overwrite.',
      );
      setEditBaselineUpdatedAt(task.updatedAt);
      return;
    }
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    setDirty(false);
    if (res.data.task?.updatedAt) setEditBaselineUpdatedAt(res.data.task.updatedAt);
    await onDone(`Saved draft "${title}".`);
  }

  async function submitProposal() {
    if (!assigneeId) {
      setError('Select an assignee before submitting.');
      return;
    }
    if (unlockLevers?.isBlocked && !overrideReason.trim()) {
      setOverrideOpen(true);
      setError('Use an unlock path above, switch assignees, or explain what changed to override.');
      return;
    }
    setBusy('propose');
    setError(null);
    const res = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/propose`, {
      method: 'POST',
      body: {
        actorId: currentUserId,
        expectedUpdatedAt: editBaselineUpdatedAt,
        assigneeId,
        deadline: activeDeadline,
        estimatedHours: activeHours,
        title,
        description,
        dependsOnTaskIds: dependsOn,
        checkInDaysBefore: checkInDays,
        ...(overrideReason.trim() ? { overrideRejectedReason: overrideReason.trim() } : {}),
      },
    });
    setBusy(null);
    if (res.status === 409 && res.data.code === 'PREVIOUSLY_REJECTED') {
      setOverrideOpen(true);
      setError(errorText(res));
      return;
    }
    if (res.status === 409 && res.data.code === 'STALE_DRAFT') {
      setStaleBanner('Draft updated in another tab. Review latest terms before submitting.');
      setEditBaselineUpdatedAt(task.updatedAt);
      return;
    }
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    setDirty(false);
    setOverrideOpen(false);
    setOverrideReason('');
    const proposed = res.data.task;
    await onDone(
      `Sent "${proposed.title}" (v${proposed.currentProposal.version}) to ${memberName(members, proposed.currentProposal.assigneeId)} — awaiting their signature.`,
    );
  }

  async function deleteTask() {
    setBusy('delete');
    setError(null);
    setBlockingDependentIds([]);
    const query = new URLSearchParams({ id: task.id, actorId: currentUserId });
    const res = await apiFetch<{ dependentTaskIds?: string[] }>(`/api/tasks?${query}`, {
      method: 'DELETE',
    });
    setBusy(null);
    if (!res.ok) {
      if (Array.isArray(res.data.dependentTaskIds)) {
        setBlockingDependentIds(res.data.dependentTaskIds);
      }
      setError(errorText(res));
      return;
    }
    setConfirmDelete(false);
    await onDone(`Deleted "${task.title}".`);
  }

  async function respond(action: 'accept' | 'counter' | 'decline') {
    setBusy(action);
    setError(null);
    const body: Record<string, unknown> = {
      actorId: currentUserId,
      expectedVersion: proposal.version,
      action,
    };
    if (action === 'counter') {
      body.newDeadline = fromDateInput(counterDeadlineInput);
      body.newEstimatedHours = Number(counterHours);
      body.note = counterNote;
    } else if (action === 'decline') {
      body.reason = declineReason;
    }
    const res = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/respond`, {
      method: 'POST',
      body,
    });
    setBusy(null);
    if (res.status === 409 && res.data.code === 'VERSION_CONFLICT') {
      setStaleBanner(
        `A newer proposal version arrived while you were viewing v${proposal.version}. Your unsent draft is preserved — review the updated terms before acting.`,
      );
      return;
    }
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    setInlinePanel(null);
    setCounterNote('');
    setDeclineReason('');
    const updated = res.data.task;
    if (action === 'decline') {
      await onDone(`Declined "${task.title}" — logged to Rejection Memory.`);
    } else if (action === 'counter') {
      await onDone(`Counter-proposal v${updated.currentProposal.version} sent for "${task.title}".`);
    } else if (updated.status === 'sync_failed') {
      await onDone(
        `Mutual agreement recorded for "${task.title}", but calendar sync failed: ${updated.syncError ?? ''}`,
        'error',
      );
    } else {
      await onDone(
        `Mutual agreement signed for "${task.title}" (v${updated.currentProposal.version}) — ${updated.calendarEventIds.length} work block(s) synced to calendar.`,
      );
    }
  }

  async function submitReschedule() {
    setBusy('reschedule');
    setError(null);
    const res = await apiFetch<{ task: Task }>(
      `/api/tasks/${encodeURIComponent(task.id)}/reschedule`,
      {
        method: 'POST',
        body: {
          actorId: currentUserId,
          newAssigneeId: counterAssigneeId,
          newDeadline: fromDateInput(counterDeadlineInput),
          newEstimatedHours: Number(counterHours),
          note: counterNote,
          checkInDaysBefore: counterCheckIn,
        },
      },
    );
    setBusy(null);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    setInlinePanel(null);
    setCounterNote('');
    await onDone(
      `Rescheduled "${task.title}" to v${res.data.task.currentProposal.version}; waiting on ${memberName(members, counterAssigneeId)} to re-confirm.`,
    );
  }

  async function retrySync() {
    setBusy('retry');
    setError(null);
    const res = await apiFetch<{ task: Task }>(
      `/api/tasks/${encodeURIComponent(task.id)}/retry-sync`,
      {
        method: 'POST',
        body: { actorId: currentUserId },
      },
    );
    setBusy(null);
    if (!res.ok) {
      setError(errorText(res));
      return;
    }
    await onDone(
      `Calendar synced ${res.data.task.calendarEventIds.length} work block(s) for "${task.title}".`,
    );
  }

  const frozenScheduled = blockHours(task);
  const frozenUnscheduled = Math.max(0, proposal.estimatedHours - frozenScheduled);
  const otherTasks = db.tasks.filter((t) => t.id !== task.id);

  // Persistent Turn & Reality Line
  const turnSummary = (() => {
    if (isSyncFailed) {
      return {
        text: `Agreed (v${proposal.version}) · Calendar sync failed — Retry to write work blocks`,
        tone: 'text-[#BE123C]',
      };
    }
    if (isRejected) {
      const who = lastRejection
        ? lastRejection.rejectedBy === currentUserId
          ? `You declined ${memberName(members, lastRejection.rejectedAssigneeId)}'s counter`
          : `${memberName(members, lastRejection.rejectedBy)} declined v${proposal.version}`
        : `Declined v${proposal.version}`;
      return { text: `${who} · Reassign, unlock terms, or delete`, tone: 'text-[#BE123C]' };
    }
    if (isConfirmed) {
      return {
        text: `Booked v${task.confirmedVersion ?? proposal.version} · ${hoursText(frozenScheduled)} of ${hoursText(proposal.estimatedHours)} placed on ${memberName(members, proposal.assigneeId)}'s calendar`,
        tone: 'text-[#047857]',
      };
    }
    if (isDraft) {
      return {
        text: unlockLevers?.isBlocked
          ? `${memberName(members, currentUserId)}'s turn · Guard active on ${memberName(members, assigneeId)} · Reassign or unlock`
          : `${memberName(members, currentUserId)}'s turn · Draft ready for workload check & assignment`,
        tone: unlockLevers?.isBlocked ? 'text-[#BE123C]' : 'text-[#4338CA]',
      };
    }
    const responder = getResponderId(task);
    const whoTurn =
      responder === currentUserId
        ? 'Your turn'
        : `${memberName(members, responder)}'s turn`;
    return {
      text: `${whoTurn} · v${proposal.version} ${task.status === 'counter_proposed' ? 'counter' : 'proposal'} · ${hoursText(frozenScheduled)} of ${hoursText(proposal.estimatedHours)} fit before ${formatDateTime(proposal.deadline)}`,
      tone: responder === currentUserId ? 'text-[#111827]' : 'text-[#57534E]',
    };
  })();

  const originClass =
    isDraft && task.aiGenerated
      ? usedFallbackAi
        ? 'ai-origin-heuristic'
        : 'ai-origin-llm'
      : 'text-[#111827]';

  const originLabel = isDraft
    ? task.aiGenerated
      ? usedFallbackAi
        ? draftWasEdited
          ? 'Heuristic draft · edited'
          : 'Heuristic fallback draft'
        : draftWasEdited
          ? 'AI-drafted · edited'
          : 'AI-extracted draft'
      : 'Manual draft'
    : `Human-owned · v${proposal.version}`;

  return (
    <article className="overflow-hidden rounded-xl border border-[#E5E2DC] bg-white shadow-sm">
      {/* Persistent Turn & Reality Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E2DC] bg-[#F7F6F2] px-4 py-2 text-xs font-semibold">
        <span className={turnSummary.tone}>{turnSummary.text}</span>
        <span className="font-mono text-[11px] text-[#78716C] tabular-nums">
          {isConfirmed ? 'Calendar unlocked' : isSyncFailed ? 'Sync pending retry' : 'Calendar locked'}
        </span>
      </div>

      <div className={`space-y-4 ${compact ? 'p-3.5' : 'p-5'}`}>
        {/* Title & Typographic Provenance Header */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {isEditableDraft ? (
              <label className="block">
                <span className="sr-only">
                  Task title ({task.aiGenerated ? 'AI-extracted draft' : 'Manual draft'})
                </span>
                <input
                  value={title}
                  onChange={(e) => markDirty(setTitle)(e.target.value)}
                  className={`w-full border-0 bg-transparent p-0 text-lg font-bold tracking-tight focus:outline-none focus:ring-0 ${originClass}`}
                  placeholder="Task title"
                />
              </label>
            ) : (
              <h2 className="text-lg font-bold tracking-tight text-[#111827]">{task.title}</h2>
            )}
            <p className="mt-0.5 font-mono text-[11px] text-[#57534E] tabular-nums">
              {memberName(members, assignerId)} to{' '}
              <strong className="text-[#111827]">{memberName(members, activeAssigneeId)}</strong> ·{' '}
              {hoursText(activeHours)} · Due {formatDateTime(activeDeadline)}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
              isDraft && task.aiGenerated
                ? 'border-[#C7D2FE] bg-[#EEF2FF] text-[#4338CA]'
                : 'border-[#E5E2DC] bg-[#F7F6F2] text-[#57534E]'
            }`}
          >
            {originLabel}
            {meeting ? ` · ${meeting.title}` : ''}
          </span>
        </div>

        {/* Description */}
        {isEditableDraft ? (
          <textarea
            value={description}
            onChange={(e) => markDirty(setDescription)(e.target.value)}
            rows={2}
            placeholder="Scope & deliverable notes…"
            className={`${inputClass} text-xs`}
          />
        ) : task.description ? (
          <p className="text-xs leading-relaxed text-[#57534E]">{task.description}</p>
        ) : null}

        {/* Honest Source Excerpt */}
        {task.sourceQuote ? (
          <div className="rounded-lg border-l-[3px] border-l-[#4338CA] bg-[#F8F8FC] px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#4338CA]">Verbatim source quote</span>
              {meeting?.rawNotes ? (
                <button
                  type="button"
                  onClick={() => setTranscriptOpen((v) => !v)}
                  className="text-[11px] font-semibold text-[#4338CA] underline underline-offset-2"
                >
                  {transcriptOpen ? 'Hide full notes' : 'Inspect in meeting notes'}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[#57534E]">“{task.sourceQuote}”</p>
            {task.aiReasoning ? (
              <p className="mt-1 text-[11px] text-[#78716C]">{task.aiReasoning}</p>
            ) : null}
            {transcriptOpen && meeting?.rawNotes ? (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-[#E5E2DC] bg-white p-2.5">
                <HighlightedTranscript rawNotes={meeting.rawNotes} quote={task.sourceQuote} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Proposal notes / override justification */}
        {proposal.note ? (
          <div className="rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] px-3 py-2 text-xs text-[#111827]">
            <strong>Note from {memberName(members, proposal.proposedBy)}:</strong> {proposal.note}
          </div>
        ) : null}
        {proposal.overrideRejectedReason ? (
          <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#78350F]">
            <strong>Re-proposed with human justification:</strong> {proposal.overrideRejectedReason}
          </div>
        ) : null}

        {/* Sync Failed Alert */}
        {isSyncFailed ? (
          <Banner tone="error" title="Mutual agreement recorded — calendar write failed">
            {task.syncError ?? 'Calendar provider returned an error.'} Turn off Outage Simulation in
            Demo Lab, then click Retry Calendar Sync below.
          </Banner>
        ) : null}

        {staleBanner ? (
          <Banner tone="warning" title="Concurrent update detected" onDismiss={() => setStaleBanner(null)}>
            {staleBanner}
          </Banner>
        ) : null}

        {/* PM DRAFT / REASSIGN WORKBENCH */}
        {isEditableDraft ? (
          <div className="space-y-4">
            {/* Hours, Deadline, Check-in Cadence */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                Estimated Hours
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className={`${inputClass} mt-1 font-mono tabular-nums`}
                  value={hours}
                  onChange={(e) => markDirty(setHours)(e.target.value)}
                />
              </label>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                Deadline (18:00)
                <input
                  type="date"
                  className={`${inputClass} mt-1 font-mono tabular-nums`}
                  value={deadlineInput}
                  onChange={(e) => markDirty(setDeadlineInput)(e.target.value)}
                />
              </label>
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                  Progress Check-in
                </span>
                <div className="mt-1 inline-flex w-full rounded-lg border border-[#D1CCC2] bg-[#F7F6F2] p-0.5">
                  {([null, ...CHECK_IN_DAY_OPTIONS] as (CheckInDaysBefore | null)[]).map((d) => {
                    const active = checkInDays === d;
                    return (
                      <button
                        key={d === null ? 'off' : d}
                        type="button"
                        onClick={() => markDirty(setCheckInDays)(d)}
                        className={`flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors ${
                          active ? 'bg-[#111827] text-white' : 'text-[#57534E] hover:text-[#111827]'
                        }`}
                      >
                        {d === null ? 'Off' : d === 0 ? 'Due' : `${d}d`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Visual Assignee Capacity Cards (Self-assignment excluded) */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                  Assignee Capacity &amp; Rejection Memory (Self-assignment excluded)
                </span>
                <button
                  type="button"
                  onClick={askAi}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-md border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-1 text-[11px] font-semibold text-[#4338CA] hover:bg-[#E0E7FF] disabled:opacity-50"
                >
                  {busy === 'suggest' ? <Spinner /> : <SparkleIcon className="h-3 w-3" />}
                  Ask AI Suggestion
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {eligibleMembers.map((member) => {
                  const b = breakdownByMember.get(member.id);
                  const lever =
                    b && activeDeadline && hoursValid
                      ? computeUnlockLevers({
                          rejections: db.rejections,
                          taskId: task.id,
                          taskTitle: title,
                          assigneeId: member.id,
                          deadline: activeDeadline,
                          estimatedHours: activeHours,
                          availableHours: b.availableHours,
                        })
                      : null;
                  const active = member.id === assigneeId;
                  const style = b ? WORKLOAD_STYLES[b.status] : WORKLOAD_STYLES.ok;
                  const used = b ? Math.max(0, b.proratedWorkHours - b.availableHours) : 0;
                  const total = b
                    ? Math.max(b.proratedWorkHours, used + b.newTaskHours, 0.1)
                    : 1;

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => pickMember(member.id)}
                      className={`rounded-lg border p-2.5 text-left transition-all ${
                        active
                          ? 'border-[#111827] ring-2 ring-[#111827]/15'
                          : lever?.isBlocked
                            ? 'border-[#FECDD3] bg-[#FFF9FA] hover:border-[#BE123C]'
                            : 'border-[#E5E2DC] bg-white hover:border-[#D1CCC2]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 text-xs font-bold text-[#111827]">
                        <span className="truncate">{member.name}</span>
                        <span
                          className={`shrink-0 text-[10px] font-semibold ${
                            lever?.isBlocked ? 'text-[#BE123C]' : style.text
                          }`}
                        >
                          {lever?.isBlocked ? 'Guard active' : b ? style.label : member.role}
                        </span>
                      </div>
                      <div className="my-1.5 flex h-1.5 overflow-hidden rounded-full bg-[#ECEAE4]">
                        {b ? (
                          <>
                            <div
                              className="bg-[#A8A29E]"
                              style={{ width: `${Math.min(100, (used / total) * 100)}%` }}
                            />
                            <div
                              className={style.bar}
                              style={{
                                width: `${Math.min(100, (b.newTaskHours / total) * 100)}%`,
                              }}
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="flex items-center justify-between font-mono text-[10px] text-[#57534E] tabular-nums">
                        <span>
                          {b ? `${hoursText(b.availableHours)} free` : `${member.weeklyHours}h/wk`}
                        </span>
                        <span>
                          {b
                            ? b.remainingAfterTask < 0
                              ? `${hoursText(b.remainingAfterTask)} deficit`
                              : `${hoursText(b.remainingAfterTask)} left`
                            : member.role}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {suggestion ? (
                <div className="mt-2 rounded-lg border border-[#C7D2FE] bg-[#EEF2FF] p-2.5 text-xs text-[#312E81]">
                  <p className="font-semibold">
                    AI suggests {memberName(members, suggestion.suggestedAssigneeId)} by{' '}
                    {formatDateTime(suggestion.suggestedDeadline)}
                    {suggestion.usedFallbackAi ? ' (deterministic fallback)' : ''}
                  </p>
                  <p className="mt-0.5 text-[11px]">{suggestion.aiReasoning}</p>
                  {suggestion.warning ? (
                    <p className="mt-1 text-[11px] font-semibold text-[#B45309]">
                      {suggestion.warning}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Honest Rejection Unlock Levers */}
              {unlockLevers?.isBlocked ? (
                <div
                  role="alert"
                  className="mt-2.5 space-y-2 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-3 text-xs"
                >
                  <p className="font-bold text-[#BE123C]">
                    {memberName(members, unlockLevers.blockingRecords[0].rejectedBy)} declined{' '}
                    {memberName(members, unlockLevers.blockingRecords[0].rejectedAssigneeId)}’s
                    terms ({hoursText(unlockLevers.blockingRecords[0].estimatedHours)}, due{' '}
                    {formatDateTime(unlockLevers.blockingRecords[0].rejectedDeadline)}): “
                    {unlockLevers.blockingRecords[0].reason}”
                  </p>
                  <p className="text-[11px] text-[#57534E]">
                    Guard stays active while deadline and effort remain unchanged.{' '}
                    <strong>Honest unlock paths (re-checked against live workload):</strong>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {unlockLevers.suggestedNextDeadlineIso ? (
                      <button
                        type="button"
                        onClick={() =>
                          markDirty(setDeadlineInput)(
                            toDateInput(unlockLevers.suggestedNextDeadlineIso),
                          )
                        }
                        className="rounded-full border border-[#111827] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111827] hover:bg-[#111827] hover:text-white"
                      >
                        Move after deadline to{' '}
                        {new Date(unlockLevers.suggestedNextDeadlineIso).toLocaleDateString(
                          'en-US',
                          { weekday: 'short', month: 'short', day: 'numeric' },
                        )}
                      </button>
                    ) : null}
                    {unlockLevers.suggestedFitHours ? (
                      <button
                        type="button"
                        onClick={() =>
                          markDirty(setHours)(String(unlockLevers.suggestedFitHours))
                        }
                        className="rounded-full border border-[#111827] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111827] hover:bg-[#111827] hover:text-white"
                      >
                        Fit within free capacity (≤ {hoursText(unlockLevers.suggestedFitHours)})
                      </button>
                    ) : null}
                    {bestFitAlternative ? (
                      <button
                        type="button"
                        onClick={() => pickMember(bestFitAlternative.member.id)}
                        className="rounded-full border border-[#047857] bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-semibold text-[#047857] hover:bg-[#047857] hover:text-white"
                      >
                        Switch to {bestFitAlternative.member.name.split(' ')[0]} (
                        {hoursText(bestFitAlternative.breakdown.availableHours)} free)
                      </button>
                    ) : null}
                  </div>

                  <div className="border-t border-[#FECDD3] pt-2">
                    <button
                      type="button"
                      onClick={() => setOverrideOpen((v) => !v)}
                      className="text-[11px] font-semibold text-[#881337] underline underline-offset-2"
                    >
                      {overrideOpen
                        ? 'Hide override justification'
                        : 'Conditions changed externally? Override guard with justification'}
                    </button>
                    {overrideOpen ? (
                      <textarea
                        className={`${inputClass} mt-1.5 text-xs`}
                        rows={2}
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        placeholder="Explain what changed (required to override rejection memory)…"
                      />
                    ) : null}
                  </div>
                </div>
              ) : unlockLevers && unlockLevers.priorMatches.length > 0 ? (
                <div className="mt-2 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-xs text-[#064E3B]">
                  <strong>Prior decline cleared under updated terms</strong> —{' '}
                  {memberName(members, unlockLevers.priorMatches[0].rejectedBy)} previously
                  declined “{unlockLevers.priorMatches[0].taskTitle}” (
                  {hoursText(unlockLevers.priorMatches[0].estimatedHours)}). Prior context stays
                  logged in Ledger.
                </div>
              ) : null}
            </div>

            {/* Chip Dependency Picker (replaces <select multiple>) */}
            {otherTasks.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
                  Dependencies (checks direct downstream deadlines)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {otherTasks.map((other) => {
                    const selected = dependsOn.includes(other.id);
                    return (
                      <button
                        key={other.id}
                        type="button"
                        onClick={() =>
                          markDirty(setDependsOn)(
                            selected
                              ? dependsOn.filter((id) => id !== other.id)
                              : [...dependsOn, other.id],
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                          selected
                            ? 'border-[#111827] bg-[#111827] text-white'
                            : 'border-[#E5E2DC] bg-[#F7F6F2] text-[#57534E] hover:border-[#D1CCC2] hover:text-[#111827]'
                        }`}
                      >
                        {selected ? <CheckIcon className="h-3 w-3" /> : null}
                        <span>{other.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Decision-on-the-Calendar Mini Timeline */}
        <MiniCalendarStrip
          members={members}
          assigneeId={activeAssigneeId}
          deadline={activeDeadline}
          estimatedHours={activeHours}
          calendarEvents={db.calendarEvents}
          frozenBlocks={
            isEditableDraft || inlinePanel === 'counter' || inlinePanel === 'reschedule'
              ? undefined
              : proposal.proposedBlocks
          }
          excludeTaskId={task.id}
          isCommitted={isConfirmed && inlinePanel === null}
        />

        {/* Affected downstream dependents warning */}
        {workloadData && workloadData.affectedDependents.length > 0 ? (
          <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2.5 text-xs text-[#78350F]">
            <p className="font-semibold">
              Direct downstream deadline warning ({workloadData.affectedDependents.length} task
              {workloadData.affectedDependents.length === 1 ? '' : 's'})
            </p>
            <ul className="mt-1 space-y-1">
              {workloadData.affectedDependents.map((dep) => (
                <li key={dep.taskId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{dep.title}</strong> ({memberName(members, dep.assigneeId)}, due{' '}
                    {formatDateTime(dep.currentDeadline)})
                  </span>
                  {onSelectTask ? (
                    <button
                      type="button"
                      onClick={() => onSelectTask(dep.taskId)}
                      className="font-semibold underline"
                    >
                      Open task
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Perforated Contract Divider + Two-Signature Handshake Strip */}
        <div className="perforated-rule -mx-5 my-2" />
        <HandshakeStrip
          task={task}
          members={members}
          draftAssigneeId={isEditableDraft ? assigneeId : undefined}
        />

        {/* Budget Math Footer (honest separation of budget vs placement) */}
        {selectedBreakdown ? (
          <p className="font-mono text-[11px] text-[#57534E] tabular-nums">
            Budget ({memberName(members, selectedBreakdown.memberId)}):{' '}
            {hoursText(selectedBreakdown.proratedWorkHours)} prorated −{' '}
            {hoursText(selectedBreakdown.scheduledMeetingHours)} mtgs −{' '}
            {hoursText(selectedBreakdown.existingTaskHours)} committed ={' '}
            <strong className="text-[#111827]">
              {hoursText(selectedBreakdown.availableHours)} free
            </strong>
          </p>
        ) : null}

        {/* Inline Counter-Propose / Reschedule Panel */}
        {inlinePanel === 'counter' || inlinePanel === 'reschedule' ? (
          <div className="space-y-3 rounded-lg border border-[#D1CCC2] bg-[#F7F6F2] p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#111827]">
                {inlinePanel === 'counter'
                  ? `Counter-propose terms (v${proposal.version + 1})`
                  : `Reschedule booked task (v${proposal.version + 1})`}
              </h3>
              <button
                type="button"
                onClick={() => setInlinePanel(null)}
                className="rounded p-0.5 text-[#57534E] hover:text-[#111827]"
                aria-label="Close panel"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {inlinePanel === 'reschedule' ? (
                <label className="block text-[11px] font-semibold text-[#57534E]">
                  Assignee
                  <select
                    className={`${inputClass} mt-1 text-xs`}
                    value={counterAssigneeId}
                    onChange={(e) => setCounterAssigneeId(e.target.value)}
                  >
                    {eligibleMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-[11px] font-semibold text-[#57534E]">
                New deadline (18:00)
                <input
                  type="date"
                  className={`${inputClass} mt-1 font-mono text-xs`}
                  value={counterDeadlineInput}
                  onChange={(e) => setCounterDeadlineInput(e.target.value)}
                />
              </label>
              <label className="block text-[11px] font-semibold text-[#57534E]">
                Estimated hours
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className={`${inputClass} mt-1 font-mono text-xs`}
                  value={counterHours}
                  onChange={(e) => setCounterHours(e.target.value)}
                />
              </label>
            </div>
            {inlinePanel === 'reschedule' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#57534E]">
                <span>Check-in cadence (rescheduling resets any active check-in):</span>
                <div className="inline-flex rounded-md border border-[#D1CCC2] bg-white p-0.5">
                  {([null, ...CHECK_IN_DAY_OPTIONS] as (CheckInDaysBefore | null)[]).map((d) => (
                    <button
                      key={d === null ? 'off' : d}
                      type="button"
                      onClick={() => setCounterCheckIn(d)}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                        counterCheckIn === d ? 'bg-[#111827] text-white' : 'text-[#57534E]'
                      }`}
                    >
                      {d === null ? 'Off' : checkInDaysLabel(d).split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <textarea
              className={`${inputClass} text-xs`}
              rows={2}
              value={counterNote}
              onChange={(e) => setCounterNote(e.target.value)}
              placeholder="Explain the proposed adjustment…"
            />
            {inlinePanel === 'reschedule' ? (
              <p className="text-[11px] text-[#57534E]">
                Existing v{task.confirmedVersion ?? proposal.version} work blocks stay live on the
                calendar until the assignee confirms the new version.
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => setInlinePanel(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass.primary}
                disabled={busy !== null || !counterDeadlineInput || !(Number(counterHours) > 0)}
                onClick={() =>
                  inlinePanel === 'counter' ? void respond('counter') : void submitReschedule()
                }
              >
                {busy === 'counter' || busy === 'reschedule' ? <Spinner /> : null}
                {inlinePanel === 'counter'
                  ? `Send Counter v${proposal.version + 1}`
                  : `Submit Replacement v${proposal.version + 1}`}
              </button>
            </div>
          </div>
        ) : null}

        {/* Inline Decline Panel (Quick chips prefill single required reason) */}
        {inlinePanel === 'decline' ? (
          <div className="space-y-2.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#BE123C]">
                Decline v{proposal.version} (logged to Rejection Memory)
              </h3>
              <button
                type="button"
                onClick={() => setInlinePanel(null)}
                className="rounded p-0.5 text-[#BE123C]"
                aria-label="Close decline panel"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DECLINE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setDeclineReason(chip)}
                  className="rounded-full border border-[#FECDD3] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#881337] hover:bg-[#BE123C] hover:text-white"
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              className={`${inputClass} text-xs`}
              rows={2}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Why are you declining these terms? (required)"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => setInlinePanel(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass.danger}
                disabled={busy !== null || !declineReason.trim()}
                onClick={() => void respond('decline')}
              >
                {busy === 'decline' ? <Spinner /> : null} Confirm Decline
              </button>
            </div>
          </div>
        ) : null}

        {/* Pre-sign partial / zero placement notice */}
        {canRespond && !isDraft && !isConfirmed && !isSyncFailed && frozenUnscheduled > 0 ? (
          <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#78350F]">
            <strong>Partial placement disclosure:</strong> Only {hoursText(frozenScheduled)} of{' '}
            {hoursText(proposal.estimatedHours)} fit before {formatDateTime(proposal.deadline)} (
            {hoursText(frozenUnscheduled)} unplaced). Sign to accept partial booking, or counter for
            a later deadline.
          </div>
        ) : null}

        {error ? (
          <Banner tone="error">
            {error}
            {blockingDependentIds.length > 0 && onSelectTask ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {blockingDependentIds.map((depId) => {
                  const depTask = db.tasks.find((t) => t.id === depId);
                  return (
                    <button
                      key={depId}
                      type="button"
                      onClick={() => onSelectTask(depId)}
                      className="rounded border border-[#BE123C] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#BE123C]"
                    >
                      Open {depTask?.title ?? depId}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </Banner>
        ) : null}

        {/* Dominant Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {isEditableDraft ? (
              confirmDelete ? (
                <>
                  <button
                    type="button"
                    className={buttonClass.danger}
                    onClick={() => void deleteTask()}
                    disabled={busy !== null}
                  >
                    {busy === 'delete' ? <Spinner /> : null} Confirm Delete
                  </button>
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={buttonClass.danger}
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy !== null || task.calendarEventIds.length > 0}
                  title={
                    task.calendarEventIds.length > 0
                      ? 'Cannot delete a task with live booked calendar blocks'
                      : undefined
                  }
                >
                  {isDraft ? 'Delete Draft' : 'Delete Task'}
                </button>
              )
            ) : null}

            {isDraft && dirty ? (
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => void saveDraft()}
                disabled={busy !== null}
              >
                {busy === 'save' ? <Spinner /> : null} Save Draft
              </button>
            ) : null}

            {isConfirmed && isAssigningPm && inlinePanel === null ? (
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => setInlinePanel('reschedule')}
              >
                Reschedule
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isEditableDraft ? (
              <button
                type="button"
                className={buttonClass.primary}
                onClick={() => void submitProposal()}
                disabled={
                  busy !== null ||
                  !assigneeId ||
                  !hoursValid ||
                  !activeDeadline ||
                  (Boolean(unlockLevers?.isBlocked) && !overrideReason.trim())
                }
              >
                {busy === 'propose' ? <Spinner /> : null}
                {unlockLevers?.isBlocked
                  ? overrideReason.trim()
                    ? 'Submit with Justification'
                    : 'Submit Proposal (Guard Active)'
                  : `Submit Proposal to ${memberName(members, assigneeId).split(' ')[0]}`}
              </button>
            ) : null}

            {canRespond && !isDraft && !isConfirmed && !isSyncFailed && inlinePanel === null ? (
              <>
                <button
                  type="button"
                  className={buttonClass.danger}
                  onClick={() => setInlinePanel('decline')}
                  disabled={busy !== null}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className={buttonClass.secondary}
                  onClick={() => setInlinePanel('counter')}
                  disabled={busy !== null}
                >
                  Counter Terms
                </button>
                <button
                  type="button"
                  className={buttonClass.emerald}
                  onClick={() => void respond('accept')}
                  disabled={busy !== null}
                >
                  {busy === 'accept' ? <Spinner /> : <CheckIcon className="h-3.5 w-3.5" />}
                  {busy === 'accept'
                    ? `Signing v${proposal.version}…`
                    : `Sign & Unlock Calendar (v${proposal.version})`}
                </button>
              </>
            ) : null}

            {isSyncFailed ? (
              <button
                type="button"
                className={buttonClass.primary}
                onClick={() => void retrySync()}
                disabled={busy !== null}
              >
                {busy === 'retry' ? <Spinner /> : <RefreshIcon className="h-3.5 w-3.5" />}
                Retry Calendar Sync
              </button>
            ) : null}
          </div>
        </div>

        {/* Progress Check-in Panel (on confirmed tasks) */}
        {isConfirmed ? (
          <CheckInPanel
            task={task}
            members={members}
            currentUserId={currentUserId}
            isAssigningPm={isAssigningPm}
            onDone={onDone}
          />
        ) : null}

        {/* Reusable Chronological Receipt Rail */}
        <div className="border-t border-[#E5E2DC] pt-3">
          <button
            type="button"
            onClick={() => setReceiptsOpen((v) => !v)}
            className="text-xs font-semibold text-[#57534E] hover:text-[#111827]"
          >
            {receiptsOpen ? 'Hide' : 'Show'} decision receipts ({taskAudit.length})
          </button>
          {receiptsOpen ? (
            <div className="mt-3">
              <ReceiptRail entries={taskAudit} members={members} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
