import type {
  AffectedDependentTask,
  AppDatabase,
  CalendarEvent,
  Task,
  TeamMember,
  WorkloadBreakdown,
} from './types';

// Wave 0 compiling stub — full deterministic implementation owned by Issue #8.

export function calculateMemberWorkload(params: {
  member: TeamMember;
  deadline: string;
  newTaskHours: number;
  calendarEvents: CalendarEvent[];
  tasks: Task[];
  now?: string;
  excludeTaskId?: string;
}): WorkloadBreakdown {
  const windowStart = params.now ?? new Date().toISOString();
  const availableHours = params.member.weeklyHours;
  const remainingAfterTask = availableHours - params.newTaskHours;
  const remainingRatio = availableHours > 0 ? remainingAfterTask / availableHours : -1;
  const status =
    remainingAfterTask < 0 ? 'conflict' : remainingRatio < 0.2 ? 'near_capacity' : 'ok';

  return {
    memberId: params.member.id,
    windowStart,
    windowEnd: params.deadline,
    workdaysInWindow: 5,
    proratedWorkHours: params.member.weeklyHours,
    scheduledMeetingHours: 0,
    existingTaskHours: 0,
    availableHours,
    newTaskHours: params.newTaskHours,
    remainingAfterTask,
    remainingRatio,
    status,
    explanation: `Stub workload calculation for ${params.member.name} (implemented in Issue #8).`,
  };
}

export function checkAllMembersWorkload(params: {
  db: AppDatabase;
  deadline: string;
  newTaskHours: number;
  now?: string;
  excludeTaskId?: string;
}): WorkloadBreakdown[] {
  return params.db.members.map((member) =>
    calculateMemberWorkload({
      member,
      deadline: params.deadline,
      newTaskHours: params.newTaskHours,
      calendarEvents: params.db.calendarEvents,
      tasks: params.db.tasks,
      now: params.now,
      excludeTaskId: params.excludeTaskId,
    }),
  );
}

export function findAffectedDependentTasks(params: {
  taskId: string;
  newDeadline: string;
  tasks: Task[];
}): AffectedDependentTask[] {
  const newDeadlineMs = new Date(params.newDeadline).getTime();
  return params.tasks
    .filter(
      (task) =>
        task.dependsOnTaskIds.includes(params.taskId) &&
        new Date(task.currentProposal.deadline).getTime() < newDeadlineMs,
    )
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      assigneeId: task.currentProposal.assigneeId,
      currentDeadline: task.currentProposal.deadline,
      reason: `Depends on ${params.taskId}, whose new deadline exceeds this task's deadline.`,
    }));
}
