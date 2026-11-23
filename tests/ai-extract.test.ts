import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDatabase, WorkloadBreakdown, WorkloadStatus } from '@/lib/types';

const testState = vi.hoisted(() => ({
  dbPath: '',
  workloads: {} as Record<string, { availableHours: number; status: WorkloadStatus }>,
}));

vi.mock('@/lib/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store')>();
  return {
    ...actual,
    readDb: (dbPath?: string) => actual.readDb(dbPath ?? testState.dbPath),
    updateDb: (updater: Parameters<typeof actual.updateDb>[0], dbPath?: string) =>
      actual.updateDb(updater, dbPath ?? testState.dbPath),
  };
});

// Workload math is owned by #8; pin it here so suggestion tests only exercise #9's ranking rules.
vi.mock('@/lib/workload', () => ({
  checkAllMembersWorkload: (params: { db: AppDatabase; deadline: string; newTaskHours: number }) =>
    params.db.members.map((member): WorkloadBreakdown => {
      const { availableHours, status } = testState.workloads[member.id] ?? {
        availableHours: 20,
        status: 'ok',
      };
      const remainingAfterTask = availableHours - params.newTaskHours;
      return {
        memberId: member.id,
        windowStart: '2026-11-23T01:00:00.000Z',
        windowEnd: params.deadline,
        workdaysInWindow: 5,
        proratedWorkHours: member.weeklyHours,
        scheduledMeetingHours: 0,
        existingTaskHours: 0,
        availableHours,
        newTaskHours: params.newTaskHours,
        remainingAfterTask,
        remainingRatio: availableHours > 0 ? remainingAfterTask / availableHours : -1,
        status,
        explanation: 'test workload',
      };
    }),
}));

import { POST as extractRoute } from '@/app/api/meetings/extract/route';
import { callStructuredLLM } from '@/lib/ai/client';
import {
  EMPTY_INPUT_MESSAGE,
  extractTasksFromNotes,
  NO_ACTIONABLE_TASKS_WARNING,
  suggestTaskAssignment,
  TRUNCATION_WARNING,
} from '@/lib/ai/extract';
import { createSeedDatabase, EDGE_CASE_PRESETS, SAMPLE_MEETING_NOTES } from '@/lib/seed';
import { readDb } from '@/lib/store';

const NOW = '2026-11-23T10:00:00'; // Monday, local time
const fetchMock = vi.fn<typeof fetch>();

function useProvider(provider: 'openai' | 'gemini' | 'anthropic') {
  vi.stubEnv('LLM_PROVIDER', provider);
  vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'sk-test-secret');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openAiReply(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  for (const name of ['LLM_PROVIDER', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) {
    vi.stubEnv(name, '');
  }
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('network disabled in tests'));
  vi.stubGlobal('fetch', fetchMock);
  testState.workloads = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('extraction guardrails', () => {
  it.each([
    ['empty', EDGE_CASE_PRESETS.empty.rawNotes, EMPTY_INPUT_MESSAGE],
    ['gibberish', EDGE_CASE_PRESETS.gibberish.rawNotes, NO_ACTIONABLE_TASKS_WARNING],
    ['too short', 'ok thanks', NO_ACTIONABLE_TASKS_WARNING],
  ])(
    'returns no tasks for %s input without calling the configured LLM',
    async (_label, rawNotes, warning) => {
      useProvider('openai');
      const result = await extractTasksFromNotes({ rawNotes, now: NOW });

      expect(result.tasks).toEqual([]);
      expect(result.aiWarning).toBe(warning);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('returns no tasks for an off-topic recipe from both the heuristic and the LLM', async () => {
    const recipe = EDGE_CASE_PRESETS.offTopic.rawNotes;

    const heuristic = await extractTasksFromNotes({ rawNotes: recipe, now: NOW });
    expect(heuristic.tasks).toEqual([]);
    expect(heuristic.usedFallbackAi).toBe(true);
    expect(heuristic.aiWarning).toContain(NO_ACTIONABLE_TASKS_WARNING);

    useProvider('openai');
    fetchMock.mockResolvedValue(
      openAiReply('{"tasks": [], "note": "No actionable project tasks found"}'),
    );
    const llm = await extractTasksFromNotes({ rawNotes: recipe, now: NOW });
    expect(llm.tasks).toEqual([]);
    expect(llm.usedFallbackAi).toBe(false);
    expect(llm.aiWarning).toBe(NO_ACTIONABLE_TASKS_WARNING);
  });

  it('truncates input over 15,000 chars and drops action items past the cut', async () => {
    const result = await extractTasksFromNotes({
      rawNotes: EDGE_CASE_PRESETS.veryLong.rawNotes,
      now: NOW,
    });

    expect(result.aiWarning).toContain(TRUNCATION_WARNING);
    expect(result.tasks.map((task) => task.title)).toEqual([
      'Audit checkout API error codes and add structured logging',
    ]);
    expect(result.tasks[0]).toMatchObject({ estimatedHours: 4, suggestedRole: 'engineer' });
  });
});

describe('deterministic fallback extraction (no API keys)', () => {
  it('extracts bilingual Chinese/English sample notes with verbatim quotes, hours, roles and deadlines', async () => {
    const result = await extractTasksFromNotes({ rawNotes: SAMPLE_MEETING_NOTES, now: NOW });

    expect(result).toMatchObject({ usedFallbackAi: true, provider: 'mock' });
    expect(result.aiWarning).toMatch(/LLM_PROVIDER=mock/);
    expect(result.tasks.map((t) => [t.title, t.estimatedHours, t.suggestedRole])).toEqual([
      ['Payment API Integration', 10, 'engineer'],
      ['Redesign Checkout Error & Empty States', 6, 'designer'],
      ['Write Release QA Smoke Test Checklist', 4, 'pm'],
    ]);
    expect(result.tasks.map((t) => new Date(t.suggestedDeadline!).getDay())).toEqual([5, 4, 5]);
    for (const task of result.tasks) {
      expect(SAMPLE_MEETING_NOTES).toContain(task.sourceQuote);
      expect(task.aiGenerated).toBe(true);
      expect(task.aiConfidence).toBe('medium');
    }
  });

  it('extracts English bullets, Chinese-only items and prose commitments, skipping chatter', async () => {
    const notes = [
      'Weekly sync',
      '- Implement login rate limiting (6 hours) by Friday',
      '* Review PR for search page',
      '2. 設計新版登入頁面，預估 4 小時，下週三前',
      'Carol will fix the flaky checkout test before Thursday.',
      'We talked about the offsite lunch.',
    ].join('\n');

    const result = await extractTasksFromNotes({ rawNotes: notes, now: NOW });

    expect(result.tasks.map((t) => [t.title, t.estimatedHours, t.aiConfidence])).toEqual([
      ['Implement login rate limiting', 6, 'medium'],
      ['Review PR for search page', 4, 'low'],
      ['設計新版登入頁面', 4, 'medium'],
      ['Carol will fix the flaky checkout test before Thursday', 4, 'low'],
    ]);
    const nextWednesday = new Date(result.tasks[2].suggestedDeadline!);
    expect([nextWednesday.getDay(), nextWednesday.getDate(), nextWednesday.getHours()]).toEqual([
      3, 2, 18,
    ]);
    for (const task of result.tasks) expect(notes).toContain(task.sourceQuote);
  });
});

describe('live LLM providers', () => {
  const llmTasks = {
    tasks: [
      {
        title: 'Payment API Integration',
        description: 'Integrate payment API and verify webhooks.',
        sourceQuote: 'Payment API Integration (串接金流 API 與 webhook 驗證)',
        estimatedHours: 10,
        suggestedRole: 'engineer',
        suggestedDeadline: '2026-11-27T10:00:00.000Z',
        aiConfidence: 'high',
        aiReasoning: 'Explicit 10h estimate and engineer request.',
      },
      {
        title: 'Hallucinated task',
        description: 'Not in the notes.',
        sourceQuote: 'Bob will rebuild the marketing site',
        estimatedHours: 3,
        aiConfidence: 'high',
        aiReasoning: 'Made up.',
      },
    ],
  };
  const llmJson = JSON.stringify(llmTasks);

  it.each([
    {
      provider: 'openai' as const,
      url: 'https://api.openai.com/v1/chat/completions',
      header: ['Authorization', 'Bearer sk-test-secret'],
      model: 'gpt-4o-mini',
      reply: openAiReply(llmJson),
    },
    {
      provider: 'gemini' as const,
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      header: ['x-goog-api-key', 'sk-test-secret'],
      model: undefined,
      reply: jsonResponse({ candidates: [{ content: { parts: [{ text: llmJson }] } }] }),
    },
    {
      provider: 'anthropic' as const,
      url: 'https://api.anthropic.com/v1/messages',
      header: ['x-api-key', 'sk-test-secret'],
      model: 'claude-haiku-5-5',
      reply: jsonResponse({ content: [{ type: 'text', text: `\`\`\`json\n${llmJson}\n\`\`\`` }] }),
    },
  ])(
    '$provider: sends the request and keeps only tasks quoted verbatim',
    async ({ provider, url, header, model, reply }) => {
      useProvider(provider);
      fetchMock.mockResolvedValue(reply);

      const result = await extractTasksFromNotes({ rawNotes: SAMPLE_MEETING_NOTES, now: NOW });

      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(url);
      expect((init?.headers as Record<string, string>)[header[0]]).toBe(header[1]);
      const body = JSON.parse(String(init?.body));
      if (model) expect(body.model).toBe(model);
      expect(JSON.stringify(body)).toContain('<meeting_notes>');

      expect(result).toMatchObject({ usedFallbackAi: false, provider });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]).toMatchObject({
        title: 'Payment API Integration',
        aiConfidence: 'high',
        suggestedDeadline: '2026-11-27T10:00:00.000Z',
      });
      expect(result.aiWarning).toMatch(/1 AI-extracted task\(s\) were dropped/);
    },
  );

  it('falls back to the heuristic when the LLM returns malformed JSON', async () => {
    useProvider('openai');
    fetchMock.mockResolvedValue(openAiReply('Sure! Here are the tasks: [{"title": "Payment'));

    const result = await extractTasksFromNotes({ rawNotes: SAMPLE_MEETING_NOTES, now: NOW });

    expect(result.usedFallbackAi).toBe(true);
    expect(result.provider).toBe('openai');
    expect(result.aiWarning).toMatch(/invalid JSON/);
    expect(result.tasks).toHaveLength(3);
  });

  it.each([
    [
      'HTTP error',
      () => fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500)),
      /HTTP 500/,
    ],
    [
      'network error',
      () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
      /unreachable/,
    ],
    [
      'timeout',
      () =>
        fetchMock.mockImplementation(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      /timed out after 20ms/,
    ],
  ])('falls back on %s without leaking the API key', async (_label, arrange, expected) => {
    useProvider('anthropic');
    arrange();

    const result = await callStructuredLLM({
      systemPrompt: 'sys',
      userPrompt: 'user',
      parse: () => 'llm',
      fallback: () => 'fallback',
      timeoutMs: 20,
    });

    expect(result).toMatchObject({ data: 'fallback', usedFallback: true, provider: 'anthropic' });
    expect(result.warning).toMatch(expected);
    expect(result.warning).not.toContain('sk-test-secret');
  });
});

describe('rejection-aware assignment suggester', () => {
  const db = createSeedDatabase(new Date(NOW));
  const fridayEnd = db.rejections[0].rejectedDeadline;
  const nextFriday = new Date(Date.parse(fridayEnd) + 7 * 24 * 60 * 60 * 1000).toISOString();

  it.each([
    {
      label: 'skips Carol after her matching rejection even though she has the most room',
      title: 'Payment API Integration',
      deadline: fridayEnd,
      workloads: {
        carol: { availableHours: 20, status: 'ok' as const },
        david: { availableHours: 15, status: 'ok' as const },
      },
      expected: 'david',
      avoided: ['rej-seed-payment-api'],
      reasoning: /Avoided Carol Wu: previously declined "Payment API Integration"/,
    },
    {
      label: 'suggests Carol again once the deadline moved materially later and she has room',
      title: 'Payment API Integration',
      deadline: nextFriday,
      workloads: {
        carol: { availableHours: 20, status: 'ok' as const },
        david: { availableHours: 15, status: 'ok' as const },
      },
      expected: 'carol',
      avoided: [],
      reasoning: /Suggested Carol Wu/,
    },
    {
      label: 'skips an overloaded engineer on an unrelated task',
      title: 'Webhook retry monitoring',
      deadline: fridayEnd,
      workloads: {
        carol: { availableHours: 6, status: 'conflict' as const },
        david: { availableHours: 15, status: 'ok' as const },
      },
      expected: 'david',
      avoided: [],
      reasoning: /Avoided Carol Wu \(6\.0h available\): over capacity/,
    },
  ])('$label', async ({ title, deadline, workloads, expected, avoided, reasoning }) => {
    testState.workloads = workloads;

    const suggestion = await suggestTaskAssignment({ db, title, estimatedHours: 10, deadline });

    expect(suggestion.suggestedAssigneeId).toBe(expected);
    expect(suggestion.avoidedRejections.map((r) => r.id)).toEqual(avoided);
    expect(suggestion.aiReasoning).toMatch(reasoning);
    expect(suggestion.usedFallbackAi).toBe(true);
  });

  it.each([
    { pick: 'carol', expected: 'david', usedFallbackAi: true, warning: /already declined/ },
    { pick: 'david', expected: 'david', usedFallbackAi: false, warning: undefined },
  ])(
    'LLM pick $pick is checked against the rejection guard',
    async ({ pick, expected, usedFallbackAi, warning }) => {
      useProvider('openai');
      testState.workloads = {
        carol: { availableHours: 20, status: 'ok' },
        david: { availableHours: 15, status: 'ok' },
      };
      fetchMock.mockResolvedValue(
        openAiReply(
          JSON.stringify({
            suggestedAssigneeId: pick,
            suggestedDeadline: fridayEnd,
            aiReasoning: 'LLM says so.',
          }),
        ),
      );

      const suggestion = await suggestTaskAssignment({
        db,
        title: 'Payment API Integration',
        estimatedHours: 10,
        deadline: fridayEnd,
      });

      expect(suggestion).toMatchObject({ suggestedAssigneeId: expected, usedFallbackAi });
      expect(suggestion.avoidedRejections.map((r) => r.rejectedAssigneeId)).toEqual(['carol']);
      if (warning) expect(suggestion.warning).toMatch(warning);
      else expect(suggestion.warning).toBeUndefined();
    },
  );
});

describe('POST /api/meetings/extract', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-extract-route-'));
    testState.dbPath = path.join(tempDir, 'db.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function post(body: unknown): Request {
    return new Request('http://localhost/api/meetings/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects whitespace-only notes with 400 EMPTY_INPUT', async () => {
    const response = await extractRoute(post({ rawNotes: '  \n\t ', actorId: 'alice' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'EMPTY_INPUT', message: EMPTY_INPUT_MESSAGE });
  });

  it('persists the meeting, unassigned draft tasks and a meeting_ingested audit entry', async () => {
    const response = await extractRoute(
      post({ title: 'Sprint 12', rawNotes: SAMPLE_MEETING_NOTES, actorId: 'alice' }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.usedFallbackAi).toBe(true);
    expect(payload.tasks).toHaveLength(3);

    const db = await readDb();
    const meeting = db.meetings.find((m) => m.id === payload.meeting.id);
    expect(meeting).toMatchObject({ title: 'Sprint 12', createdBy: 'alice', usedFallbackAi: true });
    const drafts = db.tasks.filter((t) => t.meetingId === payload.meeting.id);
    expect(
      drafts.map((t) => [t.status, t.currentProposal.assigneeId, t.currentProposal.estimatedHours]),
    ).toEqual([
      ['draft', '', 10],
      ['draft', '', 6],
      ['draft', '', 4],
    ]);
    const audit = db.auditLog.at(-1);
    expect(audit).toMatchObject({ action: 'meeting_ingested', actorId: 'alice' });
    expect(audit?.metadata?.taskIds).toEqual(drafts.map((t) => t.id));
  });
});
