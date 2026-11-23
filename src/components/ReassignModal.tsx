'use client';

import { useRef } from 'react';
import type { RejectionRecord, Task, TeamMember } from '@/lib/types';
import { TaskDraftCard } from './TaskDraftCard';
import { Modal } from './ui';

export function ReassignModal({
  task,
  members,
  allTasks,
  rejections,
  currentUserId,
  onClose,
  onDone,
}: {
  task: Task;
  members: TeamMember[];
  allTasks: Task[];
  rejections: RejectionRecord[];
  currentUserId: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  // TaskDraftCard reports a proposal via onProposed, then refreshes via onChanged; delete only refreshes.
  const proposedMessage = useRef<string | null>(null);

  return (
    <Modal title={`Reassign — ${task.title}`} onClose={onClose}>
      <TaskDraftCard
        task={task}
        members={members}
        allTasks={allTasks}
        rejections={rejections}
        currentUserId={currentUserId}
        onProposed={(message) => {
          proposedMessage.current = message;
        }}
        onChanged={() => onDone(proposedMessage.current ?? `Deleted "${task.title}".`)}
      />
    </Modal>
  );
}
