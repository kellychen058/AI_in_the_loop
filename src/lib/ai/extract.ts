import type { AppDatabase, AssignmentSuggestion, ExtractionResult } from '@/lib/types';

// Wave 0 compiling stub — full multi-provider LLM client & extractor owned by Issue #9.

export async function extractTasksFromNotes(_params: {
  title?: string;
  rawNotes: string;
  actorId?: string;
}): Promise<ExtractionResult> {
  return {
    tasks: [],
    usedFallbackAi: true,
    aiWarning: 'Stub extractor active — full AI extraction is implemented in Issue #9.',
    provider: 'mock',
  };
}

export async function suggestTaskAssignment(params: {
  db: AppDatabase;
  taskId?: string;
  title: string;
  description?: string;
  estimatedHours: number;
  deadline: string;
  now?: string;
}): Promise<AssignmentSuggestion> {
  const defaultMember = params.db.members[0];
  return {
    suggestedAssigneeId: defaultMember?.id ?? 'david',
    suggestedDeadline: params.deadline,
    aiReasoning: 'Stub assignment suggester — full workload & rejection-aware logic in Issue #9.',
    avoidedRejections: [],
    usedFallbackAi: true,
    warning: 'Stub suggester active.',
  };
}
