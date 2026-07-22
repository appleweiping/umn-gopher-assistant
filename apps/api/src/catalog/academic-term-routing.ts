/**
 * Reviewed UMN term identifiers, not inferred PeopleSoft codes. The registry
 * was checked against the official One Stop/OCM term material on 2026-07-22.
 * Routing windows are deliberately broad local-calendar seasons used only to
 * choose at most three bounded API filters; returned session dates remain the
 * authority and are filtered again after parsing.
 */
const REVIEWED_TERM_WINDOWS = Object.freeze([
  { from: "2026-05-01", termId: "1265", to: "2026-08-31" },
  { from: "2026-08-01", termId: "1269", to: "2026-12-31" },
  { from: "2027-01-01", termId: "1273", to: "2027-05-31" },
  { from: "2027-05-01", termId: "1275", to: "2027-08-31" },
  { from: "2027-08-01", termId: "1279", to: "2027-12-31" },
  { from: "2028-01-01", termId: "1283", to: "2028-05-31" },
] as const);

// Adjacent unreviewed terms may overlap May/August. Keeping the public support
// boundary inside the reviewed sequence prevents a partial response from being
// presented as complete.
export const REVIEWED_SESSION_RANGE = Object.freeze({
  from: "2026-06-01",
  to: "2028-04-30",
});

export function reviewedTermIdsForRange(from: string, to: string): readonly string[] | null {
  if (from < REVIEWED_SESSION_RANGE.from || to > REVIEWED_SESSION_RANGE.to) return null;
  const termIds = REVIEWED_TERM_WINDOWS.filter((term) => term.to >= from && term.from <= to).map(
    (term) => term.termId,
  );
  if (termIds.length < 1 || termIds.length > 3) return null;
  return Object.freeze(termIds);
}
