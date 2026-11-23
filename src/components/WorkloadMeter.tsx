'use client';

import { useEffect, useState } from 'react';
import type { AffectedDependentTask, TeamMember, WorkloadBreakdown } from '@/lib/types';
import {
  apiFetch,
  errorText,
  firstName,
  formatDateTime,
  hoursText,
  memberName,
  Spinner,
  WORKLOAD_STYLES,
} from './ui';

interface WorkloadResponse {
  breakdowns: WorkloadBreakdown[];
  affectedDependents: AffectedDependentTask[];
}

export function WorkloadMeter({
  members,
  assigneeId,
  deadline,
  estimatedHours,
  excludeTaskId,
  taskId,
  disabledMemberIds = [],
  onPickMember,
}: {
  members: TeamMember[];
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  excludeTaskId?: string;
  /** Set to also list dependents whose deadline this change would break. */
  taskId?: string;
  disabledMemberIds?: string[];
  /** Shows the all-members comparison strip; clicking a teammate picks them. */
  onPickMember?: (memberId: string) => void;
}) {
  const [data, setData] = useState<WorkloadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = Boolean(deadline) && Number.isFinite(estimatedHours) && estimatedHours > 0;

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await apiFetch<WorkloadResponse>('/api/workload', {
          method: 'POST',
          body: { deadline, estimatedHours, excludeTaskId, taskId },
          signal: controller.signal,
        });
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else {
          setError(errorText(result));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Workload check failed');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [valid, deadline, estimatedHours, excludeTaskId, taskId]);

  if (!valid) {
    return (
      <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
        Enter a deadline and estimated hours to check workload.
      </p>
    );
  }

  const selected = data?.breakdowns.find((b) => b.memberId === assigneeId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Live workload check
        </p>
        {loading ? (
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Spinner /> checking
          </span>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-700">Workload check failed: {error}</p> : null}

      {selected ? (
        <CapacityDetail breakdown={selected} name={memberName(members, assigneeId)} />
      ) : (
        <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">
          {assigneeId ? 'Loading workload…' : 'Pick an assignee to see their capacity.'}
        </p>
      )}

      {onPickMember && data ? (
        <div>
          <p className="mb-1.5 text-xs text-slate-500">
            Team availability by {formatDateTime(deadline)} — click to assign:
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.breakdowns.map((b) => {
              const style = WORKLOAD_STYLES[b.status];
              const disabled = disabledMemberIds.includes(b.memberId);
              const active = b.memberId === assigneeId;
              return (
                <button
                  key={b.memberId}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPickMember(b.memberId)}
                  title={disabled ? 'Cannot assign to yourself' : b.explanation}
                  className={`rounded-md border p-2 text-left text-xs transition ${
                    active ? 'border-indigo-500 ring-2 ring-indigo-500/30' : style.border
                  } bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="font-medium text-slate-900">
                      {firstName(members, b.memberId)}
                    </span>
                    <span className={`h-2 w-2 rounded-full ${style.bar}`} />
                  </span>
                  <span className="mt-0.5 block text-slate-600">
                    {hoursText(b.availableHours)} free · {style.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {data && data.affectedDependents.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            ⚠ Affected dependent tasks ({data.affectedDependents.length})
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {data.affectedDependents.map((dep) => (
              <li key={dep.taskId}>
                <strong>{dep.title}</strong> ({memberName(members, dep.assigneeId)}, due{' '}
                {formatDateTime(dep.currentDeadline)}) would now be due before the task it
                depends on.
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CapacityDetail({ breakdown, name }: { breakdown: WorkloadBreakdown; name: string }) {
  const style = WORKLOAD_STYLES[breakdown.status];
  const used = Math.max(0, breakdown.proratedWorkHours - breakdown.availableHours);
  const total = Math.max(breakdown.proratedWorkHours, used + breakdown.newTaskHours, 0.1);
  const pct = (value: number) => `${Math.min(100, (value / total) * 100)}%`;
  const fitsHours = Math.min(breakdown.newTaskHours, breakdown.availableHours);
  const overHours = Math.max(0, breakdown.newTaskHours - breakdown.availableHours);

  return (
    <div className={`rounded-md border p-3 ${style.border}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">{name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${style.pill}`}>
          {style.label}
        </span>
      </div>
      <div
        className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${hoursText(used)} booked, ${hoursText(breakdown.newTaskHours)} new task, ${hoursText(breakdown.proratedWorkHours)} budget`}
      >
        <div className="bg-slate-400" style={{ width: pct(used) }} />
        <div className={style.bar} style={{ width: pct(fitsHours) }} />
        <div className="bg-red-700" style={{ width: pct(overHours) }} />
      </div>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-700">
        {hoursText(breakdown.proratedWorkHours)} budget − {hoursText(breakdown.scheduledMeetingHours)}{' '}
        meetings − {hoursText(breakdown.existingTaskHours)} tasks ={' '}
        <strong>{hoursText(breakdown.availableHours)} available</strong> vs{' '}
        <strong>{hoursText(breakdown.newTaskHours)} new task</strong> →{' '}
        {hoursText(breakdown.remainingAfterTask)} left
      </p>
      <p className="mt-1 text-xs text-slate-500">{breakdown.explanation}</p>
    </div>
  );
}
