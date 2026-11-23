import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { defaultDraftDeadline, EMPTY_INPUT_MESSAGE, extractTasksFromNotes } from '@/lib/ai/extract';
import { readDb, updateDb } from '@/lib/store';
import { isPm } from '@/lib/taskRoles';
import type { AuditLogEntry, MeetingSession, Task } from '@/lib/types';

export const dynamic = 'force-dynamic';

function badRequest(code: string, message: string) {
  return NextResponse.json({ code, message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return badRequest('INVALID_JSON', 'Request body must be valid JSON.');
  }

  const rawNotes = typeof body.rawNotes === 'string' ? body.rawNotes : '';
  if (!rawNotes.trim()) {
    return badRequest('EMPTY_INPUT', EMPTY_INPUT_MESSAGE);
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const actorId = typeof body.actorId === 'string' ? body.actorId : '';

  try {
    const db = await readDb();
    const actor = db.members.find((member) => member.id === actorId);
    if (!actor) {
      return badRequest('UNKNOWN_ACTOR', 'actorId must match a team member.');
    }
    if (!isPm(actor)) {
      return NextResponse.json(
        { code: 'PM_ONLY', message: 'Only a PM can extract tasks from meeting notes.' },
        { status: 403 },
      );
    }

    const extraction = await extractTasksFromNotes({ title, rawNotes, actorId });
    const now = new Date();
    const createdAt = now.toISOString();
    const meeting: MeetingSession = {
      id: `mtg-${randomUUID()}`,
      title: title || `Meeting notes ${createdAt.slice(0, 10)}`,
      rawNotes,
      createdBy: actorId,
      createdAt,
      usedFallbackAi: extraction.usedFallbackAi,
      aiWarning: extraction.aiWarning,
    };

    const fallbackDeadline = defaultDraftDeadline(now);
    const tasks: Task[] = extraction.tasks.map((draft) => ({
      id: `task-${randomUUID()}`,
      meetingId: meeting.id,
      title: draft.title,
      description: draft.description,
      sourceQuote: draft.sourceQuote,
      aiGenerated: true,
      aiConfidence: draft.aiConfidence,
      aiReasoning: draft.aiReasoning,
      dependsOnTaskIds: [],
      status: 'draft',
      // Drafts are unassigned until the assigner proposes them (Issue #10 workflow).
      currentProposal: {
        version: 1,
        assigneeId: '',
        deadline: draft.suggestedDeadline ?? fallbackDeadline,
        estimatedHours: draft.estimatedHours,
        proposedBlocks: [],
        proposedBy: actorId,
        createdAt,
      },
      proposalHistory: [],
      calendarEventIds: [],
      createdAt,
      updatedAt: createdAt,
    }));

    const audit: AuditLogEntry = {
      id: `aud-${randomUUID()}`,
      timestamp: createdAt,
      actorId,
      action: 'meeting_ingested',
      summary: `Ingested "${meeting.title}": ${tasks.length} draft task(s) extracted${
        extraction.usedFallbackAi
          ? ' with the heuristic fallback'
          : extraction.provider
            ? ` via ${extraction.provider}`
            : ''
      }.`,
      metadata: {
        meetingId: meeting.id,
        taskIds: tasks.map((task) => task.id),
        usedFallbackAi: extraction.usedFallbackAi,
        provider: extraction.provider,
      },
    };

    await updateDb((current) => {
      current.meetings.push(meeting);
      current.tasks.push(...tasks);
      current.auditLog.push(audit);
    });

    return NextResponse.json({
      meeting,
      tasks,
      usedFallbackAi: extraction.usedFallbackAi,
      aiWarning: extraction.aiWarning,
      provider: extraction.provider,
    });
  } catch (error) {
    console.error('Meeting extraction failed', error);
    return NextResponse.json(
      { code: 'EXTRACTION_FAILED', message: 'Could not save extracted tasks. Please try again.' },
      { status: 500 },
    );
  }
}
