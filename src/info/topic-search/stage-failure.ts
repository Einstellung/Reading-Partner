// Why a topic search's judging stage failed, as one line the reader can act on
// (docs/info/88 「送达」). The result file keeps the model call's own words in
// `unjudged.why`; a rejected model, a lost sign-in, no connection or any other
// provider error is said on the info shelf and in the box, so a run that
// failed does not look like a run that found nothing. The reasons the program
// writes itself (nothing to judge, a rerank that named nothing) and a stopped
// run are not failures to tell.

import { modelCallFailure, type ModelCallFailure } from "../../ai/provider-failure";
import type { Locale } from "../../i18n/locale";
import { translate } from "../../i18n/translate";
import type { ResultUnjudged } from "./result-types";

/** build-update.ts: the pool held nothing this device could judge. */
export const NOTHING_TO_JUDGE = "no candidate on this device to judge";
/** build-result.ts, build-update.ts: the rerank answered without naming a candidate. */
export const RERANK_NAMED_NONE = "the rerank named no candidate";

const PROGRAM_WHYS: ReadonlySet<string> = new Set([NOTHING_TO_JUDGE, RERANK_NAMED_NONE]);

/** Characters of a provider's own words kept on the line. */
const DETAIL_CHARS = 140;

/** The failure an `unjudged.why` records; null when nothing failed that the reader could act on. */
export function stageFailure(why: string | null | undefined): ModelCallFailure | null {
  if (!why || PROGRAM_WHYS.has(why) || /\babort/i.test(why)) return null;
  return modelCallFailure(why);
}

/** The failure a closed run left: its result's `unjudged` when that is this run's (any run's when no id is known). */
export function runStageFailure(unjudged: ResultUnjudged | undefined, runId?: string | null): ModelCallFailure | null {
  if (!unjudged || (runId && unjudged.runId && unjudged.runId !== runId)) return null;
  return stageFailure(unjudged.why);
}

function cut(text: string, n: number): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.length <= n ? chars.join("") : `${chars.slice(0, n - 1).join("")}…`;
}

/** "The model gpt-5.5 is not supported with your ChatGPT account; choose another in Settings." */
export function stageFailureLine(failure: ModelCallFailure, locale: Locale): string {
  const key = (name: string) => `info.topicSearch.${name}`;
  switch (failure.kind) {
    case "model-rejected":
      if (!failure.model) return translate(locale, key("failModelUnnamed"));
      return translate(locale, key(failure.chatgpt ? "failModelChatGpt" : "failModel"), { model: failure.model });
    case "not-signed-in":
      return translate(locale, key("failSignedOut"));
    case "offline":
      return translate(locale, key("failOffline"));
    case "provider":
      return translate(locale, key("failProvider"), { detail: cut(failure.detail, DETAIL_CHARS) });
  }
}
