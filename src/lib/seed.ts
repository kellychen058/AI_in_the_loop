import type {
  AppDatabase,
  AuditLogEntry,
  CalendarEvent,
  EdgeCasePreset,
  MeetingSession,
  RejectionRecord,
  Task,
  TeamMember,
  WorkloadBreakdown,
} from './types';

/**
 * Returns Monday 00:00 (local time) of the active Mon–Fri workweek.
 * - On Mon–Fri: returns Monday of the current week.
 * - On Sat/Sun: advances to the upcoming Monday so weekend demos/reviews still
 *   operate on an active workweek with future deadlines and open slots.
 */
export function getWorkweekMonday(referenceDate: Date = new Date()): Date {
  const anchor = new Date(referenceDate.getTime());
  anchor.setHours(0, 0, 0, 0);
  const day = anchor.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  if (day === 0) {
    anchor.setDate(anchor.getDate() + 1);
  } else if (day === 6) {
    anchor.setDate(anchor.getDate() + 2);
  } else {
    anchor.setDate(anchor.getDate() - (day - 1));
  }

  return anchor;
}

/**
 * Builds an ISO-8601 timestamp for `dayOffset` (0=Mon .. 4=Fri) at `hour:minute`.
 */
function workweekTime(monday: Date, dayOffset: number, hour: number, minute = 0): string {
  const date = new Date(monday.getTime());
  date.setDate(monday.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

export const SAMPLE_MEETING_NOTES = `Sprint 12 Product & Engineering Sync (週會紀錄)
Attendees: Alice (PM), Bob (Designer), Carol (Engineer), David (Engineer)

Action Items:
1. Payment API Integration (串接金流 API 與 webhook 驗證) — 預估 10h，希望本週五前完成，需要工程師協助串接。
2. Redesign Checkout Error & Empty States (重新設計結帳錯誤與空狀態畫面) — 預估 6h，請設計師在週四下班前提供新版設計稿與互動規格。
3. Write Release QA Smoke Test Checklist (撰寫上線前 QA 測試清單與驗證步驟) — 預估 4h，本週五前完成以利下週發布。`;

const LONG_NOTE_BLOCK =
  'Sprint planning transcript segment: Discussed checkout funnel latency, webhook idempotency keys, retry backoff policy, and design handoff checklist for Q4 release. ';

export const EDGE_CASE_PRESETS: Record<
  'empty' | 'offTopic' | 'gibberish' | 'veryLong',
  EdgeCasePreset
> = {
  empty: {
    id: 'empty',
    label: 'Empty Input',
    title: 'Empty Meeting Notes',
    rawNotes: '   \n\t  ',
  },
  offTopic: {
    id: 'off_topic',
    label: 'Off-topic (Recipe)',
    title: 'Tomato Egg Stir-Fry Recipe',
    rawNotes:
      'Ingredients: 3 eggs, 2 ripe tomatoes, 1 tbsp oil, pinch of salt and sugar. Beat the eggs lightly, scramble until soft, remove from pan, cook chopped tomatoes until juicy, then fold eggs back in and serve warm over rice.',
  },
  gibberish: {
    id: 'gibberish',
    label: 'Gibberish / Emojis',
    title: 'Random Noise',
    rawNotes: 'asdfghjkl qwerty 12345 ??? 🚀🎉🔥 ~~~',
  },
  veryLong: {
    id: 'very_long',
    label: 'Very Long (16k chars)',
    title: 'Marathon Quarterly Sync Transcript',
    rawNotes: [
      'Action Item 1: Audit checkout API error codes and add structured logging (4h, engineer, due Friday).',
      LONG_NOTE_BLOCK.repeat(110),
      'Action Item 2: Update onboarding empty-state illustrations (3h, designer, due Friday).',
    ].join('\n\n'),
  },
};

export function createSeedDatabase(referenceDate: Date = new Date()): AppDatabase {
  const monday = getWorkweekMonday(referenceDate);
  const mondayStart = workweekTime(monday, 0, 9, 0);
  const fridayEnd = workweekTime(monday, 4, 18, 0);

  const members: TeamMember[] = [
    {
      id: 'alice',
      name: 'Alice Chen',
      role: 'pm',
      weeklyHours: 35,
      workdayStartHour: 9,
      workdayEndHour: 18,
    },
    {
      id: 'bob',
      name: 'Bob Lin',
      role: 'designer',
      weeklyHours: 30,
      workdayStartHour: 9,
      workdayEndHour: 18,
    },
    {
      id: 'carol',
      name: 'Carol Wu',
      role: 'engineer',
      weeklyHours: 30,
      workdayStartHour: 9,
      workdayEndHour: 18,
    },
    {
      id: 'david',
      name: 'David Wang',
      role: 'engineer',
      weeklyHours: 25,
      workdayStartHour: 9,
      workdayEndHour: 18,
    },
  ];

  // Pre-seeded meetings across Mon–Fri.
  // Carol has 12h of meetings + 12h of confirmed tasks = 24h booked out of 30h (~6h free).
  // David has 4h of meetings + 4h of confirmed tasks = 8h booked out of 25h (~17h free).
  // Bob has 3h of meetings + 0h of confirmed tasks = 3h booked out of 30h (~27h free).
  const calendarEvents: CalendarEvent[] = [
    // Alice (PM) — 5.5h meetings
    {
      id: 'evt-mtg-alice-1',
      memberId: 'alice',
      title: 'Sprint 12 Planning',
      start: workweekTime(monday, 0, 10, 0),
      end: workweekTime(monday, 0, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-alice-2',
      memberId: 'alice',
      title: 'Stakeholder Roadmap Sync',
      start: workweekTime(monday, 1, 14, 0),
      end: workweekTime(monday, 1, 15, 30),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-alice-3',
      memberId: 'alice',
      title: 'Customer Discovery Debrief',
      start: workweekTime(monday, 3, 14, 0),
      end: workweekTime(monday, 3, 15, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-alice-4',
      memberId: 'alice',
      title: 'Weekly Demo Prep',
      start: workweekTime(monday, 4, 15, 0),
      end: workweekTime(monday, 4, 16, 0),
      kind: 'meeting',
    },

    // Bob (Designer) — 3h meetings (light load, plenty of capacity)
    {
      id: 'evt-mtg-bob-1',
      memberId: 'bob',
      title: 'Sprint 12 Planning',
      start: workweekTime(monday, 0, 10, 0),
      end: workweekTime(monday, 0, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-bob-2',
      memberId: 'bob',
      title: 'Design System Critique',
      start: workweekTime(monday, 2, 14, 0),
      end: workweekTime(monday, 2, 15, 0),
      kind: 'meeting',
    },

    // Carol (Engineer) — 12h meetings + 12h confirmed work blocks = 6h free this week
    {
      id: 'evt-mtg-carol-1',
      memberId: 'carol',
      title: 'Sprint 12 Planning',
      start: workweekTime(monday, 0, 10, 0),
      end: workweekTime(monday, 0, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-carol-2',
      memberId: 'carol',
      title: 'Architecture Review & Backend Sync',
      start: workweekTime(monday, 1, 9, 0),
      end: workweekTime(monday, 1, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-carol-3',
      memberId: 'carol',
      title: 'API Design Workshop',
      start: workweekTime(monday, 2, 10, 0),
      end: workweekTime(monday, 2, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-carol-4',
      memberId: 'carol',
      title: 'Security & Infrastructure Audit',
      start: workweekTime(monday, 3, 9, 0),
      end: workweekTime(monday, 3, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-carol-5',
      memberId: 'carol',
      title: 'Release Readiness Sync',
      start: workweekTime(monday, 4, 10, 0),
      end: workweekTime(monday, 4, 12, 0),
      kind: 'meeting',
    },

    // David (Engineer) — 4h meetings + 4h confirmed work blocks (viable alternative to Carol)
    {
      id: 'evt-mtg-david-1',
      memberId: 'david',
      title: 'Sprint 12 Planning',
      start: workweekTime(monday, 0, 10, 0),
      end: workweekTime(monday, 0, 12, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-david-2',
      memberId: 'david',
      title: 'Frontend & API Triage',
      start: workweekTime(monday, 3, 10, 0),
      end: workweekTime(monday, 3, 11, 0),
      kind: 'meeting',
    },
    {
      id: 'evt-mtg-david-3',
      memberId: 'david',
      title: 'Release Readiness Sync',
      start: workweekTime(monday, 4, 10, 0),
      end: workweekTime(monday, 4, 11, 0),
      kind: 'meeting',
    },

    // Confirmed work blocks for pre-seeded tasks
    {
      id: 'evt-wb-carol-1',
      memberId: 'carol',
      title: 'Work: OAuth2 Token Refresh Service',
      start: workweekTime(monday, 0, 13, 0),
      end: workweekTime(monday, 0, 17, 0),
      kind: 'work_block',
      taskId: 'task-seed-oauth',
    },
    {
      id: 'evt-wb-carol-2',
      memberId: 'carol',
      title: 'Work: OAuth2 Token Refresh Service',
      start: workweekTime(monday, 1, 13, 0),
      end: workweekTime(monday, 1, 17, 0),
      kind: 'work_block',
      taskId: 'task-seed-oauth',
    },
    {
      id: 'evt-wb-carol-3',
      memberId: 'carol',
      title: 'Work: Database Migration Rollback Script',
      start: workweekTime(monday, 2, 13, 0),
      end: workweekTime(monday, 2, 17, 0),
      kind: 'work_block',
      taskId: 'task-seed-migration',
    },
    {
      id: 'evt-wb-david-1',
      memberId: 'david',
      title: 'Work: Checkout UI State & API Client',
      start: workweekTime(monday, 1, 10, 0),
      end: workweekTime(monday, 1, 12, 0),
      kind: 'work_block',
      taskId: 'task-seed-checkout-ui',
    },
    {
      id: 'evt-wb-david-2',
      memberId: 'david',
      title: 'Work: Checkout UI State & API Client',
      start: workweekTime(monday, 2, 10, 0),
      end: workweekTime(monday, 2, 12, 0),
      kind: 'work_block',
      taskId: 'task-seed-checkout-ui',
    },
  ];

  const seedMeetingCreatedAt = workweekTime(monday, 0, 9, 15);
  const meetings: MeetingSession[] = [
    {
      id: 'mtg-seed-kickoff',
      title: 'Sprint 12 Kickoff Sync',
      rawNotes:
        'Confirmed core Sprint 12 commitments: Carol owns OAuth2 Token Refresh Service (8h, due Wed) and Database Migration Rollback Script (4h, due Thu). David owns Checkout UI State & API Client (4h, due Thu, depends on OAuth2 Token Refresh).',
      createdBy: 'alice',
      createdAt: seedMeetingCreatedAt,
      usedFallbackAi: true,
    },
  ];

  const oauthProposal = {
    version: 1,
    assigneeId: 'carol',
    deadline: workweekTime(monday, 2, 18, 0),
    estimatedHours: 8,
    proposedBlocks: [
      { start: workweekTime(monday, 0, 13, 0), end: workweekTime(monday, 0, 17, 0) },
      { start: workweekTime(monday, 1, 13, 0), end: workweekTime(monday, 1, 17, 0) },
    ],
    proposedBy: 'alice',
    note: 'Blocks Checkout UI auth token handling.',
    createdAt: workweekTime(monday, 0, 9, 20),
  };

  const migrationProposal = {
    version: 1,
    assigneeId: 'carol',
    deadline: workweekTime(monday, 3, 18, 0),
    estimatedHours: 4,
    proposedBlocks: [
      { start: workweekTime(monday, 2, 13, 0), end: workweekTime(monday, 2, 17, 0) },
    ],
    proposedBy: 'alice',
    note: 'Required before Friday production cutover.',
    createdAt: workweekTime(monday, 0, 9, 22),
  };

  const checkoutUiProposal = {
    version: 1,
    assigneeId: 'david',
    deadline: workweekTime(monday, 3, 18, 0),
    estimatedHours: 4,
    proposedBlocks: [
      { start: workweekTime(monday, 1, 10, 0), end: workweekTime(monday, 1, 12, 0) },
      { start: workweekTime(monday, 2, 10, 0), end: workweekTime(monday, 2, 12, 0) },
    ],
    proposedBy: 'alice',
    note: 'Depends on Carol completing OAuth2 Token Refresh Service first.',
    createdAt: workweekTime(monday, 0, 9, 25),
  };

  const tasks: Task[] = [
    {
      id: 'task-seed-oauth',
      meetingId: 'mtg-seed-kickoff',
      title: 'OAuth2 Token Refresh Service',
      description: 'Implement automatic access-token refresh and rotation with unit tests.',
      sourceQuote: 'Carol owns OAuth2 Token Refresh Service (8h, due Wed).',
      aiGenerated: false,
      dependsOnTaskIds: [],
      status: 'confirmed',
      currentProposal: oauthProposal,
      proposalHistory: [oauthProposal],
      confirmedVersion: 1,
      confirmedByAssignerAt: workweekTime(monday, 0, 9, 20),
      confirmedByAssigneeAt: workweekTime(monday, 0, 9, 30),
      calendarEventIds: ['evt-wb-carol-1', 'evt-wb-carol-2'],
      checkInDaysBefore: 2,
      progressCheckIn: {
        daysBeforeDeadline: 2,
        requestedAt: workweekTime(monday, 0, 9, 30),
        reminders: [],
      },
      createdAt: workweekTime(monday, 0, 9, 20),
      updatedAt: workweekTime(monday, 0, 9, 30),
    },
    {
      id: 'task-seed-migration',
      meetingId: 'mtg-seed-kickoff',
      title: 'Database Migration Rollback Script',
      description: 'Prepare verified rollback migration and staging dry-run notes.',
      sourceQuote: 'Database Migration Rollback Script (4h, due Thu).',
      aiGenerated: false,
      dependsOnTaskIds: [],
      status: 'confirmed',
      currentProposal: migrationProposal,
      proposalHistory: [migrationProposal],
      confirmedVersion: 1,
      confirmedByAssignerAt: workweekTime(monday, 0, 9, 22),
      confirmedByAssigneeAt: workweekTime(monday, 0, 9, 32),
      calendarEventIds: ['evt-wb-carol-3'],
      createdAt: workweekTime(monday, 0, 9, 22),
      updatedAt: workweekTime(monday, 0, 9, 32),
    },
    {
      id: 'task-seed-checkout-ui',
      meetingId: 'mtg-seed-kickoff',
      title: 'Checkout UI State & API Client',
      description: 'Wire checkout client state machine to refreshed auth headers.',
      sourceQuote:
        'David owns Checkout UI State & API Client (4h, due Thu, depends on OAuth2 Token Refresh).',
      aiGenerated: false,
      dependsOnTaskIds: ['task-seed-oauth'],
      status: 'confirmed',
      currentProposal: checkoutUiProposal,
      proposalHistory: [checkoutUiProposal],
      confirmedVersion: 1,
      confirmedByAssignerAt: workweekTime(monday, 0, 9, 25),
      confirmedByAssigneeAt: workweekTime(monday, 0, 9, 35),
      calendarEventIds: ['evt-wb-david-1', 'evt-wb-david-2'],
      createdAt: workweekTime(monday, 0, 9, 25),
      updatedAt: workweekTime(monday, 0, 9, 35),
    },
  ];

  const carolRejectionWorkload: WorkloadBreakdown = {
    memberId: 'carol',
    windowStart: mondayStart,
    windowEnd: fridayEnd,
    workdaysInWindow: 5,
    proratedWorkHours: 30,
    scheduledMeetingHours: 12,
    existingTaskHours: 12,
    availableHours: 6,
    newTaskHours: 10,
    remainingAfterTask: -4,
    remainingRatio: -0.67,
    status: 'conflict',
    explanation:
      'Carol Wu has 30.0h prorated budget − 12.0h meetings − 12.0h existing tasks = 6.0h available; 10.0h task exceeds capacity by 4.0h (Conflict).',
  };

  const rejections: RejectionRecord[] = [
    {
      id: 'rej-seed-payment-api',
      taskId: 'task-hist-payment-api',
      taskTitle: 'Payment API Integration',
      rejectedAssigneeId: 'carol',
      rejectedDeadline: fridayEnd,
      estimatedHours: 10,
      reason:
        'Overloaded this week with OAuth2 Token Refresh and migration rollback; only 6h available before Friday.',
      rejectedBy: 'carol',
      workloadSnapshot: carolRejectionWorkload,
      createdAt: workweekTime(monday, 0, 9, 45),
    },
  ];

  const auditLog: AuditLogEntry[] = [
    {
      id: 'aud-seed-1',
      timestamp: seedMeetingCreatedAt,
      actorId: 'alice',
      action: 'meeting_ingested',
      summary: 'Ingested Sprint 12 Kickoff Sync notes.',
    },
    {
      id: 'aud-seed-2',
      timestamp: workweekTime(monday, 0, 9, 30),
      actorId: 'carol',
      action: 'task_confirmed',
      taskId: 'task-seed-oauth',
      summary: 'Carol Wu confirmed "OAuth2 Token Refresh Service" (v1, 8h) and synced 2 work blocks.',
    },
    {
      id: 'aud-seed-3',
      timestamp: workweekTime(monday, 0, 9, 32),
      actorId: 'carol',
      action: 'task_confirmed',
      taskId: 'task-seed-migration',
      summary:
        'Carol Wu confirmed "Database Migration Rollback Script" (v1, 4h) and synced 1 work block.',
    },
    {
      id: 'aud-seed-4',
      timestamp: workweekTime(monday, 0, 9, 35),
      actorId: 'david',
      action: 'task_confirmed',
      taskId: 'task-seed-checkout-ui',
      summary:
        'David Wang confirmed "Checkout UI State & API Client" (v1, 4h) and synced 2 work blocks.',
    },
    {
      id: 'aud-seed-5',
      timestamp: workweekTime(monday, 0, 9, 45),
      actorId: 'carol',
      action: 'task_rejected',
      taskId: 'task-hist-payment-api',
      summary:
        'Carol Wu declined "Payment API Integration" (10h, due Fri): only 6.0h available this week.',
      metadata: {
        rejectionId: 'rej-seed-payment-api',
        availableHours: 6,
        estimatedHours: 10,
      },
    },
  ];

  return {
    members,
    meetings,
    tasks,
    calendarEvents,
    rejections,
    auditLog,
    settings: {
      simulateCalendarFailure: false,
    },
  };
}
