import { NextResponse } from 'next/server';
import { generateIcs } from '@/lib/calendar/ics';
import { readDb } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const memberId = new URL(request.url).searchParams.get('memberId');

  try {
    const db = await readDb();
    if (memberId && !db.members.some((member) => member.id === memberId)) {
      return NextResponse.json({ error: `Member "${memberId}" not found.` }, { status: 404 });
    }
    const events = db.calendarEvents
      .filter((event) => !memberId || event.memberId === memberId)
      .sort((a, b) => a.start.localeCompare(b.start));
    return new Response(generateIcs(events, db.members), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="team-schedule.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export calendar.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
