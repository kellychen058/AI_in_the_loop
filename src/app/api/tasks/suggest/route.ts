import { NextResponse } from 'next/server';
import { suggestTaskAssignment } from '@/lib/ai/extract';
import { readDb } from '@/lib/store';

export const dynamic = 'force-dynamic';

function badRequest(message: string) {
  return NextResponse.json({ code: 'INVALID_INPUT', message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const estimatedHours = body.estimatedHours;
  const deadline = typeof body.deadline === 'string' ? body.deadline : '';

  if (!title) return badRequest('title is required.');
  if (
    typeof estimatedHours !== 'number' ||
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0
  ) {
    return badRequest('estimatedHours must be a positive number.');
  }
  if (Number.isNaN(Date.parse(deadline))) return badRequest('deadline must be an ISO 8601 date.');

  try {
    const db = await readDb();
    const suggestion = await suggestTaskAssignment({
      db,
      taskId: typeof body.taskId === 'string' && body.taskId ? body.taskId : undefined,
      title,
      description: typeof body.description === 'string' ? body.description : undefined,
      estimatedHours,
      deadline: new Date(deadline).toISOString(),
    });
    return NextResponse.json(suggestion);
  } catch (error) {
    console.error('Assignment suggestion failed', error);
    return NextResponse.json(
      {
        code: 'SUGGESTION_FAILED',
        message: 'Could not compute an assignment suggestion. Please try again.',
      },
      { status: 500 },
    );
  }
}
