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
    return <p className="text-sm text-slate-500">No rejections recorded.</p>;
  }
  const sorted = [...rejections].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2 pr-3 font-medium">Task</th>
            <th className="py-2 pr-3 font-medium">Rejected assignee</th>
            <th className="py-2 pr-3 font-medium">Deadline</th>
            <th className="py-2 pr-3 font-medium">Hours</th>
            <th className="py-2 pr-3 font-medium">Reason</th>
            <th className="py-2 pr-3 font-medium">Workload at rejection</th>
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top text-slate-700">
          {sorted.map((r) => {
            const overridden = isRejectionOverridden(r, auditLog);
            const snapshot = r.workloadSnapshot;
            return (
              <tr key={r.id}>
                <td className="py-2 pr-3 font-medium text-slate-900">{r.taskTitle}</td>
                <td className="py-2 pr-3">{memberName(members, r.rejectedAssigneeId)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.rejectedDeadline)}</td>
                <td className="py-2 pr-3">{hoursText(r.estimatedHours)}</td>
                <td className="max-w-[240px] py-2 pr-3">{r.reason}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded-full px-1.5 py-0.5 font-medium ring-1 ${WORKLOAD_STYLES[snapshot.status].pill}`}>
                    {hoursText(snapshot.availableHours)} free vs {hoursText(snapshot.newTaskHours)} needed
                  </span>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                <td className="py-2">
                  {overridden ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                      Overridden with justification
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">Active Block</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
