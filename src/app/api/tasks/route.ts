import {
  createDraftTask,
  deleteDraftTask,
  listTasks,
  readJsonBody,
  runWorkflowRoute,
  updateDraftTask,
  WorkflowError,
} from '@/lib/workflow';
import type { CheckInDaysBefore } from '@/lib/types';

export const dynamic = 'force-dynamic';

function requireActorId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkflowError(400, 'INVALID_INPUT', '"actorId" is required.');
  }
  return value;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return runWorkflowRoute(async () => ({
    tasks: await listTasks({
      status: params.get('status') ?? undefined,
      assigneeId: params.get('assigneeId') ?? undefined,
    }),
  }));
}

export async function POST(request: Request) {
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    const task = await createDraftTask({
      actorId: body.actorId as string,
      title: body.title as string,
      description: body.description as string | undefined,
      sourceQuote: body.sourceQuote as string | undefined,
      meetingId: body.meetingId as string | undefined,
      estimatedHours: body.estimatedHours as number,
      assigneeId: body.assigneeId as string | undefined,
      deadline: body.deadline as string | undefined,
      dependsOnTaskIds: body.dependsOnTaskIds as string[] | undefined,
      checkInDaysBefore: body.checkInDaysBefore as CheckInDaysBefore | null | undefined,
    });
    return { task };
  }, 201);
}

export async function PATCH(request: Request) {
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    const task = await updateDraftTask({
      taskId: body.id as string,
      actorId: requireActorId(body.actorId),
      title: body.title as string | undefined,
      description: body.description as string | undefined,
      sourceQuote: body.sourceQuote as string | undefined,
      estimatedHours: body.estimatedHours as number | undefined,
      assigneeId: body.assigneeId as string | undefined,
      deadline: body.deadline as string | undefined,
      dependsOnTaskIds: body.dependsOnTaskIds as string[] | undefined,
      checkInDaysBefore: body.checkInDaysBefore as CheckInDaysBefore | null | undefined,
    });
    return { task };
  });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  return runWorkflowRoute(async () => {
    await deleteDraftTask({
      taskId: params.get('id') ?? '',
      actorId: requireActorId(params.get('actorId')),
    });
    return { ok: true };
  });
}
