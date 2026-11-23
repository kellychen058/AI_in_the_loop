import { describe, expect, it } from 'vitest';
import {
  computeTaskSpans,
  consolidateEvents,
  layoutOverlapColumns,
  meetingColorIndex,
  packSpanRows,
  type GridEvent,
} from '@/lib/calendar/layout';
import { createSeedDatabase } from '@/lib/seed';
import type { Task, TeamMember } from '@/lib/types';

// 2026-11-23 is a Monday. All times are local, matching the seed.
const monday = new Date(2026, 10, 23);
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 10, 23 + day, hour, minute).toISOString();
}

const members: TeamMember[] = ['alice', 'bob', 'carol', 'david'].map((id) => ({
  id,
  name: id,
  role: 'engineer',
  weeklyHours: 40,
  workdayStartHour: 9,
  workdayEndHour: 18,
}));
const allIds = members.map((m) => m.id);

function meeting(id: string, memberId: string, title: string, start: string, end: string): GridEvent {
  return { id, memberId, title, start, end, kind: 'meeting' };
}

describe('consolidateEvents', () => {
  const events: GridEvent[] = [
    meeting('m-d', 'david', 'Sprint 12 Planning', at(0, 10), at(0, 12)),
    meeting('m-a', 'alice', 'Sprint 12 Planning', at(0, 10), at(0, 12)),
    meeting('m-c', 'carol', '  sprint 12   PLANNING ', at(0, 10), at(0, 12)),
    meeting('m-b', 'bob', 'Sprint 12 Planning', at(0, 10), at(0, 12)),
    meeting('m-other-time', 'bob', 'Sprint 12 Planning', at(0, 13), at(0, 14)),
    meeting('m-carol-solo', 'carol', 'API Design Workshop', at(2, 10), at(2, 12)),
    { id: 'wb-c', memberId: 'carol', title: 'Work: X', start: at(0, 10), end: at(0, 12), kind: 'work_block', taskId: 't' },
    { id: 'wb-d', memberId: 'david', title: 'Work: X', start: at(0, 10), end: at(0, 12), kind: 'work_block', taskId: 't' },
  ];

  it('merges the same meeting across members into one block with ordered attendees', () => {
    const result = consolidateEvents(events, members, allIds);
    const planning = result.filter((e) => e.kind === 'meeting' && e.start === at(0, 10));
    expect(planning).toHaveLength(1);
    expect(planning[0].attendeeIds).toEqual(['alice', 'bob', 'carol', 'david']);
    expect(result.find((e) => e.id === 'm-other-time')?.attendeeIds).toEqual(['bob']);
    expect(result.filter((e) => e.kind === 'work_block').map((e) => e.id)).toEqual(['wb-c', 'wb-d']);
  });

  it('keeps every attendee in single-member view but hides meetings and blocks the member is not in', () => {
    const result = consolidateEvents(events, members, ['bob']);
    expect(result.map((e) => e.id).sort()).toEqual(['m-d', 'm-other-time']);
    expect(result.find((e) => e.id === 'm-d')?.attendeeIds).toEqual(['alice', 'bob', 'carol', 'david']);
  });

  it('does not mutate the input events', () => {
    consolidateEvents(events, members, allIds);
    expect(events[0].attendeeIds).toBeUndefined();
    expect(events[0].memberId).toBe('david');
  });

  it('merges every seeded Sprint 12 Planning copy into one 4-member meeting', () => {
    const db = createSeedDatabase(new Date(2026, 10, 23, 8));
    const result = consolidateEvents(db.calendarEvents, db.members, db.members.map((m) => m.id));
    const planning = result.filter((e) => e.title === 'Sprint 12 Planning');
    expect(planning).toHaveLength(1);
    expect(planning[0].attendeeIds).toHaveLength(4);
  });
});

describe('layoutOverlapColumns', () => {
  const h = (hour: number) => hour * 3_600_000;

  it.each([
    ['lone event is full width', [{ id: 'a', startMs: h(10), endMs: h(12) }], { a: [0, 1] }],
    [
      'two overlapping events sit side by side',
      [
        { id: 'a', startMs: h(9), endMs: h(12) },
        { id: 'b', startMs: h(10), endMs: h(11) },
      ],
      { a: [0, 2], b: [1, 2] },
    ],
    [
      'back-to-back events do not share a cluster',
      [
        { id: 'a', startMs: h(9), endMs: h(10) },
        { id: 'b', startMs: h(10), endMs: h(11) },
      ],
      { a: [0, 1], b: [0, 1] },
    ],
    [
      'transitive overlap shares the cluster width and reuses freed columns',
      [
        { id: 'a', startMs: h(9), endMs: h(11) },
        { id: 'b', startMs: h(10), endMs: h(13) },
        { id: 'c', startMs: h(12), endMs: h(14) },
        { id: 'd', startMs: h(15), endMs: h(16) },
      ],
      { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] },
    ],
  ])('%s', (_name, items, expected) => {
    const placements = layoutOverlapColumns(items);
    for (const [id, [column, columns]] of Object.entries(expected)) {
      expect(placements.get(id)).toEqual({ column, columns });
    }
  });
});

describe('meetingColorIndex', () => {
  it.each([
    [['alice', 'carol'], 'carol', 2],
    [['alice', 'carol'], 'bob', null],
    [['alice'], undefined, null],
  ] as const)('attendees %j, user %s -> %s', (attendees, user, expected) => {
    expect(meetingColorIndex(members, [...attendees], user)).toBe(expected);
  });
});

function task(overrides: Partial<Task> & { deadline: string; assigneeId?: string }): Task {
  const { deadline, assigneeId = 'carol', ...rest } = overrides;
  return {
    id: 'task',
    meetingId: 'mtg',
    title: 'Task',
    description: '',
    sourceQuote: '',
    aiGenerated: false,
    dependsOnTaskIds: [],
    status: 'confirmed',
    currentProposal: {
      version: 1,
      assigneeId,
      deadline,
      estimatedHours: 4,
      proposedBlocks: [],
      proposedBy: 'alice',
      createdAt: at(0, 9),
    },
    proposalHistory: [],
    confirmedVersion: 1,
    confirmedByAssignerAt: at(0, 9),
    confirmedByAssigneeAt: at(1, 11),
    calendarEventIds: [],
    createdAt: at(0, 9),
    updatedAt: at(0, 9),
    ...rest,
  };
}

describe('computeTaskSpans', () => {
  it('spans from the later of the two confirmations to the deadline with a deadline marker', () => {
    const [span] = computeTaskSpans([task({ deadline: at(3, 18) })], monday, allIds);
    expect(span).toMatchObject({
      confirmedAt: at(1, 11),
      startDay: 1,
      endDay: 3,
      continuesFromPrevWeek: false,
      continuesToNextWeek: false,
      deadlineInWeek: true,
      deadlineLabel: '18:00',
    });
  });

  it.each([
    ['confirmed last week, due Wed', { confirmedByAssignerAt: at(-4, 9), confirmedByAssigneeAt: at(-3, 9), deadline: at(2, 14, 30) }, { startDay: 0, endDay: 2, continuesFromPrevWeek: true, continuesToNextWeek: false, deadlineInWeek: true, deadlineLabel: '14:30' }],
    ['due next Tuesday', { deadline: at(8, 18) }, { startDay: 1, endDay: 4, continuesFromPrevWeek: false, continuesToNextWeek: true, deadlineInWeek: false }],
    ['due Saturday', { deadline: at(5, 12) }, { endDay: 4, continuesToNextWeek: true, deadlineInWeek: false }],
    ['only assignee timestamp', { confirmedByAssignerAt: undefined, confirmedByAssigneeAt: at(2, 9), deadline: at(4, 18) }, { startDay: 2, endDay: 4 }],
    ['no timestamps falls back to updatedAt', { confirmedByAssignerAt: undefined, confirmedByAssigneeAt: undefined, updatedAt: at(3, 9), deadline: at(4, 18) }, { startDay: 3, confirmedAt: at(3, 9) }],
    ['confirmed after the deadline collapses to the deadline day', { confirmedByAssigneeAt: at(4, 9), deadline: at(2, 18) }, { startDay: 2, endDay: 2 }],
    ['sync_failed still counts as two-party confirmed', { status: 'sync_failed' as const, deadline: at(4, 18) }, { startDay: 1, endDay: 4 }],
  ])('%s', (_name, overrides, expected) => {
    const spans = computeTaskSpans([task(overrides)], monday, allIds);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject(expected);
  });

  it.each([
    ['pending task', { status: 'pending_assignee' as const, confirmedVersion: undefined, deadline: at(3, 18) }],
    ['confirmed version missing', { confirmedVersion: undefined, deadline: at(3, 18) }],
    ['hidden assignee', { assigneeId: 'bob', deadline: at(3, 18) }],
    ['deadline before this week', { confirmedByAssignerAt: at(-6, 9), confirmedByAssigneeAt: at(-6, 9), deadline: at(-3, 18) }],
    ['confirmed after this week', { confirmedByAssignerAt: at(7, 9), confirmedByAssigneeAt: at(7, 9), deadline: at(9, 18) }],
  ])('excludes %s', (_name, overrides) => {
    expect(computeTaskSpans([task(overrides)], monday, ['alice', 'carol', 'david'])).toEqual([]);
  });

  it('includes the seeded confirmed tasks', () => {
    const db = createSeedDatabase(new Date(2026, 10, 23, 8));
    const spans = computeTaskSpans(db.tasks, monday, db.members.map((m) => m.id));
    expect(spans.map((s) => s.taskId).sort()).toEqual(['task-seed-checkout-ui', 'task-seed-migration', 'task-seed-oauth']);
    expect(spans.every((s) => s.startDay === 0 && s.deadlineInWeek)).toBe(true);
    expect(new Set(spans.map((s) => s.row)).size).toBe(3);
  });
});

describe('packSpanRows', () => {
  it('stacks overlapping spans and reuses rows once a span ends', () => {
    const spans = packSpanRows([
      { id: 'a', startDay: 0, endDay: 2, row: 0 },
      { id: 'b', startDay: 1, endDay: 4, row: 0 },
      { id: 'c', startDay: 3, endDay: 4, row: 0 },
      { id: 'd', startDay: 2, endDay: 2, row: 0 },
    ]);
    expect(Object.fromEntries(spans.map((s) => [s.id, s.row]))).toEqual({ a: 0, b: 1, c: 0, d: 2 });
  });
});
