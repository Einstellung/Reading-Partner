// Live wiring of the info pipeline (docs/16): real HTTP adapters, the readable
// extractor, and the app's provider config bound to the dep-injected
// InfoPipeline. One pipeline instance for the app's lifetime so a generation
// keeps running across view switches. AI calls happen here (streamChat under the
// watchdog); the pure logic (adapters, triage prompt/validation) stays testable.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { streamChat, type ProviderId } from "../ai/providers";
import { loadSettings, toReasoning } from "../settings";
import type { AiCallOptions } from "../ai/watchdog";
import { collectJiqizhixin } from "./jiqizhixin";
import { collectQbitai } from "./qbitai";
import { extractReadable } from "./readable";
import { loadFeedback } from "./feedback";
import { loadProfile } from "./profile";
import { InfoPipeline } from "./pipeline";
import {
  loadBriefing,
  saveArticles,
  saveBriefing,
} from "./store";
import {
  parseTriageResult,
  triageSystemPrompt,
  triageUserMessage,
} from "./triage";
import type { AiLanguage } from "../settings";
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

// Fetch both sources fully. A source that throws (network/host down) degrades to
// no items rather than failing the whole run; the pipeline fails only if BOTH
// come back empty.
async function collect(): Promise<InfoItem[]> {
  const [jqx, qbit] = await Promise.all([
    collectJiqizhixin({}).catch((e) => {
      console.warn("jiqizhixin fetch failed", e);
      return [] as InfoItem[];
    }),
    collectQbitai({ extract: extractReadable }).catch((e) => {
      console.warn("qbitai fetch failed", e);
      return [] as InfoItem[];
    }),
  ]);
  return [...jqx, ...qbit];
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
