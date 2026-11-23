import { readJsonBody, respondToProposal, runWorkflowRoute } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    return respondToProposal({
      taskId: id,
      actorId: body.actorId as string,
      expectedVersion: body.expectedVersion as number,
      action: body.action as 'accept' | 'counter' | 'decline',
      newDeadline: body.newDeadline as string | undefined,
      newEstimatedHours: body.newEstimatedHours as number | undefined,
      note: body.note as string | undefined,
      reason: body.reason as string | undefined,
    });
  });
}
