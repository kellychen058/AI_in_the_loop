import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarAdapter } from '@/lib/calendar/adapter';
import { createSeedDatabase } from '@/lib/seed';
import { readDb, writeDb } from '@/lib/store';
import type { AppDatabase, ProposedBlock, RejectionRecord, Task } from '@/lib/types';
import {
  checkRejectedReproposal,
  createDraftTask,
  deleteDraftTask,
  proposeTask,
  rescheduleTask,
  respondToProposal,
  updateDraftTask,
  WorkflowError,
} from '@/lib/workflow';

const NOW = '2026-11-23T01:00:00.000Z';
const FRIDAY = '2026-11-27T10:00:00.000Z';
const THURSDAY = '2026-11-26T10:00:00.000Z';

let dbPath: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-loop-workflow-test-'));
  dbPath = path.join(tempDir, 'db.json');
  await writeDb(createSeedDatabase(new Date('2026-11-23T10:00:00')), dbPath);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function fakeCalendar(options: { fail?: boolean } = {}) {
  const calls: Array<{ task: Task; blocks: ProposedBlock[] }> = [];
  const adapter: CalendarAdapter = {
    listEvents: async () => [],
    syncTaskBlocks: async (params) => {
      calls.push(params);
      if (options.fail) throw new Error('Simulated calendar provider outage (503).');
      return { eventIds: [`evt-${params.task.id}-v${params.task.currentProposal.version}`] };
    },
    removeTaskBlocks: async () => undefined,
  };
  return { adapter, calls };
}

async function expectWorkflowError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkflowError);
  expect(error).toMatchObject({ status, code });
  return error as WorkflowError;
}

async function proposedTask(overrides: { estimatedHours?: number; deadline?: string } = {}) {
  const draft = await createDraftTask({
    actorId: 'alice',
    title: 'Payment Webhook Retry Queue',
    estimatedHours: 6,
    now: NOW,
    dbPath,
  });
  const { task } = await proposeTask({
    taskId: draft.id,
    actorId: 'alice',
    assigneeId: 'david',
    deadline: overrides.deadline ?? FRIDAY,
    estimatedHours: overrides.estimatedHours ?? 6,
    now: NOW,
    dbPath,
  });
  return task;
}

async function getTask(id: string): Promise<Task> {
  const db = await readDb(dbPath);
  return db.tasks.find((t) => t.id === id)!;
}

function actions(db: AppDatabase, taskId: string) {
  return db.auditLog.filter((e) => e.taskId === taskId).map((e) => e.action);
}

describe('manual draft CRUD', () => {
  it('creates, edits and deletes drafts, and refuses to edit or delete once proposed', async () => {
    const draft = await createDraftTask({
      actorId: 'alice',
      title: '  Write rollout runbook ',
      estimatedHours: 3,
      now: NOW,
      dbPath,
    });
    expect(draft).toMatchObject({
      status: 'draft',
      title: 'Write rollout runbook',
      aiGenerated: false,
      currentProposal: { version: 0, estimatedHours: 3, proposedBy: 'alice' },
    });

    const edited = await updateDraftTask({
      taskId: draft.id,
      title: 'Write rollout runbook v2',
      dependsOnTaskIds: ['task-seed-oauth'],
      dbPath,
    });
    expect(edited.title).toBe('Write rollout runbook v2');
    expect(edited.dependsOnTaskIds).toEqual(['task-seed-oauth']);

    await expectWorkflowError(
      createDraftTask({ actorId: 'alice', title: ' ', estimatedHours: 3, dbPath }),
      400,
      'INVALID_INPUT',
    );

    const proposed = await proposedTask();
    await expectWorkflowError(
      updateDraftTask({ taskId: proposed.id, title: 'nope', dbPath }),
      409,
      'INVALID_STATE',
    );
    await expectWorkflowError(deleteDraftTask({ taskId: proposed.id, dbPath }), 409, 'INVALID_STATE');

    await deleteDraftTask({ taskId: draft.id, dbPath });
    const db = await readDb(dbPath);
    expect(db.tasks.some((t) => t.id === draft.id)).toBe(false);
    expect(actions(db, draft.id)).toEqual(['task_drafted']);
  });
});

describe('two-party confirmation state machine', () => {
  it('proposing bumps the version to pending_assignee without touching the calendar', async () => {
    const before = await readDb(dbPath);
    const task = await proposedTask();

    expect(task.status).toBe('pending_assignee');
    expect(task.currentProposal).toMatchObject({ version: 1, assigneeId: 'david', proposedBy: 'alice' });
    expect(task.proposalHistory).toHaveLength(1);

    const db = await readDb(dbPath);
    expect(db.calendarEvents).toEqual(before.calendarEvents);
    expect(actions(db, task.id)).toEqual(['task_drafted', 'task_proposed']);
  });

  it('assignee accepting the same version syncs the calendar exactly once and confirms', async () => {
    const calendar = fakeCalendar();
    const proposed = await proposedTask();

    const { task } = await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 1,
      action: 'accept',
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });

    expect(calendar.calls).toHaveLength(1);
    expect(calendar.calls[0].task.currentProposal.version).toBe(1);
    expect(calendar.calls[0].blocks).toEqual(proposed.currentProposal.proposedBlocks);
    expect(task).toMatchObject({
      status: 'confirmed',
      confirmedVersion: 1,
      confirmedByAssignerAt: proposed.currentProposal.createdAt,
      confirmedByAssigneeAt: NOW,
      calendarEventIds: [`evt-${proposed.id}-v1`],
    });
    expect(actions(await readDb(dbPath), task.id)).toEqual([
      'task_drafted',
      'task_proposed',
      'task_confirmed',
      'calendar_synced',
    ]);
  });

  it('rejects a stale expectedVersion with 409 and never syncs', async () => {
    const calendar = fakeCalendar();
    const proposed = await proposedTask();

    const error = await expectWorkflowError(
      respondToProposal({
        taskId: proposed.id,
        actorId: 'david',
        expectedVersion: 0,
        action: 'accept',
        calendar: calendar.adapter,
        dbPath,
      }),
      409,
      'VERSION_CONFLICT',
    );
    expect(error.message).toBe('Proposal version changed; please refresh before confirming.');
    expect(calendar.calls).toHaveLength(0);
    expect((await getTask(proposed.id)).status).toBe('pending_assignee');
  });

  it('only the party whose turn it is may respond', async () => {
    const proposed = await proposedTask();
    for (const actorId of ['alice', 'carol']) {
      await expectWorkflowError(
        respondToProposal({
          taskId: proposed.id,
          actorId,
          expectedVersion: 1,
          action: 'accept',
          calendar: fakeCalendar().adapter,
          dbPath,
        }),
        403,
        'NOT_YOUR_TURN',
      );
    }
  });

  it('counter-proposals alternate turns and sync only when the other party accepts that version', async () => {
    const calendar = fakeCalendar();
    const proposed = await proposedTask();

    const countered = await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 1,
      action: 'counter',
      newDeadline: FRIDAY,
      newEstimatedHours: 4,
      note: 'Can do 4h if scope shrinks.',
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });
    expect(countered.task).toMatchObject({
      status: 'counter_proposed',
      currentProposal: { version: 2, proposedBy: 'david', assigneeId: 'david', estimatedHours: 4 },
    });
    expect(countered.workload).toBeDefined();

    await expectWorkflowError(
      respondToProposal({
        taskId: proposed.id,
        actorId: 'david',
        expectedVersion: 2,
        action: 'accept',
        calendar: calendar.adapter,
        dbPath,
      }),
      403,
      'NOT_YOUR_TURN',
    );

    const back = await respondToProposal({
      taskId: proposed.id,
      actorId: 'alice',
      expectedVersion: 2,
      action: 'counter',
      newDeadline: THURSDAY,
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });
    expect(back.task).toMatchObject({
      status: 'pending_assignee',
      currentProposal: { version: 3, proposedBy: 'alice', estimatedHours: 4, deadline: THURSDAY },
    });

    const reCounter = await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 3,
      action: 'counter',
      newDeadline: FRIDAY,
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });
    expect(reCounter.task.status).toBe('counter_proposed');
    expect(calendar.calls).toHaveLength(0);

    const { task } = await respondToProposal({
      taskId: proposed.id,
      actorId: 'alice',
      expectedVersion: 4,
      action: 'accept',
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });
    expect(calendar.calls).toHaveLength(1);
    expect(calendar.calls[0].task.currentProposal.version).toBe(4);
    expect(task).toMatchObject({
      status: 'confirmed',
      confirmedVersion: 4,
      confirmedByAssignerAt: NOW,
      confirmedByAssigneeAt: reCounter.task.currentProposal.createdAt,
    });
  });

  it('concurrent accepts of the same version sync once; the loser gets 409', async () => {
    const calendar = fakeCalendar();
    const proposed = await proposedTask();
    const accept = () =>
      respondToProposal({
        taskId: proposed.id,
        actorId: 'david',
        expectedVersion: 1,
        action: 'accept',
        calendar: calendar.adapter,
        dbPath,
      });

    const results = await Promise.allSettled([accept(), accept()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(calendar.calls).toHaveLength(1);
  });

  it('calendar sync failure leaves the task confirmed at that version in sync_failed', async () => {
    const proposed = await proposedTask();
    const { task } = await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 1,
      action: 'accept',
      calendar: fakeCalendar({ fail: true }).adapter,
      dbPath,
    });

    expect(task).toMatchObject({
      status: 'sync_failed',
      confirmedVersion: 1,
      syncError: 'Simulated calendar provider outage (503).',
      calendarEventIds: [],
    });
    expect(actions(await readDb(dbPath), task.id).slice(-2)).toEqual([
      'task_confirmed',
      'calendar_sync_failed',
    ]);
  });
});

describe('rejection memory & re-proposal guard', () => {
  it('declining requires a reason and records a RejectionRecord with a workload snapshot', async () => {
    const calendar = fakeCalendar();
    const proposed = await proposedTask();

    await expectWorkflowError(
      respondToProposal({
        taskId: proposed.id,
        actorId: 'david',
        expectedVersion: 1,
        action: 'decline',
        reason: '   ',
        dbPath,
      }),
      400,
      'INVALID_INPUT',
    );

    const { task, workload } = await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 1,
      action: 'decline',
      reason: 'Release week is already full.',
      now: NOW,
      calendar: calendar.adapter,
      dbPath,
    });
    expect(task.status).toBe('rejected');
    expect(calendar.calls).toHaveLength(0);

    const db = await readDb(dbPath);
    const record = db.rejections.find((r) => r.taskId === proposed.id)!;
    expect(record).toMatchObject({
      taskTitle: 'Payment Webhook Retry Queue',
      rejectedAssigneeId: 'david',
      rejectedDeadline: FRIDAY,
      estimatedHours: 6,
      reason: 'Release week is already full.',
      rejectedBy: 'david',
      workloadSnapshot: workload,
    });
    expect(record.workloadSnapshot.memberId).toBe('david');
    expect(db.auditLog.at(-1)).toMatchObject({
      action: 'task_rejected',
      metadata: { rejectionId: record.id },
    });
  });

  it('re-proposing under unchanged conditions returns 409 PREVIOUSLY_REJECTED unless justified', async () => {
    const proposed = await proposedTask();
    await respondToProposal({
      taskId: proposed.id,
      actorId: 'david',
      expectedVersion: 1,
      action: 'decline',
      reason: 'No capacity.',
      now: NOW,
      dbPath,
    });

    const repropose = (overrideRejectedReason?: string) =>
      proposeTask({
        taskId: proposed.id,
        actorId: 'alice',
        assigneeId: 'david',
        deadline: FRIDAY,
        estimatedHours: 6,
        overrideRejectedReason,
        now: NOW,
        dbPath,
      });

    const blocked = await expectWorkflowError(repropose('  '), 409, 'PREVIOUSLY_REJECTED');
    expect(blocked.details?.priorRejection).toMatchObject({ taskId: proposed.id, reason: 'No capacity.' });
    expect((await getTask(proposed.id)).status).toBe('rejected');

    const { task } = await repropose('Carol took over the webhook tests, freeing David.');
    expect(task).toMatchObject({
      status: 'pending_assignee',
      currentProposal: {
        version: 2,
        overrideRejectedReason: 'Carol took over the webhook tests, freeing David.',
      },
    });
    const db = await readDb(dbPath);
    const override = db.auditLog.find(
      (e) => e.taskId === proposed.id && e.action === 'rejected_option_overridden',
    );
    expect(override?.metadata).toMatchObject({
      priorRejectionId: db.rejections.at(-1)!.id,
      overrideRejectedReason: 'Carol took over the webhook tests, freeing David.',
    });
  });

  it('only blocks the same task/assignee when no condition materially improved', () => {
    const db = createSeedDatabase(new Date('2026-11-23T10:00:00'));
    const seeded = db.rejections[0] as RejectionRecord;
    const base = {
      db,
      taskId: 'task-new',
      taskTitle: '  payment   API integration ',
      assigneeId: 'carol',
      deadline: seeded.rejectedDeadline,
      estimatedHours: 10,
      availableHours: 6,
    };
    const later = new Date(Date.parse(seeded.rejectedDeadline) + 86_400_000).toISOString();

    const cases: Array<[string, Partial<typeof base> & { overrideRejectedReason?: string }, boolean]> = [
      ['unchanged (title match)', {}, true],
      ['tighter conditions', { estimatedHours: 12, availableHours: 4 }, true],
      ['later deadline', { deadline: later }, false],
      ['more available hours', { availableHours: 8 }, false],
      ['smaller estimate', { estimatedHours: 6 }, false],
      ['different assignee', { assigneeId: 'david' }, false],
      ['different task', { taskTitle: 'Something else' }, false],
      ['override given', { overrideRejectedReason: 'Deadline is now negotiable.' }, false],
    ];
    for (const [label, overrides, blocked] of cases) {
      const result = checkRejectedReproposal({ ...base, ...overrides });
      expect(result.blocked, label).toBe(blocked);
    }
    expect(
      checkRejectedReproposal({ ...base, overrideRejectedReason: 'Deadline is now negotiable.' }),
    ).toMatchObject({ blocked: false, overridden: true, priorRejection: { id: seeded.id } });
  });
});

describe('reschedule flow', () => {
  it('moves a confirmed task back to pending_assignee and flags dependents without touching the calendar', async () => {
    const calendar = fakeCalendar();
    const before = await readDb(dbPath);
    const oauth = before.tasks.find((t) => t.id === 'task-seed-oauth')!;
    const checkoutUi = before.tasks.find((t) => t.id === 'task-seed-checkout-ui')!;
    const newDeadline = new Date(
      Date.parse(checkoutUi.currentProposal.deadline) + 86_400_000,
    ).toISOString();

    await expectWorkflowError(
      rescheduleTask({ taskId: oauth.id, actorId: 'carol', newDeadline, dbPath }),
      403,
      'NOT_ASSIGNER',
    );

    const result = await rescheduleTask({
      taskId: oauth.id,
      actorId: 'alice',
      newDeadline,
      note: 'Security review slipped.',
      now: NOW,
      dbPath,
    });
    expect(result.task).toMatchObject({
      status: 'pending_assignee',
      confirmedVersion: 1,
      calendarEventIds: oauth.calendarEventIds,
      currentProposal: { version: 2, assigneeId: 'carol', proposedBy: 'alice', deadline: newDeadline },
    });
    expect(result.affectedDependents.map((d) => d.taskId)).toEqual(['task-seed-checkout-ui']);

    const after = await readDb(dbPath);
    expect(after.calendarEvents).toEqual(before.calendarEvents);
    expect(after.auditLog.at(-1)).toMatchObject({
      action: 'task_rescheduled',
      metadata: { fromVersion: 1, version: 2, affectedDependents: result.affectedDependents },
    });

    await expectWorkflowError(
      rescheduleTask({ taskId: oauth.id, actorId: 'alice', newDeadline, dbPath }),
      409,
      'INVALID_STATE',
    );

    const { task } = await respondToProposal({
      taskId: oauth.id,
      actorId: 'carol',
      expectedVersion: 2,
      action: 'accept',
      calendar: calendar.adapter,
      dbPath,
    });
    expect(calendar.calls).toHaveLength(1);
    expect(calendar.calls[0].task.currentProposal.version).toBe(2);
    expect(task).toMatchObject({ status: 'confirmed', confirmedVersion: 2 });
  });
});
