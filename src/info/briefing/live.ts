// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.

import { callModel, resolveModel, type ResolvedModel } from "../../ai/model-call";
import { loadSettings } from "../../platform/app/settings";
import type { AiCallOptions } from "../../ai/watchdog";
import { INFO_EVENT_TOPIC, logEvent } from "../../platform/app/events";
import { newTally, reportParse } from "../../platform/app/structured-output";
import { observeAppExit, observeAppLifecycle } from "../../platform/app/lifecycle";
import { browserWakeLockTarget, createScreenWakeLock } from "../../platform/app/wake-lock";
import { collectAll, fetchBodies as fetchArticleBodies } from "../sources/engine";
import { fetchArticleViaWebview } from "../extract/webview-article";
import { hasWebviewFetch } from "../../platform/app/platform";
import { extractReadable } from "../extract/readable";
import { loadSources, loadSourceHealth, saveSourceHealth } from "../sources/source-store";
import { loadFeedback } from "../../observation/feedback";
import { loadProfile } from "../../observation/profile";
import { assembleReadingContext } from "../../observation/assemble";
import { InfoPipeline, type InfoSourceRef, type SourceResult } from "./pipeline";
import {
  parseScreenVerdicts,
  screenSystemPrompt,
  screenUserMessage,
  type ScreenParseOutcome,
  type ScreenVerdict,
} from "./screen";
import type { InfoRunPhase } from "./run-state";
import {
  clearRun,
  loadArticles,
  loadBriefing,
  loadItems,
  loadRun,
  pruneStaleDailyFiles,
  saveArticles,
  saveBriefing,
  saveItems,
  saveRun,
  todayLocal,
} from "./store";
import { InfoCollector } from "./collector";
import {
  loadPool,
  removePoolDays,
  savePoolDay,
  savePoolMarks,
  savePoolPolled,
} from "./pool-store";
import type { SourceDescriptor } from "../sources/descriptor";
import {
  parseTriageResult,
  triageSystemPrompt,
  triageUserMessage,
  type ParseOutcome,
} from "./triage";
import type { FeedbackEvent } from "../../observation/feedback";
import type { TriageResult } from "./types";
import type { InfoItem } from "../sources/item";

// One tool-less streaming call. `extra` lets the parse-retry append a corrective
// nudge. Triage wants some deliberation but not a marathon, so it reuses the
// prep effort setting. Budgeted as a plan: the reply is a verdict on every item
// collected, so it grows with the input and needs the wider output floor.
function runTriageCall(userText: string, opts: AiCallOptions, extra?: string): Promise<string> {
  return callModel(
    "prep",
    "plan",
    (model) => triageSystemPrompt(model.aiLanguage) + (extra ?? ""),
    userText,
    opts,
  );
}

// One triage attempt: run the model, validate, and record how the parse went
// (structured-output.ts) whichever way it lands. The in-band retry below is a
// second attempt, so it logs a second line.
async function attemptTriage(
  model: ResolvedModel,
  userText: string,
  validIds: Set<string>,
  opts: AiCallOptions,
  extra?: string,
): Promise<ParseOutcome> {
  const text = await runTriageCall(userText, opts, extra);
  const tally = newTally();
  const parsed = parseTriageResult(text, validIds, tally);
  reportParse({
    site: "info-triage",
    model,
    text,
    tally,
    error: parsed.ok ? undefined : parsed.error,
  });
  return parsed;
}

// The triage dep: stream the model, validate the JSON, retry once on a parse
// failure with a corrective instruction. A second failure throws so the watchdog
// treats it as a transient error and retries the whole attempt.
async function triage(
  input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[]; readerContext?: string },
  opts: AiCallOptions,
): Promise<TriageResult> {
  // One watchdog attempt, timed against the collection numbers above: the two
  // together are the only answer to "why did that take four minutes".
  const startedAt = Date.now();
  const done = (ok: boolean) =>
    logEvent(INFO_EVENT_TOPIC, "info-triage", {
      ms: Date.now() - startedAt,
      items: input.items.length,
      ok,
    });
  try {
    const result = await runTriageAttempt(input, opts);
    done(true);
    return result;
  } catch (e) {
    done(false);
    throw e;
  }
}

async function runTriageAttempt(
  input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[]; readerContext?: string },
  opts: AiCallOptions,
): Promise<TriageResult> {
  const userText = triageUserMessage(input.profile, input.feedback, input.items, {
    readerContext: input.readerContext,
  });
  const validIds = new Set(input.items.map((it) => it.id));
  const model = await resolveModel("prep");
  const parsed = await attemptTriage(model, userText, validIds, opts);
  if (parsed.ok) return parsed.result;
  const reparsed = await attemptTriage(
    model,
    userText,
    validIds,
    opts,
    "\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object, no prose, no markdown fence.",
  );
  if (reparsed.ok) return reparsed.result;
  throw new Error(`triage produced invalid JSON: ${reparsed.error}`);
}

// The roster a run is checkpointed against: the enabled sources, in list order.
async function listSources(): Promise<InfoSourceRef[]> {
  const sources = await loadSources();
  return sources.filter((d) => d.enabled).map((d) => ({ id: d.id, name: d.name }));
}

// One screening call: the model, then the validation, with the parse recorded
// whichever way it lands (structured-output.ts).
async function attemptScreen(
  model: ResolvedModel,
  userText: string,
  validIds: Set<string>,
  opts: AiCallOptions,
  extra?: string,
): Promise<ScreenParseOutcome> {
  const text = await callModel(
    "chat",
    "plan",
    (m) => screenSystemPrompt(m.aiLanguage) + (extra ?? ""),
    userText,
    opts,
  );
  const tally = newTally();
  const parsed = parseScreenVerdicts(text, validIds, tally);
  reportParse({
    site: "info-screen",
    model,
    text,
    tally,
    error: parsed.ok ? undefined : parsed.error,
  });
  return parsed;
}

// The screening dep: one batch of headlines in, one verdict per item out. The
// cheap model, on purpose — this is the stage that runs over the whole day, and
// the question it answers ("is the body worth fetching") is a coarse one. A
// parse failure gets one corrective retry, then throws so the watchdog treats it
// as transient.
async function screen(
  input: { profile: string; items: InfoItem[] },
  opts: AiCallOptions,
): Promise<ScreenVerdict[]> {
  const userText = screenUserMessage(input.profile, input.items);
  const validIds = new Set(input.items.map((it) => it.id));
  const model = await resolveModel("chat");
  const parsed = await attemptScreen(model, userText, validIds, opts);
  if (parsed.ok) return parsed.verdicts;
  const reparsed = await attemptScreen(
    model,
    userText,
    validIds,
    opts,
    "\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object, no prose, no markdown fence.",
  );
  if (reparsed.ok) return reparsed.verdicts;
  throw new Error(`screening produced invalid JSON: ${reparsed.error}`);
}

// Discovery (docs/35): run the requested sources through the generic engine for
// their item lists only — one request per source, no article pages — a subset of
// the roster when the pipeline is resuming, everything otherwise. Per-source
// isolation lives in collectAll: one source failing degrades to no items rather
// than failing the run (the pipeline fails only if the whole set comes back
// empty). Each source is handed to the pipeline as it settles so the run's
// checkpoint advances one source at a time, and into the pool at the same time,
// so a run's own requests stock it exactly as a background poll does. Health is
// recorded for the source-list UI.
//
// A source the background collector polled recently is not polled again here: it
// settles with nothing new, and the pool supplies its items. `force` — the user
// asking for a regenerate — overrides that.
async function discover(
  refs: InfoSourceRef[],
  onSettled: (result: SourceResult) => Promise<void>,
  signal: AbortSignal,
  opts: { force: boolean },
): Promise<void> {
  const wanted = new Set(refs.map((r) => r.id));
  const chosen = (await loadSources()).filter((d) => wanted.has(d.id));
  const collector = getInfoCollector();
  const { poll, skip } = await collector.toPoll(chosen, opts);
  for (const d of skip) await onSettled({ id: d.id, items: [] });
  if (poll.length === 0) return;
  const prior = await loadSourceHealth();
  const { health } = await collectAll(
    poll,
    {
      extract: extractReadable,
      discoveryOnly: true,
      signal,
      onSourceSettled: async (r) => {
        // Where a run's minutes go: per source, so a slow one is nameable.
        logEvent(INFO_EVENT_TOPIC, "info-collect", {
          source: r.source,
          ms: Math.round(r.durationMs),
          items: r.items.length,
          ok: !r.error,
        });
        await collector.ingest(r.items);
        await onSettled({ id: r.source, items: r.items, error: r.error });
      },
    },
    prior,
  );
  // Stopped means these sources were not polled: collectAll answers a stop by
  // resolving with whatever settled, and marking the rest polled would keep the
  // background collection off them until their next interval comes round.
  await collector.notePolled(
    poll.map((d) => d.id),
    signal,
  );
  saveSourceHealth(health).catch(() => {});
}

// A background poll: the same discovery pass, without a run around it. Health is
// recorded here too — a source that has been failing all day should say so on
// the source list, not only after a generation.
async function pollSources(
  sources: SourceDescriptor[],
  signal: AbortSignal,
): Promise<InfoItem[]> {
  const prior = await loadSourceHealth();
  const { items, health } = await collectAll(
    sources,
    { extract: extractReadable, discoveryOnly: true, signal },
    prior,
  );
  saveSourceHealth(health).catch(() => {});
  return items;
}

// Whether a briefing may generate itself when the app opens (docs/35): a
// provider to call and at least one source to read.
async function canAutoGenerate(): Promise<boolean> {
  const [settings, sources] = await Promise.all([loadSettings(), loadSources()]);
  if (!settings.defaultProviderId || !settings.defaultModelId) return false;
  return sources.some((d) => d.enabled);
}

// Material (docs/35): the article bodies of the items screening kept. The
// descriptors come back off disk because an item carries only its source id —
// the body's whereabouts (a page, a detail endpoint, the feed field it already
// had) is the descriptor's business.
async function fetchBodies(
  items: InfoItem[],
  onSettled: (item: InfoItem) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const sources = await loadSources();
  await fetchArticleBodies(
    items,
    sources,
    {
      extract: extractReadable,
      // Only where there is one. A `webview` source on a platform without a
      // fetcher gets no body and no error either — it stays at the headline and
      // summary the feed already gave, which is what the funnel does with every
      // body it cannot get.
      fetchViaWebview: hasWebviewFetch() ? fetchArticleViaWebview : undefined,
      signal,
    },
    onSettled,
  );
}

// The per-phase timing lines (events-info.jsonl), alongside the per-source ones
// discovery writes and the triage line the call itself writes.
const PHASE_EVENT: Record<InfoRunPhase, "info-discover" | "info-screen" | "info-material" | null> = {
  discovering: "info-discover",
  screening: "info-screen",
  fetching: "info-material",
  // Triage logs its own line, per watchdog attempt, with the outcome.
  triaging: null,
};

function logPhase(phase: InfoRunPhase, data: Record<string, number>): void {
  const type = PHASE_EVENT[phase];
  if (type) logEvent(INFO_EVENT_TOPIC, type, data);
}

let pipeline: InfoPipeline | null = null;
let collector: InfoCollector | null = null;

// One screen wake lock for the app, held while a briefing generates (docs/22).
const wakeLock = createScreenWakeLock(browserWakeLockTarget());

// The background collector (docs/35), which also owns the one in-memory copy of
// the pool — the pipeline draws from the same pool the polling fills.
export function getInfoCollector(): InfoCollector {
  if (!collector) {
    collector = new InfoCollector({
      loadPool,
      savePoolDay,
      savePoolMarks,
      savePoolPolled,
      removePoolDays,
      listSources: loadSources,
      poll: pollSources,
      loadBodies: loadArticles,
      backgroundOn: async () => (await loadSettings()).backgroundCollect,
      busy: () => getInfoPipeline().snapshot().running,
      now: () => Date.now(),
      today: () => todayLocal(),
      setTimer: (ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
      log: (data) => logEvent(INFO_EVENT_TOPIC, "info-poll", data),
    });
  }
  return collector;
}

// The background-collection setting changed: start or stop the polling now
// rather than at whatever the next wake would have been.
export function refreshInfoCollector(): void {
  void getInfoCollector().refresh();
}

export function getInfoPipeline(): InfoPipeline {
  if (!pipeline) {
    pipeline = new InfoPipeline({
      loadBriefing,
      loadProfile,
      loadFeedback,
      // Reading-side signal for triage: assembled from per-topic observations, guarded
      // so a failure yields "" and the section is simply omitted.
      loadReaderContext: () => assembleReadingContext(),
      listSources,
      discover,
      screen,
      fetchBodies,
      triage,
      logPhase,
      saveBriefing,
      saveArticles,
      saveItems,
      loadItems,
      loadRun,
      saveRun,
      clearRun,
      poolDraw: (date) => getInfoCollector().draw(date),
      poolRecord: (date, record) => getInfoCollector().record(date, record),
      canAutoGenerate,
      pruneStaleDays: pruneStaleDailyFiles,
      keepAwake: (on) => wakeLock.set(on),
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      setTimer: (ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
    });
    // Leaving the app is where a run dies (docs/22): iOS may suspend or kill a
    // backgrounded webview within seconds. Flushing writes the checkpoint and
    // nothing else — no fetch, no AI call — so it fits in that window. The wake
    // lock re-acquires itself (platform/app/wake-lock).
    //
    // Coming back is where the pool and the trigger get their chance. A
    // suspended webview runs no timers, so the collector cannot be trusted to
    // have kept polling; it recomputes what is due from the clock instead.
    // init() is the day's briefing trigger and is cheap when there is nothing to
    // do, which is also how a day that turned over while the app sat open is
    // noticed.
    //
    // The collector's schedule is not on this edge. Leaving the foreground means
    // blur as well as hide (docs/pitfall/69), and a desktop machine whose window
    // is unfocused or minimised while its owner reads on a phone is exactly the
    // state background collection exists for (docs/36). Its timer therefore hangs
    // off the way out of the page and nothing else; only foreground() stays here,
    // to catch up a webview that really was suspended.
    const p = pipeline;
    observeAppLifecycle(window, {
      onForeground: () => {
        getInfoCollector().foreground();
        void p.init();
      },
      onBackground: () => {
        void p.flush();
      },
    });
    observeAppExit(window, () => {
      getInfoCollector().suspend();
    });
    void getInfoCollector().refresh();
  }
  return pipeline;
}
