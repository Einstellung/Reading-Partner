// Why an original was not read, as typed records (docs/info/88 「看原文」, the
// failure vocabulary of docs/research 开源读论文与读资料项目调研 §3). Every step
// of a read — the arXiv API, the HTML, the PDF, the page, the README — leaves a
// record, ok or not; a failure has a code, whether trying again later can help,
// and the program's own words for it. The words still make up the plain reason
// the write-up and the book show; the codes are for whatever plans a retry.
//
// Pure: no I/O. Result files written before 2026-10-18 hold only the plain
// reason; `failuresOf` reads those back as one record of code "unknown".

import type { Rejection } from "../../workshop/bindery";
import { isAbortError } from "../../platform/app/abort";
import { isHostCoolingDown, isRateLimitError } from "../../platform/http/host-gate";
import { isHttpStatusError } from "../../platform/http/throttled-fetch";

/** A step of reading one original. */
export type ReadStep =
  /** arXiv's export API: a paper's metadata. */
  | "api"
  /** arXiv's HTML version of a paper. */
  | "html"
  /** A PDF's text layer. */
  | "pdf"
  /** 86's open route for a link: a reader, a site adapter, the generic page read. */
  | "page"
  /** A post's own page on X, read whole. */
  | "post"
  /** The counted GitHub lookup: a repository's facts. */
  | "lookup"
  /** A repository's README. */
  | "readme"
  /** Before any step: a file written before steps were kept. */
  | "unknown";

export type FailureCode =
  /** 404/410, no such repository, no such API entry. */
  | "not_found"
  /** The format asked for does not exist: arXiv has no HTML version (pitfall 377). */
  | "no_such_format"
  /** A bot challenge or an access-denied page; 88 rule 3: stop for this run. */
  | "blocked"
  /** A sign-in, paywall or consent wall. */
  | "login_wall"
  /** A page that is only scripts. */
  | "js_shell"
  /** Less text than the content needs, or none. */
  | "too_short"
  /** A PDF with no text layer (a scan). */
  | "no_text_layer"
  /** Not what the route reads: a PDF's bytes in a text route. */
  | "wrong_content"
  /** 429, or a quota spent. */
  | "rate_limited"
  /** The host is cooling down from a rate limit; nothing was sent. */
  | "cooling_down"
  /** 5xx, DNS, TLS, a dropped connection, or an error nobody named. */
  | "upstream_error"
  /** The step ran out of time. */
  | "timeout"
  /** More bytes than a read takes in. */
  | "too_large"
  /** Something nothing here reads: not a page, a PDF or an EPUB. */
  | "unsupported"
  /** The run's own allowance (X pages today, GitHub lookups) is spent. */
  | "budget_spent"
  /** A file written before codes were kept: only the words are known. */
  | "unknown";

/** Whether the same read, tried again later, can succeed. */
export const RETRYABLE: Readonly<Record<FailureCode, boolean>> = {
  not_found: false,
  no_such_format: false,
  blocked: false,
  login_wall: false,
  js_shell: false,
  too_short: false,
  no_text_layer: false,
  wrong_content: false,
  rate_limited: true,
  cooling_down: true,
  upstream_error: true,
  timeout: true,
  too_large: false,
  unsupported: false,
  budget_spent: true,
  unknown: false,
};

export interface ReadFailure {
  step: ReadStep;
  code: FailureCode;
  retryable: boolean;
  /** The program's words, an English clause: what the plain reason is made of. */
  detail: string;
  /** What the step asked for, when not the original's own address. */
  url?: string;
}

/** One step of one read: what it asked for and how it went. */
export type StepRecord = { step: ReadStep; ok: true; url?: string } | ({ ok: false } & ReadFailure);

/** One original tried for an item: what it was, how it ended, its steps in order. */
export interface ReadTrace {
  /** The original's address. */
  url: string;
  /** read: every step that ran went through; partial: read, but a step failed; unread: nothing usable. */
  outcome: "read" | "partial" | "unread";
  steps: StepRecord[];
}

export function failure(step: ReadStep, code: FailureCode, detail: string, url?: string): ReadFailure {
  return { step, code, retryable: RETRYABLE[code], detail, ...(url ? { url } : {}) };
}

export function failedStep(f: ReadFailure): StepRecord {
  return { ok: false, ...f };
}

export function okStep(step: ReadStep, url?: string): StepRecord {
  return { step, ok: true, ...(url ? { url } : {}) };
}

/** The code an HTTP status that is not a 200 stands for. */
export function codeOfStatus(status: number): FailureCode {
  if (status === 404 || status === 410) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 402) return "login_wall";
  if (status === 403) return "blocked";
  if (status === 408 || status === 504) return "timeout";
  if (status === 413) return "too_large";
  return status >= 500 || status === 0 ? "upstream_error" : "not_found";
}

/**
 * The code a thrown error stands for: the host gate's classes first, then the
 * words they and our fetches use ("… answered HTTP 404"), since an error that
 * crossed a seam may have lost its class.
 */
export function codeOfError(e: unknown): FailureCode {
  if (isHostCoolingDown(e)) return e.refused ? "rate_limited" : "cooling_down";
  if (isRateLimitError(e)) return "rate_limited";
  if (isHttpStatusError(e)) return codeOfStatus(e.status);
  if (isAbortError(e) || (e instanceof Error && e.name === "TimeoutError")) return "timeout";
  const msg = e instanceof Error ? e.message : String(e);
  if (/cooling down after a rate limit[^;]*; no request sent/i.test(msg)) return "cooling_down";
  if (/\bHTTP 429\b|rate.limit/i.test(msg)) return "rate_limited";
  const status = /answered HTTP (\d{3})/.exec(msg)?.[1];
  return status ? codeOfStatus(Number(status)) : "upstream_error";
}

/** The code a bindery or open-route rejection stands for. */
export function codeOfRejection(r: Pick<Rejection, "reason" | "status">): FailureCode {
  switch (r.reason) {
    case "empty":
    case "too-short":
      return "too_short";
    case "login-wall":
      return "login_wall";
    case "blocked":
      return "blocked";
    case "js-shell":
      return "js_shell";
    case "wrong-content":
      return "wrong_content";
    case "error-page":
      return "not_found";
    case "too-large":
      return "too_large";
    case "rate-limited":
      return "rate_limited";
    case "no-adapter":
      return "unsupported";
    case "unreachable":
      return r.status !== undefined ? codeOfStatus(r.status) : "upstream_error";
  }
}

/** A read's trace: unread when it failed, else partial when any step failed. */
export function traceOf(url: string, ok: boolean, steps: readonly StepRecord[]): ReadTrace {
  const outcome = !ok ? "unread" : steps.some((s) => !s.ok) ? "partial" : "read";
  return { url, outcome, steps: [...steps] };
}

/**
 * The failures an item's verify record holds, each with whether a retry can
 * help: from its traces, or, in a file written before traces were kept, its
 * plain reason as one record of code "unknown". For retry planning to read.
 */
export function failuresOf(verify: { reason: string | null; reads?: readonly ReadTrace[] }): ReadFailure[] {
  if (verify.reads) return verify.reads.flatMap((r) => r.steps.filter((s): s is Extract<StepRecord, { ok: false }> => !s.ok)).map(({ ok: _, ...f }) => f);
  return verify.reason ? [failure("unknown", "unknown", verify.reason)] : [];
}

/** Whether an unread original of an item could be read by trying again later. */
export function retryableUnread(verify: { reason: string | null; reads?: readonly ReadTrace[] }): boolean {
  if (!verify.reads) return false;
  return verify.reads.some((r) => r.outcome === "unread" && r.steps.some((s) => !s.ok && s.retryable));
}
