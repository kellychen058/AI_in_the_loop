'use client';

import { isRejectionOverridden } from '@/lib/evaluation';
import type { AuditLogEntry, RejectionRecord, TeamMember } from '@/lib/types';
import { formatDateTime, hoursText, memberName, WORKLOAD_STYLES } from './ui';

export function RejectionLogTable({
  rejections,
  auditLog,
  members,
}: {
  rejections: RejectionRecord[];
  auditLog: AuditLogEntry[];
  members: TeamMember[];
}) {
  if (rejections.length === 0) {
    return <p className="text-xs text-[#78716C]">No declines recorded yet.</p>;
  }
  const sorted = [...rejections].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sorted.map((r) => {
        const overridden = isRejectionOverridden(r, auditLog);
        const snapshot = r.workloadSnapshot;
        const style = WORKLOAD_STYLES[snapshot.status];
        const attribution =
          r.rejectedBy === r.rejectedAssigneeId
            ? `${memberName(members, r.rejectedBy)} declined assignment`
            : `${memberName(members, r.rejectedBy)} declined ${memberName(members, r.rejectedAssigneeId)}’s counter`;

        return (
          <article
            key={r.id}
            className="flex flex-col justify-between rounded-lg border border-[#E5E2DC] bg-[#FAF9F6] p-3.5"
          >
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[#111827]">{r.taskTitle}</h3>
                  <p className="mt-0.5 text-[11px] font-medium text-[#57534E]">
                    {attribution} ·{' '}
                    <span className="font-mono tabular-nums">
                      {hoursText(r.estimatedHours)} due {formatDateTime(r.rejectedDeadline)}
                    </span>
                  </p>
                </div>
                {overridden ? (
                  <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[10px] font-bold text-[#B45309]">
                    Overridden with justification
                  </span>
                ) : (
                  <span className="rounded-full border border-[#FECDD3] bg-[#FFF1F2] px-2 py-0.5 text-[10px] font-bold text-[#BE123C]">
                    Active Guard
                  </span>
                )}
              </div>

              <blockquote className="mt-2.5 border-l-2 border-[#D1CCC2] pl-2.5 text-xs text-[#111827]">
                “{r.reason}”
              </blockquote>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E2DC] pt-2 text-[11px]">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ring-1 tabular-nums ${style.pill}`}
              >
                {hoursText(snapshot.availableHours)} free vs {hoursText(snapshot.newTaskHours)}{' '}
                needed
              </span>
              <span className="font-mono text-[10px] text-[#78716C] tabular-nums">
                {formatDateTime(r.createdAt)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
