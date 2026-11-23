import { randomUUID } from 'node:crypto';
import { readDb, updateDb } from '@/lib/store';
import type { CalendarEvent, ProposedBlock, Task } from '@/lib/types';

export const SIMULATED_OUTAGE_MESSAGE =
  'Simulated calendar provider outage (503). Click Retry to sync once resolved.';

export interface CalendarAdapter {
  listEvents(memberId: string, start: string, end: string): Promise<CalendarEvent[]>;
  syncTaskBlocks(params: { task: Task; blocks: ProposedBlock[] }): Promise<{ eventIds: string[] }>;
  removeTaskBlocks(taskId: string): Promise<void>;
}

/*
 * CP3 seam: a GoogleCalendarAdapter implements the same interface, so callers don't change.
 *
 *   class GoogleCalendarAdapter implements CalendarAdapter {
 *     constructor(private auth: OAuth2Client, private calendarId = 'primary') {}
 *     listEvents(memberId, start, end)  -> events.list({ timeMin: start, timeMax: end, singleEvents: true })
 *     syncTaskBlocks({ task, blocks })  -> events.list({ privateExtendedProperty: `taskId=${task.id}` })
 *                                          then events.delete each, then events.insert one per block
 *                                          with extendedProperties.private.taskId = task.id
 *     removeTaskBlocks(taskId)          -> same lookup by extended property, then events.delete
 *   }
 *
 * Provider errors (e.g. 503) propagate as thrown errors, exactly like the simulated outage below.
 */

export class LocalCalendarAdapter implements CalendarAdapter {
  private readonly dbPath?: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  async listEvents(memberId: string, start: string, end: string): Promise<CalendarEvent[]> {
    const db = await readDb(this.dbPath);
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return db.calendarEvents.filter(
      (event) =>
        event.memberId === memberId &&
        new Date(event.end).getTime() > startMs &&
        new Date(event.start).getTime() < endMs,
    );
  }

  async syncTaskBlocks({
    task,
    blocks,
  }: {
    task: Task;
    blocks: ProposedBlock[];
  }): Promise<{ eventIds: string[] }> {
    let eventIds: string[] = [];
    await updateDb((db) => {
      // Throwing inside the updater aborts before the write, so an outage never leaves partial events.
      if (db.settings.simulateCalendarFailure) {
        throw new Error(SIMULATED_OUTAGE_MESSAGE);
      }
      const events: CalendarEvent[] = blocks.map((block, index) => ({
        id: `evt-wb-${task.id}-v${task.currentProposal.version}-${index + 1}`,
        memberId: task.currentProposal.assigneeId,
        title: `Work: ${task.title}`,
        start: block.start,
        end: block.end,
        kind: 'work_block',
        taskId: task.id,
      }));
      db.calendarEvents = db.calendarEvents
        .filter((event) => event.taskId !== task.id)
        .concat(events);
      eventIds = events.map((event) => event.id);
    }, this.dbPath);
    return { eventIds };
  }

  async removeTaskBlocks(taskId: string): Promise<void> {
    await updateDb((db) => {
      db.calendarEvents = db.calendarEvents.filter((event) => event.taskId !== taskId);
    }, this.dbPath);
  }
}

export function getCalendarAdapter(dbPath?: string): CalendarAdapter {
  return new LocalCalendarAdapter(dbPath);
}

export type RetrySyncResult =
  | { ok: true; task: Task }
  | { ok: false; status: 404 | 409 | 503; error: string; task?: Task };

/**
 * Re-runs calendar sync for a `sync_failed` task using its confirmed proposal's blocks.
 */
export async function retryTaskSync(params: {
  taskId: string;
  actorId?: string;
  dbPath?: string;
  adapter?: CalendarAdapter;
}): Promise<RetrySyncResult> {
  const { taskId, dbPath } = params;
  const adapter = params.adapter ?? getCalendarAdapter(dbPath);

  const db = await readDb(dbPath);
  const task = db.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return { ok: false, status: 404, error: `Task "${taskId}" not found.` };
  }
  if (task.status !== 'sync_failed') {
    return {
      ok: false,
      status: 409,
      error: `Task "${task.title}" is "${task.status}"; only sync_failed tasks can be retried.`,
      task,
    };
  }

  const actorId = params.actorId ?? task.currentProposal.assigneeId;
  const blocks = task.currentProposal.proposedBlocks;

  let eventIds: string[];
  try {
    ({ eventIds } = await adapter.syncTaskBlocks({ task, blocks }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Calendar sync failed.';
    const updated = await updateDb((current) => {
      const target = current.tasks.find((candidate) => candidate.id === taskId);
      if (!target) return;
      const timestamp = new Date().toISOString();
      target.syncError = message;
      target.updatedAt = timestamp;
      current.auditLog.push({
        id: `aud-${randomUUID()}`,
        timestamp,
        actorId,
        action: 'calendar_sync_failed',
        taskId,
        summary: `Retry sync failed for "${target.title}": ${message}`,
      });
    }, dbPath);
    return {
      ok: false,
      status: 503,
      error: message,
      task: updated.tasks.find((candidate) => candidate.id === taskId),
    };
  }

  const updated = await updateDb((current) => {
    const target = current.tasks.find((candidate) => candidate.id === taskId);
    if (!target) return;
    const timestamp = new Date().toISOString();
    target.status = 'confirmed';
    target.calendarEventIds = eventIds;
    delete target.syncError;
    target.updatedAt = timestamp;
    current.auditLog.push({
      id: `aud-${randomUUID()}`,
      timestamp,
      actorId,
      action: 'calendar_synced',
      taskId,
      summary: `Synced ${eventIds.length} work block${eventIds.length === 1 ? '' : 's'} for "${target.title}" after retry.`,
      metadata: { eventIds },
    });
  }, dbPath);

  const synced = updated.tasks.find((candidate) => candidate.id === taskId);
  if (!synced) {
    return { ok: false, status: 404, error: `Task "${taskId}" not found.` };
  }
  return { ok: true, task: synced };
}
