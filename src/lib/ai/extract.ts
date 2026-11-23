import { callStructuredLLM, parseJsonObject } from '@/lib/ai/client';
import {
  buildExtractionUserPrompt,
  buildSuggestionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  SUGGESTION_SYSTEM_PROMPT,
} from '@/lib/ai/prompts';
import { getWorkweekMonday } from '@/lib/seed';
import type {
  AIConfidence,
  AppDatabase,
  AssignmentSuggestion,
  ExtractionResult,
  RejectionRecord,
  Role,
  TaskDraft,
  TeamMember,
  WorkloadBreakdown,
  WorkloadStatus,
} from '@/lib/types';
import { checkAllMembersWorkload } from '@/lib/workload';

export const MAX_NOTES_CHARS = 15_000;
export const MIN_NOTES_CHARS = 15;
export const DEFAULT_ESTIMATE_HOURS = 4;

export const EMPTY_INPUT_MESSAGE = 'Please paste meeting notes before extracting tasks.';
export const NO_ACTIONABLE_TASKS_WARNING =
  'No actionable tasks detected. Try pasting notes with action items, or add a task manually.';
export const TRUNCATION_WARNING =
  'Input exceeded 15,000 characters and was truncated. Review extracted tasks for missing items from the end.';
export const NO_CAPACITY_WARNING =
  'No team member can fit this task before the deadline without a conflict or a repeated rejection; consider extending the deadline or splitting the task.';

export type PreparedNotes =
  { kind: 'empty' } | { kind: 'no_signal' } | { kind: 'ok'; notes: string; truncated: boolean };

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/g;

function looksLikeGibberish(text: string): boolean {
  if (text.length < MIN_NOTES_CHARS) return true;
  if ((text.match(CJK_CHAR) ?? []).length >= 4) return false;
  // Keyboard mashes ("asdfghjkl") have long consonant runs; real words rarely do.
  const words = text.toLowerCase().match(/[a-z]{2,}/g) ?? [];
  const wordLike = words.filter((word) => /[aeiouy]/.test(word) && !/[^aeiouy]{5,}/.test(word));
  return wordLike.length < 3;
}

export function prepareMeetingNotes(rawNotes: string): PreparedNotes {
  const trimmed = rawNotes.trim();
  if (!trimmed) return { kind: 'empty' };
  if (looksLikeGibberish(trimmed)) return { kind: 'no_signal' };
  if (trimmed.length <= MAX_NOTES_CHARS) return { kind: 'ok', notes: trimmed, truncated: false };

  let notes = trimmed.slice(0, MAX_NOTES_CHARS);
  // Don't leave half of a surrogate pair (emoji) at the cut point.
  if (/[\ud800-\udbff]$/.test(notes)) notes = notes.slice(0, -1);
  return { kind: 'ok', notes, truncated: true };
}

const EN_VERB_PATTERN =
  'implement|design|redesign|fix|review|prepare|write|build|create|update|integrate|deploy|refactor|draft|audit|document|investigate|research|migrate|finish|complete|deliver|ship|test|set\\s+up|follow\\s+up|send|schedule|plan|define|analyze|optimize|configure|clean\\s+up|verify';
const ZH_VERB_PATTERN =
  '設計|實作|串接|完成|撰寫|修正|修復|測試|準備|整合|部署|審查|檢查|更新|規劃|提供|建立|開發|優化|處理|調查|研究|追蹤|確認|整理|安排|重構|驗證';
const EN_VERB = new RegExp(`\\b(${EN_VERB_PATTERN})(?:s|es|ed|ing)?\\b`, 'i');
const EN_VERB_AT_START = new RegExp(`^(${EN_VERB_PATTERN})\\b`, 'i');
const EN_COMMITMENT = new RegExp(
  `\\b(?:will|should|must|needs? to|has to|have to|is going to)\\s+(?:\\w+\\s+)?(${EN_VERB_PATTERN})\\b`,
  'i',
);
const ZH_VERB = new RegExp(`(${ZH_VERB_PATTERN})`);
const ZH_COMMITMENT = new RegExp(`(?:請|需要|負責|要|將)[^。！？\\n]{0,12}(${ZH_VERB_PATTERN})`);

const LIST_MARKER = /^\s*(?:[-*•]\s+|\d+[.)]\s+|\d+、\s*)/;
const ACTION_MARKER = /^\s*(?:action items?\s*#?\d*|todo|待辦(?:事項)?|行動項目)\s*[:：]\s*/i;
const HOURS = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|個?小時|小时)(?![a-z])/i;
const MAX_SEGMENT_CHARS = 500;

const ROLE_EXPLICIT: Record<Role, RegExp> = {
  engineer: /工程師|工程师|後端|前端|\bengineers?\b|\bdevelopers?\b/i,
  designer: /設計師|设计师|\bdesigners?\b/i,
  pm: /產品經理|\bPM\b|\bproduct manager\b/,
};
const ROLE_KEYWORDS: Record<Role, RegExp> = {
  engineer:
    /\bapi\b|webhook|backend|frontend|\bbug|\bfix|implement|實作|串接|deploy|部署|database|migration|logging|refactor|endpoint|integration|oauth|\bcode\b/gi,
  designer:
    /design|設計|\bui\b|\bux\b|mockup|wireframe|figma|設計稿|illustration|prototype|layout|\bicons?\b/gi,
  pm: /roadmap|stakeholder|規劃|\bplan\b|requirement|需求|release notes|checklist|清單|\bqa\b|slides|\bdemo\b/gi,
};

export function inferRole(text: string): Role | undefined {
  const roles: Role[] = ['engineer', 'designer', 'pm'];
  const explicit = roles.filter((role) => ROLE_EXPLICIT[role].test(text));
  if (explicit.length === 1) return explicit[0];

  const scores = roles.map((role) => ({
    role,
    score: (text.match(ROLE_KEYWORDS[role]) ?? []).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score === 0 || scores[0].score === scores[1].score) return undefined;
  return scores[0].role;
}

const EN_WEEKDAY =
  /\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|mon|tues?|wed|thu(?:rs?)?|fri)\b/i;
const ZH_WEEKDAY = /(下)?(?:週|周|星期|禮拜|礼拜)([一二三四五])/;
const EN_DAY_INDEX: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };
const ZH_DAY_INDEX: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 };

export function inferDeadline(text: string, now: Date): string | undefined {
  let day: number | undefined;
  let nextWeek = false;

  const en = text.match(EN_WEEKDAY);
  const zh = text.match(ZH_WEEKDAY);
  if (en && (!zh || (en.index ?? 0) <= (zh.index ?? 0))) {
    day = EN_DAY_INDEX[en[2].slice(0, 3).toLowerCase()];
    nextWeek = Boolean(en[1]);
  } else if (zh) {
    day = ZH_DAY_INDEX[zh[2]];
    nextWeek = Boolean(zh[1]);
  }
  if (!day) return undefined;

  const deadline = getWorkweekMonday(now);
  deadline.setDate(deadline.getDate() + day - 1);
  deadline.setHours(18, 0, 0, 0);
  if (nextWeek || deadline.getTime() < now.getTime()) {
    deadline.setDate(deadline.getDate() + 7);
  }
  return deadline.toISOString();
}

export function defaultDraftDeadline(now: Date): string {
  return inferDeadline('Friday', now)!;
}

function clampHours(hours: number): number {
  return Math.min(80, Math.max(0.5, Math.round(hours * 2) / 2));
}

interface NoteCandidate {
  quote: string;
  body: string;
}

function findActionVerb(text: string): string | undefined {
  return text.match(EN_VERB)?.[1] ?? text.match(ZH_VERB)?.[1];
}

function collectCandidates(notes: string): NoteCandidate[] {
  const candidates: NoteCandidate[] = [];

  for (const line of notes.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const listMatch = trimmedLine.match(LIST_MARKER);
    const actionMatch = trimmedLine.match(ACTION_MARKER);

    if (actionMatch) {
      const body = trimmedLine.slice(actionMatch[0].length).trim();
      if (body) candidates.push({ quote: trimmedLine, body });
      continue;
    }

    if (listMatch) {
      const quote = trimmedLine.slice(listMatch[0].length).trim();
      if (quote && (findActionVerb(quote) || HOURS.test(quote))) {
        candidates.push({ quote, body: quote.replace(ACTION_MARKER, '') });
      }
      continue;
    }

    for (const sentence of trimmedLine.split(/(?<=[.!?。！？；;])\s*/)) {
      const quote = sentence.trim();
      if (!quote) continue;
      if (
        EN_VERB_AT_START.test(quote) ||
        EN_COMMITMENT.test(quote) ||
        ZH_COMMITMENT.test(quote) ||
        ZH_VERB.test(quote.slice(0, 4))
      ) {
        candidates.push({ quote, body: quote });
      }
    }
  }

  return candidates.filter((candidate) => candidate.quote.length <= MAX_SEGMENT_CHARS);
}

function deriveTitle(body: string): string {
  const withoutHours = body.replace(new RegExp(HOURS.source, 'gi'), '').trim();
  const head = withoutHours
    .split(/\s+[—–-]\s+|[（(，,；;。]/)[0]
    .trim()
    .replace(/[\s.:：!！]+$/, '');
  const title = head.length >= 3 ? head : withoutHours;
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

export function fallbackExtractTasks(notes: string, now: Date): TaskDraft[] {
  return collectCandidates(notes).map(({ quote, body }) => {
    const hoursMatch = body.match(HOURS);
    const role = inferRole(body);
    const verb = findActionVerb(body);
    const deadline = inferDeadline(body, now);

    const reasons = [
      verb ? `action verb "${verb}"` : 'action-item marker',
      hoursMatch
        ? `estimate from "${hoursMatch[0].trim()}"`
        : `no hour hint, defaulted to ${DEFAULT_ESTIMATE_HOURS}h`,
    ];
    if (role) reasons.push(`role hint → ${role}`);
    if (deadline) reasons.push('deadline from weekday mention');

    return {
      title: deriveTitle(body),
      description: body,
      sourceQuote: quote,
      estimatedHours: hoursMatch ? clampHours(Number(hoursMatch[1])) : DEFAULT_ESTIMATE_HOURS,
      suggestedRole: role,
      suggestedDeadline: deadline,
      aiGenerated: true,
      aiConfidence: hoursMatch && role ? 'medium' : 'low',
      aiReasoning: `Heuristic fallback: ${reasons.join('; ')}.`,
    };
  });
}

const ROLES: Role[] = ['pm', 'designer', 'engineer'];
const CONFIDENCES: AIConfidence[] = ['high', 'medium', 'low'];

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function parseExtractionResponse(
  raw: string,
  notes: string,
): { tasks: TaskDraft[]; dropped: number } {
  const parsed = parseJsonObject(raw);
  if (!Array.isArray(parsed.tasks)) {
    throw new Error('missing "tasks" array');
  }

  const tasks: TaskDraft[] = [];
  let dropped = 0;

  for (const item of parsed.tasks as unknown[]) {
    const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = nonEmptyString(record.title);
    const sourceQuote = nonEmptyString(record.sourceQuote);
    if (!title || !sourceQuote || !notes.includes(sourceQuote)) {
      dropped += 1;
      continue;
    }

    const hours =
      typeof record.estimatedHours === 'number' && record.estimatedHours > 0
        ? clampHours(record.estimatedHours)
        : undefined;
    const confidence = CONFIDENCES.includes(record.aiConfidence as AIConfidence)
      ? (record.aiConfidence as AIConfidence)
      : 'medium';

    tasks.push({
      title: title.length > 120 ? `${title.slice(0, 117)}...` : title,
      description: nonEmptyString(record.description) ?? title,
      sourceQuote,
      estimatedHours: hours ?? DEFAULT_ESTIMATE_HOURS,
      suggestedRole: ROLES.includes(record.suggestedRole as Role)
        ? (record.suggestedRole as Role)
        : undefined,
      suggestedDeadline: toIsoDate(record.suggestedDeadline),
      aiGenerated: true,
      aiConfidence: hours === undefined ? 'low' : confidence,
      aiReasoning: nonEmptyString(record.aiReasoning) ?? 'Extracted by LLM.',
    });
  }

  return { tasks, dropped };
}

export async function extractTasksFromNotes(params: {
  title?: string;
  rawNotes: string;
  actorId?: string;
  now?: string;
}): Promise<ExtractionResult> {
  const now = params.now ? new Date(params.now) : new Date();
  const prepared = prepareMeetingNotes(params.rawNotes);

  if (prepared.kind === 'empty') {
    return { tasks: [], usedFallbackAi: false, aiWarning: EMPTY_INPUT_MESSAGE, provider: 'none' };
  }
  if (prepared.kind === 'no_signal') {
    return {
      tasks: [],
      usedFallbackAi: false,
      aiWarning: NO_ACTIONABLE_TASKS_WARNING,
      provider: 'none',
    };
  }

  const { notes, truncated } = prepared;
  const result = await callStructuredLLM({
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildExtractionUserPrompt({ title: params.title, notes, now }),
    parse: (raw) => parseExtractionResponse(raw, notes),
    fallback: () => ({ tasks: fallbackExtractTasks(notes, now), dropped: 0 }),
  });

  const { tasks, dropped } = result.data;
  const warnings: string[] = [];
  if (truncated) warnings.push(TRUNCATION_WARNING);
  if (result.warning) warnings.push(result.warning);
  if (dropped > 0) {
    warnings.push(
      `${dropped} AI-extracted task(s) were dropped because their source quote was not found verbatim in the notes.`,
    );
  }
  if (tasks.length === 0) warnings.push(NO_ACTIONABLE_TASKS_WARNING);

  return {
    tasks,
    usedFallbackAi: result.usedFallback,
    aiWarning: warnings.length > 0 ? warnings.join(' ') : undefined,
    provider: result.provider,
  };
}

const STATUS_RANK: Record<WorkloadStatus, number> = { ok: 0, near_capacity: 1, conflict: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

function topicTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]/g) ?? []);
}

export function topicsMatch(a: string, b: string): boolean {
  const left = topicTokens(a);
  const right = topicTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / new Set([...left, ...right]).size >= 0.5;
}

/**
 * A rejection still blocks re-suggesting the same member unless the member now has room AND the
 * request itself changed: a deadline at least a day later, or a smaller task that fits the
 * capacity they had when they declined.
 */
export function rejectionStillApplies(params: {
  rejection: RejectionRecord;
  workload: WorkloadBreakdown;
  estimatedHours: number;
  deadline: string;
}): boolean {
  const { rejection, workload, estimatedHours, deadline } = params;
  if (workload.status === 'conflict') return true;
  const laterDeadline = Date.parse(deadline) - Date.parse(rejection.rejectedDeadline) >= DAY_MS;
  const smallerAndFits =
    estimatedHours < rejection.estimatedHours &&
    estimatedHours <= rejection.workloadSnapshot.availableHours;
  return !(laterDeadline || smallerAndFits);
}

function hours(value: number): string {
  return `${value.toFixed(1)}h`;
}

interface Candidate {
  member: TeamMember;
  workload: WorkloadBreakdown;
  blocked: boolean;
}

function capacityWarning(chosen: Candidate | undefined): string | undefined {
  return !chosen || chosen.blocked || chosen.workload.status === 'conflict'
    ? NO_CAPACITY_WARNING
    : undefined;
}

function describeAvoided(params: {
  chosenId: string;
  candidates: Candidate[];
  blockedRejections: RejectionRecord[];
}): string[] {
  const nameOf = (id: string) =>
    params.candidates.find((c) => c.member.id === id)?.member.name ?? id;
  const lines = params.blockedRejections
    .filter((rejection) => rejection.rejectedAssigneeId !== params.chosenId)
    .map(
      (rejection) =>
        `Avoided ${nameOf(rejection.rejectedAssigneeId)}: previously declined "${rejection.taskTitle}" (${rejection.reason}) and workload/deadline conditions have not materially changed.`,
    );
  const overloaded = params.candidates.filter(
    (c) => c.member.id !== params.chosenId && !c.blocked && c.workload.status === 'conflict',
  );
  if (overloaded.length > 0) {
    lines.push(
      `Avoided ${overloaded.map((c) => `${c.member.name} (${hours(c.workload.availableHours)} available)`).join(', ')}: over capacity before the deadline.`,
    );
  }
  return lines;
}

function fallbackSuggestion(params: {
  candidates: Candidate[];
  role: Role | undefined;
  estimatedHours: number;
  deadline: string;
  blockedRejections: RejectionRecord[];
}): { assigneeId: string; deadline: string; reasoning: string } {
  const roleMiss = (c: Candidate) => (params.role && c.member.role !== params.role ? 1 : 0);
  const isConflict = (c: Candidate) => (c.workload.status === 'conflict' ? 1 : 0);
  const ranked = [...params.candidates].sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      isConflict(a) - isConflict(b) ||
      roleMiss(a) - roleMiss(b) ||
      STATUS_RANK[a.workload.status] - STATUS_RANK[b.workload.status] ||
      b.workload.remainingAfterTask - a.workload.remainingAfterTask,
  );

  const chosen = ranked[0];
  if (!chosen) {
    return {
      assigneeId: '',
      deadline: params.deadline,
      reasoning: 'No team members are available to suggest.',
    };
  }

  const { member, workload } = chosen;
  const parts = [
    `Suggested ${member.name} (${member.role}): ${hours(workload.availableHours)} available before the deadline, ${hours(workload.remainingAfterTask)} left after this ${hours(params.estimatedHours)} task (${workload.status}).`,
  ];
  if (params.role && member.role !== params.role) {
    parts.push(`No ${params.role} has capacity, so a ${member.role} was chosen.`);
  }
  parts.push(
    ...describeAvoided({
      chosenId: member.id,
      candidates: params.candidates,
      blockedRejections: params.blockedRejections,
    }),
  );

  return { assigneeId: member.id, deadline: params.deadline, reasoning: parts.join(' ') };
}

function parseSuggestionResponse(
  raw: string,
  candidates: Candidate[],
  requestedDeadline: string,
): { assigneeId: string; deadline: string; reasoning: string } {
  const parsed = parseJsonObject(raw);
  const assigneeId = nonEmptyString(parsed.suggestedAssigneeId);
  const chosen = candidates.find((c) => c.member.id === assigneeId);
  if (!chosen) {
    throw new Error(`unknown suggestedAssigneeId "${String(parsed.suggestedAssigneeId)}"`);
  }
  if (chosen.blocked && candidates.some((c) => !c.blocked)) {
    throw new Error(
      `re-suggested ${chosen.member.name}, who already declined this task under unchanged conditions`,
    );
  }
  if (
    chosen.workload.status === 'conflict' &&
    candidates.some((c) => !c.blocked && c.workload.status !== 'conflict')
  ) {
    throw new Error(
      `suggested ${chosen.member.name}, who is over capacity, while others have room`,
    );
  }
  const reasoning = nonEmptyString(parsed.aiReasoning);
  if (!reasoning) {
    throw new Error('missing aiReasoning');
  }
  return {
    assigneeId: chosen.member.id,
    deadline: toIsoDate(parsed.suggestedDeadline) ?? requestedDeadline,
    reasoning,
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
  const { db, taskId, title, description, estimatedHours, deadline } = params;
  const workloads = checkAllMembersWorkload({
    db,
    deadline,
    newTaskHours: estimatedHours,
    now: params.now,
    excludeTaskId: taskId,
  });
  const workloadById = new Map(workloads.map((workload) => [workload.memberId, workload]));

  const matchingRejections = db.rejections.filter(
    (rejection) =>
      (taskId && rejection.taskId === taskId) || topicsMatch(rejection.taskTitle, title),
  );
  const rejectionStatus = matchingRejections.map((rejection) => {
    const workload = workloadById.get(rejection.rejectedAssigneeId);
    return {
      rejection,
      applies: workload
        ? rejectionStillApplies({ rejection, workload, estimatedHours, deadline })
        : false,
    };
  });
  const blockedRejections = rejectionStatus.filter((s) => s.applies).map((s) => s.rejection);
  const blockedIds = new Set(blockedRejections.map((rejection) => rejection.rejectedAssigneeId));

  const candidates: Candidate[] = db.members.flatMap((member) => {
    const workload = workloadById.get(member.id);
    return workload ? [{ member, workload, blocked: blockedIds.has(member.id) }] : [];
  });

  const result = await callStructuredLLM({
    systemPrompt: SUGGESTION_SYSTEM_PROMPT,
    userPrompt: buildSuggestionUserPrompt({
      task: { title, description, estimatedHours, deadline },
      members: candidates.map(({ member, workload }) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        availableHours: workload.availableHours,
        remainingAfterTask: workload.remainingAfterTask,
        status: workload.status,
      })),
      previousRejections: rejectionStatus.map(({ rejection, applies }) => ({
        rejectedAssigneeId: rejection.rejectedAssigneeId,
        taskTitle: rejection.taskTitle,
        reason: rejection.reason,
        rejectedDeadline: rejection.rejectedDeadline,
        estimatedHours: rejection.estimatedHours,
        availableHoursAtRejection: rejection.workloadSnapshot.availableHours,
        conditionsChanged: !applies,
      })),
    }),
    parse: (raw) => parseSuggestionResponse(raw, candidates, deadline),
    fallback: () =>
      fallbackSuggestion({
        candidates,
        role: inferRole(`${title} ${description ?? ''}`),
        estimatedHours,
        deadline,
        blockedRejections,
      }),
  });

  const chosen = candidates.find((c) => c.member.id === result.data.assigneeId);
  const warnings = [result.warning, capacityWarning(chosen)].filter(Boolean);

  return {
    suggestedAssigneeId: result.data.assigneeId,
    suggestedDeadline: result.data.deadline,
    aiReasoning: result.data.reasoning,
    avoidedRejections: blockedRejections.filter(
      (rejection) => rejection.rejectedAssigneeId !== result.data.assigneeId,
    ),
    usedFallbackAi: result.usedFallback,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}
