import { NextResponse } from 'next/server';
import { readDb } from '@/lib/store';
import {
  checkAllMembersWorkload,
  findAffectedDependentTasks,
  parseWorkloadRequest,
} from '@/lib/workload';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workload
 * Body: { deadline, estimatedHours, memberId?, excludeTaskId?, taskId? }
 * Returns: { breakdowns: WorkloadBreakdown[], affectedDependents: AffectedDependentTask[] }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const parsed = parseWorkloadRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }
  const { deadline, estimatedHours, memberId, excludeTaskId, taskId } = parsed.value;

  try {
    const db = await readDb();

    if (memberId && !db.members.some((member) => member.id === memberId)) {
      return NextResponse.json({ error: `Unknown memberId: ${memberId}` }, { status: 400 });
    }

    const breakdowns = checkAllMembersWorkload({
      db,
      deadline,
      newTaskHours: estimatedHours,
      excludeTaskId,
    }).filter((breakdown) => !memberId || breakdown.memberId === memberId);

    const affectedDependents = taskId
      ? findAffectedDependentTasks({ taskId, newDeadline: deadline, tasks: db.tasks })
      : [];

    return NextResponse.json(
      { breakdowns, affectedDependents },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to calculate workload.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
