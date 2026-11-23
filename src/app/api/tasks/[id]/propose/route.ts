import type { CheckInDaysBefore } from '@/lib/types';
import { proposeTask, readJsonBody, runWorkflowRoute } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    return proposeTask({
      taskId: id,
      actorId: body.actorId as string,
      assigneeId: body.assigneeId as string,
      deadline: body.deadline as string,
      estimatedHours: body.estimatedHours as number,
      note: body.note as string | undefined,
      overrideRejectedReason: body.overrideRejectedReason as string | undefined,
      title: body.title as string | undefined,
      description: body.description as string | undefined,
      dependsOnTaskIds: body.dependsOnTaskIds as string[] | undefined,
      checkInDaysBefore: body.checkInDaysBefore as CheckInDaysBefore | null | undefined,
    });
  });
}
