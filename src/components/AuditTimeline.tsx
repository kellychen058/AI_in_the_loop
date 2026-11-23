'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AuditAction, AuditLogEntry, Task, TeamMember } from '@/lib/types';
import { ReceiptRail } from './ReceiptRail';
import { formatDateTime, inputClass, memberName, StatusPill } from './ui';

const ACTION_LABELS: Record<AuditAction, string> = {
  meeting_ingested: 'Meeting ingested',
  task_drafted: 'Task drafted',
  task_proposed: 'Proposed',
  task_counter_proposed: 'Counter-proposed',
  task_rejected: 'Declined',
  task_confirmed: 'Confirmed',
  task_rescheduled: 'Rescheduled',
  calendar_synced: 'Calendar synced',
  calendar_sync_failed: 'Calendar sync failed',
  rejected_option_overridden: 'Guard overridden',
  task_deleted: 'Task deleted',
  progress_checkin_configured: 'Check-in configured',
  progress_checkin_submitted: 'Check-in submitted',
  progress_checkin_reminded: 'Check-in reminder',
  progress_checkin_dismissed: 'Check-in alert dismissed',
  demo_reset: 'Demo reset',
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
  const [viewMode, setViewMode] = useState<'grouped' | 'chronological'>('grouped');
  const [action, setAction] = useState<AuditAction | 'all'>('all');
  const [taskId, setTaskId] = useState<string>('all');

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const taskTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of auditLog) {
      if (entry.taskId && !map.has(entry.taskId)) {
        map.set(entry.taskId, taskById.get(entry.taskId)?.title ?? `Historical (${entry.taskId})`);
      }
    }
    return map;
  }, [auditLog, taskById]);

  const filtered = useMemo(
    () =>
      auditLog
        .filter(
          (e) =>
            (action === 'all' || e.action === action) &&
            (taskId === 'all' || e.taskId === taskId),
        )
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [auditLog, action, taskId],
  );

  const groupedByTask = useMemo(() => {
    const groups = new Map<string, AuditLogEntry[]>();
    for (const entry of filtered) {
      const key = entry.taskId ?? '__workspace__';
      const list = groups.get(key) ?? [];
      list.push(entry);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#D1CCC2] bg-[#F7F6F2] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`rounded-md px-2.5 py-1 font-semibold ${
                viewMode === 'grouped' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#57534E]'
              }`}
            >
              Grouped by Task
            </button>
            <button
              type="button"
              onClick={() => setViewMode('chronological')}
              className={`rounded-md px-2.5 py-1 font-semibold ${
                viewMode === 'chronological'
                  ? 'bg-white text-[#111827] shadow-sm'
                  : 'text-[#57534E]'
              }`}
            >
              Chronological
            </button>
          </div>

          <select
            aria-label="Filter by action"
            className={`${inputClass} w-auto py-1 text-xs`}
            value={action}
            onChange={(e) => setAction(e.target.value as AuditAction | 'all')}
          >
            <option value="all">All actions</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by task"
            className={`${inputClass} w-auto max-w-xs py-1 text-xs`}
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
        </div>

        <span className="font-mono text-[11px] text-[#78716C] tabular-nums">
          {filtered.length} of {auditLog.length} receipts
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-[#78716C]">No receipts match these filters.</p>
      ) : viewMode === 'grouped' ? (
        <div className="space-y-3">
          {groupedByTask.map(([key, entries]) => {
            const liveTask = key !== '__workspace__' ? taskById.get(key) : undefined;
            const heading =
              key === '__workspace__'
                ? 'Workspace & Meeting Intake Events'
                : (liveTask?.title ?? `Historical Record (${key})`);
            return (
              <div
                key={key}
                className="rounded-lg border border-[#E5E2DC] bg-[#FAF9F6] p-3.5"
              >
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E2DC] pb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-[#111827]">{heading}</h3>
                    {liveTask ? <StatusPill status={liveTask.status} /> : null}
                  </div>
                  {liveTask ? (
                    <Link
                      href={`/?task=${encodeURIComponent(liveTask.id)}`}
                      className="text-[11px] font-semibold text-[#111827] underline"
                    >
                      Open Contract
                    </Link>
                  ) : null}
                </div>
                <ReceiptRail entries={entries} members={members} />
              </div>
            );
          })}
        </div>
      ) : (
        <ol className="relative space-y-2.5 border-l border-[#E5E2DC] pl-4">
          {filtered.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[#111827] ring-2 ring-white" />
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#78716C]">
                <span className="font-semibold text-[#111827]">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                </span>
                <span>· {memberName(members, entry.actorId)}</span>
                <span className="font-mono tabular-nums">· {formatDateTime(entry.timestamp)}</span>
              </div>
              <p className="text-xs text-[#57534E]">{entry.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
