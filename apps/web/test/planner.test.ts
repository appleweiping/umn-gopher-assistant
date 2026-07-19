// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createIcsCalendar, findScheduleConflicts } from "../lib/planner";

describe("planner domain", () => {
  it("detects overlapping schedule blocks but not adjacent blocks", async () => {
    expect(
      findScheduleConflicts([
        { id: "a", day: "mon", startMinutes: 540, endMinutes: 600 },
        { id: "b", day: "mon", startMinutes: 585, endMinutes: 645 },
        { id: "c", day: "mon", startMinutes: 645, endMinutes: 690 },
      ]),
    ).toEqual([["a", "b"]]);
  });

  it("exports a standards-shaped ICS calendar with escaped user text", async () => {
    const ics = createIcsCalendar({
      calendarName: "My week",
      events: [
        {
          id: "chem-101",
          title: "CHEM 101, Lab",
          location: "Science Hall; 210",
          startsAt: "2026-09-01T14:00:00-05:00",
          endsAt: "2026-09-01T15:00:00-05:00",
        },
      ],
    });

    expect(ics).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0");
    expect(ics).toContain("SUMMARY:CHEM 101\\, Lab");
    expect(ics).toContain("LOCATION:Science Hall\\; 210");
    expect(ics).toContain("END:VCALENDAR\r\n");
  });
});
