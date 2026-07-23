"use client";

import type {
  AiCitation,
  AiQueryResponse,
  AiQueryState,
  CampusId,
  FreshnessState,
  VerificationState,
} from "@umn-gopher-assistant/contracts";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
  type SubmitEventHandler,
} from "react";

import type { Locale } from "../lib/data/registry";
import { useAiQuery } from "../lib/ai/use-ai-query";

const examples: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    "When is the library open?",
    "Where can I get student services help?",
    "Where can I find campus safety information?",
  ],
  "zh-CN": ["图书馆什么时候开放？", "我可以在哪里获得学生服务帮助？", "校园安全信息在哪里？"],
};

function localizedTitle(citation: AiCitation, locale: Locale): string {
  return citation.title[locale];
}

function formattedDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function stateClassName(state: AiQueryState): string {
  return `ai-state ai-state-${state}`;
}

type QueryErrorKind = "input" | "rate-limit" | "unavailable";

function queryErrorKind(failureCode: string): QueryErrorKind {
  if (
    ["AI_QUERY_REJECTED", "AI_QUERY_TOO_LARGE", "INVALID_AI_QUERY", "UNSUPPORTED_MEDIA_TYPE"].includes(
      failureCode,
    )
  ) {
    return "input";
  }
  return failureCode === "AI_RATE_LIMITED" ? "rate-limit" : "unavailable";
}

function CitationCard(props: {
  readonly citation: AiCitation;
  readonly index: number;
  readonly locale: Locale;
}) {
  const t = useTranslations("ai");
  const title = localizedTitle(props.citation, props.locale);
  return (
    <li
      aria-labelledby={`ai-citation-title-${props.citation.id}`}
      className="citation-card"
      id={`ai-citation-${props.citation.id}`}
      tabIndex={-1}
    >
      <article aria-labelledby={`ai-citation-title-${props.citation.id}`}>
        <div className="citation-card-heading">
          <span className="citation-number" aria-hidden="true">
            {props.index + 1}
          </span>
          <div>
            <h4 id={`ai-citation-title-${props.citation.id}`}>{title}</h4>
            <p className="citation-category">{t(`category.${props.citation.category}`)}</p>
          </div>
        </div>
        <p className="citation-excerpt">
          <strong>{t("excerpt")}</strong> {props.citation.excerpt}
        </p>
        <dl className="citation-metadata">
          <div>
            <dt>{t("updated")}</dt>
            <dd>
              <time dateTime={props.citation.updatedAt}>
                {formattedDate(props.citation.updatedAt, props.locale)}
              </time>
            </dd>
          </div>
          <div>
            <dt>{t("freshness")}</dt>
            <dd>
              {t(
                `freshnessState.${props.citation.freshnessState}` satisfies `freshnessState.${FreshnessState}`,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("verification")}</dt>
            <dd>
              {t(
                `verificationState.${props.citation.verificationState}` satisfies `verificationState.${VerificationState}`,
              )}
            </dd>
          </div>
        </dl>
        <a
          aria-label={`${t("openOfficial", { title })} ${t("opensNewTab")}`}
          className="button button-quiet citation-link"
          href={props.citation.sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("openOfficial", { title })}
        </a>
      </article>
    </li>
  );
}

function EvidenceAnswer(props: {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly locale: Locale;
  readonly response: AiQueryResponse;
}) {
  const t = useTranslations("ai");
  const citationIndexes = useMemo(
    () => new Map(props.response.citations.map((citation, index) => [citation.id, index] as const)),
    [props.response.citations],
  );
  const hasOutdatedEvidence = props.response.citations.some(
    (citation) => citation.freshnessState === "STALE" || citation.freshnessState === "EXPIRED",
  );

  return (
    <section className="answer-panel" aria-labelledby="ai-answer-title">
      <div className="answer-heading">
        <div>
          <p className="section-kicker">{t("evidenceAnswer")}</p>
          <h3 id="ai-answer-title" ref={props.headingRef} tabIndex={-1}>
            {t(`stateTitle.${props.response.state}`)}
          </h3>
        </div>
        <span className={stateClassName(props.response.state)}>
          {t(`stateLabel.${props.response.state}`)}
        </span>
      </div>
      {props.response.state === "stale" || (props.response.state === "conflict" && hasOutdatedEvidence) ? (
        <p className="notice notice-warning" role="status">
          {t("staleWarning")}
        </p>
      ) : null}
      {props.response.state === "conflict" ? (
        <p className="notice notice-danger" role="status">
          {t("conflictWarning")}
        </p>
      ) : null}
      <div className="answer-copy">
        {props.response.paragraphs.map((paragraph) => (
          <p data-testid="answer-paragraph" key={paragraph.id}>
            {paragraph.text}{" "}
            <span className="paragraph-citations" aria-label={t("paragraphSources")} role="group">
              {paragraph.citationIds.map((citationId) => {
                const citationIndex = citationIndexes.get(citationId);
                if (citationIndex === undefined) return null;
                const citation = props.response.citations[citationIndex];
                if (citation === undefined) return null;
                return (
                  <sup key={citationId}>
                    <a
                      aria-label={t("citationMarker", {
                        number: citationIndex + 1,
                        title: localizedTitle(citation, props.locale),
                      })}
                      href={`#ai-citation-${citation.id}`}
                      onClick={() => {
                        document.getElementById(`ai-citation-${citation.id}`)?.focus({ preventScroll: true });
                      }}
                    >
                      [{citationIndex + 1}]
                    </a>
                  </sup>
                );
              })}
            </span>
          </p>
        ))}
      </div>
      <div className="retrieval-summary">
        <span>{t("retrievalMode")}</span>
        <span>{t("documentsConsidered", { count: props.response.retrieval.documentsConsidered })}</span>
      </div>
      <h3 className="citation-heading">{t("sources")}</h3>
      <ol className="citation-list" aria-label={t("sources")}>
        {props.response.citations.map((citation, index) => (
          <CitationCard citation={citation} index={index} key={citation.id} locale={props.locale} />
        ))}
      </ol>
    </section>
  );
}

export function AssistantWorkbench(props: { readonly campus: CampusId; readonly locale: Locale }) {
  const t = useTranslations("ai");
  const [query, setQuery] = useState("");
  const { state, submit } = useAiQuery(props.campus, props.locale);
  const answerTitleRef = useRef<HTMLHeadingElement>(null);
  const emptyTitleRef = useRef<HTMLHeadingElement>(null);
  const errorTitleRef = useRef<HTMLHeadingElement>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.status === "error") {
      const target = queryErrorKind(state.failureCode) === "input" ? queryRef.current : errorTitleRef.current;
      target?.focus({ preventScroll: false });
    } else if (state.status === "success") {
      const target = state.response.state === "no-results" ? emptyTitleRef.current : answerTitleRef.current;
      target?.focus({ preventScroll: false });
    }
  }, [state]);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    void submit(query);
  };

  const handleQuery = (event: ChangeEvent<HTMLTextAreaElement>) => setQuery(event.currentTarget.value);
  const busy = state.status === "loading";
  const errorKind = state.status === "error" ? queryErrorKind(state.failureCode) : null;
  const queryHasError = errorKind === "input";
  const errorTitle =
    errorKind === "input"
      ? t("invalidQueryTitle")
      : errorKind === "rate-limit"
        ? t("rateLimitTitle")
        : t("errorTitle");
  const errorBody =
    errorKind === "input"
      ? t("invalidQueryBody")
      : errorKind === "rate-limit"
        ? t("rateLimitBody")
        : t("errorBody");

  return (
    <div className="assistant-workbench">
      <p className="active-campus">
        <strong>{t("activeCampus")}</strong> {t(`campus.${props.campus}`)}
      </p>
      <div className="example-prompts" aria-label={t("examples")} role="group">
        {examples[props.locale].map((example) => (
          <button
            className="prompt-chip"
            disabled={busy}
            key={example}
            onClick={() => setQuery(example)}
            type="button"
          >
            {example}
          </button>
        ))}
      </div>
      <form className="assistant-form" onSubmit={handleSubmit} role="search">
        <label htmlFor="assistant-query">{t("queryLabel")}</label>
        <textarea
          aria-describedby={
            queryHasError ? "assistant-query-help assistant-query-error" : "assistant-query-help"
          }
          aria-errormessage={queryHasError ? "assistant-query-error" : undefined}
          aria-invalid={queryHasError || undefined}
          disabled={busy}
          id="assistant-query"
          maxLength={500}
          minLength={2}
          onChange={handleQuery}
          required
          ref={queryRef}
          rows={4}
          value={query}
        />
        <div className="assistant-form-footer">
          <p className="fine-print" id="assistant-query-help">
            {t("queryHelp")}
          </p>
          <button className="button" disabled={busy} type="submit">
            {busy ? t("searching") : t("search")}
          </button>
        </div>
      </form>

      {busy ? (
        <p className="ai-progress" role="status" aria-live="polite">
          <span className="status-dot" aria-hidden="true" /> {t("loading")}
        </p>
      ) : null}

      <div aria-busy={busy} className="ai-result-focus">
        {state.status === "error" ? (
          <section className="notice notice-danger" role="alert" aria-labelledby="ai-error-title">
            <h3 id="ai-error-title" ref={errorTitleRef} tabIndex={-1}>
              {errorTitle}
            </h3>
            <p id={queryHasError ? "assistant-query-error" : undefined}>{errorBody}</p>
            <p className="fine-print">{t("errorCode", { code: state.failureCode })}</p>
          </section>
        ) : null}
        {state.status === "success" && state.response.state === "no-results" ? (
          <section className="notice notice-warning" role="region" aria-labelledby="ai-empty-title">
            <h3 id="ai-empty-title" ref={emptyTitleRef} tabIndex={-1}>
              {t("stateTitle.no-results")}
            </h3>
            <p>{t("noResults")}</p>
            <p className="fine-print">
              {t("documentsConsidered", { count: state.response.retrieval.documentsConsidered })}
            </p>
          </section>
        ) : null}
        {state.status === "success" && state.response.state !== "no-results" ? (
          <EvidenceAnswer headingRef={answerTitleRef} locale={props.locale} response={state.response} />
        ) : null}
      </div>
    </div>
  );
}
