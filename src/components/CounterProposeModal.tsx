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
  Modal,
  Spinner,
  toDateInput,
} from './ui';
import { WorkloadMeter } from './WorkloadMeter';

export function CounterProposeModal({
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
    const result = await apiFetch<{ task: Task }>(`/api/tasks/${encodeURIComponent(task.id)}/respond`, {
      method: 'POST',
      body: {
        actorId: currentUserId,
        expectedVersion: proposal.version,
        action: 'counter',
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
    await onDone(`Counter-proposal v${result.data.task.currentProposal.version} sent for "${task.title}".`);
  }

  return (
    <Modal title={`Propose new deadline / hours — ${task.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
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
          Explanation
          <textarea
            className={`${inputClass} mt-1`}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. I can do it if it moves to next Tuesday."
          />
        </label>
        <WorkloadMeter
          members={members}
          assigneeId={proposal.assigneeId}
          deadline={deadline}
          estimatedHours={estimatedHours}
          excludeTaskId={task.id}
        />
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
            {busy ? <Spinner /> : null} Send Counter-proposal (v{proposal.version + 1})
          </button>
        </div>
      </div>
    </Modal>
  );
}
