import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarAdapter } from '@/lib/calendar/adapter';
import { computeCheckInRequestedAt, getCheckInStatus } from '@/lib/checkIn';
import { createSeedDatabase } from '@/lib/seed';
import { readDb, updateDb, writeDb } from '@/lib/store';
import { getInboxSection } from '@/lib/taskRoles';
import type { Task } from '@/lib/types';
import {
  configureProgressCheckIn,
  createDraftTask,
  deleteDraftTask,
  dismissProgressCheckInAlert,
  proposeTask,
  remindProgressCheckIn,
  rescheduleTask,
  respondToProposal,
  submitProgressCheckIn,
  updateDraftTask,
  WorkflowError,
} from '@/lib/workflow';

// Seed week: Mon 2026-11-23 (local). OAuth: alice → carol, due Wed 18:00, check-in Mon 09:30.
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();
const OAUTH = 'task-seed-oauth';

let dbPath: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-loop-checkin-test-'));
  dbPath = path.join(tempDir, 'db.json');
  await writeDb(createSeedDatabase(new Date('2026-11-23T10:00:00')), dbPath);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const okCalendar: CalendarAdapter = {
  listEvents: async () => [],
  syncTaskBlocks: async ({ task }) => ({ eventIds: [`evt-${task.id}`] }),
  removeTaskBlocks: async () => undefined,
};

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkflowError);
  expect(error).toMatchObject({ status, code });
}

async function oauth(): Promise<Task> {
  return (await readDb(dbPath)).tasks.find((t) => t.id === OAUTH)!;
}

async function declinedTask(): Promise<Task> {
  const draft = await createDraftTask({ actorId: 'alice', title: 'Docs sweep', estimatedHours: 2, dbPath });
  const { task } = await proposeTask({
    taskId: draft.id,
    actorId: 'alice',
    assigneeId: 'bob',
    deadline: local(27, 18),
    estimatedHours: 2,
    now: local(23, 10),
    dbPath,
  });
  return (
    await respondToProposal({
      taskId: task.id,
      actorId: 'bob',
      expectedVersion: task.currentProposal.version,
      action: 'decline',
      reason: 'On leave Friday.',
      now: local(23, 11),
      dbPath,
    })
  ).task;
}

describe('PM-only assignment', () => {
  it('rejects non-PM writes with 403 PM_ONLY and a different PM with NOT_ASSIGNER', async () => {
    const draft = await createDraftTask({ actorId: 'alice', title: 'Runbook', estimatedHours: 2, dbPath });
    const cases: Array<() => Promise<unknown>> = [
      () => createDraftTask({ actorId: 'carol', title: 'x', estimatedHours: 1, dbPath }),
      () => updateDraftTask({ taskId: draft.id, actorId: 'bob', title: 'x', dbPath }),
      () => deleteDraftTask({ taskId: draft.id, actorId: 'david', dbPath }),
      () =>
        proposeTask({
          taskId: draft.id,
          actorId: 'bob',
          assigneeId: 'carol',
          deadline: local(27, 18),
          estimatedHours: 2,
          dbPath,
        }),
      () => rescheduleTask({ taskId: OAUTH, actorId: 'carol', newDeadline: local(27, 18), dbPath }),
      () => configureProgressCheckIn({ taskId: OAUTH, actorId: 'carol', daysBeforeDeadline: 1, dbPath }),
    ];
    for (const run of cases) await expectError(run(), 403, 'PM_ONLY');

    await updateDb((db) => {
      db.members.find((m) => m.id === 'bob')!.role = 'pm';
    }, dbPath);
    await expectError(
      rescheduleTask({ taskId: OAUTH, actorId: 'bob', newDeadline: local(27, 18), dbPath }),
      403,
      'NOT_ASSIGNER',
    );
  });

  it('rejects checkInDaysBefore outside 0–2', async () => {
    await expectError(
      createDraftTask({
        actorId: 'alice',
        title: 'x',
        estimatedHours: 1,
        checkInDaysBefore: 3 as never,
        dbPath,
      }),
      400,
      'INVALID_INPUT',
    );
  });
});

describe('declined tasks return to the assigning PM', () => {
  it('surfaces in the PM action inbox, and deleting keeps rejection memory', async () => {
    const task = await declinedTask();
    expect(['alice', 'bob'].map((id) => getInboxSection(task, id))).toEqual(['action', undefined]);

    await expectError(deleteDraftTask({ taskId: task.id, actorId: 'bob', dbPath }), 403, 'PM_ONLY');
    await deleteDraftTask({ taskId: task.id, actorId: 'alice', now: local(23, 12), dbPath });

    const db = await readDb(dbPath);
    expect(db.tasks.some((t) => t.id === task.id)).toBe(false);
    expect(db.rejections.some((r) => r.taskId === task.id)).toBe(true);
    expect(db.auditLog.at(-1)).toMatchObject({ action: 'task_deleted', actorId: 'alice', taskId: task.id });
  });
});

describe('computeCheckInRequestedAt', () => {
  it.each([
    ['09:00 N days before the deadline day', 2, local(20, 8), local(23, 9)],
    ['clamped to confirmation when that is later', 2, local(23, 11), local(23, 11)],
    ['same-day check-in', 0, local(22, 8), local(25, 9)],
  ] as const)('%s', (_label, days, confirmedAt, expected) => {
    expect(computeCheckInRequestedAt(local(25, 18), days, confirmedAt)).toBe(expected);
  });

  it('never lands after the deadline', () => {
    expect(computeCheckInRequestedAt(local(25, 8), 0, local(22, 8))).toBe(local(25, 8));
  });
});

describe('progress check-in lifecycle', () => {
  it('initializes on confirmation from the task setting and resets on reschedule', async () => {
    const draft = await createDraftTask({
      actorId: 'alice',
      title: 'Load test',
      estimatedHours: 2,
      checkInDaysBefore: 1,
      dbPath,
    });
    const { task } = await proposeTask({
      taskId: draft.id,
      actorId: 'alice',
      assigneeId: 'david',
      deadline: local(27, 18),
      estimatedHours: 2,
      now: local(23, 10),
      dbPath,
    });
    const confirmed = await respondToProposal({
      taskId: task.id,
      actorId: 'david',
      expectedVersion: task.currentProposal.version,
      action: 'accept',
      now: local(23, 11),
      calendar: okCalendar,
      dbPath,
    });
    expect(confirmed.task.progressCheckIn).toEqual({
      daysBeforeDeadline: 1,
      requestedAt: local(26, 9),
      reminders: [],
    });

    const rescheduled = await rescheduleTask({
      taskId: task.id,
      actorId: 'alice',
      newDeadline: local(30, 18),
      checkInDaysBefore: 2,
      now: local(23, 12),
      dbPath,
    });
    expect(rescheduled.task.progressCheckIn).toBeUndefined();
    expect(rescheduled.task.checkInDaysBefore).toBe(2);
  });

  it('asks the assignee, alerts the PM after 12h, and follows remind / skip / submit', async () => {
    const at = (iso: string) => async () => {
      const task = await oauth();
      return {
        state: getCheckInStatus(task, iso).state,
        carol: getInboxSection(task, 'carol', iso),
        alice: getInboxSection(task, 'alice', iso),
      };
    };

    expect(await at(local(23, 9))()).toEqual({ state: 'scheduled', carol: 'confirmed', alice: 'confirmed' });
    expect(await at(local(23, 21))()).toEqual({ state: 'awaiting_response', carol: 'action', alice: 'confirmed' });
    expect(await at(local(23, 21, 30))()).toEqual({ state: 'overdue', carol: 'action', alice: 'action' });

    await expectError(
      remindProgressCheckIn({ taskId: OAUTH, actorId: 'carol', dbPath }),
      403,
      'PM_ONLY',
    );
    await dismissProgressCheckInAlert({ taskId: OAUTH, actorId: 'alice', now: local(23, 22), dbPath });
    expect(await at(local(24, 8))()).toEqual({ state: 'overdue_dismissed', carol: 'action', alice: 'confirmed' });

    await remindProgressCheckIn({ taskId: OAUTH, actorId: 'alice', note: 'Need it for standup', now: local(24, 8), dbPath });
    expect((await oauth()).progressCheckIn).toMatchObject({
      reminders: [{ sentBy: 'alice', sentAt: local(24, 8), note: 'Need it for standup' }],
    });
    expect((await oauth()).progressCheckIn?.dismissedAlertAt).toBeUndefined();
    expect(await at(local(24, 19))()).toEqual({ state: 'awaiting_response', carol: 'action', alice: 'confirmed' });
    expect(await at(local(24, 20))()).toEqual({ state: 'overdue', carol: 'action', alice: 'action' });

    for (const message of ['', 'line one\nline two', 'x'.repeat(241)]) {
      await expectError(
        submitProgressCheckIn({ taskId: OAUTH, actorId: 'carol', message, dbPath }),
        400,
        'INVALID_INPUT',
      );
    }
    await expectError(
      submitProgressCheckIn({ taskId: OAUTH, actorId: 'alice', message: 'Done.', dbPath }),
      403,
      'NOT_ASSIGNEE',
    );
    await submitProgressCheckIn({
      taskId: OAUTH,
      actorId: 'carol',
      message: '  Refresh flow done, writing tests.  ',
      now: local(24, 21),
      dbPath,
    });
    expect((await oauth()).progressCheckIn?.response).toEqual({
      message: 'Refresh flow done, writing tests.',
      submittedBy: 'carol',
      submittedAt: local(24, 21),
    });
    expect(await at(local(25, 12))()).toEqual({ state: 'submitted', carol: 'confirmed', alice: 'confirmed' });
    await expectError(
      remindProgressCheckIn({ taskId: OAUTH, actorId: 'alice', dbPath }),
      409,
      'CHECK_IN_SUBMITTED',
    );

    const actions = (await readDb(dbPath)).auditLog.filter((e) => e.taskId === OAUTH).map((e) => e.action);
    expect(actions.slice(-3)).toEqual([
      'progress_checkin_dismissed',
      'progress_checkin_reminded',
      'progress_checkin_submitted',
    ]);
  });

  it('lets the assigning PM change or turn off the check-in on a confirmed task', async () => {
    await configureProgressCheckIn({ taskId: OAUTH, actorId: 'alice', daysBeforeDeadline: 0, now: local(23, 12), dbPath });
    expect((await oauth()).progressCheckIn).toEqual({
      daysBeforeDeadline: 0,
      requestedAt: local(25, 9),
      reminders: [],
    });
    await configureProgressCheckIn({ taskId: OAUTH, actorId: 'alice', daysBeforeDeadline: null, dbPath });
    const task = await oauth();
    expect(task.checkInDaysBefore).toBeUndefined();
    expect(getCheckInStatus(task).state).toBe('none');
  });
});
