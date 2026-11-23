import { describe, expect, it } from 'vitest';
import { createSeedDatabase } from '@/lib/seed';
import type { CalendarEvent, Task, TaskStatus, TeamMember } from '@/lib/types';
import {
  calculateMemberWorkload,
  checkAllMembersWorkload,
  countWorkdaysInWindow,
  findAffectedDependentTasks,
  parseWorkloadRequest,
} from '@/lib/workload';

// All dates are built in local time, the same convention as src/lib/seed.ts,
// so these tests give the same result in any time zone.
// 2026-11-23 is a Monday.
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 10, day, hour, minute, 0, 0).toISOString();
}

const MON = 23;
const TUE = 24;
const WED = 25;
const THU = 26;
const FRI = 27;
const MON_NEXT = 30;

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'carol',
    name: 'Carol',
    role: 'engineer',
    weeklyHours: 30,
    workdayStartHour: 9,
    workdayEndHour: 18,
    ...overrides,
  };
}

function meeting(memberId: string, start: string, end: string, id = `m-${start}`): CalendarEvent {
  return { id, memberId, title: 'Meeting', start, end, kind: 'meeting' };
}

function task(params: {
  id: string;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  status?: TaskStatus;
  dependsOnTaskIds?: string[];
  title?: string;
}): Task {
  const proposal = {
    version: 1,
    assigneeId: params.assigneeId,
    deadline: params.deadline,
    estimatedHours: params.estimatedHours,
    proposedBlocks: [],
    proposedBy: 'alice',
    createdAt: at(MON, 8),
  };
  return {
    id: params.id,
    meetingId: 'meeting-1',
    title: params.title ?? `Task ${params.id}`,
    description: '',
    sourceQuote: '',
    aiGenerated: false,
    dependsOnTaskIds: params.dependsOnTaskIds ?? [],
    status: params.status ?? 'confirmed',
    currentProposal: proposal,
    proposalHistory: [proposal],
    calendarEventIds: [],
    createdAt: at(MON, 8),
    updatedAt: at(MON, 8),
  };
}

describe('calculateMemberWorkload', () => {
  it('1. reports ok for a comfortable workload', () => {
    const result = calculateMemberWorkload({
      member: member({ id: 'bob', name: 'Bob', role: 'designer' }),
      now: at(MON, 9),
      deadline: at(FRI, 18),
      newTaskHours: 6,
      calendarEvents: [meeting('bob', at(TUE, 10), at(TUE, 12))],
      tasks: [],
    });

    expect(result.workdaysInWindow).toBe(5);
    expect(result.proratedWorkHours).toBe(30);
    expect(result.scheduledMeetingHours).toBe(2);
    expect(result.existingTaskHours).toBe(0);
    expect(result.availableHours).toBe(28);
    expect(result.remainingAfterTask).toBe(22);
    expect(result.status).toBe('ok');
  });

  it('2. reports near_capacity when less than 20% would remain', () => {
    // 50h/week -> 10h for one full workday; 8.5h leaves 1.5h = 15%.
    const result = calculateMemberWorkload({
      member: member({ weeklyHours: 50 }),
      now: at(MON, 9),
      deadline: at(MON, 18),
      newTaskHours: 8.5,
      calendarEvents: [],
      tasks: [],
    });

    expect(result.availableHours).toBe(10);
    expect(result.remainingAfterTask).toBe(1.5);
    expect(result.remainingRatio).toBe(0.15);
    expect(result.status).toBe('near_capacity');
    expect(result.explanation).toContain('(Near capacity)');
  });

  it('3. reports ok at exactly 20% remaining', () => {
    const result = calculateMemberWorkload({
      member: member({ weeklyHours: 50 }),
      now: at(MON, 9),
      deadline: at(MON, 18),
      newTaskHours: 8,
      calendarEvents: [],
      tasks: [],
    });

    expect(result.remainingAfterTask).toBe(2);
    expect(result.remainingRatio).toBe(0.2);
    expect(result.status).toBe('ok');
  });

  it('4. reports a conflict for the CP1 Section 3.3 Carol example', () => {
    // 30h/week over Mon–Wed = 18h; 4h meetings; 8h existing task -> 6h free; 10h task.
    const result = calculateMemberWorkload({
      member: member(),
      now: at(MON, 9),
      deadline: at(WED, 18),
      newTaskHours: 10,
      calendarEvents: [
        meeting('carol', at(MON, 10), at(MON, 12)),
        meeting('carol', at(TUE, 14), at(TUE, 16)),
      ],
      tasks: [task({ id: 't-existing', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 8 })],
    });

    expect(result).toMatchObject({
      memberId: 'carol',
      workdaysInWindow: 3,
      proratedWorkHours: 18,
      scheduledMeetingHours: 4,
      existingTaskHours: 8,
      availableHours: 6,
      newTaskHours: 10,
      remainingAfterTask: -4,
      status: 'conflict',
    });
    expect(result.explanation).toBe(
      'Carol has 18.0h prorated budget − 4.0h meetings − 8.0h existing tasks = 6.0h available; ' +
        '10.0h task exceeds capacity by 4.0h (Conflict).',
    );
  });

  it('5. excludes Saturday and Sunday from a window spanning a weekend', () => {
    const result = calculateMemberWorkload({
      member: member(),
      now: at(FRI, 9),
      deadline: at(MON_NEXT, 18),
      newTaskHours: 4,
      calendarEvents: [],
      tasks: [],
    });

    expect(result.workdaysInWindow).toBe(2);
    expect(result.proratedWorkHours).toBe(12);
    expect(result.status).toBe('ok');
  });

  it('6. excludeTaskId avoids double-counting the task being rescheduled', () => {
    const tasks = [
      task({ id: 't-1', assigneeId: 'carol', deadline: at(WED, 18), estimatedHours: 5, status: 'pending_assignee' }),
    ];
    const base = {
      member: member(),
      now: at(MON, 9),
      deadline: at(WED, 18),
      newTaskHours: 5,
      calendarEvents: [],
      tasks,
    };

    expect(calculateMemberWorkload(base).existingTaskHours).toBe(5);
    expect(calculateMemberWorkload({ ...base, excludeTaskId: 't-1' }).existingTaskHours).toBe(0);
  });

  it('7. treats a deadline in the past as zero available hours (conflict)', () => {
    const result = calculateMemberWorkload({
      member: member(),
      now: at(WED, 9),
      deadline: at(MON, 18),
      newTaskHours: 2,
      calendarEvents: [meeting('carol', at(MON, 10), at(MON, 12))],
      tasks: [],
    });

    expect(result.workdaysInWindow).toBe(0);
    expect(result.proratedWorkHours).toBe(0);
    expect(result.scheduledMeetingHours).toBe(0);
    expect(result.availableHours).toBe(0);
    expect(result.remainingRatio).toBe(-1);
    expect(result.status).toBe('conflict');
    expect(result.explanation).toContain('deadline is not in the future');
  });

  it('prorates partial first days and clamps meetings to the window', () => {
    // Window starts Mon 13:30: 4.5h of a 9h day = 0.5 workday -> 3h for 30h/week.
    // The 12:00–15:00 meeting only counts its 1.5h inside the window.
    const result = calculateMemberWorkload({
      member: member(),
      now: at(MON, 13, 30),
      deadline: at(MON, 18),
      newTaskHours: 1,
      calendarEvents: [meeting('carol', at(MON, 12), at(MON, 15))],
      tasks: [],
    });

    expect(result.workdaysInWindow).toBe(0.5);
    expect(result.proratedWorkHours).toBe(3);
    expect(result.scheduledMeetingHours).toBe(1.5);
    expect(result.availableHours).toBe(1.5);
  });

  it("only counts the member's own committed tasks due by the deadline", () => {
    const tasks = [
      task({ id: 'counted', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 3 }),
      task({ id: 'pending', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 2, status: 'pending_assignee' }),
      task({ id: 'draft', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 7, status: 'draft' }),
      task({ id: 'rejected', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 7, status: 'rejected' }),
      task({ id: 'after-deadline', assigneeId: 'carol', deadline: at(FRI, 18), estimatedHours: 7 }),
      task({ id: 'someone-else', assigneeId: 'david', deadline: at(TUE, 18), estimatedHours: 7 }),
    ];
    const result = calculateMemberWorkload({
      member: member(),
      now: at(MON, 9),
      deadline: at(WED, 18),
      newTaskHours: 1,
      calendarEvents: [meeting('david', at(MON, 10), at(MON, 12))],
      tasks,
    });

    expect(result.existingTaskHours).toBe(5);
    expect(result.scheduledMeetingHours).toBe(0);
  });

  it('reports an already-overbooked member as 0h available instead of a negative number', () => {
    const result = calculateMemberWorkload({
      member: member(),
      now: at(MON, 9),
      deadline: at(MON, 18),
      newTaskHours: 1,
      calendarEvents: [],
      tasks: [task({ id: 't', assigneeId: 'carol', deadline: at(MON, 17), estimatedHours: 8 })],
    });

    expect(result.availableHours).toBe(0);
    expect(result.status).toBe('conflict');
    expect(result.explanation).toContain('already overbooked by 2.0h');
  });
});

describe('countWorkdaysInWindow', () => {
  it('returns 0 for an empty or reversed window', () => {
    const params = { workdayStartHour: 9, workdayEndHour: 18 };
    const t = new Date(2026, 10, MON, 9).getTime();
    expect(countWorkdaysInWindow({ ...params, windowStartMs: t, windowEndMs: t })).toBe(0);
    expect(countWorkdaysInWindow({ ...params, windowStartMs: t, windowEndMs: t - 1 })).toBe(0);
  });
});

describe('checkAllMembersWorkload', () => {
  it("matches the seeded demo week: Carol has 6h free and a 10h task is a conflict, David's is not", () => {
    const db = createSeedDatabase(new Date(2026, 10, MON, 10));
    const results = checkAllMembersWorkload({
      db,
      now: at(MON, 9),
      deadline: at(FRI, 18),
      newTaskHours: 10,
    });

    expect(results.map((r) => r.memberId)).toEqual(db.members.map((m) => m.id));
    const carol = results.find((r) => r.memberId === 'carol')!;
    expect(carol.availableHours).toBe(6);
    expect(carol.status).toBe('conflict');
    expect(results.find((r) => r.memberId === 'david')!.status).not.toBe('conflict');
  });
});

describe('findAffectedDependentTasks', () => {
  const tasks = [
    task({ id: 'parent', assigneeId: 'carol', deadline: at(TUE, 18), estimatedHours: 4, title: 'Payment API' }),
    task({ id: 'child', assigneeId: 'david', deadline: at(WED, 18), estimatedHours: 2, dependsOnTaskIds: ['parent'] }),
    task({ id: 'unrelated', assigneeId: 'bob', deadline: at(MON, 18), estimatedHours: 2 }),
  ];

  it('8. flags downstream tasks when the parent deadline moves past the child deadline', () => {
    const affected = findAffectedDependentTasks({ taskId: 'parent', newDeadline: at(THU, 18), tasks });

    expect(affected).toHaveLength(1);
    expect(affected[0]).toMatchObject({
      taskId: 'child',
      assigneeId: 'david',
      currentDeadline: at(WED, 18),
    });
    expect(affected[0].reason).toContain('"Payment API"');
  });

  it('does not flag anything when the parent still finishes before the child', () => {
    expect(findAffectedDependentTasks({ taskId: 'parent', newDeadline: at(TUE, 12), tasks })).toEqual([]);
    expect(findAffectedDependentTasks({ taskId: 'parent', newDeadline: at(WED, 18), tasks })).toEqual([]);
  });
});

describe('parseWorkloadRequest', () => {
  it('accepts a valid body with optional fields', () => {
    expect(
      parseWorkloadRequest({ deadline: at(FRI, 18), estimatedHours: 4, memberId: 'carol', taskId: 't-1' }),
    ).toEqual({
      ok: true,
      value: { deadline: at(FRI, 18), estimatedHours: 4, memberId: 'carol', taskId: 't-1' },
    });
  });

  it.each([
    ['a non-object body', null],
    ['a missing deadline', { estimatedHours: 4 }],
    ['an invalid deadline', { deadline: 'next friday', estimatedHours: 4 }],
    ['negative hours', { deadline: at(FRI, 18), estimatedHours: -1 }],
    ['non-numeric hours', { deadline: at(FRI, 18), estimatedHours: '4' }],
    ['an empty memberId', { deadline: at(FRI, 18), estimatedHours: 4, memberId: '' }],
  ])('rejects %s with a readable message', (_label, body) => {
    const result = parseWorkloadRequest(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});
