// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.
//
// Nothing starts a collection by calling the pipeline any more (docs/55 step
// 12). The morning tick, the companion's generate_briefing and a reader's ask
// all delegate a `collect` run, and the worker beside this file
// (collect-worker.ts) is what holds the pipeline. The run file is also the
// record of what has been collected for: the day's round is keyed by its
// anchor, so a second ask reaches the run that is already there.

import { callModel, resolveModel, type ResolvedModel } from "../../ai/model-call";
import { realTimers } from "../../legion/execute/observable-run";
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
} from "../briefer/reader";
import type { AiCallOptions } from "../../legion/execute/watchdog";
import { INFO_EVENT_TOPIC, logEvent } from "../../platform/app/events";
import { newTally, reportParse } from "../../platform/app/structured-output";
import { observeAppExit, observeAppLifecycle } from "../../platform/app/lifecycle";
import { browserWakeLockTarget, createScreenWakeLock } from "../../platform/app/wake-lock";
import { collectAll, fetchBodies as fetchArticleBodies } from "../sources/engine";
import { registerAllSourcePlugins } from "../sources/plugins/all";
import { fetchArticleViaWebview } from "../extract/webview-article";
import { hasWebviewFetch } from "../../platform/app/platform";
import { setTrayStatus } from "../../platform/app/tray";
import { loadExtractReadable } from "../extract/readable-lazy";
import {
  loadSiteSessions,
  loadSources,
  loadSourceHealth,
  saveSourceHealth,
  SOURCES_PULL_ROUTE,
} from "../sources/source-store";
import { assembleReaderSection } from "../../memory/live/assemble";
import { InfoPipeline, type InfoSourceRef, type SourceResult } from "../boxes/pipeline";
import {
  parseScreenVerdicts,
  screenSystemPrompt,
  screenUserMessage,
  type ScreenParseOutcome,
  type ScreenTarget,
  type ScreenVerdict,
} from "../collect/screen";
import type { InfoRunPhase } from "../collect/run-state";
import {
  clearRun,
  loadArticle,
  loadArticles,
  loadItems,
  loadRun,
  pruneStaleDailyFiles,
  saveArticles,
  saveItems,
  saveRun,
  todayLocal,
} from "../collect/store";
import { loadBriefing, saveBriefing } from "../boxes/store";
import { deliverBriefing } from "../boxes/red-box";
import { appBox } from "../../box";
import { loadCableDay, saveCableDay } from "../cable/store";
import { activeLabs, loadLabs } from "../labs/store";
import { loadPicture, savePicture } from "../picture/store";
import { runLabAnalysis } from "../analysis/run";
import type { AnalystInput, LabRunResult } from "../analysis/types";
import { getObservationAdapter } from "../../memory/live/live";
import { buildObservationSnapshot, trimObservations } from "../../memory/observations/select";
import { runDreamIfDue } from "../../memory/dream/live";
import { DAILY_ANCHOR_HOUR, DAILY_TICK_MS, lastAnchorDate } from "./daily";
import { registerCollectWorker, writeCollectBrief, type CollectScope } from "./collect-worker";
import { appRunner } from "../../legion/execute/runner";
import { collectorStatusLine, InfoCollector } from "../collect/collector";
import { createCollectorSession, type CollectorSession } from "./presence";
import { backfillPublish, loadPublishedBriefing, publishBriefing } from "../boxes/publish";
import { ASK_PULL_ROUTE, COLLECT_KIND, readAsks, type CollectorClaim } from "../briefer/handoff";
import { appClaims, WEBVIEW_FETCH } from "../../legion/claim";
import { runLedgerHousekeeping } from "../../legion/ledger";
import { registerSchedule, runScheduleTick } from "../../legion/schedule";
import { subscribeSyncStatus } from "../../platform/sync";
import { registerPullRoute } from "../../platform/sync/pull-routes";
import { hostname, platform } from "@tauri-apps/plugin-os";
import { signInSites } from "../sources/site-session";
import {
  loadPool,
  removePoolDays,
  savePoolDay,
  savePoolMarks,
  savePoolPolled,
} from "../collect/pool-store";
import type { SourceDescriptor } from "../sources/descriptor";
import type { Briefing } from "../boxes/types";
import type { InfoItem } from "../sources/item";

// One room's day (docs/63 加工): the analyst call and the synthesis call, with
// the two prompts, the parse and the one in-band retry in analysis/run.ts. Both
// want some deliberation but not a marathon, so they take the briefing's
// analysis effort setting, and both are budgeted as a plan: the reply covers
// every cable the room was handed, so it grows with the input and needs the
// wider output floor.
//
// The parse tallies are reported per call from here rather than from run.ts,
// which does not know which model it is talking to. run.ts hands the text back
// through the same parse it used, so what is counted is what was kept.
async function analyze(input: AnalystInput, opts: AiCallOptions): Promise<LabRunResult> {
  const model = await resolveModel("briefing");
  const startedAt = Date.now();
  const done = (ok: boolean) =>
    logEvent(INFO_EVENT_TOPIC, "info-analyze", {
      ms: Date.now() - startedAt,
      cables: input.cables.length,
      ok,
    });
  try {
    const result = await runLabAnalysis(
      {
        callModel: (system, user, o) => callModel("briefing", "plan", () => system, user, o),
        now: Date.now,
        onParse: (report) => reportParse({ ...report, model }),
      },
      // The reply's language is the model's, the same way every other prompt in
      // the app takes it; the pipeline has no business reading settings.
      { ...input, aiLanguage: model.aiLanguage },
      opts,
    );
    done(true);
    return result;
  } catch (e) {
    done(false);
    throw e;
  }
}

// What is remembered about the reader on a room's topic, as the paragraph the
// analyst reads (docs/48). The same snapshot the briefing conversation gets, so
// the room writes for the person the companion is talking to. It is never
// evidence for a judgment, and a store that will not answer costs the analyst
// its context and not the day.
const ANALYST_OBSERVATIONS = 12;

async function loadObservations(topicId: string): Promise<string> {
  const entries = await getObservationAdapter(topicId).listObservations();
  return buildObservationSnapshot(trimObservations(entries, ANALYST_OBSERVATIONS));
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
  targets: ScreenTarget[],
  validIds: Set<string>,
  opts: AiCallOptions,
  extra?: string,
): Promise<ScreenParseOutcome> {
  const text = await callModel(
    "briefing-screen",
    "plan",
    (m) => screenSystemPrompt(m.aiLanguage) + (extra ?? ""),
    userText,
    opts,
  );
  const tally = newTally();
  const parsed = parseScreenVerdicts(text, targets, validIds, tally);
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
// cheap effort setting, on purpose — this is the stage that runs over the whole
// day, and the question it answers ("is the body worth fetching") is a coarse
// one. A parse failure gets one corrective retry, then throws so the watchdog
// treats it as transient.
async function screen(
  input: { targets: ScreenTarget[]; items: InfoItem[] },
  opts: AiCallOptions,
): Promise<ScreenVerdict[]> {
  const targets = input.targets;
  const userText = screenUserMessage(targets, input.items);
  const validIds = new Set(input.items.map((it) => it.id));
  const model = await resolveModel("briefing-screen");
  const parsed = await attemptScreen(model, userText, targets, validIds, opts);
  if (parsed.ok) return parsed.verdicts;
  const reparsed = await attemptScreen(
    model,
    userText,
    targets,
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
      extract: await loadExtractReadable(),
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
    { extract: await loadExtractReadable(), discoveryOnly: true, signal },
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
// The Red Box delivery hangs off the same edge (docs/68): the corner's badge and
// the secretary's list are fed from box/ and nothing else, so a briefing that
// only lands in its own file is one they cannot see. Here rather than in the
// pipeline for the reason above, and on the save path rather than the publish
// path because it is the generating device that delivers — a reader pulls the
// published file and puts nothing; the items reach it as box files, through
// sync. A second save of the same briefing adds nothing (boxes/red-box.ts).
//
// Swallowed the same way a failed publish is, and for the same reason: the
// briefing is on disk and this machine can show it.
async function saveAndPublishBriefing(briefing: Briefing): Promise<void> {
  await saveBriefing(briefing);
  try {
    await publishBriefing(briefing);
  } catch (e) {
    console.warn("failed to publish the briefing", e);
  }
  try {
    await deliverBriefing(briefing, appBox());
  } catch (e) {
    console.warn("failed to put the briefing in the box", e);
  }
}

// Whether a briefing may generate itself — when the app opens, and every morning
// at the anchor (docs/35): a provider to call, at least one source to read, and
// — since two collectors would pay for the day twice and publish two different
// briefings — the claim (docs/36).
//
// The claim is asked first of the three. It is the cheapest (a held election
// answer, or an instant no on anything that is not a running collector) and the
// one that says no most often, on every reader and on every desktop that lost
// the election. That order only started mattering when a timer began asking the
// question: it is the difference between two file reads a tick and none, on a
// device whose answer was never going to be yes.
// A room to collect for is the fourth (docs/63): the screen matches headlines
// against a room's observables and the briefing is cut by room, so a bureau with
// none of them has nothing to spend the day on. The companion asks for one
// instead.
async function canAutoGenerate(): Promise<boolean> {
  if (!(await session.amICollecting())) return false;
  const [settings, sources, labs] = await Promise.all([loadSettings(), loadSources(), loadLabs()]);
  if (!settings.defaultProviderId || !settings.defaultModelId) return false;
  if (activeLabs(labs).length === 0) return false;
  return sources.some((d) => d.enabled);
}

// --- the morning round (docs/35) --------------------------------------------
//
// The rule is in daily.ts, where it can be tested. What is here is what it is
// bound to: the recorded date, the real clock, a repeating wake, and the two
// gates a generate nobody asked for has to pass.

// The round as a schedule (docs/55): the hour is declared once, here, and which
// machine acts on it is the election for `collect` — the same election
// canAutoGenerate asks below. What legion does about the hour is ring a wake
// bell, so that the soul knows the night is being worked; the round itself is a
// run the tick below delegates.
export const DAILY_ROUND_SCHEDULE = "info-daily-round";

registerSchedule({
  id: DAILY_ROUND_SCHEDULE,
  kind: COLLECT_KIND,
  at: { daily: { hour: DAILY_ANCHOR_HOUR } },
  brief:
    "The morning briefing round is due. The collect run for it has been delegated by the daily tick on this device and will report when it settles; say something to the reader only if there is something worth saying.",
});

// The last anchor this process delegated for. Only a saving of file reads: the
// record that matters is the run itself, which is on disk under a name derived
// from the anchor, so a process that forgot this asks the runner and is handed
// the run that is already there.
let delegatedAnchor: string | null = null;
let cancelDailyTimer: (() => void) | null = null;
let dailyStopped = false;

/** What a collect run is delegated under, so that two asks meet in one file. */
export function collectRunKey(what: string): string {
  return `collect:${what}`;
}

// Delegate one collect run and answer whether there is now a run for this key —
// which includes the run that was already there. Everything the three callers
// share is here: the task book is written first and frozen, the run points at
// it, and the runner decides whether this is a new run or the one that exists.
async function delegateCollect(
  key: string,
  scope: CollectScope,
  why: string,
): Promise<boolean> {
  const brief = await writeCollectBrief(key, { scope, why });
  const result = await appRunner().delegate({
    kind: COLLECT_KIND,
    idempotencyKey: key,
    delegator: { kind: "program", name: why },
    brief,
  });
  // `ok: false` with a run is a run under this key that failed or was cancelled
  // — still a run for this key, and not one to ask for again on the next tick.
  return result.ok || result.run !== undefined;
}

// One check. Cheap when there is nothing to do — a date comparison — and it has
// to be, because it runs on a timer for the life of the app.
//
// The record of "today's round has been run" is the run file itself, named from
// the anchor (legion/run/store.ts): a second ask for the same anchor, on this
// device or the next one to win the election, reaches the same file and is
// handed it back rather than starting a second collection. The date file this
// used to keep is gone with it.
async function dailyTick(): Promise<void> {
  const anchor = lastAnchorDate(realTimers.now());
  if (delegatedAnchor === anchor) return;
  // The timer hangs off the pipeline's assembly, which a reader never
  // constructs (docs/36), so this is not what keeps a phone from collecting —
  // but it does not ask what role it is on either, and a machine that stops
  // being the collector between two ticks stops here on the next one.
  if (!(await canAutoGenerate())) return;
  // A refresh, not a second briefing (pipeline.ts): the pool hands today's items
  // back along with whatever has come in since, so a briefing the reader
  // generated at two in the morning gains the hours between rather than being
  // left to stand for the day.
  //
  // Nothing is skipped for a pipeline that is busy any more. The round is a
  // pending run on disk the moment it is owed, and the worker takes the pipeline
  // when whatever has it lets go.
  if (await delegateCollect(collectRunKey(anchor), "full", DAILY_ROUND_SCHEDULE)) {
    delegatedAnchor = anchor;
  }
}

// Never rejects. A check that throws — settings that would not read, a claim
// file the disk refused — is a round that is late, and it must not take the
// schedule down with it.
//
// The nightly memory pass rides this tick rather than a timer of its own. It
// belongs to the collector (docs/48: dream runs where the election put the
// collecting, and its statements are what the five o'clock briefing reads), and
// this is the one place that already asks who the collector is on a schedule.
// runDreamIfDue owns its own 3 a.m. day gate and never throws; the guard here is
// for the election read.
async function checkDailyRound(): Promise<void> {
  try {
    // Every schedule registered, not just this domain's: this tick is the one
    // place in the app that already asks the clock on a timer. On the device
    // the election picked, an hour that has gone by leaves a wake bell.
    await runScheduleTick({ deviceId: currentDeviceId() });
  } catch (e) {
    console.warn("the schedule check failed", e);
  }
  try {
    await dailyTick();
  } catch (e) {
    console.warn("the morning briefing check failed", e);
  }
  try {
    if (await session.amICollecting()) await runDreamIfDue();
  } catch (e) {
    console.warn("the nightly memory pass check failed", e);
  }
  // Every device folds its own hot layer, collector or not: a run file this
  // machine holds is deleted by this machine, and the ledger line is what tells
  // it which ones (docs/55). Once a day, and it never throws.
  await runLedgerHousekeeping();
}

// The wake is a hint and nothing more — the answer comes from the clock and the
// recorded date — so a tick a suspended process never ran costs lateness, and
// coming back to the foreground asks again regardless.
function scheduleDailyTick(): void {
  if (dailyStopped) return;
  cancelDailyTimer = realTimers.setTimer(DAILY_TICK_MS, () => {
    cancelDailyTimer = null;
    void checkDailyRound().finally(scheduleDailyTick);
  });
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
      extract: await loadExtractReadable(),
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
const PHASE_EVENT: Record<
  InfoRunPhase,
  "info-discover" | "info-screen" | "info-material" | "info-analyze"
> = {
  discovering: "info-discover",
  screening: "info-screen",
  fetching: "info-material",
  // The analysis writes one line per room as well (info-analyze), so this is
  // the phase total over however many rooms the day hit.
  analyzing: "info-analyze",
};

function logPhase(phase: InfoRunPhase, data: Record<string, number>): void {
  const type = PHASE_EVENT[phase];
  if (type) logEvent(INFO_EVENT_TOPIC, type, data);
}

let pipeline: InfoPipeline | null = null;
let collector: InfoCollector | null = null;

// The index adapters (docs/69) are looked up by the engine at run time; the
// program is the one place that registers the whole set.
registerAllSourcePlugins();

// One screen wake lock for the app, held while a briefing generates (docs/22).
let wakeLock = createScreenWakeLock(browserWakeLockTarget());

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
        (await loadDeviceSettings()).backgroundCollect && (await session.amICollecting()),
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
      await session.stop();
      return;
    }
    if (session.isCollecting()) await session.publishClaim();
    else await session.start();
    await getInfoCollector().refresh();
  })().catch((e) => console.warn("failed to apply the collection settings", e));
}

export function getInfoPipeline(): InfoPipeline {
  if (!pipeline) {
    pipeline = new InfoPipeline({
      loadBriefing: loadBriefingForToday,
      loadReader: assembleReaderSection,
      loadLabs,
      loadPicture,
      savePicture,
      loadObservations,
      listSources,
      discover,
      screen,
      fetchBodies,
      analyze,
      saveCableDay,
      loadCableDay,
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
        // After init(), so a run it starts is the one the morning round steps
        // aside for rather than the other way round. This is the edge that
        // catches a machine whose timers stopped while it was suspended — a
        // laptop shut overnight, a phone in a pocket.
        void checkDailyRound();
      },
      onBackground: () => {
        void p.flush();
      },
    });
    observeAppExit(window, () => {
      getInfoCollector().suspend();
      // Nothing is in flight to unwind here; what the cancel is for is the tick
      // that would otherwise land in the middle of a quit and start a run the
      // app has no time left to make.
      dailyStopped = true;
      cancelDailyTimer?.();
      cancelDailyTimer = null;
    });
    void getInfoCollector().refresh();
    // The first check runs now rather than at the first wake: a machine started
    // at nine in the morning has an anchor behind it already, and init() above
    // only answers for a day with no briefing at all.
    void checkDailyRound().finally(scheduleDailyTick);
  }
  return pipeline;
}

// --- what the screens read (docs/36) ---------------------------------------

let reader: InfoReader | null = null;

/**
 * Hand legion the collect kind, bound to this device's pipeline (docs/55 step
 * 12). Called once on the way up, from the shell, before the runner's first
 * poll: a kind with no worker here is a kind this device cannot run, and the
 * election would send the day's round to a machine that declines it.
 *
 * Both shells register it, reader and collector alike. Which of them actually
 * runs a collect run is the election's answer, not the registration's — the
 * registration is what makes a device eligible to win.
 */
export function registerInfoCollectWorker(): void {
  registerCollectWorker({ pipeline: getInfoPipeline });
}

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
    // A regenerate is a run of its own, always. The reader asked for it after
    // seeing what is on the screen now, so the key carries the moment as well as
    // the day and the scope: two asks are two runs, and the second waits its
    // turn behind the first rather than being refused (docs/55 step 12).
    //
    // "busy" is therefore gone from this view. Nothing is dropped any more, so
    // there is no longer a refusal to report, and the progress card follows the
    // pipeline exactly as it did — whatever it is working on is what a
    // collection on this device is doing.
    request(scope) {
      const at = realTimers.now();
      const key = collectRunKey(`${todayLocal()}:${scope}:${at}`);
      const done = delegateCollect(key, scope, "generate_briefing").then(() => {});
      return { outcome: "started", done };
    },
    // This machine is the one collecting; whatever went wrong is already in the
    // snapshot's error, on the screen of the person who can act on it, and the
    // sign-in rows on its source list are the real ones.
    notices: () => [],
    collectorSites: () => null,
    async article(itemId: string): Promise<ArticleState> {
      const briefing = p.snapshot().briefing;
      // A briefing carries only the items it points at, so an id it does not
      // know is one this day never delivered (briefer/reader.ts says the same).
      if (!briefing || !briefing.items[itemId]) return { kind: "unknown" };
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
// The rules themselves are in presence.ts, which is where they can be tested:
// the election, its held answer, when a claim is taken and given up, and which
// reader's request gets run. What is left here is what they are bound to — the
// claim files, the device settings, the real clock and interval, sync, and the
// two singletons above. Nothing in presence.ts imports this file back; the
// places it needs are the callbacks below.

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

function liveSession(): CollectorSession {
  return createCollectorSession({
    deviceId: currentDeviceId,
    describeDevice: async () => ({
      deviceName: await machineName(),
      platform: platformName(),
      // What this machine can do, as capability tags (legion/claim). Rendering
      // an article in a hidden webview is the only one it has to say anything
      // about today: collecting itself asks for nothing, and a reader is told
      // why four of its sources only have headlines (docs/17).
      capabilities: hasWebviewFetch() ? [WEBVIEW_FETCH] : [],
    }),
    readOwnClaim: (id) => appClaims().readOwn<CollectorClaim>(id),
    readClaims: () => appClaims().readAll<CollectorClaim>(),
    writeClaim: (claim) => appClaims().write(claim),
    readAsks,
    loadDeviceSettings,
    loadSourceHealth,
    siteStates,
    now: Date.now,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
    subscribeSyncStatus: (cb) =>
      subscribeSyncStatus((s) => cb({ engineStarted: s.engineStarted, lastSyncAt: s.lastSyncAt })),
    // A source the reader subscribed to or turned on elsewhere, and a reader
    // asking for a briefing. Two routes rather than one subscription with two
    // arms: they answer to different files and neither cares about the other's.
    subscribeSourcesPulled: (cb) => registerPullRoute({ ...SOURCES_PULL_ROUTE, onPulled: cb }),
    subscribeAskPulled: (cb) => registerPullRoute({ ...ASK_PULL_ROUTE, onPulled: cb }),
    onExit: (cb) => observeAppExit(window, cb),
    backfillPublish,
    pipeline: getInfoPipeline,
    collector: getInfoCollector,
    requestCollect: async (scope, askedAt) => {
      await delegateCollect(collectRunKey(`ask:${askedAt}:${scope}`), scope, "reader ask");
    },
  });
}

let session = liveSession();

// Whether this machine is the one collecting. False for anything that is not a
// running collector, so every caller can ask without knowing the role.
export function amICollecting(): Promise<boolean> {
  return session.amICollecting();
}

// Everything this module keeps for the life of the process, put back to how the
// first import left it: the three lazily built objects, the collector session,
// the wake lock, the morning round's recorded date and timer, and this machine's
// name. One function rather than seven, because they refer to each other — the
// session is built holding the two getters, and the morning round runs through
// the pipeline.
//
// Whatever was started is stopped first. A session left running keeps a
// heartbeat, two pull routes and a sync subscription; a morning timer left
// running keeps waking a pipeline nothing can reach any more.
export function resetInfoLiveForTests(): void {
  void session.stop().catch(() => {});
  cancelDailyTimer?.();
  cancelDailyTimer = null;
  wakeLock.set(false);
  session = liveSession();
  wakeLock = createScreenWakeLock(browserWakeLockTarget());
  pipeline = null;
  collector = null;
  reader = null;
  delegatedAnchor = null;
  dailyStopped = false;
  deviceName = null;
}
