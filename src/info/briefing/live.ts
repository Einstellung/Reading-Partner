// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { streamChat, type ProviderId } from "../../ai/providers";
import { loadSettings, toReasoning } from "../../app/settings";
import type { AiCallOptions } from "../../ai/watchdog";
import { collectAll, type CollectEvent } from "../sources/engine";
import { extractReadable } from "../extract/readable";
import { loadSources, loadSourceHealth, saveSourceHealth } from "../sources/source-store";
import { loadFeedback } from "../../memory/feedback";
import { loadProfile } from "../../memory/profile";
import { InfoPipeline } from "./pipeline";
import {
  loadBriefing,
  loadItems,
  saveArticles,
  saveBriefing,
  saveItems,
} from "./store";
import {
  parseTriageResult,
  triageSystemPrompt,
  triageUserMessage,
} from "./triage";
import type { AiLanguage } from "../../app/settings";
import type { FeedbackEvent, InfoItem, TriageResult } from "./types";

async function resolveModel(): Promise<{
  providerId: ProviderId;
  modelId: string;
  reasoning: ThinkingLevel | undefined;
  aiLanguage: AiLanguage;
}> {
  const s = await loadSettings();
  if (!s.defaultProviderId || !s.defaultModelId) {
    throw new Error("No default AI provider configured (Settings).");
  }
  return {
    providerId: s.defaultProviderId as ProviderId,
    modelId: s.defaultModelId,
    // Triage wants some deliberation but not a marathon; reuse the prep effort.
    reasoning: toReasoning(s.prepThinking),
    aiLanguage: s.aiLanguage,
  };
}

// One tool-less streaming call, promisified, reporting cumulative chars for the
// watchdog. `extra` lets the parse-retry append a corrective nudge.
function callModel(userText: string, opts: AiCallOptions, extra?: string): Promise<string> {
  return resolveModel().then(
    (model) =>
      new Promise<string>((resolve, reject) => {
        let chars = 0;
        const bump = (t: string) => {
          chars += t.length;
          opts.onProgress(chars);
        };
        void streamChat({
          providerId: model.providerId,
          modelId: model.modelId,
          systemPrompt: triageSystemPrompt(model.aiLanguage) + (extra ?? ""),
          messages: [{ role: "user", text: userText }],
          signal: opts.signal,
          reasoning: model.reasoning,
          onDelta: bump,
          onThinking: bump,
          onDone: resolve,
          onError: (m) => reject(new Error(m)),
        });
      }),
  );
}

// The triage dep: stream the model, validate the JSON, retry once on a parse
// failure with a corrective instruction. A second failure throws so the watchdog
// treats it as a transient error and retries the whole attempt.
async function triage(
  input: { profile: string; feedback: FeedbackEvent[]; items: InfoItem[] },
  opts: AiCallOptions,
): Promise<TriageResult> {
  const userText = triageUserMessage(input.profile, input.feedback, input.items);
  const validIds = new Set(input.items.map((it) => it.id));
  const first = await callModel(userText, opts);
  const parsed = parseTriageResult(first, validIds);
  if (parsed.ok) return parsed.result;
  const retry = await callModel(
    userText,
    opts,
    "\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object, no prose, no markdown fence.",
  );
  const reparsed = parseTriageResult(retry, validIds);
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
      collect,
      triage,
      saveBriefing,
      saveArticles,
      saveItems,
      loadItems,
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
