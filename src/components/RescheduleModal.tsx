'use client';

import { useState } from 'react';
import type { Task, TeamMember } from '@/lib/types';
import {
  apiFetch,
  Banner,
  buttonClass,
  errorText,
  fromDateInput,
  inputClass,
  memberName,
  Modal,
  Spinner,
  toDateInput,
} from './ui';
import { WorkloadMeter } from './WorkloadMeter';

export function RescheduleModal({
  task,
  members,
  currentUserId,
  onClose,
  onDone,
}: {
  task: Task;
  members: TeamMember[];
  currentUserId: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const proposal = task.currentProposal;
  const [assigneeId, setAssigneeId] = useState(proposal.assigneeId);
  const [deadlineInput, setDeadlineInput] = useState(toDateInput(proposal.deadline));
  const [hours, setHours] = useState(String(proposal.estimatedHours));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deadline = deadlineInput ? fromDateInput(deadlineInput) : '';
  const estimatedHours = Number(hours);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/reschedule`, {
      method: 'POST',
      body: {
        actorId: currentUserId,
        newAssigneeId: assigneeId,
        newDeadline: deadline,
        newEstimatedHours: estimatedHours,
        note,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result));
      return;
    }
    await onDone(
      `"${task.title}" rescheduled to v${result.data.task.currentProposal.version}; waiting for ${memberName(members, assigneeId)} to re-confirm.`,
    );
  }

  return (
    <Modal title={`Reschedule — ${task.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-600">
            Assignee
            <select className={`${inputClass} mt-1`} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === currentUserId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            New deadline (18:00)
            <input
              type="date"
              className={`${inputClass} mt-1`}
              value={deadlineInput}
              onChange={(e) => setDeadlineInput(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Estimated hours
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={`${inputClass} mt-1`}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Reason
          <textarea className={`${inputClass} mt-1`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <WorkloadMeter
          members={members}
          assigneeId={assigneeId}
          deadline={deadline}
          estimatedHours={estimatedHours}
          excludeTaskId={task.id}
          taskId={task.id}
        />
        <Banner tone="info">
          Calendar will only update after the assignee confirms the new version. Existing work blocks
          stay as they are until then.
        </Banner>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass.primary}
            onClick={submit}
            disabled={busy || !deadline || !(estimatedHours > 0)}
          >
            {busy ? <Spinner /> : null} Submit v{proposal.version + 1} for re-confirmation
          </button>
        </div>
      </div>
    </Modal>
  );
}
