import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSeedDatabase,
  EDGE_CASE_PRESETS,
  getWorkweekMonday,
  SAMPLE_MEETING_NOTES,
} from '@/lib/seed';
import { readDb, resetDb, updateDb, writeDb } from '@/lib/store';

function durationHours(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
}

describe('Seed database integrity', () => {
  it('seeds the 4 canonical team personas with expected roles and weekly hours', () => {
    const db = createSeedDatabase(new Date('2026-11-23T10:00:00'));

    expect(db.members.map((m) => m.id)).toEqual(['alice', 'bob', 'carol', 'david']);
    expect(db.members.find((m) => m.id === 'alice')).toMatchObject({
      role: 'pm',
      weeklyHours: 35,
      workdayStartHour: 9,
      workdayEndHour: 18,
    });
    expect(db.members.find((m) => m.id === 'bob')).toMatchObject({
      role: 'designer',
      weeklyHours: 30,
    });
    expect(db.members.find((m) => m.id === 'carol')).toMatchObject({
      role: 'engineer',
      weeklyHours: 30,
    });
    expect(db.members.find((m) => m.id === 'david')).toMatchObject({
      role: 'engineer',
      weeklyHours: 25,
    });
  });

  it('sets up Carol with heavy meetings + confirmed tasks leaving ~6h free this week', () => {
    const db = createSeedDatabase(new Date('2026-11-23T10:00:00'));
    const carol = db.members.find((m) => m.id === 'carol')!;

    const carolMeetingHours = db.calendarEvents
      .filter((e) => e.memberId === 'carol' && e.kind === 'meeting')
      .reduce((sum, e) => sum + durationHours(e.start, e.end), 0);

    const carolConfirmedTaskHours = db.tasks
      .filter((t) => t.status === 'confirmed' && t.currentProposal.assigneeId === 'carol')
      .reduce((sum, t) => sum + t.currentProposal.estimatedHours, 0);

    const carolFreeHours = carol.weeklyHours - carolMeetingHours - carolConfirmedTaskHours;

    expect(carolMeetingHours).toBe(12);
    expect(carolConfirmedTaskHours).toBe(12);
    expect(carolFreeHours).toBe(6);

    // Verify David has substantially more capacity than Carol (viable alternative).
    const david = db.members.find((m) => m.id === 'david')!;
    const davidMeetingHours = db.calendarEvents
      .filter((e) => e.memberId === 'david' && e.kind === 'meeting')
      .reduce((sum, e) => sum + durationHours(e.start, e.end), 0);
    const davidTaskHours = db.tasks
      .filter((t) => t.status === 'confirmed' && t.currentProposal.assigneeId === 'david')
      .reduce((sum, t) => sum + t.currentProposal.estimatedHours, 0);
    expect(david.weeklyHours - davidMeetingHours - davidTaskHours).toBeGreaterThanOrEqual(15);
  });

  it('links confirmed tasks to matching work_block calendar events and includes a dependency link', () => {
    const db = createSeedDatabase(new Date('2026-11-23T10:00:00'));

    expect(db.tasks.length).toBeGreaterThanOrEqual(2);
    for (const task of db.tasks) {
      expect(task.status).toBe('confirmed');
      expect(task.calendarEventIds.length).toBeGreaterThan(0);
      for (const evtId of task.calendarEventIds) {
        const evt = db.calendarEvents.find((e) => e.id === evtId);
        expect(evt).toBeDefined();
        expect(evt?.kind).toBe('work_block');
        expect(evt?.taskId).toBe(task.id);
        expect(evt?.memberId).toBe(task.currentProposal.assigneeId);
      }
    }

    const dependentTask = db.tasks.find((t) => t.dependsOnTaskIds.length > 0);
    expect(dependentTask).toBeDefined();
    expect(db.tasks.some((t) => t.id === dependentTask!.dependsOnTaskIds[0])).toBe(true);
  });

  it('includes a historical RejectionRecord for Carol with conflict workload snapshot and demo presets', () => {
    const db = createSeedDatabase(new Date('2026-11-23T10:00:00'));

    expect(db.rejections).toHaveLength(1);
    const rejection = db.rejections[0];
    expect(rejection.rejectedAssigneeId).toBe('carol');
    expect(rejection.taskTitle).toMatch(/payment api/i);
    expect(rejection.workloadSnapshot.status).toBe('conflict');
    expect(rejection.workloadSnapshot.availableHours).toBe(6);

    expect(SAMPLE_MEETING_NOTES.length).toBeGreaterThan(100);
    expect(EDGE_CASE_PRESETS.empty.rawNotes.trim()).toBe('');
    expect(EDGE_CASE_PRESETS.veryLong.rawNotes.length).toBeGreaterThan(15000);
  });

  it('anchors weekend reference dates to the upcoming Monday workweek', () => {
    // 2026-11-29 is a Sunday -> upcoming Monday is 2026-11-30
    const sunday = new Date('2026-11-29T12:00:00');
    const monday = getWorkweekMonday(sunday);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(30);
  });
});

describe('JSON store round-trip & concurrency', () => {
  const tempDirs: string[] = [];

  async function makeTempDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-loop-store-test-'));
    tempDirs.push(dir);
    return path.join(dir, 'nested', 'db.json');
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it('auto-creates parent directory and auto-seeds when db file does not exist', async () => {
    const dbPath = await makeTempDbPath();
    const db = await readDb(dbPath);

    expect(db.members).toHaveLength(4);
    expect(db.settings.simulateCalendarFailure).toBe(false);

    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  it('supports writeDb, updateDb, and resetDb cleanly without temp file leftovers', async () => {
    const dbPath = await makeTempDbPath();
    const initial = await readDb(dbPath);

    initial.settings.simulateCalendarFailure = true;
    await writeDb(initial, dbPath);

    const afterWrite = await readDb(dbPath);
    expect(afterWrite.settings.simulateCalendarFailure).toBe(true);

    // Concurrent updates should serialize cleanly without losing writes.
    await Promise.all([
      updateDb((db) => {
        db.auditLog.push({
          id: 'aud-concurrent-1',
          timestamp: new Date().toISOString(),
          actorId: 'alice',
          action: 'task_drafted',
          summary: 'Concurrent update 1',
        });
      }, dbPath),
      updateDb((db) => {
        db.auditLog.push({
          id: 'aud-concurrent-2',
          timestamp: new Date().toISOString(),
          actorId: 'bob',
          action: 'task_drafted',
          summary: 'Concurrent update 2',
        });
      }, dbPath),
    ]);

    const afterUpdates = await readDb(dbPath);
    const ids = afterUpdates.auditLog.map((entry) => entry.id);
    expect(ids).toContain('aud-concurrent-1');
    expect(ids).toContain('aud-concurrent-2');

    // Reset should restore pristine seed state.
    const reset = await resetDb(dbPath, new Date('2026-11-23T10:00:00'));
    expect(reset.settings.simulateCalendarFailure).toBe(false);
    expect(reset.auditLog.some((entry) => entry.id === 'aud-concurrent-1')).toBe(false);

    const files = await fs.readdir(path.dirname(dbPath));
    expect(files).toEqual(['db.json']);
  });
});
