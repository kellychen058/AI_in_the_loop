import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtures from './fixtures/prompt-cases.json';
import { extractTasksFromNotes, suggestTaskAssignment } from '@/lib/ai/extract';
import {
  createSeedDatabase,
  EDGE_CASE_PRESETS,
  getWorkweekMonday,
  SAMPLE_MEETING_NOTES,
} from '@/lib/seed';
import type { ExtractionResult } from '@/lib/types';

interface ExtractExpect {
  taskCount?: number;
  titles?: string[];
  hours?: number[];
  roles?: (string | null)[];
  confidence?: string[];
  deadlineDayOffsets?: (number | null)[];
  warningIncludes?: string[];
  forbiddenSubstrings?: string[];
}

interface SuggestExpect {
  assigneeId?: string;
  notAssigneeIds?: string[];
  avoidedRejectionIds?: string[];
  reasoningIncludes?: string[];
}

interface PromptCase {
  id: string;
  category: 'typical' | 'edge' | 'adversarial';
  kind: 'extract' | 'suggest';
  description: string;
  input: {
    title?: string;
    rawNotes?: string;
    rawNotesFrom?: string;
    mockLlmReply?: unknown;
    estimatedHours?: number;
    deadlineDayOffset?: number;
    clearTasksFor?: string[];
  };
  expect: ExtractExpect & SuggestExpect;
}

const NOW = fixtures.now;
const CASES = fixtures.cases as PromptCase[];
const LIVE = process.env.RUN_LIVE_LLM_TESTS === '1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MONDAY = getWorkweekMonday(new Date(NOW));

const NOTE_SOURCES: Record<string, string> = {
  SAMPLE_MEETING_NOTES,
  'EDGE_CASE_PRESETS.empty': EDGE_CASE_PRESETS.empty.rawNotes,
  'EDGE_CASE_PRESETS.offTopic': EDGE_CASE_PRESETS.offTopic.rawNotes,
  'EDGE_CASE_PRESETS.gibberish': EDGE_CASE_PRESETS.gibberish.rawNotes,
  'EDGE_CASE_PRESETS.veryLong': EDGE_CASE_PRESETS.veryLong.rawNotes,
};

function notesFor(testCase: PromptCase): string {
  const { rawNotes, rawNotesFrom } = testCase.input;
  if (rawNotesFrom) {
    const notes = NOTE_SOURCES[rawNotesFrom];
    if (notes === undefined) throw new Error(`Unknown rawNotesFrom "${rawNotesFrom}"`);
    return notes;
  }
  return rawNotes ?? '';
}

function dayOffset(iso: string | undefined): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - MONDAY.getTime()) / DAY_MS);
}

function deadlineAt(offset: number): string {
  const date = new Date(MONDAY.getTime());
  date.setDate(date.getDate() + offset);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}

function assertInvariants(result: ExtractionResult, notes: string, expected: ExtractExpect) {
  for (const task of result.tasks) {
    expect(notes).toContain(task.sourceQuote);
    expect(task.aiGenerated).toBe(true);
  }
  if (expected.taskCount === 0) expect(result.tasks).toEqual([]);
  for (const forbidden of expected.forbiddenSubstrings ?? []) {
    for (const task of result.tasks) {
      expect(`${task.title} ${task.sourceQuote}`.toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      );
    }
  }
}

async function runSuggest(testCase: PromptCase) {
  const db = createSeedDatabase(new Date(NOW));
  const cleared = new Set(testCase.input.clearTasksFor ?? []);
  db.tasks = db.tasks.filter((task) => !cleared.has(task.currentProposal.assigneeId));
  return suggestTaskAssignment({
    db,
    title: testCase.input.title ?? '',
    estimatedHours: testCase.input.estimatedHours ?? 4,
    deadline: deadlineAt(testCase.input.deadlineDayOffset ?? 4),
    now: new Date(NOW).toISOString(),
  });
}

it('covers at least 12 prompt cases across typical, edge and adversarial inputs', () => {
  expect(CASES.length).toBeGreaterThanOrEqual(12);
  expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  expect(new Set(CASES.map((c) => c.category))).toEqual(
    new Set(['typical', 'edge', 'adversarial']),
  );
});

describe.skipIf(LIVE)('CP2 prompt suite (deterministic, no API keys)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    for (const name of ['LLM_PROVIDER', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) {
      vi.stubEnv(name, '');
    }
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('network disabled in tests'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(CASES.filter((c) => c.kind === 'extract').map((c) => [c.id, c] as const))(
    'extract: %s',
    async (_id, testCase) => {
      if (testCase.input.mockLlmReply) {
        vi.stubEnv('LLM_PROVIDER', 'openai');
        vi.stubEnv('OPENAI_API_KEY', 'sk-test-secret');
        const content = JSON.stringify(testCase.input.mockLlmReply);
        fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content } }] }));
      }
      const notes = notesFor(testCase);
      const expected = testCase.expect;

      const result = await extractTasksFromNotes({
        title: testCase.input.title,
        rawNotes: notes,
        now: NOW,
      });

      assertInvariants(result, notes, expected);
      const count = expected.taskCount ?? expected.titles?.length;
      if (count !== undefined) expect(result.tasks).toHaveLength(count);
      if (expected.titles) expect(result.tasks.map((t) => t.title)).toEqual(expected.titles);
      if (expected.hours) expect(result.tasks.map((t) => t.estimatedHours)).toEqual(expected.hours);
      if (expected.roles) {
        expect(result.tasks.map((t) => t.suggestedRole ?? null)).toEqual(expected.roles);
      }
      if (expected.confidence) {
        expect(result.tasks.map((t) => t.aiConfidence)).toEqual(expected.confidence);
      }
      if (expected.deadlineDayOffsets) {
        expect(result.tasks.map((t) => dayOffset(t.suggestedDeadline))).toEqual(
          expected.deadlineDayOffsets,
        );
      }
      for (const fragment of expected.warningIncludes ?? []) {
        expect(result.aiWarning).toContain(fragment);
      }
    },
  );

  it.each(CASES.filter((c) => c.kind === 'suggest').map((c) => [c.id, c] as const))(
    'suggest: %s',
    async (_id, testCase) => {
      const expected = testCase.expect;
      const suggestion = await runSuggest(testCase);

      if (expected.assigneeId) expect(suggestion.suggestedAssigneeId).toBe(expected.assigneeId);
      expect(expected.notAssigneeIds ?? []).not.toContain(suggestion.suggestedAssigneeId);
      if (expected.avoidedRejectionIds) {
        expect(suggestion.avoidedRejections.map((r) => r.id)).toEqual(
          expected.avoidedRejectionIds,
        );
      }
      for (const fragment of expected.reasoningIncludes ?? []) {
        expect(suggestion.aiReasoning).toContain(fragment);
      }
    },
  );
});

// Opt-in: a human runs `RUN_LIVE_LLM_TESTS=1 npm test` with their own key in .env.local / shell.
describe.runIf(LIVE)('CP2 prompt suite (live LLM)', () => {
  const liveCases = CASES.filter((c) => !c.input.mockLlmReply);

  it.each(liveCases.map((c) => [c.id, c] as const))(
    'live: %s',
    async (_id, testCase) => {
      if (testCase.kind === 'suggest') {
        const suggestion = await runSuggest(testCase);
        expect(testCase.expect.notAssigneeIds ?? []).not.toContain(
          suggestion.suggestedAssigneeId,
        );
        return;
      }
      const notes = notesFor(testCase);
      const result = await extractTasksFromNotes({ title: testCase.input.title, rawNotes: notes });
      assertInvariants(result, notes, testCase.expect);
      if ((testCase.expect.taskCount ?? testCase.expect.titles?.length ?? 1) > 0) {
        expect(result.tasks.length).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});
