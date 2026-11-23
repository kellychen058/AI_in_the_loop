import { NextResponse } from 'next/server';
import { readDb } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await readDb();
    return NextResponse.json(db, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load application state.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
