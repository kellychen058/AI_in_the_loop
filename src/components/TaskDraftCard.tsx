'use client';

import { useState } from 'react';
import { CHECK_IN_DAY_OPTIONS, checkInDaysLabel, parseCheckInSelect } from '@/lib/checkIn';
import type {
  AssignmentSuggestion,
  RejectionRecord,
  Task,
  TeamMember,
  WorkloadBreakdown,
} from '@/lib/types';
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
  StatusPill,
  toDateInput,
} from './ui';
import { WorkloadMeter } from './WorkloadMeter';

const CONFIDENCE_STYLES = {
  high: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-800',
  low: 'bg-rose-50 text-rose-700',
} as const;

interface Guard {
  priorRejection: RejectionRecord;
  workload?: WorkloadBreakdown;
}

export function TaskDraftCard({
  task,
  members,
  allTasks,
  rejections,
  currentUserId,
  onChanged,
  onProposed,
}: {
  task: Task;
  members: TeamMember[];
  allTasks: Task[];
  rejections: RejectionRecord[];
  currentUserId: string;
  onChanged: () => Promise<void>;
  onProposed: (message: string) => void;
}) {
  const isDraft = task.status === 'draft';
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [hours, setHours] = useState(String(task.currentProposal.estimatedHours));
  const [assigneeId, setAssigneeId] = useState(task.currentProposal.assigneeId);
  const [deadlineInput, setDeadlineInput] = useState(
    toDateInput(task.currentProposal.deadline || defaultDeadline()),
  );
  const [dependsOn, setDependsOn] = useState<string[]>(task.dependsOnTaskIds);
  const [checkInInput, setCheckInInput] = useState(task.checkInDaysBefore?.toString() ?? '');
  const [suggestion, setSuggestion] = useState<AssignmentSuggestion | null>(null);
  const [guard, setGuard] = useState<Guard | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState<null | 'suggest' | 'save' | 'propose' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const estimatedHours = Number(hours);
  const deadline = deadlineInput ? fromDateInput(deadlineInput) : '';
  const hoursValid = Number.isFinite(estimatedHours) && estimatedHours > 0;
  const checkInDaysBefore = parseCheckInSelect(checkInInput);
  const lastRejection =
    task.status === 'rejected' ? rejections.filter((r) => r.taskId === task.id).at(-1) : undefined;

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setError(null);
    };
  }

  function pickAssignee(id: string) {
    setAssigneeId(id);
    setGuard(null);
    setOverrideReason('');
    setDirty(true);
  }

  async function askAi() {
    if (!hoursValid || !deadline || !title.trim()) {
      setError('Title, estimated hours and deadline are required for a suggestion.');
      return;
    }
    setBusy('suggest');
    setError(null);
    const result = await apiFetch<AssignmentSuggestion>('/api/tasks/suggest', {
      method: 'POST',
      body: { taskId: task.id, title, description, estimatedHours, deadline },
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    setSuggestion(result.data);
    if (result.data.suggestedAssigneeId) pickAssignee(result.data.suggestedAssigneeId);
    if (result.data.suggestedDeadline) setDeadlineInput(toDateInput(result.data.suggestedDeadline));
  }

  async function save() {
    setBusy('save');
    const result = await apiFetch('/api/tasks', {
      method: 'PATCH',
      body: {
        id: task.id,
        actorId: currentUserId,
        title,
        description,
        ...(hoursValid ? { estimatedHours } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(deadline ? { deadline } : {}),
        dependsOnTaskIds: dependsOn,
        checkInDaysBefore,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    setDirty(false);
    await onChanged();
  }

  async function remove() {
    setBusy('delete');
    const query = new URLSearchParams({ id: task.id, actorId: currentUserId });
    const result = await apiFetch(`/api/tasks?${query}`, {
      method: 'DELETE',
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    await onChanged();
  }

  async function propose() {
    if (!assigneeId) {
      setError('Pick an assignee first.');
      return;
    }
    if (guard && !overrideReason.trim()) {
      setError('Explain what changed before re-submitting, or pick another assignee.');
      return;
    }
    setBusy('propose');
    setError(null);
    const result = await apiFetch<{
      task: Task;
      priorRejection?: RejectionRecord;
      workload?: WorkloadBreakdown;
    }>(`/api/tasks/${encodeURIComponent(task.id)}/propose`, {
      method: 'POST',
      body: {
        actorId: currentUserId,
        assigneeId,
        deadline,
        estimatedHours,
        title,
        description,
        dependsOnTaskIds: dependsOn,
        checkInDaysBefore,
        ...(guard ? { overrideRejectedReason: overrideReason.trim() } : {}),
      },
    });
    setBusy(null);
    if (result.status === 409 && result.data.code === 'PREVIOUSLY_REJECTED' && result.data.priorRejection) {
      setGuard({ priorRejection: result.data.priorRejection, workload: result.data.workload });
      return;
    }
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    const proposed = result.data.task;
    onProposed(
      `"${proposed.title}" sent to ${memberName(members, proposed.currentProposal.assigneeId)} (v${proposed.currentProposal.version}) — now pending their confirmation in /inbox.`,
    );
    await onChanged();
  }

  const otherTasks = allTasks.filter((t) => t.id !== task.id);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {task.aiGenerated ? (
          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
            ✦ AI Suggested
          </span>
        ) : (
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-semibold text-white">
            Manual
          </span>
        )}
        {task.aiConfidence ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLES[task.aiConfidence]}`}>
            {task.aiConfidence} confidence
          </span>
        ) : null}
        <StatusPill status={task.status} />
        {dirty && isDraft ? <span className="text-xs text-amber-700">Unsaved edits</span> : null}
      </div>

      {lastRejection ? (
        <div className="mt-3">
          <Banner tone="warning" title={`Declined by ${memberName(members, lastRejection.rejectedBy)}`}>
            “{lastRejection.reason}” — edit and re-propose, or pick someone else.
          </Banner>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3">
        <label className="block text-xs font-medium text-slate-600">
          Title
          <input className={`${inputClass} mt-1`} value={title} onChange={(e) => edit(setTitle)(e.target.value)} />
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Description
          <textarea
            className={`${inputClass} mt-1`}
            rows={2}
            value={description}
            onChange={(e) => edit(setDescription)(e.target.value)}
          />
        </label>

        {task.sourceQuote ? (
          <details className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Source quote from notes</summary>
            <blockquote className="mt-1 border-l-2 border-indigo-300 pl-2 italic">{task.sourceQuote}</blockquote>
            {task.aiReasoning ? <p className="mt-1 text-slate-500">Why: {task.aiReasoning}</p> : null}
          </details>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-600">
            Estimated hours
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={`${inputClass} mt-1`}
              value={hours}
              onChange={(e) => edit(setHours)(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Assignee
            <select
              className={`${inputClass} mt-1`}
              value={assigneeId}
              onChange={(e) => pickAssignee(e.target.value)}
            >
              <option value="">— Pick —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === currentUserId}>
                  {m.name} ({m.role}){m.id === currentUserId ? ' — you' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Deadline (18:00)
            <input
              type="date"
              className={`${inputClass} mt-1`}
              value={deadlineInput}
              onChange={(e) => edit(setDeadlineInput)(e.target.value)}
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-slate-600">
          Progress check-in (one-sentence update from the assignee)
          <select
            className={`${inputClass} mt-1`}
            value={checkInInput}
            onChange={(e) => edit(setCheckInInput)(e.target.value)}
          >
            <option value="">None</option>
            {CHECK_IN_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {checkInDaysLabel(days)}
              </option>
            ))}
          </select>
        </label>

        {otherTasks.length > 0 ? (
          <label className="block text-xs font-medium text-slate-600">
            Depends on (optional, Ctrl/⌘-click for several)
            <select
              multiple
              size={Math.min(4, otherTasks.length)}
              className={`${inputClass} mt-1`}
              value={dependsOn}
              onChange={(e) =>
                edit(setDependsOn)(Array.from(e.target.selectedOptions, (option) => option.value))
              }
            >
              {otherTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.status})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass.secondary} onClick={askAi} disabled={busy !== null}>
          {busy === 'suggest' ? <Spinner /> : '✦'} Ask AI for Assignee Suggestion
        </button>
        {isDraft && dirty ? (
          <button type="button" className={buttonClass.secondary} onClick={save} disabled={busy !== null}>
            {busy === 'save' ? <Spinner /> : null} Save Draft
          </button>
        ) : null}
        {isDraft || task.status === 'rejected' ? (
          <button type="button" className={buttonClass.danger} onClick={remove} disabled={busy !== null}>
            {busy === 'delete' ? <Spinner /> : null} {isDraft ? 'Delete Draft' : 'Delete Task'}
          </button>
        ) : null}
      </div>

      {suggestion ? (
        <div className="mt-3 rounded-md border border-indigo-200 bg-indigo-50/60 p-3 text-xs text-indigo-950">
          <p className="font-semibold">
            ✦ AI suggests {memberName(members, suggestion.suggestedAssigneeId)} by{' '}
            {formatDateTime(suggestion.suggestedDeadline)}
            {suggestion.usedFallbackAi ? ' (deterministic fallback)' : ''}
          </p>
          <p className="mt-1">{suggestion.aiReasoning}</p>
          {suggestion.avoidedRejections.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {suggestion.avoidedRejections.map((r) => (
                <li key={r.id}>
                  Avoided {memberName(members, r.rejectedAssigneeId)} — declined “{r.taskTitle}” on{' '}
                  {formatDateTime(r.createdAt)}: {r.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {suggestion.warning ? <p className="mt-1 text-amber-800">⚠ {suggestion.warning}</p> : null}
          <p className="mt-1 text-indigo-700">You decide — the suggestion only pre-fills the form.</p>
        </div>
      ) : null}

      <div className="mt-3">
        <WorkloadMeter
          members={members}
          assigneeId={assigneeId}
          deadline={deadline}
          estimatedHours={estimatedHours}
          excludeTaskId={task.id}
          disabledMemberIds={[currentUserId]}
          onPickMember={pickAssignee}
        />
      </div>

      {guard ? (
        <div className="mt-3 rounded-lg border-2 border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          <p className="font-semibold">Previously rejected under similar conditions</p>
          <p className="mt-1 text-xs">
            {memberName(members, guard.priorRejection.rejectedAssigneeId)} declined “
            {guard.priorRejection.taskTitle}” ({hoursText(guard.priorRejection.estimatedHours)}, due{' '}
            {formatDateTime(guard.priorRejection.rejectedDeadline)}) on{' '}
            {formatDateTime(guard.priorRejection.createdAt)}:
          </p>
          <blockquote className="mt-1 border-l-2 border-red-300 pl-2 text-xs italic">
            {guard.priorRejection.reason}
          </blockquote>
          <p className="mt-1 text-xs">
            Workload then: {guard.priorRejection.workloadSnapshot.explanation}
          </p>
          {guard.workload ? <p className="mt-1 text-xs">Workload now: {guard.workload.explanation}</p> : null}
          <label className="mt-2 block text-xs font-medium">
            What changed? (required to re-submit)
            <textarea
              className={`${inputClass} mt-1`}
              rows={2}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Carol's OAuth task was moved to next sprint, freeing 8h."
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              onClick={propose}
              disabled={busy !== null || !overrideReason.trim()}
            >
              Re-submit with justification
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => pickAssignee('')}>
              Pick another assignee
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      {!guard ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className={buttonClass.primary}
            onClick={propose}
            disabled={busy !== null || !assigneeId || !hoursValid || !deadline}
          >
            {busy === 'propose' ? <Spinner /> : null} Submit to Assignee →
          </button>
        </div>
      ) : null}
    </article>
  );
}
