// What background_status says about a topic-search run (docs/info/88 「进度」;
// the generic entry is legion/status). Counts and outcomes only, worked out by
// the program: never a post's text, never a raw log.
//
// Where each piece is: the X progress file, the arXiv and Hugging Face reads and the run's source health are in
// the run directory, on the computer that ran it only (run-state.ts); this
// device's halt and X session are its own. The result files and the info shelf
// sync. The collector's claim carries its source health, whether it has an X
// session and its last halt to the other devices, as of its last write. So on
// the computer that runs it the detail is the run's own, and anywhere else it is
// what that computer last said, labelled as such.

import { WEBVIEW_FETCH, type DeviceClaim } from "../../legion/claim";
import type { Run } from "../../legion/run";
import type { RunAbout, RunDescriber, RunView } from "../../legion/status/registry";
import type { SourceHealth } from "../sources/engine";
import { X_SIGN_IN_URL } from "../sources/x-search";
import { paperProgressLine, type ArxivRead } from "./arxiv-read";
import { SOURCE_NAME, sourceNames, sourcesOfPace, splitsFirstLook, type RunSource } from "./pace";
import type { SourceHealthEntry, SourceHealthFile } from "./build-result";
import type { XHaltRecord } from "./halt";
import type { TopicSearchResult } from "./result-types";
import { parseBrief, TOPIC_SEARCH_KIND, type TopicSearchBrief } from "./run";
import { TOPIC_SEARCH_HEALTH_PREFIX } from "./source-health";
import type { TopicSearch } from "./types";
import { tallySteps, type XStep } from "./x-progress";

const X_HOST = new URL(X_SIGN_IN_URL).hostname;

/** One issue on the info shelf, as much as the status needs (info/issue/types.ts IssueEntry). */
export interface ShelfIssue {
  key: string;
  number: number;
  date: string;
  topics: { searchId: string }[];
}

/** The collector's claim, as much as the status reads (info/briefer/handoff.ts CollectorClaim). */
type CollectorView = DeviceClaim & { sources?: Record<string, SourceHealth>; sites?: Record<string, boolean>; halt?: string | null };

export interface TopicSearchStatusDeps {
  searches(): Promise<readonly TopicSearch[]>;
  /** The run's X progress steps, or null when this device has no progress file for it. */
  steps(runId: string): Promise<XStep[] | null>;
  /** What the run's arXiv read has on file (arxiv-read.ts), or null when this device has none for it. */
  arxivRead(runId: string): Promise<ArxivRead | null>;
  /** What the run's Hugging Face read has on file (hf-read.ts), or null when this device has none for it. */
  hfRead(runId: string): Promise<ArxivRead | null>;
  /** The run directory's source health, or null when this device has none for it. */
  runHealth(runId: string): Promise<SourceHealthFile | null>;
  /** The search's result files on this device. */
  results(searchId: string): Promise<TopicSearchResult[]>;
  issues(): Promise<ShelfIssue[]>;
  /** X on this device: the halt record and the session sidecar's answer (null: never checked). */
  localX(): Promise<{ halt: XHaltRecord | null; signedIn: boolean | null }>;
}

function titleOf(brief: TopicSearchBrief, name: string): string {
  const what =
    brief.kind === "first"
      ? "first look"
      : brief.kind === "retry"
        ? `retry #${brief.n ?? 1} of the first look`
        : `nightly run for the night of ${brief.night}`;
  return `topic search "${name}": ${what}`;
}

const SKIPPED = "skipped:";

export function aboutTopicSearchRun(run: Run, searches: readonly TopicSearch[]): RunAbout {
  const brief = parseBrief(run.brief);
  if (!brief) return { title: "topic search run", subjects: [TOPIC_SEARCH_KIND] };
  const search = searches.find((s) => s.id === brief.searchId);
  const skipped = run.state === "done" && run.progress?.startsWith(SKIPPED) ? run.progress.slice(SKIPPED.length).trim() : null;
  return {
    title: titleOf(brief, search?.name ?? brief.searchId),
    subjects: [brief.searchId, ...(search ? [search.name] : [])],
    skipped,
  };
}

function queryLabel(search: TopicSearch | undefined, query: string, source: RunSource): string {
  const q = search?.queries.find((x) => x.id === query);
  return `"${(source === "x" ? q?.x : q?.arxiv) ?? query}"`;
}

type HealthLineEntry = Pick<SourceHealthEntry, "query" | "source" | "status" | "read" | "fresh" | "ladder" | "note"> & { why?: string | null };

function outcome(e: HealthLineEntry): string {
  if (e.status === "failed") return `failed${e.why ? ` (${e.why})` : ""}`;
  const ladder = e.ladder ? `${e.ladder.outcome}, ` : "";
  return `${ladder}${e.read} read, ${e.fresh} new`;
}

/** Per-query outcome lines, X, then arXiv, then Hugging Face; a source's warnings after its line, each once. */
export function healthLines(entries: readonly HealthLineEntry[], search: TopicSearch | undefined): string[] {
  const out: string[] = [];
  for (const source of ["x", "arxiv", "huggingface"] as const) {
    const mine = entries.filter((e) => e.source === source);
    if (!mine.length) continue;
    out.push(`${SOURCE_NAME[source]} per query: ${mine.map((e) => `${queryLabel(search, e.query, source)} ${outcome(e)}`).join("; ")}.`);
    const notes = [...new Set(mine.map((e) => e.note).filter((n): n is string => !!n))];
    for (const note of notes) out.push(`${SOURCE_NAME[source]} warning: ${note}.`);
  }
  return out;
}

/**
 * The run's arXiv read before the build has written the source health: how far
 * it got, and each searched query's ladder outcome and papers. arXiv runs beside
 * X, so it is usually done while X is still being read. Hugging Face's read
 * says the same with `source`.
 */
export function arxivLines(
  read: ArxivRead,
  search: TopicSearch | undefined,
  open: boolean,
  split = false,
  source: "arxiv" | "huggingface" = "arxiv",
): string[] {
  const name = SOURCE_NAME[source];
  const head = paperProgressLine(name, read);
  const after = split ? "the first part is built from it without waiting for X" : "the result is built once X has been read";
  const lines = [read.done && open && read.planned.length ? `${head}; ${after}.` : `${head}.`];
  if (read.found.length) {
    const each = read.found.map((f) => {
      const papers = `${f.items.length} paper${f.items.length === 1 ? "" : "s"}`;
      return `${queryLabel(search, f.query, source)} ${f.error ? `failed (${f.error})` : `${f.ladder?.outcome ?? "searched"}, ${papers}`}`;
    });
    lines.push(`${name} per query: ${each.join("; ")}.`);
  }
  return lines;
}

/** The claim's source health lines of one search, as the generic entry's (search, query, source) records. */
function claimEntries(claim: CollectorView, searchId: string) {
  const prefix = `${TOPIC_SEARCH_HEALTH_PREFIX}${searchId}:`;
  return Object.entries(claim.sources ?? {})
    .filter(([key, h]) => key.startsWith(prefix) && h.topicSearch)
    .map(([, h]) => ({ ...h.topicSearch!, why: h.lastError ?? null }));
}

const startOf = (run: Run) => run.startedAt ?? run.createdAt;
const unfinished = (run: Run) => run.state === "pending" || run.state === "running";

export function resultLine(run: Run, brief: TopicSearchBrief, results: readonly TopicSearchResult[]): string {
  const open = unfinished(run);
  if (brief.kind === "retry") {
    for (const r of results) {
      const rec = r.retries?.find((x) => x.runId === run.id);
      if (rec) return `Result: this retry added ${rec.items.length} item${rec.items.length === 1 ? "" : "s"} to the first look's result (now ${r.items.length}).`;
    }
    return open
      ? "Result: nothing added yet; what it finds is added to the first look's result when its build finishes."
      : "Result: this device's copy of the first look's result shows nothing added by this retry.";
  }
  const file = run.output ? run.output.replace(/^.*\//, "").replace(/\.json$/, "") : null;
  const mine = results
    .filter((r) => r.kind === brief.kind && (file ? r.id === file : r.createdAt >= startOf(run)))
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const split = splitsFirstLook(brief.kind);
  if (!mine) {
    if (!open) return "Result: no result file on this device (yet).";
    return split
      ? `Result: not written yet; the first part (${sourceNames(sourcesOfPace("fast"))}) is written when its build finishes, before X is read.`
      : "Result: not written yet; it is written when the build finishes.";
  }
  const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const slow = (mine.retries ?? []).find((r) => r.part === "slow" && r.runId === run.id);
  const fromRetries = (mine.retries ?? []).filter((r) => r !== slow).reduce((n, r) => n + r.items.length, 0);
  const own = mine.items.length - fromRetries - (slow?.items.length ?? 0);
  const retried = fromRetries ? ` (and ${fromRetries} more added by retries)` : "";
  if (mine.awaiting?.length) {
    const what = sourceNames(mine.awaiting);
    return open
      ? `Result: first part delivered with ${items(own)}; ${what} is still being read, and what it finds is added to the same file.`
      : `Result: first part delivered with ${items(own)}; the run ended before ${what} was added.`;
  }
  if (mine.empty || mine.items.length === 0) return slow ? "Result: written, nothing new in it, from either part." : "Result: written, nothing new in it.";
  if (slow) return `Result: ${items(own)} in the first part, ${slow.items.length} more added once X was read${retried}.`;
  return `Result: ${items(own)}${retried}.`;
}

export function issueLine(run: Run, brief: TopicSearchBrief, issues: readonly ShelfIssue[], results: readonly TopicSearchResult[]): string {
  const open = unfinished(run);
  if (splitsFirstLook(brief.kind)) {
    // Two issues: the first part's, and what the slow part added (keyed like a retry's).
    const first = issues.find((i) => i.key === `first:${brief.searchId}`);
    const later = issues.find((i) => i.key === `first:${brief.searchId}#${run.id}`);
    const slow = sourceNames(sourcesOfPace("slow"));
    const record = results.flatMap((r) => r.retries ?? []).find((x) => x.runId === run.id && x.part === "slow");
    const head = first
      ? `the first part is No. ${first.number} (${first.date}) on the shelf`
      : open
        ? "the first part's is made as soon as its build finishes"
        : "none for the first part on this device's shelf (nothing new in it, or not synced yet)";
    const tail = later
      ? `${slow}'s part is No. ${later.number} (${later.date})`
      : record && record.items.length === 0
        ? `${slow}'s part added nothing, so it has none`
        : open
          ? `${slow}'s part gets one of its own once ${slow} has been read`
          : `${slow}'s part is not on this device's shelf yet`;
    return `Brief issue: ${head}; ${tail}.`;
  }
  const key = brief.kind === "first" ? `first:${brief.searchId}` : brief.kind === "retry" ? `first:${brief.searchId}#${run.id}` : `night:${brief.night}`;
  const issue = issues.find((i) => i.key === key);
  if (issue) {
    if (brief.kind === "daily" && !issue.topics.some((t) => t.searchId === brief.searchId)) {
      return `Brief issue: No. ${issue.number} (${issue.date}) came out without this topic (nothing new for it).`;
    }
    return `Brief issue: No. ${issue.number} (${issue.date}) is on the shelf.`;
  }
  if (open) return "Brief issue: not yet; it is made after the run closes.";
  if (brief.kind === "retry" && !results.some((r) => r.retries?.some((x) => x.runId === run.id && x.items.length > 0))) {
    return "Brief issue: none, since this retry added nothing.";
  }
  return "Brief issue: not on this device's shelf yet (the computer makes it after the run closes; then it syncs).";
}

export function localXLine(x: { halt: XHaltRecord | null; signedIn: boolean | null }, view: Pick<RunView, "ago">): string {
  const { halt } = x;
  if (halt?.kind === "signed-out") return `X on this device: signed out (found ${view.ago(halt.at)}); the reader signs in at Settings > Accounts.`;
  if (halt?.paused) return `X on this device: paused after a second ${halt.kind} until the reader says to resume.`;
  if (halt && halt.kind !== "structure") return `X on this device: met a ${halt.kind} ${view.ago(halt.at)}; the next night is skipped.`;
  if (x.signedIn === false) return "X on this device: signed out; the reader signs in at Settings > Accounts.";
  if (x.signedIn === true) return "X on this device: signed in, not paused.";
  return "X on this device: its sign-in has not been checked yet.";
}

export function remoteXLine(claim: CollectorView | null, view: Pick<RunView, "ago">): string {
  const site = claim?.sites?.[X_HOST];
  if (!claim || (site === undefined && !claim.halt)) return "X's sign-in and pauses are known only on the computer that reads X.";
  const name = claim.deviceName ? `"${claim.deviceName}"` : "the computer";
  const state = site === true ? "signed in" : site === false ? "signed out" : "sign-in unknown";
  return `X on ${name}, as it last reported ${view.ago(claim.heartbeatAt)}: ${state}${claim.halt ? `; its last halt: ${claim.halt}` : ""}.`;
}

export function topicSearchDescriber(deps: TopicSearchStatusDeps): RunDescriber {
  return {
    kind: TOPIC_SEARCH_KIND,
    about: async (run) => aboutTopicSearchRun(run, await deps.searches()),
    detail: async (view) => {
      const { run } = view;
      const brief = parseBrief(run.brief);
      if (!brief) return [];
      const search = (await deps.searches()).find((s) => s.id === brief.searchId);
      const open = unfinished(run);
      const lines: string[] = [];
      const split = splitsFirstLook(brief.kind);
      if (view.here) {
        const steps = await deps.steps(run.id);
        if (steps?.length) lines.push(`X: ${tallySteps(steps).line()}.`);
        else if (run.state === "running") lines.push(split ? "X: not started; it is read after the first part is delivered." : "X: nothing read yet on this device.");
        const health = await deps.runHealth(run.id);
        // A split first look's slow part rewrites the run's health with X alone; the paper sources' are then on their read files.
        if (health) lines.push(...healthLines(health.entries, search));
        for (const source of ["arxiv", "huggingface"] as const) {
          const onFile = !health || !health.entries.some((e) => e.source === source);
          const read = onFile ? await (source === "arxiv" ? deps.arxivRead(run.id) : deps.hfRead(run.id)) : null;
          const name = SOURCE_NAME[source];
          if (read) lines.push(...arxivLines(read, search, open && !health, split, source));
          else if (!health && open) lines.push(split ? `${name}: searched first; nothing on file yet.` : `${name}: searched beside X while X is read; nothing on file yet.`);
        }
      } else if (run.claimant) {
        const name = view.claimant?.deviceName ? `"${view.claimant.deviceName}"` : "the computer running it";
        if (open) {
          lines.push(`Its X progress file and per-query outcomes are kept on ${name}; the last report above is the latest this device has.`);
        } else if (view.claimant) {
          const entries = claimEntries(view.claimant as CollectorView, brief.searchId);
          if (entries.length) {
            lines.push(`Latest outcome per query, as ${name} last reported ${view.ago(view.claimant.heartbeatAt)} (from the last run that read each query):`);
            lines.push(...healthLines(entries, search));
          }
        }
      }
      const results = search ? await deps.results(brief.searchId) : [];
      lines.push(resultLine(run, brief, results));
      lines.push(issueLine(run, brief, await deps.issues(), results));
      const mine = view.claims.find((c) => c.deviceId === view.deviceId);
      const localSide = view.here || (!run.claimant && !!mine?.capabilities.includes(WEBVIEW_FETCH));
      if (open || run.state === "failed" || aboutTopicSearchRun(run, []).skipped) {
        if (localSide) lines.push(localXLine(await deps.localX(), view));
        else {
          const collector = (view.claimant ??
            [...view.claims].filter((c) => (c as CollectorView).sites).sort((a, b) => b.heartbeatAt - a.heartbeatAt)[0] ??
            null) as CollectorView | null;
          lines.push(remoteXLine(collector, view));
        }
      }
      return lines;
    },
  };
}
