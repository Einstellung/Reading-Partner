// One room's day, end to end: analyst, apply, synthesis (docs/63 加工).
//
// The two model calls sit either side of the one thing neither model touches —
// applyDelta. The analyst hands back an increment, the program folds it in, and
// the synthesis is then shown what actually landed rather than what the analyst
// claimed. That ordering is the whole safety story on this side: a reply full of
// invented ids costs a few warnings and leaves a valid picture behind.
//
// Each call gets one in-band retry on a parse failure and then throws. The
// caller wraps the run in runWithWatchdog, which owns timeouts and attempts;
// duplicating that here would only make two nested retry budgets.

import type { AiCallOptions } from "../../ai/call-options";
import { newTally, type ParseTally } from "../../platform/app/structured-output";
import { applyDelta, driftAlerts } from "../picture/picture";
import type { Picture } from "../picture/types";
import { analystSystemPrompt, analystUserMessage, parseAnalystOutput } from "./analyst";
import { coverWithinBody } from "./rules";
import {
  judgmentsAddedToday,
  parseSynthesisOutput,
  synthesisSystemPrompt,
  synthesisUserMessage,
} from "./synthesis";
import type {
  AnalysisDeps,
  AnalystInput,
  AnalystOutput,
  LabRunResult,
  ParseOutcome,
  SynthesisInput,
  SynthesisOutput,
} from "./types";

// Appended to the system prompt on the second attempt. In-band, like triage and
// screen: the model that just wrote prose around its JSON is told so in the one
// place it is certain to read.
const RETRY_NUDGE =
  "\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object, no prose, no markdown fence.";

// Run one call and parse it; on a parse failure run it once more with the nudge.
// A second failure throws, because at that point the reply is not something a
// third prompt is going to fix.
async function callAndParse<T>(
  deps: AnalysisDeps,
  opts: AiCallOptions,
  site: "info-analyst" | "info-synthesis",
  system: string,
  user: string,
  parse: (raw: string, tally: ParseTally) => ParseOutcome<T>,
): Promise<T> {
  const attempt = async (extra: string): Promise<ParseOutcome<T>> => {
    const text = await deps.callModel(system + extra, user, opts);
    const tally = newTally();
    const parsed = parse(text, tally);
    deps.onParse?.({ site, text, tally, error: parsed.ok ? undefined : parsed.error });
    return parsed;
  };
  const first = await attempt("");
  if (first.ok) return first.output;
  const second = await attempt(RETRY_NUDGE);
  if (second.ok) return second.output;
  throw new Error(`${site === "info-analyst" ? "analyst" : "synthesis"} produced invalid JSON: ${second.error}`);
}

/**
 * The analyst and synthesis runs for one lab on one day.
 *
 * Returns the picture to save, the cover to put in the briefing (null when the
 * room was quiet), the room's picks tagged with its id, and every warning the
 * run produced. Throws only when a model reply could not be parsed twice.
 */
export async function runLabAnalysis(
  deps: AnalysisDeps,
  input: AnalystInput,
  opts: AiCallOptions,
): Promise<LabRunResult> {
  const analyst: AnalystOutput = await callAndParse(
    deps,
    opts,
    "info-analyst",
    analystSystemPrompt(input.aiLanguage),
    analystUserMessage(input),
    (raw, tally) => parseAnalystOutput(raw, input.picture, tally),
  );

  const applied = applyDelta(input.picture, analyst.delta, {
    date: input.date,
    now: deps.now(),
    random: deps.random,
  });
  const after: Picture = applied.picture;
  const warnings = [...applied.warnings];

  // Drift is read off the merged picture, so today's judgment is the last step
  // of the chain being reported (docs/63 质量规则 漂移检测).
  for (const alert of driftAlerts(after)) {
    warnings.push(
      `judgment ${alert.judgmentId} has been strengthened every step of a ${alert.chain.length}-judgment chain: ${alert.chain.join(" -> ")}`,
    );
  }

  const synthesisInput: SynthesisInput = {
    lab: input.lab,
    before: input.picture,
    after,
    delta: analyst.delta,
    cables: input.cables,
    date: input.date,
    aiLanguage: input.aiLanguage,
  };
  const synthesis: SynthesisOutput = await callAndParse(
    deps,
    opts,
    "info-synthesis",
    synthesisSystemPrompt(input.aiLanguage),
    synthesisUserMessage(synthesisInput),
    (raw, tally) => parseSynthesisOutput(raw, input.cables, tally),
  );

  const added = judgmentsAddedToday(input.picture, after);
  if (synthesis.changed && synthesis.cover !== "") {
    const check = coverWithinBody(synthesis.cover, added, input.aiLanguage);
    // The cover stands either way. Rewriting it would mean a third call to fix a
    // word, and letting the room go coverless would cost the reader their day
    // over a phrasing — the warning is what the drift log is for.
    if (!check.ok) {
      warnings.push(
        `cover claims "${check.offending}", stronger than any judgment added today`,
      );
    }
  }

  return {
    picture: after,
    cover: synthesis.changed
      ? {
          labId: input.lab.id,
          name: input.lab.name,
          cover: synthesis.cover,
          judgments: added.map((j) => j.id),
        }
      : null,
    // The picks survive a quiet day: nothing changed in the room's reading does
    // not mean nothing was worth reading.
    mustRead: synthesis.mustRead.map((m) => ({ ...m, labId: input.lab.id })),
    oneLiners: synthesis.oneLiners.map((o) => ({ ...o, labId: input.lab.id })),
    warnings,
  };
}
