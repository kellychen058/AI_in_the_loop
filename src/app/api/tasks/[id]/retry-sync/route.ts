import { NextResponse } from 'next/server';
import { retryTaskSync } from '@/lib/calendar/adapter';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { actorId?: unknown } | null;
  const actorId = typeof body?.actorId === 'string' ? body.actorId : undefined;

  try {
    const result = await retryTaskSync({ taskId: id, actorId });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, task: result.task },
        { status: result.status },
      );
    }
    return NextResponse.json({ task: result.task }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry calendar sync.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
