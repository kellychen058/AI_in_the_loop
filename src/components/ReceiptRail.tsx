'use client';

import type { AuditAction, AuditLogEntry, TeamMember } from '@/lib/types';
import { formatDateTime, memberName } from './ui';

const ACTION_DOT: Record<AuditAction, { label: string; dot: string }> = {
  meeting_ingested: { label: 'Meeting ingested', dot: 'bg-[#78716C]' },
  task_drafted: { label: 'Drafted', dot: 'bg-[#4338CA]' },
  task_proposed: { label: 'Proposed', dot: 'bg-[#4338CA]' },
  task_counter_proposed: { label: 'Counter-proposed', dot: 'bg-[#B45309]' },
  task_rejected: { label: 'Declined', dot: 'bg-[#BE123C]' },
  task_confirmed: { label: 'Confirmed', dot: 'bg-[#047857]' },
  task_rescheduled: { label: 'Rescheduled', dot: 'bg-[#4338CA]' },
  calendar_synced: { label: 'Calendar synced', dot: 'bg-[#047857]' },
  calendar_sync_failed: { label: 'Sync failed', dot: 'bg-[#BE123C]' },
  rejected_option_overridden: { label: 'Guard overridden', dot: 'bg-[#B45309]' },
  task_deleted: { label: 'Deleted', dot: 'bg-[#57534E]' },
  progress_checkin_configured: { label: 'Check-in configured', dot: 'bg-[#0F766E]' },
  progress_checkin_submitted: { label: 'Check-in submitted', dot: 'bg-[#047857]' },
  progress_checkin_reminded: { label: 'Check-in reminded', dot: 'bg-[#B45309]' },
  progress_checkin_dismissed: { label: 'Alert dismissed', dot: 'bg-[#78716C]' },
  demo_reset: { label: 'Demo reset', dot: 'bg-[#A8A29E]' },
};

export function ReceiptRail({
  entries,
  members,
  emptyLabel = 'No receipts recorded for this task yet.',
}: {
  entries: AuditLogEntry[];
  members: TeamMember[];
  emptyLabel?: string;
}) {
  const ordered = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (ordered.length === 0) {
    return <p className="text-xs text-[#78716C]">{emptyLabel}</p>;
  }

  return (
    <ol className="relative space-y-2.5 border-l border-[#E5E2DC] pl-4">
      {ordered.map((entry) => {
        const meta = ACTION_DOT[entry.action] ?? { label: entry.action, dot: 'bg-[#78716C]' };
        return (
          <li key={entry.id} className="relative">
            <span
              className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${meta.dot}`}
            />
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#78716C]">
              <span className="font-semibold text-[#111827]">{meta.label}</span>
              <span>· {memberName(members, entry.actorId)}</span>
              <span className="font-mono tabular-nums">· {formatDateTime(entry.timestamp)}</span>
            </div>
            <p className="mt-0.5 text-xs text-[#57534E]">{entry.summary}</p>
          </li>
        );
      })}
    </ol>
  );
}
