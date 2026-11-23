export type Role = 'pm' | 'designer' | 'engineer';

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  weeklyHours: number;
  workdayStartHour: number;
  workdayEndHour: number;
}

export type CalendarEventKind = 'meeting' | 'work_block';

export interface CalendarEvent {
  id: string;
  memberId: string;
  title: string;
  start: string;
  end: string;
  kind: CalendarEventKind;
  taskId?: string;
}

export type TaskStatus =
  | 'draft'
  | 'pending_assignee'
  | 'counter_proposed'
  | 'rejected'
  | 'confirmed'
  | 'sync_failed';

export type AIConfidence = 'high' | 'medium' | 'low';

export interface ProposedBlock {
  start: string;
  end: string;
}

export interface TaskProposal {
  version: number;
  assigneeId: string;
  deadline: string;
  estimatedHours: number;
  proposedBlocks: ProposedBlock[];
  proposedBy: string;
  note?: string;
  overrideRejectedReason?: string;
  createdAt: string;
}

export type CheckInDaysBefore = 0 | 1 | 2;

export interface ProgressCheckInResponse {
  message: string;
  submittedBy: string;
  submittedAt: string;
}

export interface ProgressCheckInReminder {
  id: string;
  sentBy: string;
  sentAt: string;
  note?: string;
}

export interface ProgressCheckIn {
  daysBeforeDeadline: CheckInDaysBefore;
  requestedAt: string;
  response?: ProgressCheckInResponse;
  reminders: ProgressCheckInReminder[];
  dismissedAlertAt?: string;
}

export interface Task {
  id: string;
  meetingId: string;
  title: string;
  description: string;
  sourceQuote: string;
  aiGenerated: boolean;
  aiConfidence?: AIConfidence;
  aiReasoning?: string;
  dependsOnTaskIds: string[];
  status: TaskStatus;
  currentProposal: TaskProposal;
  proposalHistory: TaskProposal[];
  confirmedVersion?: number;
  confirmedByAssignerAt?: string;
  confirmedByAssigneeAt?: string;
  calendarEventIds: string[];
  syncError?: string;
  checkInDaysBefore?: CheckInDaysBefore;
  progressCheckIn?: ProgressCheckIn;
  createdAt: string;
  updatedAt: string;
}

export type WorkloadStatus = 'ok' | 'near_capacity' | 'conflict';

export interface WorkloadBreakdown {
  memberId: string;
  windowStart: string;
  windowEnd: string;
  workdaysInWindow: number;
  proratedWorkHours: number;
  scheduledMeetingHours: number;
  existingTaskHours: number;
  availableHours: number;
  newTaskHours: number;
  remainingAfterTask: number;
  remainingRatio: number;
  status: WorkloadStatus;
  explanation: string;
}

export interface AffectedDependentTask {
  taskId: string;
  title: string;
  assigneeId: string;
  currentDeadline: string;
  reason: string;
}

export interface RejectionRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  rejectedAssigneeId: string;
  rejectedDeadline: string;
  estimatedHours: number;
  reason: string;
  rejectedBy: string;
  workloadSnapshot: WorkloadBreakdown;
  createdAt: string;
}

export type AuditAction =
  | 'meeting_ingested'
  | 'task_drafted'
  | 'task_proposed'
  | 'task_counter_proposed'
  | 'task_rejected'
  | 'task_confirmed'
  | 'task_rescheduled'
  | 'calendar_synced'
  | 'calendar_sync_failed'
  | 'rejected_option_overridden'
  | 'task_deleted'
  | 'progress_checkin_configured'
  | 'progress_checkin_submitted'
  | 'progress_checkin_reminded'
  | 'progress_checkin_dismissed'
  | 'demo_reset';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  action: AuditAction;
  taskId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface MeetingSession {
  id: string;
  title: string;
  rawNotes: string;
  createdBy: string;
  createdAt: string;
  usedFallbackAi: boolean;
  aiWarning?: string;
}

export interface AppSettings {
  simulateCalendarFailure: boolean;
}

export interface AppDatabase {
  members: TeamMember[];
  meetings: MeetingSession[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  rejections: RejectionRecord[];
  auditLog: AuditLogEntry[];
  settings: AppSettings;
}

// Shared DTO contracts used across Wave 1 & Wave 2 services

export interface TaskDraft {
  title: string;
  description: string;
  sourceQuote: string;
  estimatedHours: number;
  suggestedRole?: Role;
  suggestedDeadline?: string;
  aiGenerated: true;
  aiConfidence: AIConfidence;
  aiReasoning: string;
}

export interface ExtractionResult {
  tasks: TaskDraft[];
  usedFallbackAi: boolean;
  aiWarning?: string;
  provider?: string;
}

export interface AssignmentSuggestion {
  suggestedAssigneeId: string;
  suggestedDeadline: string;
  aiReasoning: string;
  avoidedRejections: RejectionRecord[];
  usedFallbackAi: boolean;
  warning?: string;
}

export interface ScheduleBlocksResult {
  blocks: ProposedBlock[];
  scheduledHours: number;
  unscheduledHours: number;
}

export type RejectionCheckResult =
  | {
      blocked: false;
      priorRejection?: RejectionRecord;
      overridden?: boolean;
    }
  | {
      blocked: true;
      code: 'PREVIOUSLY_REJECTED';
      message: string;
      priorRejection: RejectionRecord;
    };

export interface EdgeCasePreset {
  id: 'empty' | 'off_topic' | 'gibberish' | 'very_long';
  label: string;
  title: string;
  rawNotes: string;
}
