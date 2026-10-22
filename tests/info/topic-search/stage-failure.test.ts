// A topic search's failed judging stage as a line the reader can act on (stage-failure.ts).

import { expect, test } from "bun:test";
import { LOCALES } from "../../../src/i18n/locale";
import { NOTHING_TO_JUDGE, RERANK_NAMED_NONE, runStageFailure, stageFailure, stageFailureLine } from "../../../src/info/topic-search/stage-failure";

const CODEX = '{"detail":"The \'gpt-5.5\' model is not supported when using Codex with a ChatGPT account."}';

test("the program's own reasons and a stopped run are no failure; a provider's words are", () => {
  expect(stageFailure(NOTHING_TO_JUDGE)).toBeNull();
  expect(stageFailure(RERANK_NAMED_NONE)).toBeNull();
  expect(stageFailure("The operation was aborted.")).toBeNull();
  expect(stageFailure(null)).toBeNull();
  expect(stageFailure(CODEX)).toEqual({ kind: "model-rejected", model: "gpt-5.5", chatgpt: true });
});

test("only the closing run's own failure counts", () => {
  const unjudged = { runId: "run-1", at: 1, why: CODEX, candidates: 60 };
  expect(runStageFailure(unjudged, "run-1")?.kind).toBe("model-rejected");
  expect(runStageFailure(unjudged, "run-2")).toBeNull();
  expect(runStageFailure(unjudged, undefined)?.kind).toBe("model-rejected");
  expect(runStageFailure(undefined, "run-1")).toBeNull();
});

test("each failure has its line, in every locale", () => {
  expect(stageFailureLine({ kind: "model-rejected", model: "gpt-5.5", chatgpt: true }, "en")).toBe(
    "The model gpt-5.5 is not supported with your ChatGPT account; choose another in Settings.",
  );
  expect(stageFailureLine({ kind: "model-rejected", model: "gpt-9", chatgpt: false }, "en")).toBe("The model gpt-9 is not supported with your account; choose another in Settings.");
  expect(stageFailureLine({ kind: "not-signed-in" }, "en")).toBe("The AI provider is signed out; sign in again in Settings.");
  expect(stageFailureLine({ kind: "provider", detail: "x".repeat(400) }, "en").length).toBeLessThan(200);
  for (const locale of LOCALES) {
    const line = stageFailureLine({ kind: "model-rejected", model: "gpt-5.5", chatgpt: true }, locale);
    expect(line).toContain("gpt-5.5");
    expect(line).not.toContain("info.topicSearch");
  }
});
