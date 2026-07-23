"use client";

import type { AiQueryResponse, CampusId } from "@umn-gopher-assistant/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "../data/registry";
import { AiQueryRequestError, queryCampusIndex } from "./client";

export type AiQueryState =
  | { readonly status: "idle" }
  | { readonly campusId: CampusId; readonly locale: Locale; readonly status: "loading" }
  | {
      readonly campusId: CampusId;
      readonly failureCode: string;
      readonly locale: Locale;
      readonly status: "error";
    }
  | { readonly response: AiQueryResponse; readonly status: "success" };

export function useAiQuery(campusId: CampusId, locale: Locale) {
  const [state, setState] = useState<AiQueryState>({ status: "idle" });
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestSequence.current += 1;
    setState({ status: "idle" });
  }, [campusId, locale]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  const submit = useCallback(
    async (query: string): Promise<void> => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      requestSequence.current += 1;
      const sequence = requestSequence.current;
      setState({ campusId, locale, status: "loading" });
      try {
        const response = await queryCampusIndex({ campusId, locale, query }, controller.signal);
        if (!controller.signal.aborted && requestSequence.current === sequence) {
          setState({ response, status: "success" });
        }
      } catch (error) {
        if (!controller.signal.aborted && requestSequence.current === sequence) {
          setState({
            campusId,
            failureCode: error instanceof AiQueryRequestError ? error.failureCode : "AI_SERVICE_UNAVAILABLE",
            locale,
            status: "error",
          });
        }
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
      }
    },
    [campusId, locale],
  );

  const stateMatchesScope =
    state.status === "idle" ||
    (state.status === "success"
      ? state.response.campusId === campusId && state.response.locale === locale
      : state.campusId === campusId && state.locale === locale);
  return { state: stateMatchesScope ? state : ({ status: "idle" } as const), submit } as const;
}
