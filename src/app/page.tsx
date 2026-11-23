'use client';

import { Suspense } from 'react';
import { DeskWorkspace } from '@/components/DeskWorkspace';

export default function WorkspacePage() {
  return (
    <Suspense fallback={<p className="py-12 text-center text-xs text-[#78716C]">Loading Desk…</p>}>
      <DeskWorkspace />
    </Suspense>
  );
}
