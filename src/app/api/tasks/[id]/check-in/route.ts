import type { CheckInDaysBefore } from '@/lib/types';
import {
  configureProgressCheckIn,
  dismissProgressCheckInAlert,
  readJsonBody,
  remindProgressCheckIn,
  runWorkflowRoute,
  submitProgressCheckIn,
  WorkflowError,
} from '@/lib/workflow';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runWorkflowRoute(async () => {
    const body = await readJsonBody(request);
    const actorId = body.actorId as string;
    switch (body.action) {
      case 'configure':
        return configureProgressCheckIn({
          taskId: id,
          actorId,
          daysBeforeDeadline: (body.daysBeforeDeadline ?? null) as CheckInDaysBefore | null,
        });
      case 'submit':
        return submitProgressCheckIn({ taskId: id, actorId, message: body.message as string });
      case 'remind':
        return remindProgressCheckIn({ taskId: id, actorId, note: body.note as string | undefined });
      case 'dismiss':
        return dismissProgressCheckInAlert({ taskId: id, actorId });
      default:
        throw new WorkflowError(
          400,
          'INVALID_INPUT',
          '"action" must be one of configure, submit, remind, dismiss.',
        );
    }
  });
}
