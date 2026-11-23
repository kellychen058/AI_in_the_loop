'use client';

import type { ReactNode } from 'react';
import { getWorkweekMonday } from '@/lib/seed';
import type { ProposedBlock, TaskStatus, TeamMember, WorkloadStatus } from '@/lib/types';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { code?: string; message?: string; error?: string };
}

export async function apiFetch<T = Record<string, unknown>>(
  url: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
    signal: init?.signal,
  });
  const data = (await response.json().catch(() => ({}))) as ApiResult<T>['data'];
  return { ok: response.ok, status: response.status, data };
}

export function errorText(result: ApiResult<unknown>): string {
  return result.data.message ?? result.data.error ?? `Request failed (${result.status})`;
}

export function memberName(members: TeamMember[], id: string | undefined): string {
  if (!id) return 'Unassigned';
  return members.find((member) => member.id === id)?.name ?? id;
}

export function firstName(members: TeamMember[], id: string | undefined): string {
  return memberName(members, id).split(' ')[0];
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-US', DATE_TIME);
}

function hhmm(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatBlock(block: ProposedBlock): string {
  const start = new Date(block.start);
  const weekday = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${weekday} ${hhmm(start)}–${hhmm(new Date(block.end))}`;
}

/** yyyy-mm-dd in local time, for <input type="date">. */
export function toDateInput(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Deadlines picked by date mean end of that workday (18:00 local). */
export function fromDateInput(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(year, month - 1, day, 18, 0, 0, 0).toISOString();
}

export function defaultDeadline(now: Date = new Date()): string {
  const friday = getWorkweekMonday(now);
  friday.setDate(friday.getDate() + 4);
  friday.setHours(18, 0, 0, 0);
  if (friday.getTime() < now.getTime()) friday.setDate(friday.getDate() + 7);
  return friday.toISOString();
}

export function hoursText(value: number): string {
  return `${(Math.round(value * 10) / 10).toFixed(1)}h`;
}

export const WORKLOAD_STYLES: Record<
  WorkloadStatus,
  { label: string; bar: string; pill: string; border: string }
> = {
  ok: {
    label: 'OK',
    bar: 'bg-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    border: 'border-emerald-200',
  },
  near_capacity: {
    label: 'Near capacity',
    bar: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-800 ring-amber-200',
    border: 'border-amber-200',
  },
  conflict: {
    label: 'Conflict',
    bar: 'bg-red-500',
    pill: 'bg-red-50 text-red-700 ring-red-200',
    border: 'border-red-200',
  },
};

const STATUS_STYLES: Record<TaskStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-700' },
  pending_assignee: { label: 'Pending assignee', className: 'bg-sky-50 text-sky-700' },
  counter_proposed: { label: 'Counter-proposed', className: 'bg-violet-50 text-violet-700' },
  rejected: { label: 'Declined', className: 'bg-rose-50 text-rose-700' },
  confirmed: { label: 'Confirmed', className: 'bg-emerald-50 text-emerald-700' },
  sync_failed: { label: 'Sync failed', className: 'bg-red-100 text-red-800' },
};

export function StatusPill({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
      {style.label}
    </span>
  );
}

const BANNER_STYLES = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const;

export function Banner({
  tone,
  title,
  children,
  onDismiss,
}: {
  tone: keyof typeof BANNER_STYLES;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${BANNER_STYLES[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className="break-words">{children}</div> : null}
        </div>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="text-xs font-medium opacity-70 hover:opacity-100">
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30';

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50',
};

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
