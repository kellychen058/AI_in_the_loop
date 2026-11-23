import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalCalendarAdapter,
  retryTaskSync,
  SIMULATED_OUTAGE_MESSAGE,
} from '@/lib/calendar/adapter';
import { generateIcs } from '@/lib/calendar/ics';
import { findWorkBlocks } from '@/lib/calendar/scheduler';
import { createSeedDatabase } from '@/lib/seed';
import { readDb, updateDb, writeDb } from '@/lib/store';
import type { CalendarEvent, Task, TeamMember } from '@/lib/types';

// 2026-11-23 is a Monday. All times are local, matching the seed and scheduler.
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 10, 23 + day, hour, minute).toISOString();
}

const member: TeamMember = {
  id: 'm1',
  name: 'Test Member',
  role: 'engineer',
  weeklyHours: 40,
  workdayStartHour: 9,
  workdayEndHour: 18,
};

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'start' | 'end'>) {
  return {
    id: `evt-${overrides.start}`,
    memberId: member.id,
    title: 'Busy',
    kind: 'meeting',
    ...overrides,
  } satisfies CalendarEvent;
}

function hours(block: { start: string; end: string }): number {
  return (new Date(block.end).getTime() - new Date(block.start).getTime()) / 3_600_000;
}

describe('findWorkBlocks', () => {
  it.each([
    {
      name: 'packs around a meeting in 1–4h chunks',
      estimatedHours: 6,
      now: at(0, 9),
      deadline: at(4, 18),
      events: [event({ start: at(0, 10), end: at(0, 12) })],
      expected: [
        [at(0, 9), at(0, 10)],
        [at(0, 12), at(0, 16)],
        [at(0, 16, 30), at(0, 17, 30)],
      ],
    },
    {
      name: 'inserts a 30-min break so continuous focus time never exceeds 4h',
      estimatedHours: 8,
      now: at(0, 9),
      deadline: at(4, 18),
      events: [],
      expected: [
        [at(0, 9), at(0, 13)],
        [at(0, 13, 30), at(0, 17, 30)],
      ],
    },
    {
      name: 'skips gaps shorter than 1h and ignores other members and the excluded task',
      estimatedHours: 2,
      now: at(0, 9),
      deadline: at(4, 18),
      excludeTaskId: 'task-old',
      events: [
        event({ start: at(0, 9, 30), end: at(0, 17) }),
        event({ start: at(0, 17), end: at(0, 18), memberId: 'someone-else' }),
        event({ start: at(0, 9), end: at(0, 9, 30), taskId: 'task-old', kind: 'work_block' }),
      ],
      expected: [
        [at(0, 17), at(0, 18)],
        [at(1, 9), at(1, 10)],
      ],
    },
    {
      name: 'rounds now up to the next 30 min and skips the weekend',
      estimatedHours: 4,
      now: at(4, 16, 10),
      deadline: at(8, 18),
      events: [],
      expected: [
        [at(4, 16, 30), at(4, 18)],
        [at(7, 9), at(7, 11, 30)],
      ],
    },
  ])('$name', ({ estimatedHours, now, deadline, events, excludeTaskId, expected }) => {
    const result = findWorkBlocks({
      member,
      estimatedHours,
      deadline,
      now,
      existingEvents: events,
      excludeTaskId,
    });

    expect(result.blocks.map((b) => [b.start, b.end])).toEqual(expected);
    expect(result.scheduledHours).toBe(estimatedHours);
    expect(result.unscheduledHours).toBe(0);
  });

  it('never overlaps busy time or exceeds 4h per block, and reports the partial-fit shortfall', () => {
    const db = createSeedDatabase(new Date(2026, 10, 23, 10));
    const carol = db.members.find((m) => m.id === 'carol')!;
    const carolBusy = db.calendarEvents.filter((e) => e.memberId === 'carol');

    const result = findWorkBlocks({
      member: carol,
      estimatedHours: 10,
      now: at(0, 9),
      deadline: at(2, 18),
      existingEvents: db.calendarEvents,
    });

    // Carol's free time Mon–Wed: Mon 9-10,12-13,17-18 · Tue 12-13,17-18 · Wed 9-10,12-13,17-18.
    expect(result.scheduledHours).toBe(8);
    expect(result.unscheduledHours).toBe(2);
    for (const block of result.blocks) {
      expect(hours(block)).toBeGreaterThanOrEqual(1);
      expect(hours(block)).toBeLessThanOrEqual(4);
      expect([0, 6]).not.toContain(new Date(block.start).getDay());
      for (const busy of carolBusy) {
        const overlaps = block.start < busy.end && busy.start < block.end;
        expect(overlaps, `${block.start} overlaps ${busy.title}`).toBe(false);
      }
    }
  });
});

describe('LocalCalendarAdapter & retry sync', () => {
  const tempDirs: string[] = [];

  async function seededDbPath(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-loop-calendar-test-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'db.json');
    await writeDb(createSeedDatabase(new Date(2026, 10, 23, 10)), dbPath);
    return dbPath;
  }

  async function oauthTask(dbPath: string): Promise<Task> {
    const db = await readDb(dbPath);
    return db.tasks.find((t) => t.id === 'task-seed-oauth')!;
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('replaces prior work blocks on reschedule and reassignment without duplicates', async () => {
    const dbPath = await seededDbPath();
    const adapter = new LocalCalendarAdapter(dbPath);
    const task = await oauthTask(dbPath);
    const blocks = [
      { start: at(3, 13), end: at(3, 17) },
      { start: at(4, 13), end: at(4, 17) },
    ];

    const rescheduled = { ...task, currentProposal: { ...task.currentProposal, version: 2 } };
    const first = await adapter.syncTaskBlocks({ task: rescheduled, blocks });
    const second = await adapter.syncTaskBlocks({ task: rescheduled, blocks });
    expect(second.eventIds).toEqual(first.eventIds);

    let db = await readDb(dbPath);
    let taskEvents = db.calendarEvents.filter((e) => e.taskId === task.id);
    expect(taskEvents.map((e) => e.id)).toEqual(first.eventIds);
    expect(taskEvents.map((e) => [e.start, e.end])).toEqual(blocks.map((b) => [b.start, b.end]));
    expect(db.calendarEvents.some((e) => e.id === 'evt-wb-carol-1')).toBe(false);
    expect(db.calendarEvents.some((e) => e.id === 'evt-wb-carol-3')).toBe(true);

    const reassigned = {
      ...task,
      currentProposal: { ...task.currentProposal, version: 3, assigneeId: 'david' },
    };
    await adapter.syncTaskBlocks({ task: reassigned, blocks: blocks.slice(0, 1) });
    db = await readDb(dbPath);
    taskEvents = db.calendarEvents.filter((e) => e.taskId === task.id);
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0]).toMatchObject({ memberId: 'david', kind: 'work_block' });

    await adapter.removeTaskBlocks(task.id);
    db = await readDb(dbPath);
    expect(db.calendarEvents.some((e) => e.taskId === task.id)).toBe(false);
  });

  it('fails a simulated outage without partial writes, then recovers via retry', async () => {
    const dbPath = await seededDbPath();
    const adapter = new LocalCalendarAdapter(dbPath);
    const newBlocks = [{ start: at(3, 13), end: at(3, 17) }];

    await updateDb((db) => {
      db.settings.simulateCalendarFailure = true;
      const task = db.tasks.find((t) => t.id === 'task-seed-oauth')!;
      task.status = 'sync_failed';
      task.syncError = SIMULATED_OUTAGE_MESSAGE;
      task.currentProposal = { ...task.currentProposal, version: 2, proposedBlocks: newBlocks };
    }, dbPath);
    const before = await readDb(dbPath);

    await expect(
      adapter.syncTaskBlocks({ task: await oauthTask(dbPath), blocks: newBlocks }),
    ).rejects.toThrow(SIMULATED_OUTAGE_MESSAGE);
    expect((await readDb(dbPath)).calendarEvents).toEqual(before.calendarEvents);

    const failed = await retryTaskSync({ taskId: 'task-seed-oauth', dbPath });
    expect(failed).toMatchObject({ ok: false, status: 503, error: SIMULATED_OUTAGE_MESSAGE });
    let db = await readDb(dbPath);
    expect(db.calendarEvents).toEqual(before.calendarEvents);
    expect(db.tasks.find((t) => t.id === 'task-seed-oauth')!.status).toBe('sync_failed');
    expect(db.auditLog.at(-1)).toMatchObject({ action: 'calendar_sync_failed', actorId: 'carol' });

    await updateDb((current) => {
      current.settings.simulateCalendarFailure = false;
    }, dbPath);
    const recovered = await retryTaskSync({ taskId: 'task-seed-oauth', actorId: 'alice', dbPath });
    expect(recovered.ok).toBe(true);

    db = await readDb(dbPath);
    const task = db.tasks.find((t) => t.id === 'task-seed-oauth')!;
    expect(task.status).toBe('confirmed');
    expect(task.syncError).toBeUndefined();
    const taskEvents = db.calendarEvents.filter((e) => e.taskId === task.id);
    expect(task.calendarEventIds).toEqual(taskEvents.map((e) => e.id));
    expect(taskEvents.map((e) => [e.start, e.end])).toEqual([[at(3, 13), at(3, 17)]]);
    expect(db.auditLog.at(-1)).toMatchObject({ action: 'calendar_synced', actorId: 'alice' });

    expect(await retryTaskSync({ taskId: 'task-seed-oauth', dbPath })).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await retryTaskSync({ taskId: 'nope', dbPath })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});

describe('generateIcs', () => {
  it('emits RFC 5545 events with CRLF, UTC times, escaping, and folded long lines', () => {
    const members: TeamMember[] = [{ ...member, name: 'Carol Wu' }];
    const longTitle = `Payment, webhooks; retries\\backoff\nnotes 串接金流 ${'x'.repeat(80)}`;
    const ics = generateIcs(
      [
        event({ id: 'evt-1', start: '2026-11-23T02:00:00.000Z', end: '2026-11-23T04:00:00.000Z' }),
        event({
          id: 'evt-2',
          title: longTitle,
          kind: 'work_block',
          taskId: 'task-1',
          start: '2026-11-24T05:30:00.000Z',
          end: '2026-11-24T09:30:00.000Z',
        }),
      ],
      members,
      new Date('2026-11-20T00:00:00.000Z'),
    );

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:evt-1@ai-in-the-loop\r\nDTSTAMP:20261120T000000Z\r\n');
    expect(ics).toContain('DTSTART:20261124T053000Z\r\nDTEND:20261124T093000Z\r\n');
    expect(ics).toContain('DESCRIPTION:Confirmed work block for Carol Wu (task task-1)');

    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(
      `SUMMARY:Payment\\, webhooks\\; retries\\\\backoff\\nnotes 串接金流 ${'x'.repeat(80)} · Carol Wu`,
    );
  });
});
