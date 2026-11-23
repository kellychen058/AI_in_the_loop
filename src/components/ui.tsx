'use client';

import { useEffect, type ReactNode } from 'react';
import { getWorkweekMonday } from '@/lib/seed';
import type { ProposedBlock, TaskStatus, TeamMember, WorkloadStatus } from '@/lib/types';
import { XIcon } from './Icons';

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
  { label: string; bar: string; pill: string; border: string; text: string }
> = {
  ok: {
    label: 'Healthy fit',
    bar: 'bg-[#047857]',
    pill: 'bg-[#ECFDF5] text-[#047857] ring-[#A7F3D0]',
    border: 'border-[#A7F3D0]',
    text: 'text-[#047857]',
  },
  near_capacity: {
    label: 'Near capacity',
    bar: 'bg-[#B45309]',
    pill: 'bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]',
    border: 'border-[#FDE68A]',
    text: 'text-[#B45309]',
  },
  conflict: {
    label: 'Over capacity',
    bar: 'bg-[#BE123C]',
    pill: 'bg-[#FFF1F2] text-[#BE123C] ring-[#FECDD3]',
    border: 'border-[#FECDD3]',
    text: 'text-[#BE123C]',
  },
};

const STATUS_STYLES: Record<TaskStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-[#F3F2ED] text-[#57534E] border border-[#E5E2DC]' },
  pending_assignee: { label: 'Pending assignee', className: 'bg-[#EEF2FF] text-[#4338CA] border border-[#C7D2FE]' },
  counter_proposed: { label: 'Counter-proposed', className: 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]' },
  rejected: { label: 'Declined', className: 'bg-[#FFF1F2] text-[#BE123C] border border-[#FECDD3]' },
  confirmed: { label: 'Confirmed', className: 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]' },
  sync_failed: { label: 'Sync failed', className: 'bg-[#FFF1F2] text-[#BE123C] border border-[#BE123C]' },
};

export function StatusPill({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${style.className}`}>
      {style.label}
    </span>
  );
}

const BANNER_STYLES = {
  info: 'border-[#C7D2FE] bg-[#EEF2FF] text-[#312E81]',
  warning: 'border-[#FDE68A] bg-[#FFFBEB] text-[#78350F]',
  error: 'border-[#FECDD3] bg-[#FFF1F2] text-[#881337]',
  success: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#064E3B]',
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
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3.5 py-2.5 text-xs ${BANNER_STYLES[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className="break-words opacity-90">{children}</div> : null}
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-xs font-semibold opacity-70 hover:opacity-100"
            aria-label="Dismiss message"
          >
            <XIcon className="h-3.5 w-3.5" />
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#111827]/40 p-4 backdrop-blur-[1px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[#D1CCC2] bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-[#E5E2DC] pb-3">
          <h2 className="text-sm font-bold text-[#111827]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#57534E] hover:bg-[#F7F6F2] hover:text-[#111827]"
            aria-label="Close dialog"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#111827]/35 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[#D1CCC2] bg-[#F7F6F2] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E2DC] bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-[#111827]">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-[#57534E]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#57534E] hover:bg-[#F7F6F2] hover:text-[#111827]"
            aria-label="Close drawer"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-[#D1CCC2] bg-white px-3 py-1.5 text-sm text-[#111827] placeholder:text-[#78716C] focus:border-[#111827] focus:outline-none focus:ring-2 focus:ring-[#111827]/15';

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#111827] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
  emerald:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#047857] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#D1CCC2] bg-white px-3 py-1.5 text-xs font-semibold text-[#111827] shadow-sm transition-colors hover:bg-[#F7F6F2] disabled:cursor-not-allowed disabled:opacity-40',
  danger:
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] px-3 py-1.5 text-xs font-semibold text-[#BE123C] transition-colors hover:bg-[#FFE4E6] disabled:cursor-not-allowed disabled:opacity-40',
};

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
