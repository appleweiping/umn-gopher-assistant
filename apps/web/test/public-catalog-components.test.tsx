import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CampusId } from "@umn-gopher-assistant/contracts";

import { ExploreWorkspace } from "../components/explore-workspace";
import { PreferenceControls, PreferencesProvider } from "../components/preferences";
import { TodayDashboard } from "../components/today-dashboard";
import messages from "../messages/en.json";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const institutions = {
  crookston: "UMNCR",
  duluth: "UMNDL",
  morris: "UMNMO",
  rochester: "UMNTC",
  tc: "UMNTC",
} as const;

const observationIds: Record<CampusId, string> = {
  crookston: "123e4567-e89b-42d3-a456-426614174003",
  duluth: "123e4567-e89b-42d3-a456-426614174001",
  morris: "123e4567-e89b-42d3-a456-426614174002",
  rochester: "123e4567-e89b-42d3-a456-426614174004",
  tc: "123e4567-e89b-42d3-a456-426614174000",
};

function observation(campusId: CampusId, resource: "events" | "sessions") {
  return {
    appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
    cachePolicy: "NO_CONTENT_CACHE",
    campusId,
    dataClassification: "PUBLIC",
    durationMs: 80,
    failureCode: null,
    freshnessState: "FRESH",
    httpStatus: 200,
    licenseStatus: "LIVE_ONLY",
    observationId: observationIds[campusId],
    observedAt: "2026-07-22T12:00:00.000Z",
    outcome: "SUCCESS",
    parserVersion: `${resource}@1.0.0`,
    rawByteLength: 512,
    rawSha256: "a".repeat(64),
    recordsAccepted: 1,
    recordsRejected: 0,
    sourceId: resource === "events" ? `${campusId}-events-feed` : `umn-sessions-${campusId}`,
  };
}

function catalogPage(campusId: CampusId, resource: "events" | "sessions", title?: string) {
  const sourceObservation = observation(campusId, resource);
  const item =
    resource === "events"
      ? {
          allDay: false,
          campusId,
          canonicalUrl: `https://${campusId === "duluth" ? "calendar.d" : "events.tc"}.umn.edu/event/synthetic`,
          categories: [],
          descriptionText: null,
          endsAt: "2026-09-08T15:00:00.000-05:00",
          id: `${campusId}-event-1`,
          language: "en",
          location: { address: null, coordinates: null, name: "Public room", onlineUrl: null },
          observedAt: sourceObservation.observedAt,
          sourceId: sourceObservation.sourceId,
          sourceObservationId: sourceObservation.observationId,
          startsAt: "2026-09-08T14:00:00.000-05:00",
          status: "SCHEDULED",
          timeZone: "America/Chicago",
          title: title ?? `${campusId} current event`,
        }
      : {
          academicCareerCode: "UGRD",
          beginDate: "2026-09-08",
          campusId,
          endDate: "2026-12-23",
          enrollmentOpenDate: "2026-03-01",
          id: `${campusId}-session-1`,
          institutionCode: institutions[campusId],
          name: title ?? `${campusId} fall session`,
          observedAt: sourceObservation.observedAt,
          sessionCode: "001",
          sourceId: sourceObservation.sourceId,
          sourceObservationId: sourceObservation.observationId,
          termCode: "1269",
        };
  return {
    items: [item],
    nextCursor: null,
    range: { defaulted: false, from: "2026-07-22", to: "2026-11-19" },
    retrievalCoverage: {
      nextUpstreamPage: null,
      pagesFetched: 1,
      recordsFetched: 1,
      sourceTotalPages: 1,
      sourceTotalRecords: 1,
      truncatedByPolicy: false,
    },
    sourceObservations: [sourceObservation],
  };
}

function responseFor(url: string, eventTitle?: string): Response {
  const parsed = new URL(url, "https://assistant.example");
  const campusId = parsed.searchParams.get("campusId") as CampusId;
  const resource = parsed.pathname.endsWith("/events") ? "events" : "sessions";
  return Response.json(catalogPage(campusId, resource, resource === "events" ? eventTitle : undefined));
}

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function renderCatalog(children: ReactNode, campusId: CampusId = "tc") {
  return render(
    <PreferencesProvider initialCampus={campusId} initialLocale="en" initialTheme="light">
      <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Chicago">
        {children}
      </NextIntlClientProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("public catalog UI", () => {
  it("renders observed public events and session dates with linked provenance", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => responseFor(fetchInputUrl(input)));
    renderCatalog(<TodayDashboard />);

    expect(screen.getByText("Checking the public events source…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "tc current event" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "tc fall session" })).toBeInTheDocument();
    expect(screen.getAllByText(/observed Jul 22, 2026/iu).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Twin Cities Events.*new tab/iu })).toHaveAttribute(
      "href",
      "https://events.tc.umn.edu/event/synthetic",
    );
    expect(document.body).not.toHaveTextContent(/72°F|Biology seminar|authored demo/iu);
  });

  it("discloses partial coverage when an empty event page has a continuation", async () => {
    const signedCursor = `${"a".repeat(24)}.${"b".repeat(43)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = fetchInputUrl(input);
      if (!new URL(url, "https://assistant.example").pathname.endsWith("/events")) {
        return responseFor(url);
      }
      const page = catalogPage("tc", "events");
      return Response.json({
        ...page,
        items: [],
        nextCursor: signedCursor,
        retrievalCoverage: {
          ...page.retrievalCoverage,
          nextUpstreamPage: 2,
          recordsFetched: 0,
          sourceTotalPages: 2,
          sourceTotalRecords: 1,
        },
      });
    });
    renderCatalog(<TodayDashboard />);

    expect(await screen.findByText(/No public events were returned/iu)).toBeInTheDocument();
    expect(screen.getByText(/Additional results have not been loaded/iu)).toBeInTheDocument();
  });

  it("discards obsolete campus responses even when the transport ignores abort", async () => {
    const user = userEvent.setup();
    const pending: { resolve: (response: Response) => void; url: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input) =>
        new Promise<Response>((resolve) => {
          const url = fetchInputUrl(input);
          if (url.includes("campusId=duluth")) resolve(responseFor(url, "Duluth current event"));
          else pending.push({ resolve, url });
        }),
    );
    renderCatalog(
      <>
        <PreferenceControls />
        <TodayDashboard />
      </>,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Campus" }), "duluth");
    expect(await screen.findByRole("heading", { name: "Duluth current event" })).toBeInTheDocument();
    await act(async () => {
      for (const request of pending) request.resolve(responseFor(request.url, "Obsolete Twin Cities event"));
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Obsolete Twin Cities event" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Duluth current event" })).toBeInTheDocument();
  });

  it("does not request a disabled event feed for a deep-link-only campus", async () => {
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => responseFor(fetchInputUrl(input)));
    renderCatalog(<TodayDashboard />, "morris");

    expect(await screen.findByRole("heading", { name: "morris fall session" })).toBeInTheDocument();
    expect(screen.getByText(/official event link only/iu)).toBeInTheDocument();
    expect(upstreamFetch.mock.calls.some(([input]) => fetchInputUrl(input).includes("/events"))).toBe(false);
    expect(screen.getByRole("link", { name: /Morris Events/iu })).toHaveAttribute(
      "href",
      "https://events.morris.umn.edu/",
    );
  });

  it("combines live catalog records and static official links in Explore", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => responseFor(fetchInputUrl(input)));
    renderCatalog(<ExploreWorkspace />);

    expect(await screen.findByRole("heading", { name: "tc current event" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "tc fall session" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Campus transit" })).toBeInTheDocument();
    expect(screen.getAllByText(/Observed public data/iu).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Official link/iu).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent(/project-authored|checked 2026|open now/iu);
  });

  it("keeps official entries usable when live catalog responses fail contract validation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items: "malformed" }));
    renderCatalog(<ExploreWorkspace />);

    expect(await screen.findByText(/Live events are temporarily unavailable/iu)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Academic session dates are temporarily unavailable/iu)).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Campus maps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Campus transit" })).toBeInTheDocument();
  });

  it("loads an explicitly requested signed-cursor continuation without persisting it", async () => {
    const user = userEvent.setup();
    const signedCursor = `${"a".repeat(24)}.${"b".repeat(43)}`;
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = fetchInputUrl(input);
      const parsed = new URL(url, "https://assistant.example");
      if (!parsed.pathname.endsWith("/events")) return responseFor(url);
      const result = structuredClone(catalogPage("tc", "events"));
      if (parsed.searchParams.get("cursor") === null) {
        return Response.json({ ...result, nextCursor: signedCursor });
      }
      const firstItem = result.items[0];
      if (firstItem === undefined || !("title" in firstItem)) throw new Error("Missing synthetic event");
      const nextObservation = {
        ...result.sourceObservations[0],
        observationId: "123e4567-e89b-42d3-a456-426614174009",
        observedAt: "2026-07-22T12:01:00.000Z",
        recordsAccepted: 2,
      };
      const repeatedItem = {
        ...firstItem,
        observedAt: nextObservation.observedAt,
        sourceObservationId: nextObservation.observationId,
      };
      return Response.json({
        ...result,
        items: [repeatedItem, { ...repeatedItem, id: "tc-event-2", title: "Second observed event" }],
        nextCursor: null,
        retrievalCoverage: {
          ...result.retrievalCoverage,
          recordsFetched: 2,
          sourceTotalRecords: 2,
        },
        sourceObservations: [nextObservation],
      });
    });
    renderCatalog(<ExploreWorkspace />);

    expect(await screen.findByRole("button", { name: "Load more events" })).toBeInTheDocument();
    expect(screen.getByText(/Additional results have not been loaded/iu)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more events" }));
    expect(await screen.findByRole("heading", { name: "Second observed event" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "tc current event" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more events" })).not.toBeInTheDocument();
    expect(
      upstreamFetch.mock.calls.some(([input]) => {
        const url = new URL(fetchInputUrl(input), "https://assistant.example");
        return url.searchParams.get("cursor") === signedCursor;
      }),
    ).toBe(true);
  });

  it("keeps existing results when a continuation repeats an ID with conflicting content", async () => {
    const user = userEvent.setup();
    const signedCursor = `${"c".repeat(24)}.${"d".repeat(43)}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = fetchInputUrl(input);
      const parsed = new URL(url, "https://assistant.example");
      if (!parsed.pathname.endsWith("/events")) return responseFor(url);
      const result = structuredClone(catalogPage("tc", "events"));
      if (parsed.searchParams.get("cursor") === null) {
        return Response.json({ ...result, nextCursor: signedCursor });
      }
      const firstItem = result.items[0];
      if (firstItem === undefined || !("title" in firstItem)) throw new Error("Missing synthetic event");
      return Response.json({
        ...result,
        items: [{ ...firstItem, title: "Conflicting event title" }],
        nextCursor: null,
      });
    });
    renderCatalog(<ExploreWorkspace />);

    await user.click(await screen.findByRole("button", { name: "Load more events" }));
    expect(await screen.findByText(/More events could not be loaded/iu)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "tc current event" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Conflicting event title" })).not.toBeInTheDocument();
  });
});
