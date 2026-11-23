import { readDb } from '@/lib/store';
import type { CalendarEvent, ProposedBlock, Task } from '@/lib/types';

// Wave 0 compiling stub — full implementation owned by Issue #11.

export interface CalendarAdapter {
  listEvents(memberId: string, start: string, end: string): Promise<CalendarEvent[]>;
  syncTaskBlocks(params: { task: Task; blocks: ProposedBlock[] }): Promise<{ eventIds: string[] }>;
  removeTaskBlocks(taskId: string): Promise<void>;
}

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

  async syncTaskBlocks(_params: {
    task: Task;
    blocks: ProposedBlock[];
  }): Promise<{ eventIds: string[] }> {
    return { eventIds: [] };
  }

  async removeTaskBlocks(_taskId: string): Promise<void> {
    return;
  }
}

export function getCalendarAdapter(dbPath?: string): CalendarAdapter {
  return new LocalCalendarAdapter(dbPath);
}
