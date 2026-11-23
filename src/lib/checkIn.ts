import type { CheckInDaysBefore, ProgressCheckInReminder, Task } from './types';

export const CHECK_IN_OVERDUE_MS = 12 * 60 * 60 * 1000;
export const CHECK_IN_MAX_LENGTH = 240;
export const CHECK_IN_DAY_OPTIONS: readonly CheckInDaysBefore[] = [0, 1, 2];

export function isCheckInDaysBefore(value: unknown): value is CheckInDaysBefore {
  return value === 0 || value === 1 || value === 2;
}

export function checkInDaysLabel(days: CheckInDaysBefore): string {
  if (days === 0) return 'On deadline day (0 days before)';
  return `${days} day${days === 1 ? '' : 's'} before deadline`;
}

export function parseCheckInSelect(value: string): CheckInDaysBefore | null {
  const days = Number(value);
  return value !== '' && isCheckInDaysBefore(days) ? days : null;
}

/** 09:00 local on (deadline day − N), clamped to [confirmedAt, deadline]. */
export function computeCheckInRequestedAt(
  deadlineIso: string,
  daysBeforeDeadline: CheckInDaysBefore,
  confirmedAtIso: string,
): string {
  const deadlineMs = Date.parse(deadlineIso);
  const target = new Date(deadlineMs);
  target.setDate(target.getDate() - daysBeforeDeadline);
  target.setHours(9, 0, 0, 0);
  const clamped = Math.min(Math.max(target.getTime(), Date.parse(confirmedAtIso)), deadlineMs);
  return new Date(clamped).toISOString();
}

export type CheckInState =
  | 'none'
  | 'scheduled'
  | 'awaiting_response'
  | 'overdue'
  | 'overdue_dismissed'
  | 'submitted';

export interface CheckInStatus {
  state: CheckInState;
  lastPromptedAt?: string;
  lastReminder?: ProgressCheckInReminder;
  elapsedHours: number;
  needsAssigneeAction: boolean;
  needsPmAlert: boolean;
}

export function getCheckInStatus(task: Task, nowIso: string = new Date().toISOString()): CheckInStatus {
  const checkIn = task.progressCheckIn;
  if (!checkIn) {
    return { state: 'none', elapsedHours: 0, needsAssigneeAction: false, needsPmAlert: false };
  }
  const nowMs = Date.parse(nowIso);
  const lastReminder = checkIn.reminders.at(-1);
  const lastPromptedAt = lastReminder?.sentAt ?? checkIn.requestedAt;
  const elapsedMs = nowMs - Date.parse(lastPromptedAt);
  const started = nowMs >= Date.parse(checkIn.requestedAt);
  const confirmed = task.status === 'confirmed';

  let state: CheckInState;
  if (checkIn.response) state = 'submitted';
  else if (!started) state = 'scheduled';
  else if (elapsedMs >= CHECK_IN_OVERDUE_MS) {
    const dismissed =
      checkIn.dismissedAlertAt !== undefined &&
      Date.parse(checkIn.dismissedAlertAt) >= Date.parse(lastPromptedAt);
    state = dismissed ? 'overdue_dismissed' : 'overdue';
  } else state = 'awaiting_response';

  return {
    state,
    lastPromptedAt,
    lastReminder,
    elapsedHours: Math.max(0, elapsedMs / 3_600_000),
    needsAssigneeAction: confirmed && !checkIn.response && started,
    needsPmAlert: confirmed && state === 'overdue',
  };
}
