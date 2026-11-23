import { NextResponse } from 'next/server';
import { resetDb } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const db = await resetDb();
    return NextResponse.json(
      { ok: true, db },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset demo data.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
