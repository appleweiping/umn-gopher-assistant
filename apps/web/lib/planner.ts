export interface ScheduleBlock {
  readonly id: string;
  readonly day: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface CalendarEvent {
  readonly id: string;
  readonly title: string;
  readonly location: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

export function findScheduleConflicts(blocks: readonly ScheduleBlock[]): [string, string][] {
  const conflicts: [string, string][] = [];
  for (const [index, block] of blocks.entries()) {
    for (const candidate of blocks.slice(index + 1)) {
      if (
        block.day === candidate.day &&
        block.startMinutes < candidate.endMinutes &&
        candidate.startMinutes < block.endMinutes
      ) {
        conflicts.push([block.id, candidate.id]);
      }
    }
  }
  return conflicts;
}

function escapeIcsText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function toIcsDate(value: string): string {
  return new Date(value)
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function createIcsCalendar(input: {
  readonly calendarName: string;
  readonly events: readonly CalendarEvent[];
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//UMN Gopher Assistant//Independent Planner//EN",
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
    "CALSCALE:GREGORIAN",
    ...input.events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.id)}@umn-gopher-assistant.local`,
      `DTSTAMP:${toIcsDate("2026-07-19T00:00:00.000Z")}`,
      `DTSTART:${toIcsDate(event.startsAt)}`,
      `DTEND:${toIcsDate(event.endsAt)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `LOCATION:${escapeIcsText(event.location)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ];
  return lines.join("\r\n");
}
