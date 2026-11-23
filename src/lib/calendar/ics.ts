import type { CalendarEvent, TeamMember } from '@/lib/types';

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function formatUtc(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// RFC 5545 §3.1: fold lines longer than 75 octets without splitting a UTF-8 character.
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  for (const char of line) {
    const octets = Buffer.byteLength(char, 'utf8');
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = '';
      currentOctets = 0;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function generateIcs(
  events: CalendarEvent[],
  members: TeamMember[],
  now: Date = new Date(),
): string {
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const dtstamp = formatUtc(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI in the Loop//Team Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Team Schedule',
  ];

  for (const event of events) {
    const memberName = memberNames.get(event.memberId) ?? event.memberId;
    const kindLabel = event.kind === 'meeting' ? 'Meeting' : 'Confirmed work block';
    const description = event.taskId
      ? `${kindLabel} for ${memberName} (task ${event.taskId})`
      : `${kindLabel} for ${memberName}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.id)}@ai-in-the-loop`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${formatUtc(event.start)}`,
      `DTEND:${formatUtc(event.end)}`,
      `SUMMARY:${escapeText(`${event.title} · ${memberName}`)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `CATEGORIES:${event.kind === 'meeting' ? 'MEETING' : 'WORK_BLOCK'}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
