import type { CheckInDaysBefore } from '@/lib/types';
import { readJsonBody, rescheduleTask, runWorkflowRoute } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    return rescheduleTask({
      taskId: id,
      actorId: body.actorId as string,
      newAssigneeId: body.newAssigneeId as string | undefined,
      newDeadline: body.newDeadline as string,
      newEstimatedHours: body.newEstimatedHours as number | undefined,
      note: body.note as string | undefined,
      checkInDaysBefore: body.checkInDaysBefore as CheckInDaysBefore | null | undefined,
    });
  });
}
