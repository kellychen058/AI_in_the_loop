'use client';

import { getAssignerId } from '@/lib/taskRoles';
import type { Task, TeamMember } from '@/lib/types';
import { CheckIcon, LockClosedIcon, LockOpenIcon } from './Icons';
import { formatDateTime, hoursText, memberName } from './ui';

export function HandshakeStrip({
  task,
  members,
  draftAssigneeId,
}: {
  task: Task;
  members: TeamMember[];
  draftAssigneeId?: string;
}) {
  const proposal = task.currentProposal;
  const assignerId = getAssignerId(task);
  const assigneeId = draftAssigneeId ?? proposal.assigneeId;

  const isConfirmed = task.status === 'confirmed';
  const isSyncFailed = task.status === 'sync_failed';
  const isDraft = task.status === 'draft';
  const isRejected = task.status === 'rejected';

  const assignerSigned =
    isConfirmed ||
    isSyncFailed ||
    (task.status === 'pending_assignee' && proposal.proposedBy === assignerId);
  const assigneeSigned =
    isConfirmed ||
    isSyncFailed ||
    (task.status === 'counter_proposed' && proposal.proposedBy === assigneeId);

  const prev =
    task.proposalHistory.length >= 2
      ? task.proposalHistory[task.proposalHistory.length - 2]
      : undefined;
  const hasDiff =
    prev !== undefined &&
    (prev.deadline !== proposal.deadline ||
      prev.estimatedHours !== proposal.estimatedHours ||
      prev.assigneeId !== proposal.assigneeId);

  const liveBookedCount = task.calendarEventIds.length;
  const hasLivePrevBooking =
    !isConfirmed && task.confirmedVersion !== undefined && liveBookedCount > 0;

  return (
    <div className="space-y-2.5">
      {hasDiff && prev ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-[#57534E]">
            Changes v{prev.version} to v{proposal.version}:
          </span>
          {prev.estimatedHours !== proposal.estimatedHours ? (
            <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono font-semibold text-[#B45309] tabular-nums">
              {hoursText(prev.estimatedHours)} to {hoursText(proposal.estimatedHours)}
            </span>
          ) : null}
          {prev.deadline !== proposal.deadline ? (
            <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono font-semibold text-[#B45309] tabular-nums">
              {formatDateTime(prev.deadline)} to {formatDateTime(proposal.deadline)}
            </span>
          ) : null}
          {prev.assigneeId !== proposal.assigneeId ? (
            <span className="rounded border border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 font-mono font-semibold text-[#B45309]">
              {memberName(members, prev.assigneeId)} to {memberName(members, proposal.assigneeId)}
            </span>
          ) : null}
        </div>
      ) : null}

      {hasLivePrevBooking ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#5EEAD4] bg-[#F0FDFA] px-2.5 py-1.5 text-[11px] font-medium text-[#111827]">
          <span>
            <strong>Booked v{task.confirmedVersion} stays live on calendar</strong> ({liveBookedCount}{' '}
            block{liveBookedCount === 1 ? '' : 's'}) until replacement v{proposal.version} is
            mutually confirmed and synced.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 items-center gap-2 rounded-lg border border-[#E5E2DC] bg-[#F7F6F2] p-2.5 sm:grid-cols-[1fr_auto_1fr]">
        {/* Assigner Signature Slot */}
        <div
          className={`rounded-md border px-3 py-2 ${
            assignerSigned
              ? 'border-[#A7F3D0] bg-[#ECFDF5]'
              : 'border-[#E5E2DC] bg-white'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#78716C]">
            Assigner (PM)
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-bold text-[#111827]">
              {memberName(members, assignerId)}
            </span>
            {assignerSigned ? (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#047857]">
                <CheckIcon className="h-3 w-3" />
                Signed
              </span>
            ) : (
              <span className="font-mono text-[10px] font-semibold text-[#78716C]">
                {isDraft ? 'Drafting' : 'Awaiting'}
              </span>
            )}
          </div>
        </div>

        {/* Center Calendar Lock Gate */}
        <div
          className={`flex min-w-[126px] flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 text-center transition-colors ${
            isConfirmed
              ? 'border-[#047857] bg-[#ECFDF5] text-[#047857]'
              : isSyncFailed
                ? 'border-[#BE123C] bg-[#FFF1F2] text-[#BE123C]'
                : 'border-[#D1CCC2] bg-white text-[#111827]'
          }`}
        >
          {isConfirmed ? (
            <LockOpenIcon className="h-4 w-4" />
          ) : (
            <LockClosedIcon className="h-4 w-4" />
          )}
          <span className="font-mono text-[10px] font-bold tracking-tight tabular-nums">
            {isConfirmed
              ? `UNLOCKED · ${liveBookedCount} blk${liveBookedCount === 1 ? '' : 's'}`
              : isSyncFailed
                ? 'AGREED · SYNC FAILED'
                : isRejected
                  ? 'LOCKED · DECLINED'
                  : `LOCKED · v${proposal.version}`}
          </span>
        </div>

        {/* Assignee Signature Slot */}
        <div
          className={`rounded-md border px-3 py-2 ${
            assigneeSigned
              ? 'border-[#A7F3D0] bg-[#ECFDF5]'
              : isRejected
                ? 'border-[#FECDD3] bg-[#FFF1F2]'
                : 'border-[#E5E2DC] bg-white'
          }`}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#78716C]">
            Assignee
          </p>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-bold text-[#111827]">
              {assigneeId ? memberName(members, assigneeId) : 'Pick assignee'}
            </span>
            {assigneeSigned ? (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#047857]">
                <CheckIcon className="h-3 w-3" />
                Signed
              </span>
            ) : isRejected ? (
              <span className="font-mono text-[10px] font-bold text-[#BE123C]">Declined</span>
            ) : (
              <span className="font-mono text-[10px] font-semibold text-[#78716C]">Awaiting</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
