// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.

import { callModel, resolveModel, type ResolvedModel } from "../../ai/model-call";
import { realTimers } from "../../ai/observable-run";
import { loadSettings } from "../../platform/app/settings";
import {
  currentDeviceId,
  currentDeviceRole,
  loadDeviceSettings,
  type DeviceRole,
} from "../../platform/app/device";
import { sanitizeArticleHtml } from "../extract/sanitize";
import {
  InfoReader,
  type ArticleState,
  type BriefingView,
} from "./reader";
import type { AiCallOptions } from "../../ai/watchdog";
import { INFO_EVENT_TOPIC, logEvent } from "../../platform/app/events";
import { newTally, reportParse } from "../../platform/app/structured-output";
import { observeAppExit, observeAppLifecycle } from "../../platform/app/lifecycle";
import { browserWakeLockTarget, createScreenWakeLock } from "../../platform/app/wake-lock";
import { collectAll, fetchBodies as fetchArticleBodies } from "../sources/engine";
import { fetchArticleViaWebview } from "../extract/webview-article";
import { hasWebviewFetch } from "../../platform/app/platform";
import { setTrayStatus } from "../../platform/app/tray";
import { extractReadable } from "../extract/readable";
import {
  loadSiteSessions,
  loadSources,
  loadSourceHealth,
  saveSourceHealth,
  SOURCES_FILE,
} from "../sources/source-store";
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
  loadArticle,
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
import { collectorStatusLine, InfoCollector } from "./collector";
import { backfillPublish, loadPublishedBriefing, publishBriefing } from "./publish";
import {
  chooseAsk,
  HEARTBEAT_MS,
  isElectedCollector,
  mayClaim,
  readAsks,
  readCollectorClaims,
  readOwnClaim,
  writeCollectorClaim,
  type AskRecord,
  type CollectorClaim,
} from "./handoff";
import { onSyncPulled, subscribeSyncStatus } from "../../platform/sync";
import { hostname, platform } from "@tauri-apps/plugin-os";
import { signInSites } from "../sources/site-session";
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
import type { Briefing, TriageResult } from "./types";
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

// Today's briefing for a machine that is a collector but did not win the
// election (docs/36). It generates nothing, so it has no briefing-<date>.json of
// its own; without this its screen would be blank while a briefing for today
// sits in the folder it just pulled. The date is still checked, so a stale
// published file cannot pass as today's and talk startupAction out of a run.
async function loadBriefingForToday(date: string): Promise<Briefing | null> {
  const own = await loadBriefing(date);
  if (own) return own;
  const published = await loadPublishedBriefing().catch(() => null);
  return published && published.date === date ? published : null;
}

// A briefing landed on disk: publish it for the readers (docs/36). Wrapped
// around the pipeline's saveBriefing dep rather than called from inside the
// pipeline, so both paths that write a briefing — a run and a re-triage —
// publish without either of them knowing there are other devices.
//
// A publish that fails is logged and swallowed. The briefing is on disk and this
// machine can show it; the readers get the next one, and the alternative is a
// briefing that counts as failed because another device could not be told.
// The briefing this machine had before it could publish one (docs/36). Same
// files, same order, decided by publish.ts; the only thing added here is the
// election, which is what keeps a desktop that lost it from putting its own
// older briefing over the winner's.
//
// Swallowed like the publish above: the readers get the next one.
async function backfillPublishedBriefing(): Promise<void> {
  if (!(await amICollecting())) return;
  try {
    await backfillPublish();
  } catch (e) {
    console.warn("failed to publish the briefing already on disk", e);
  }
}

async function saveAndPublishBriefing(briefing: Briefing): Promise<void> {
  await saveBriefing(briefing);
  try {
    await publishBriefing(briefing);
  } catch (e) {
    console.warn("failed to publish the briefing", e);
  }
}

// Whether a briefing may generate itself when the app opens (docs/35): a
// provider to call, at least one source to read, and — since two collectors
// would pay for the day twice and publish two different briefings — the claim
// (docs/36).
async function canAutoGenerate(): Promise<boolean> {
  const [settings, sources] = await Promise.all([loadSettings(), loadSources()]);
  if (!settings.defaultProviderId || !settings.defaultModelId) return false;
  if (!sources.some((d) => d.enabled)) return false;
  return await amICollecting();
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
      // Two answers, both needed: this machine was told to collect, and this
      // machine is the one holding the claim (docs/36).
      backgroundOn: async () =>
        (await loadDeviceSettings()).backgroundCollect && (await amICollecting()),
      busy: () => getInfoPipeline().snapshot().running,
      now: realTimers.now,
      today: () => todayLocal(),
      setTimer: realTimers.setTimer,
      log: (data) => logEvent(INFO_EVENT_TOPIC, "info-poll", data),
      // The tray is where a machine with its window closed says what it has
      // been doing (docs/36). Display only, and it goes nowhere on a phone.
      onStatus: (status) => {
        void setTrayStatus(collectorStatusLine(status, Date.now()));
      },
    });
  }
  return collector;
}

// A device setting changed: apply it now rather than at whatever the next wake
// would have been. Three things can have changed and they are one call, because
// they interlock — a machine that is no longer a collector must not go on
// claiming, and a machine that stopped collecting must give the claim up so
// another one can take over in seconds rather than in a day (docs/36).
//
// Called on every change and once when device.json first lands, so it is also
// how a collector starts.
export function refreshInfoCollector(): void {
  void (async () => {
    if (currentDeviceRole() !== "collector") {
      await stopCollecting();
      return;
    }
    if (collecting) await publishClaim();
    else await startCollecting();
    await getInfoCollector().refresh();
  })().catch((e) => console.warn("failed to apply the collection settings", e));
}

export function getInfoPipeline(): InfoPipeline {
  if (!pipeline) {
    pipeline = new InfoPipeline({
      loadBriefing: loadBriefingForToday,
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
      saveBriefing: saveAndPublishBriefing,
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
      ...realTimers,
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

// --- what the screens read (docs/36) ---------------------------------------

let reader: InfoReader | null = null;

export function getInfoReader(): InfoReader {
  if (!reader) reader = new InfoReader();
  return reader;
}

// The collector's own view: the pipeline for everything live, and the day's
// files for an article's body. Both this and InfoReader answer to BriefingView,
// so a screen never asks which one it has.
//
// The one difference worth naming is where the body comes from. A collector
// reads the article cache it wrote itself, which still has its images; a reader
// reads the published bodies, which do not (publish.ts). Keeping an article on
// the desktop therefore keeps the version with pictures, and keeping the same
// article on a phone keeps the text — which is what docs/21 says a kept article
// is: the reader's own snapshot of what they were looking at.
function collectorView(): BriefingView {
  const p = getInfoPipeline();
  return {
    snapshot: () => p.snapshot(),
    subscribe: (fn) => p.subscribe(fn),
    init: () => p.init(),
    stop: () => p.stop(),
    // The pipeline's own answer, passed through: it runs one run at a time and
    // says whether this call started one or found one already going. Losing
    // that distinction here is exactly what the caller must not be made to
    // guess at — a refused start drawn as a start is a card nothing updates.
    request(scope) {
      const handle = scope === "retriage" ? p.retriage() : p.generate();
      return { outcome: handle.start, done: handle.done };
    },
    // This machine is the one collecting; whatever went wrong is already in the
    // snapshot's error, on the screen of the person who can act on it, and the
    // sign-in rows on its source list are the real ones.
    notices: () => [],
    collectorSites: () => null,
    async article(itemId: string): Promise<ArticleState> {
      const briefing = p.snapshot().briefing;
      if (!briefing || !briefing.items[itemId]) return { kind: "unknown" };
      const dropped = briefing.filtered.find((f) => f.itemId === itemId);
      if (dropped) return { kind: "filtered", category: dropped.category };
      const [cached, items] = await Promise.all([
        loadArticle(briefing.date, itemId).catch(() => null),
        loadItems(briefing.date).catch(() => [] as InfoItem[]),
      ]);
      const html = cached?.contentHtml ?? "";
      const text = cached?.textContent ?? "";
      if (!html && !text) return { kind: "summaryOnly" };
      const item = items.find((it) => it.id === itemId);
      return {
        kind: "body",
        body: {
          html: html ? sanitizeArticleHtml(html) : "",
          text,
          summaryOnly: item ? (item.summaryOnly ?? !text) : true,
        },
      };
    },
  };
}

// The view for this device's role, one per role for the app's lifetime — a
// screen subscribes to it, so handing out a new object per call would leak a
// listener on every render.
//
// A reader never touches getInfoPipeline or getInfoCollector through here, so
// neither singleton is ever constructed on a machine that is not collecting: no
// item pool, no schedule, no auto-generate.
const views: Partial<Record<DeviceRole, BriefingView>> = {};

export function getInfoView(role: DeviceRole): BriefingView {
  return (views[role] ??= role === "collector" ? collectorView() : getInfoReader());
}

// --- the claim, the heartbeat, and the readers' asks (docs/36) --------------
//
// Only a collector runs any of this. A reader never calls startCollecting, so it
// writes no claim, takes part in no election, and constructs neither singleton.

// A pulled path that is some reader's request. Matches this device's own file
// too, which costs one read of a request it has already run.
const ASK_PATH = /^info-ask-.+\.json$/;

let claim: CollectorClaim | null = null;
let collecting = false;
let sessionStartedAt = 0;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let unsubSync: (() => void) | null = null;
let unsubPulled: (() => void) | null = null;
let syncing = false;
let lastSyncAt: number | null = null;
// The election result, held briefly. Every poll cycle asks, and the answer
// changes on the scale of hours; re-reading every claim file for each of them
// would be a directory listing per minute to learn the same thing.
const ELECTION_TTL_MS = 60_000;
let electionAt = 0;
let electionValue = false;

// This machine's name, for a sentence a reader can act on. Asked once — it does
// not change while the app runs — and the platform stands in where the host will
// not say (an unsupported plugin call, a permission that is not granted).
let deviceName: string | null = null;
async function machineName(): Promise<string> {
  if (deviceName !== null) return deviceName;
  try {
    deviceName = (await hostname()) || platformName();
  } catch {
    deviceName = platformName();
  }
  return deviceName;
}

function platformName(): string {
  try {
    return platform();
  } catch {
    return "unknown";
  }
}

// Which sites this machine currently has a session with. The yes-or-no travels;
// the cookie does not leave the webview it was set in (docs/36).
async function siteStates(): Promise<Record<string, boolean>> {
  try {
    const [sources, sessions] = await Promise.all([loadSources(), loadSiteSessions()]);
    const out: Record<string, boolean> = {};
    for (const site of signInSites(sources)) {
      const state = sessions[site.host];
      out[site.host] = !!state && !state.unknown && state.signedIn;
    }
    return out;
  } catch {
    return {};
  }
}

// Write this machine's claim: a heartbeat every time, and the claim itself only
// while this machine is both willing (the setting) and allowed (its first pull
// has landed, or it has waited long enough to stop waiting).
//
// claimedAt is kept once taken, so a machine's standing is its uptime and not
// the time of its last write. Losing eligibility clears it, and taking it up
// again puts the machine at the back of the queue rather than back at its old
// place — which is the point: whoever picked the work up keeps it.
async function publishClaim(): Promise<void> {
  if (!claim) return;
  const now = Date.now();
  let willing = false;
  try {
    willing = (await loadDeviceSettings()).backgroundCollect;
  } catch {
    // Unreadable device settings: do not claim work on a guess.
  }
  const allowed =
    willing &&
    mayClaim({
      syncing,
      pulledAt: lastSyncAt !== null && lastSyncAt >= sessionStartedAt ? lastSyncAt : null,
      startedAt: sessionStartedAt,
      now,
    });
  const wasClaiming = claim.claimedAt !== null;
  claim = {
    ...claim,
    claimedAt: allowed ? (claim.claimedAt ?? now) : null,
    heartbeatAt: now,
    sources: await loadSourceHealth().catch(() => ({})),
    sites: await siteStates(),
  };
  const took = !wasClaiming && claim.claimedAt !== null;
  try {
    await writeCollectorClaim(claim);
  } catch (e) {
    console.warn("failed to write the collector claim", e);
  }
  // The file that decides the election just changed; do not answer from a copy
  // taken before it.
  electionAt = 0;
  // A machine that has just started claiming was, until a moment ago, one that
  // declined to poll and declined to generate. Both asked the claim and both got
  // no for an answer, and neither will ask again on its own — polling waits for
  // its next wake, which it never scheduled, and the pipeline waits for the next
  // return to the foreground. So the claim tells them.
  //
  // It is also the moment to publish a briefing this machine already had and
  // never published, and that goes first: it settles in three file reads, and
  // running it after the run below had started would race the run's own publish
  // for the same two names.
  if (took) {
    await backfillPublishedBriefing();
    await getInfoCollector().refresh();
    void getInfoPipeline().init();
  }
}

// Whether this machine is the one collecting. False for anything that is not a
// running collector, so every caller can ask without knowing the role.
export async function amICollecting(): Promise<boolean> {
  if (!collecting) return false;
  const now = Date.now();
  if (now - electionAt < ELECTION_TTL_MS) return electionValue;
  const claims = await readCollectorClaims().catch(() => [] as CollectorClaim[]);
  electionValue = isElectedCollector(claims, currentDeviceId(), now);
  electionAt = now;
  return electionValue;
}

// A reader asked for a briefing. Run at most one, whatever arrived: the newest
// request at the widest scope anyone asked for, and never one already run.
//
// Called on every pull that carried an ask, and once at startup — a request
// uploaded during the last session was pulled during the last session, so its
// file is already on disk and no event will ever mention it again.
async function runPendingAsk(): Promise<void> {
  if (!claim || !(await amICollecting())) return;
  const asks = await readAsks().catch(() => [] as AskRecord[]);
  const chosen = chooseAsk(asks, claim.lastAskAt, Date.now());
  if (!chosen) return;
  // Recorded before the run, not after: a run that dies halfway is not a reason
  // to run the same request again on the next pull.
  claim = { ...claim, lastAskAt: chosen.askedAt };
  await writeCollectorClaim(claim).catch(() => {});
  const p = getInfoPipeline();
  if (chosen.scope === "retriage") void p.retriage();
  else void p.generate();
}

// Report how the run that just ended went, so a reader can say what happened on
// a machine nobody is sitting at. `error` is the halt reason the pipeline parked
// the run with; null means it finished.
function watchRuns(p: InfoPipeline): void {
  let wasRunning = p.snapshot().running;
  p.subscribe(() => {
    const snap = p.snapshot();
    const ended = wasRunning && !snap.running;
    wasRunning = snap.running;
    if (!ended || !claim) return;
    claim = {
      ...claim,
      lastRunAt: Date.now(),
      lastBriefingDate: snap.briefing?.date ?? null,
      halt: snap.error,
    };
    void publishClaim();
  });
}

// Become the collector: claim, say so every hour, and act on what the readers
// asked for. Idempotent, so a settings change can call it without checking.
export async function startCollecting(): Promise<void> {
  if (collecting) return;
  collecting = true;
  sessionStartedAt = Date.now();
  unsubSync ??= subscribeSyncStatus((s) => {
    syncing = s.engineStarted;
    const advanced = s.lastSyncAt !== null && s.lastSyncAt !== lastSyncAt;
    lastSyncAt = s.lastSyncAt;
    // A pass landing is the thing a held-back claim was waiting for. Without
    // this it would wait for the next hourly heartbeat instead — an hour of a
    // machine that is willing, allowed, and doing nothing.
    if (advanced && claim && claim.claimedAt === null) void publishClaim();
  });
  const prior = await readOwnClaim(currentDeviceId());
  claim = {
    deviceId: currentDeviceId(),
    deviceName: await machineName(),
    platform: platformName(),
    hasWebviewFetch: hasWebviewFetch(),
    // Deliberately not restored from the file: the claim is this process's
    // uptime, so a restart goes to the back of the queue.
    claimedAt: null,
    heartbeatAt: Date.now(),
    lastRunAt: prior?.lastRunAt ?? null,
    lastBriefingDate: prior?.lastBriefingDate ?? null,
    halt: prior?.halt ?? null,
    sources: {},
    sites: {},
    // This does survive: a request this machine already ran must not run again
    // because the app was restarted.
    lastAskAt: prior?.lastAskAt ?? null,
  };
  await publishClaim();
  // The heartbeat hangs off the way out of the page and nothing else: a desktop
  // whose window is minimised or unfocused while its owner reads on a phone is
  // exactly the machine that has to go on saying it is alive (docs/36).
  heartbeat ??= setInterval(() => void publishClaim(), HEARTBEAT_MS);
  observeAppExit(window, () => {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  });
  watchRuns(getInfoPipeline());
  unsubPulled ??= onSyncPulled((paths) => {
    // A source the reader subscribed to or turned on elsewhere: collect on it
    // now rather than at the next wake, which can be half an hour away.
    if (paths.includes(SOURCES_FILE)) getInfoCollector().foreground();
    if (paths.some((p) => ASK_PATH.test(p))) void runPendingAsk();
  });
  await runPendingAsk();
  // Only now can the pipeline decide anything: its startup action asks whether
  // this machine holds the claim, and until this function returned it did not.
  // The screens call init() too, on mount, and that call arrives before this one
  // — it finds no claim, declines to generate, and this is the second chance.
  // Cheap when there is nothing to do, and a no-op if the ask above started one.
  void getInfoPipeline().init();
}

// Stop being the collector: give the claim up now rather than letting it expire,
// so whoever is next takes over in seconds instead of a day.
export async function stopCollecting(): Promise<void> {
  if (!collecting) return;
  collecting = false;
  if (heartbeat !== null) clearInterval(heartbeat);
  heartbeat = null;
  unsubPulled?.();
  unsubPulled = null;
  if (claim) {
    claim = { ...claim, claimedAt: null, heartbeatAt: Date.now() };
    await writeCollectorClaim(claim).catch(() => {});
  }
  electionAt = 0;
  electionValue = false;
  void getInfoCollector().refresh();
}
