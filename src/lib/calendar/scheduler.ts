import type { CalendarEvent, ScheduleBlocksResult, TeamMember } from '@/lib/types';

// Wave 0 compiling stub — full auto work-block scheduler owned by Issue #11.

export function findWorkBlocks(params: {
  member: TeamMember;
  estimatedHours: number;
  deadline: string;
  existingEvents: CalendarEvent[];
  now?: string;
  excludeTaskId?: string;
}): ScheduleBlocksResult {
  return {
    blocks: [],
    scheduledHours: 0,
    unscheduledHours: Math.max(0, params.estimatedHours),
  };
}
