export function sessionFixture() {
  return {
    sessions: [
      {
        type: "session",
        session_id: "UMNTC_UGRD_1269_001",
        session_code: "001",
        session_name: "Regular Academic Session",
        begin_date: "2026-09-08",
        end_date: "2026-12-16",
        enrollment_open_date: "2026-05-01",
        academic_career: { type: "academic_career", academic_career_id: "UGRD" },
        institution: { type: "institution", institution_id: "UMNTC", abbreviation: "UMNTC" },
        term: { type: "term", term_id: "1269", strm: "1269" },
      },
    ],
  };
}

/** Structurally mirrors the lowercase, misspelled-field example in the official Sessions documentation. */
export function documentedSessionFixture() {
  return {
    sessions: [
      {
        type: "session",
        session_id: "umntc_ugrd_1159_017",
        academic_career: { type: "academic_career", academic_career_id: "ugrd" },
        institution: { type: "institution", institution_id: "umntc", abbreviation: "umntc" },
        term: { type: "term", term_id: "1159", strm: "1159" },
        session_code: "017",
        session_name: "11 wk Session",
        begin_date: "2015-09-08",
        end_date: "2015-11-23",
        enrollement_open_date: "2015-05-01",
      },
    ],
  };
}

export function liveWhaleFixture(origin = "https://events.tc.umn.edu") {
  return {
    meta: { type: "events", total_results: 1, per_page: 50, page: 1, total_pages: 1 },
    links: { self: `${origin}/live/json/events` },
    data: [
      {
        id: 19_113,
        gid: 517,
        title: "Campus research showcase",
        url: `${origin}/event/19113-campus-research-showcase`,
        date: "September 8",
        date_time: "9:00am - 10:30am",
        date_iso: "2026-09-08T09:00:00-05:00",
        date2_iso: "2026-09-08T10:30:00-05:00",
        timezone: "America/Chicago",
        is_all_day: null,
        status: 1,
        is_canceled: null,
        location: "Walter Library",
        summary: "This field must not cross the parser allowlist.",
        description: "Nor may this one.",
      },
    ],
  };
}
