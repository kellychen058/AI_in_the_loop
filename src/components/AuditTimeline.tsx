'use client';

import { useState } from 'react';
import type { AuditAction, AuditLogEntry, Task, TeamMember } from '@/lib/types';
import { formatDateTime, inputClass, memberName } from './ui';

const ACTION_META: Record<AuditAction, { label: string; dot: string }> = {
  meeting_ingested: { label: 'Meeting ingested', dot: 'bg-slate-400' },
  task_drafted: { label: 'Task drafted', dot: 'bg-slate-500' },
  task_proposed: { label: 'Proposed', dot: 'bg-sky-500' },
  task_counter_proposed: { label: 'Counter-proposed', dot: 'bg-violet-500' },
  task_rejected: { label: 'Rejected', dot: 'bg-rose-500' },
  task_confirmed: { label: 'Confirmed', dot: 'bg-emerald-500' },
  task_rescheduled: { label: 'Rescheduled', dot: 'bg-indigo-500' },
  calendar_synced: { label: 'Calendar synced', dot: 'bg-teal-500' },
  calendar_sync_failed: { label: 'Calendar sync failed', dot: 'bg-red-600' },
  rejected_option_overridden: { label: 'Rejection overridden', dot: 'bg-amber-500' },
  demo_reset: { label: 'Demo reset', dot: 'bg-slate-300' },
};

export function AuditTimeline({
  auditLog,
  tasks,
  members,
}: {
  auditLog: AuditLogEntry[];
  tasks: Task[];
  members: TeamMember[];
}) {
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [taskId, setTaskId] = useState<string>('all');

  const taskTitles = new Map<string, string>();
  for (const entry of auditLog) {
    if (entry.taskId && !taskTitles.has(entry.taskId)) {
      taskTitles.set(entry.taskId, tasks.find((t) => t.id === entry.taskId)?.title ?? entry.taskId);
    }
  }
  const entries = auditLog
    .filter((e) => (action === 'all' || e.action === action) && (taskId === 'all' || e.taskId === taskId))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Filter by action"
          className={`${inputClass} w-auto`}
          value={action}
          onChange={(e) => setAction(e.target.value as AuditAction | 'all')}
        >
          <option value="all">All actions</option>
          {Object.entries(ACTION_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by task"
          className={`${inputClass} w-auto max-w-xs`}
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
        >
          <option value="all">All tasks</option>
          {[...taskTitles].map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-slate-500">
          {entries.length} of {auditLog.length} events
        </span>
      </div>

      {entries.length === 0 ? <p className="text-sm text-slate-500">No events match these filters.</p> : null}
      <ol className="relative space-y-3 border-l border-slate-200 pl-5">
        {entries.map((entry) => {
          const meta = ACTION_META[entry.action] ?? { label: entry.action, dot: 'bg-slate-400' };
          return (
            <li key={entry.id} className="relative">
              <span className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${meta.dot}`} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700">{meta.label}</span>
                <span>· {memberName(members, entry.actorId)}</span>
                <span>· {formatDateTime(entry.timestamp)}</span>
              </div>
              <p className="text-sm text-slate-800">{entry.summary}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
