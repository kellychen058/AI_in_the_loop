import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyTaskForDesk, countDeskActionItems, groupDeskTasks } from '@/lib/deskQueue';
import { checkRejectedReproposal, computeUnlockLevers } from '@/lib/rejectionGuard';
import { createSeedDatabase } from '@/lib/seed';
import { writeDb } from '@/lib/store';
import {
  createDraftTask,
  deleteDraftTask,
  proposeTask,
  rescheduleTask,
  respondToProposal,
  updateDraftTask,
  WorkflowError,
} from '@/lib/workflow';

const tempDirs: string[] = [];

function makeTempDb(refDate = new Date('2026-11-23T09:00:00')) {
  const dir = mkdtempSync(join(tmpdir(), 'living-handshake-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'db.json');
  const db = createSeedDatabase(refDate);
  return { dbPath, db, refDate };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('rejectionGuard & computeUnlockLevers', () => {
  it('blocks on equal hours & equal deadline and suggests honest fit <= availableHours', () => {
    const db = createSeedDatabase(new Date('2026-11-23T09:00:00'));
    const rej = db.rejections[0]; // Carol, Payment API Integration, 10h, Fri 18:00, 6h available

    const levers = computeUnlockLevers({
      rejections: db.rejections,
      taskId: 'task-new-payment',
      taskTitle: '  payment api integration  ',
      assigneeId: 'carol',
      deadline: rej.rejectedDeadline,
      estimatedHours: 10,
      availableHours: 6,
    });

    expect(levers.isBlocked).toBe(true);
    expect(levers.strictMaxHours).toBe(10);
    expect(levers.suggestedFitHours).toBe(6);
    expect(levers.suggestedNextDeadlineIso).toBeDefined();
    expect(Date.parse(levers.suggestedNextDeadlineIso!)).toBeGreaterThan(
      Date.parse(rej.rejectedDeadline),
    );
  });

  it('clears guard strictly below rejected hours or strictly after rejected deadline', () => {
    const db = createSeedDatabase(new Date('2026-11-23T09:00:00'));
    const rej = db.rejections[0];

    const byHours = checkRejectedReproposal({
      db,
      taskId: 'task-new-payment',
      taskTitle: 'Payment API Integration',
      assigneeId: 'carol',
      deadline: rej.rejectedDeadline,
      estimatedHours: 6,
      availableHours: 6,
    });
    expect(byHours.blocked).toBe(false);

    const later = new Date(Date.parse(rej.rejectedDeadline) + 24 * 60 * 60 * 1000).toISOString();
    const byDeadline = checkRejectedReproposal({
      db,
      taskId: 'task-new-payment',
      taskTitle: 'Payment API Integration',
      assigneeId: 'carol',
      deadline: later,
      estimatedHours: 10,
      availableHours: 6,
    });
    expect(byDeadline.blocked).toBe(false);
  });
});

describe('deskQueue role × status classification', () => {
  it('routes PM drafts to Needs You while hiding drafts from ICs', () => {
    const db = createSeedDatabase(new Date('2026-11-23T09:00:00'));
    const alice = db.members.find((m) => m.id === 'alice')!;
    const carol = db.members.find((m) => m.id === 'carol')!;
    const draft = { ...db.tasks[0], id: 'task-draft', status: 'draft' as const };

    expect(classifyTaskForDesk(draft, alice)?.bucket).toBe('action');
    expect(classifyTaskForDesk(draft, carol)).toBeNull();
  });

  it('sorts sync_failed before overdue check-ins and drafts, and keeps live-booked declined replacements visible to IC', () => {
    const db = createSeedDatabase(new Date('2026-11-23T09:00:00'));
    const alice = db.members.find((m) => m.id === 'alice')!;
    const carol = db.members.find((m) => m.id === 'carol')!;

    const syncFailed = { ...db.tasks[1], id: 't-sync', status: 'sync_failed' as const };
    const declinedLive = {
      ...db.tasks[0],
      id: 't-declined-live',
      status: 'rejected' as const,
      calendarEventIds: ['evt-wb-carol-1'],
    };

    const groupedAlice = groupDeskTasks([declinedLive, syncFailed], alice);
    expect(groupedAlice.action.map((x) => x.task.id)).toEqual(['t-sync', 't-declined-live']);
    expect(countDeskActionItems([declinedLive, syncFailed], alice)).toBe(2);

    const carolClass = classifyTaskForDesk(declinedLive, carol);
    expect(carolClass?.bucket).toBe('scheduled');
  });
});

describe('workflow hardening (stale draft, live-booking delete guard, dependentTaskIds)', () => {
  it('rejects stale draft updates with 409 STALE_DRAFT when expectedUpdatedAt mismatches', async () => {
    const { dbPath, db } = makeTempDb();
    await writeDb(db, dbPath);

    const draft = await createDraftTask({
      actorId: 'alice',
      title: 'Initial Draft',
      estimatedHours: 3,
      now: '2026-11-23T10:00:00.000Z',
      dbPath,
    });

    await updateDraftTask({
      taskId: draft.id,
      actorId: 'alice',
      expectedUpdatedAt: draft.updatedAt,
      title: 'Updated from Tab 1',
      now: '2026-11-23T10:01:00.000Z',
      dbPath,
    });

    await expect(
      updateDraftTask({
        taskId: draft.id,
        actorId: 'alice',
        expectedUpdatedAt: draft.updatedAt,
        title: 'Stale Tab 2 Edit',
        now: '2026-11-23T10:02:00.000Z',
        dbPath,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_DRAFT' });
  });

  it('blocks deleting a declined replacement that still owns live calendar blocks and returns dependentTaskIds', async () => {
    const { dbPath, db } = makeTempDb();
    await writeDb(db, dbPath);

    // Reschedule Carol's confirmed OAuth task (which Checkout UI depends on and has live blocks)
    await rescheduleTask({
      taskId: 'task-seed-oauth',
      actorId: 'alice',
      newDeadline: '2026-11-27T18:00:00.000Z',
      newEstimatedHours: 8,
      now: '2026-11-23T11:00:00.000Z',
      dbPath,
    });
    await respondToProposal({
      taskId: 'task-seed-oauth',
      actorId: 'carol',
      expectedVersion: 2,
      action: 'decline',
      reason: 'Cannot move OAuth right now',
      now: '2026-11-23T11:05:00.000Z',
      dbPath,
    });

    await expect(
      deleteDraftTask({ taskId: 'task-seed-oauth', actorId: 'alice', dbPath }),
    ).rejects.toMatchObject({ status: 409, code: 'HAS_LIVE_BOOKING' });

    // Create two drafts with a dependency to verify HAS_DEPENDENTS returns dependentTaskIds
    const parent = await createDraftTask({
      actorId: 'alice',
      title: 'Parent Draft',
      estimatedHours: 2,
      dbPath,
    });
    const child = await createDraftTask({
      actorId: 'alice',
      title: 'Child Draft',
      estimatedHours: 2,
      dependsOnTaskIds: [parent.id],
      dbPath,
    });
    try {
      await deleteDraftTask({ taskId: parent.id, actorId: 'alice', dbPath });
      throw new Error('Expected HAS_DEPENDENTS');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      expect((err as WorkflowError).code).toBe('HAS_DEPENDENTS');
      expect((err as WorkflowError).details?.dependentTaskIds).toEqual([child.id]);
    }
  });

  it('allocates strictly monotonic proposal versions', async () => {
    const { dbPath, db } = makeTempDb();
    await writeDb(db, dbPath);

    const draft = await createDraftTask({
      actorId: 'alice',
      title: 'Monotonic Version Test',
      estimatedHours: 2,
      dbPath,
    });
    const { task: v1 } = await proposeTask({
      taskId: draft.id,
      actorId: 'alice',
      assigneeId: 'bob',
      deadline: '2026-11-27T18:00:00.000Z',
      estimatedHours: 2,
      now: '2026-11-23T12:00:00.000Z',
      dbPath,
    });
    expect(v1.currentProposal.version).toBe(1);
  });
});
