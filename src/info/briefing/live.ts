// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.

import { callModel, resolveModel, type ResolvedModel } from "../../ai/model-call";
import type { AiCallOptions } from "../../ai/watchdog";
import { newTally, reportParse } from "../../platform/app/structured-output";
import { collectAll, type CollectEvent } from "../sources/engine";
import { extractReadable } from "../extract/readable";
import { loadSources, loadSourceHealth, saveSourceHealth } from "../sources/source-store";
import { loadFeedback } from "../../memory/feedback";
import { loadProfile } from "../../memory/profile";
import { assembleReadingContext } from "../../memory/assemble";
import { InfoPipeline } from "./pipeline";
import {
  loadBriefing,
  loadItems,
  pruneStaleDailyFiles,
  saveArticles,
  saveBriefing,
  saveItems,
} from "./store";
import {
  parseTriageResult,
  triageSystemPrompt,
  triageUserMessage,
  type ParseOutcome,
} from "./triage";
import type { FeedbackEvent } from "../../memory/feedback";
import type { InfoItem, TriageResult } from "./types";

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

// Run every enabled source through the generic engine (docs/17). Per-source
// isolation lives in collectAll: one source failing degrades to no items rather
// than failing the run (the pipeline fails only if the whole set comes back
// empty). Each run records per-source health for a future source-list UI.
async function collect(onProgress?: (e: CollectEvent) => void): Promise<InfoItem[]> {
  const sources = await loadSources();
  const prior = await loadSourceHealth();
  const { items, health } = await collectAll(sources, { extract: extractReadable, onProgress }, prior);
  saveSourceHealth(health).catch(() => {});
  return items;
}

let pipeline: InfoPipeline | null = null;

export function getInfoPipeline(): InfoPipeline {
  if (!pipeline) {
    pipeline = new InfoPipeline({
      loadBriefing,
      loadProfile,
      loadFeedback,
      // Reading-side signal for triage: assembled from per-topic memory, guarded
      // so a failure yields "" and the section is simply omitted.
      loadReaderContext: () => assembleReadingContext(),
      collect,
      triage,
      saveBriefing,
      saveArticles,
      saveItems,
      loadItems,
      pruneStaleDays: pruneStaleDailyFiles,
      now: () => Date.now(),
      sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
      setTimer: (ms, cb) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
    });
  }
  return pipeline;
}
