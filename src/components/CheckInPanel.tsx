'use client';

import { useState } from 'react';
import {
  CHECK_IN_DAY_OPTIONS,
  CHECK_IN_MAX_LENGTH,
  checkInDaysLabel,
  getCheckInStatus,
} from '@/lib/checkIn';
import { getAssignerId } from '@/lib/taskRoles';
import type { CheckInDaysBefore, Task, TeamMember } from '@/lib/types';
import { BellIcon } from './Icons';
import { apiFetch, buttonClass, errorText, formatDateTime, inputClass, memberName, Spinner } from './ui';

type CheckInAction = 'configure' | 'submit' | 'remind' | 'dismiss';

const QUICK_PREFIXES = ['On track: ', 'At risk: ', 'Blocked: '] as const;

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
    if (action === 'submit') setMessage('');
    if (action === 'remind') setNote('');
    await onDone(done);
  }

  const unanswered = checkIn !== undefined && !checkIn.response;
  const started = status.state !== 'none' && status.state !== 'scheduled';
  const elapsed = `${Math.floor(status.elapsedHours)}h`;
  const trimmed = message.trim();
  const singleLine = trimmed !== '' && trimmed.length <= CHECK_IN_MAX_LENGTH;

  return (
    <section
      className="space-y-2.5 rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] p-3 text-xs"
      aria-label="Progress check-in"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#57534E]">
          Progress Check-in Pulse
        </p>
        {isAssigningPm ? (
          <div
            role="group"
            aria-label="Progress check-in schedule"
            className="inline-flex rounded-md border border-[#D1CCC2] bg-white p-0.5"
          >
            {([null, ...CHECK_IN_DAY_OPTIONS] as (CheckInDaysBefore | null)[]).map((days) => {
              const active = (task.checkInDaysBefore ?? null) === days;
              const label = days === null ? 'Off' : days === 0 ? 'Due day' : `${days}d before`;
              return (
                <button
                  key={days === null ? 'off' : days}
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void post(
                      'configure',
                      { daysBeforeDeadline: days },
                      days === null
                        ? 'Progress check-in turned off.'
                        : `Progress check-in set: ${checkInDaysLabel(days)}.`,
                    )
                  }
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                    active ? 'bg-[#111827] text-white' : 'text-[#57534E] hover:text-[#111827]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {!checkIn ? (
        <p className="text-[#78716C]">
          No check-in scheduled. Pick a cadence to request a one-sentence progress update from{' '}
          {assigneeName}.
        </p>
      ) : null}

      {checkIn?.response ? (
        <div className="rounded-md border border-[#A7F3D0] bg-[#ECFDF5] p-2.5 text-[#064E3B]">
          <p className="text-xs font-medium text-[#111827]">“{checkIn.response.message}”</p>
          <p className="mt-1 font-mono text-[10px] text-[#047857] tabular-nums">
            — {memberName(members, checkIn.response.submittedBy)} ·{' '}
            {formatDateTime(checkIn.response.submittedAt)}
          </p>
        </div>
      ) : null}

      {checkIn && unanswered && status.state === 'scheduled' ? (
        <p className="text-[#57534E]">
          {isAssignee ? 'Your PM will ask' : `${assigneeName} will be asked`} for a one-sentence
          update on{' '}
          <strong className="font-mono text-[#111827] tabular-nums">
            {formatDateTime(checkIn.requestedAt)}
          </strong>
          .
        </p>
      ) : null}

      {isAssignee && status.needsAssigneeAction ? (
        <div className="space-y-2 rounded-md border border-[#C7D2FE] bg-[#EEF2FF] p-2.5 text-[#111827]">
          <p className="font-semibold">
            {memberName(members, getAssignerId(task))} requested a one-sentence progress update.
          </p>
          {status.lastReminder ? (
            <p className="inline-flex items-center gap-1.5 rounded border border-[#FDE68A] bg-[#FFFBEB] px-2 py-1 text-[11px] font-semibold text-[#B45309]">
              <BellIcon className="h-3 w-3" />
              Reminder #{checkIn!.reminders.length} · {formatDateTime(status.lastReminder.sentAt)}
              {status.lastReminder.note ? ` — “${status.lastReminder.note}”` : ''}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PREFIXES.map((prefix) => (
              <button
                key={prefix}
                type="button"
                onClick={() =>
                  setMessage((prev) =>
                    prev.startsWith(prefix) ? prev : `${prefix}${prev.replace(/^(On track|At risk|Blocked):\s*/, '')}`,
                  )
                }
                className="rounded-full border border-[#C7D2FE] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#4338CA] hover:bg-[#4338CA] hover:text-white"
              >
                {prefix.trim()}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputClass} min-w-[200px] flex-1`}
              value={message}
              maxLength={CHECK_IN_MAX_LENGTH}
              placeholder="e.g. On track: refresh flow works end-to-end; writing unit tests today."
              onChange={(e) => setMessage(e.target.value.replace(/[\r\n]+/g, ' '))}
            />
            <span className="font-mono text-[10px] text-[#57534E] tabular-nums">
              {message.length}/{CHECK_IN_MAX_LENGTH}
            </span>
            <button
              type="button"
              className={buttonClass.primary}
              disabled={busy !== null || !singleLine}
              onClick={() =>
                post('submit', { message: trimmed }, `Progress update sent for "${task.title}".`)
              }
            >
              {busy === 'submit' ? <Spinner /> : null} Send Update
            </button>
          </div>
        </div>
      ) : null}

      {isAssigningPm && status.needsPmAlert ? (
        <div
          className="space-y-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] p-2.5 text-[#78350F]"
          role="alert"
        >
          <p className="font-semibold">
            {assigneeName} has not reported progress for {elapsed} (≥12h). Send another reminder?
          </p>
          <input
            className={inputClass}
            value={note}
            placeholder="Optional note (e.g. Need this before tomorrow's standup)"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass.primary}
              disabled={busy !== null}
              onClick={() => post('remind', { note }, `Reminder sent to ${assigneeName}.`)}
            >
              {busy === 'remind' ? <Spinner /> : <BellIcon className="h-3.5 w-3.5" />}
              Send Reminder
            </button>
            <button
              type="button"
              className={buttonClass.secondary}
              disabled={busy !== null}
              onClick={() =>
                post('dismiss', {}, `Alert dismissed for "${task.title}" until next manual reminder.`)
              }
            >
              {busy === 'dismiss' ? <Spinner /> : null} Dismiss Alert
            </button>
          </div>
        </div>
      ) : null}

      {isAssigningPm && checkIn && unanswered && !status.needsPmAlert ? (
        <div className="space-y-1.5 text-[#57534E]">
          <p>
            Requested <span className="font-mono tabular-nums">{formatDateTime(checkIn.requestedAt)}</span>
            {started ? ` · awaiting reply (${elapsed})` : ''}
            {status.state === 'overdue_dismissed' ? ' · alert dismissed until next reminder' : ''}
          </p>
          {checkIn.reminders.length > 0 ? (
            <ul className="list-disc pl-4 text-[11px] text-[#78716C]">
              {checkIn.reminders.map((r) => (
                <li key={r.id}>
                  Reminder <span className="font-mono tabular-nums">{formatDateTime(r.sentAt)}</span>
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
              {busy === 'remind' ? <Spinner /> : <BellIcon className="h-3.5 w-3.5" />}
              Send Reminder
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="font-medium text-[#BE123C]">{error}</p> : null}
    </section>
  );
}
