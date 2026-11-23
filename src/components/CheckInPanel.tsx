'use client';

import { useState } from 'react';
import {
  CHECK_IN_DAY_OPTIONS,
  CHECK_IN_MAX_LENGTH,
  checkInDaysLabel,
  getCheckInStatus,
  parseCheckInSelect,
} from '@/lib/checkIn';
import { getAssignerId } from '@/lib/taskRoles';
import type { Task, TeamMember } from '@/lib/types';
import { apiFetch, buttonClass, errorText, formatDateTime, inputClass, memberName, Spinner } from './ui';

type CheckInAction = 'configure' | 'submit' | 'remind' | 'dismiss';

export function CheckInPanel({
  task,
  members,
  currentUserId,
  isAssigningPm,
  onDone,
}: {
  task: Task;
  members: TeamMember[];
  currentUserId: string;
  isAssigningPm: boolean;
  onDone: (message: string, tone?: 'success' | 'error') => Promise<void>;
}) {
  const checkIn = task.progressCheckIn;
  const status = getCheckInStatus(task);
  const assigneeName = memberName(members, task.currentProposal.assigneeId);
  const isAssignee = task.currentProposal.assigneeId === currentUserId;
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<CheckInAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!checkIn && !isAssigningPm) return null;

  async function post(action: CheckInAction, body: Record<string, unknown>, done: string) {
    setBusy(action);
    setError(null);
    const result = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/check-in`, {
      method: 'POST',
      body: { actorId: currentUserId, action, ...body },
    });
    setBusy(null);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    await onDone(done);
  }

  const unanswered = checkIn !== undefined && !checkIn.response;
  const started = status.state !== 'none' && status.state !== 'scheduled';
  const elapsed = `${Math.floor(status.elapsedHours)}h`;
  const singleLine = message.trim() !== '' && message.trim().length <= CHECK_IN_MAX_LENGTH;

  return (
    <section className="mt-3 space-y-2 rounded-md border border-cyan-200 bg-cyan-50/40 p-3 text-xs" aria-label="Progress check-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-800">Progress Check-in</p>
        {isAssigningPm ? (
          <select
            aria-label="Progress check-in schedule"
            className={`${inputClass} w-auto py-1 text-xs`}
            value={task.checkInDaysBefore?.toString() ?? ''}
            disabled={busy !== null}
            onChange={(e) => {
              const days = parseCheckInSelect(e.target.value);
              void post(
                'configure',
                { daysBeforeDeadline: days },
                days === null ? 'Progress check-in turned off.' : `Progress check-in set: ${checkInDaysLabel(days)}.`,
              );
            }}
          >
            <option value="">Off</option>
            {CHECK_IN_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {checkInDaysLabel(days)}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {!checkIn ? <p className="text-slate-500">No check-in. Pick a day to ask {assigneeName} for a one-sentence update.</p> : null}

      {checkIn?.response ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-emerald-900">
          <p className="text-sm">“{checkIn.response.message}”</p>
          <p className="mt-1 text-emerald-700">
            — {memberName(members, checkIn.response.submittedBy)}, {formatDateTime(checkIn.response.submittedAt)}
          </p>
        </div>
      ) : null}

      {checkIn && unanswered && status.state === 'scheduled' ? (
        <p className="text-slate-600">
          {isAssignee ? 'Your PM will ask' : `${assigneeName} will be asked`} for a one-sentence progress update on{' '}
          <strong>{formatDateTime(checkIn.requestedAt)}</strong>.
        </p>
      ) : null}

      {isAssignee && status.needsAssigneeAction ? (
        <div className="space-y-2 rounded-md border border-indigo-300 bg-indigo-50 p-2 text-indigo-950">
          <p className="font-semibold">
            {memberName(members, getAssignerId(task))} asks for a one-sentence progress update.
          </p>
          {status.lastReminder ? (
            <p className="rounded bg-orange-100 px-2 py-1 font-semibold text-orange-900">
              🔔 Follow-up reminder ×{checkIn!.reminders.length} — {formatDateTime(status.lastReminder.sentAt)}
              {status.lastReminder.note ? `: “${status.lastReminder.note}”` : ''}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} min-w-0 flex-1`}
              value={message}
              maxLength={CHECK_IN_MAX_LENGTH}
              placeholder="e.g. Refresh flow works end-to-end; writing tests today."
              onChange={(e) => setMessage(e.target.value.replace(/[\r\n]+/g, ' '))}
            />
            <button
              type="button"
              className={buttonClass.primary}
              disabled={busy !== null || !singleLine}
              onClick={() => post('submit', { message: message.trim() }, `Progress update sent for "${task.title}".`)}
            >
              {busy === 'submit' ? <Spinner /> : null} Submit 1-Sentence Update
            </button>
          </div>
        </div>
      ) : null}

      {isAssigningPm && status.needsPmAlert ? (
        <div className="space-y-2 rounded-md border-2 border-amber-400 bg-amber-50 p-2 text-amber-950" role="alert">
          <p className="font-semibold">
            ⚠ {assigneeName} hasn&apos;t reported progress for {elapsed} (&gt;12h). Send another reminder?
          </p>
          <input
            className={inputClass}
            value={note}
            placeholder="Optional note (e.g. Need it for tomorrow's standup)"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={busy !== null}
              onClick={() => post('remind', { note }, `Reminder sent to ${assigneeName}.`)}
            >
              {busy === 'remind' ? <Spinner /> : '🔔'} Send Reminder Again
            </button>
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={busy !== null}
              onClick={() => post('dismiss', {}, `No reminder sent for "${task.title}".`)}
            >
              {busy === 'dismiss' ? <Spinner /> : null} Skip / Don&apos;t Remind
            </button>
          </div>
        </div>
      ) : null}

      {isAssigningPm && checkIn && unanswered && !status.needsPmAlert ? (
        <div className="space-y-1 text-slate-700">
          <p>
            Requested {formatDateTime(checkIn.requestedAt)}
            {started ? ` · no reply for ${elapsed}` : ''}
            {status.state === 'overdue_dismissed' ? ' · you skipped the reminder' : ''}
          </p>
          {checkIn.reminders.length > 0 ? (
            <ul className="list-disc pl-4 text-slate-600">
              {checkIn.reminders.map((r) => (
                <li key={r.id}>
                  Reminder {formatDateTime(r.sentAt)}
                  {r.note ? ` — “${r.note}”` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {started ? (
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={busy !== null}
              onClick={() => post('remind', {}, `Reminder sent to ${assigneeName}.`)}
            >
              {busy === 'remind' ? <Spinner /> : '🔔'} Send Reminder
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-red-700">{error}</p> : null}
    </section>
  );
}
