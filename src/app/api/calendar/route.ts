import { NextResponse } from 'next/server';
import { findWorkBlocks } from '@/lib/calendar/scheduler';
import { readDb, updateDb } from '@/lib/store';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

function parseTime(value: string | null): number | null | undefined {
  if (value === null || value === '') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get('memberId');
  const startMs = parseTime(searchParams.get('start'));
  const endMs = parseTime(searchParams.get('end'));
  if (startMs === null || endMs === null) {
    return NextResponse.json({ error: '`start` and `end` must be ISO dates.' }, { status: 400 });
  }

  try {
    const db = await readDb();
    const calendarEvents = db.calendarEvents.filter(
      (event) =>
        (!memberId || event.memberId === memberId) &&
        (startMs === undefined || new Date(event.end).getTime() > startMs) &&
        (endMs === undefined || new Date(event.start).getTime() < endMs),
    );
    return NextResponse.json(
      {
        calendarEvents,
        members: db.members,
        settings: { simulateCalendarFailure: db.settings.simulateCalendarFailure },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error, 'Failed to load calendar.');
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    simulateCalendarFailure?: unknown;
  } | null;
  if (typeof body?.simulateCalendarFailure !== 'boolean') {
    return NextResponse.json(
      { error: 'Body must be { simulateCalendarFailure: boolean }.' },
      { status: 400 },
    );
  }
  const simulateCalendarFailure = body.simulateCalendarFailure;

  try {
    const db = await updateDb((current) => {
      current.settings.simulateCalendarFailure = simulateCalendarFailure;
    });
    return NextResponse.json({ settings: db.settings }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, 'Failed to update calendar settings.');
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    memberId?: unknown;
    estimatedHours?: unknown;
    deadline?: unknown;
    excludeTaskId?: unknown;
  } | null;
  const { memberId, estimatedHours, deadline, excludeTaskId } = body ?? {};
  if (
    typeof memberId !== 'string' ||
    typeof estimatedHours !== 'number' ||
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0 ||
    typeof deadline !== 'string' ||
    !Number.isFinite(new Date(deadline).getTime()) ||
    (excludeTaskId !== undefined && typeof excludeTaskId !== 'string')
  ) {
    return NextResponse.json(
      {
        error:
          'Body must be { memberId: string, estimatedHours: number > 0, deadline: ISO date, excludeTaskId?: string }.',
      },
      { status: 400 },
    );
  }

  try {
    const db = await readDb();
    const member = db.members.find((candidate) => candidate.id === memberId);
    if (!member) {
      return NextResponse.json({ error: `Member "${memberId}" not found.` }, { status: 404 });
    }
    const result = findWorkBlocks({
      member,
      estimatedHours,
      deadline,
      existingEvents: db.calendarEvents,
      excludeTaskId,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, 'Failed to preview work blocks.');
  }
}
