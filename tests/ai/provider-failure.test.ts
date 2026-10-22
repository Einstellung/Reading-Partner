import { expect, test } from "bun:test";
import { modelCallFailure, providerDetail, providerFailureName } from "../../src/ai/provider-failure";

test("pi-ai's texts for a failed credential lookup and a refused connection map to their names", () => {
  expect(providerFailureName("API key auth failed for provider anthropic: Anthropic is not connected")).toBe("NotSignedInError");
  expect(providerFailureName("OpenAI is not connected. Open Settings to sign in with ChatGPT.")).toBe("NotSignedInError");
  expect(providerFailureName('401 {"type":"error","error":{"type":"authentication_error"}}')).toBe("NotSignedInError");
  expect(providerFailureName("Connection error.")).toBe("OfflineError");
  expect(providerFailureName("TypeError: fetch failed")).toBe("OfflineError");
  expect(providerFailureName("Load failed")).toBe("OfflineError");
  expect(providerFailureName("The Internet connection appears to be offline.")).toBe("OfflineError");
  expect(providerFailureName("529 overloaded_error")).toBe("ModelCallError");
});

test("a model the provider refuses is told apart, with its id, from other provider errors", () => {
  // The ChatGPT Codex backend's answer to gpt-5.5 on 2026-10-22, as the result file kept it.
  const codex = '{"detail":"The \'gpt-5.5\' model is not supported when using Codex with a ChatGPT account."}';
  expect(providerDetail(codex)).toBe("The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.");
  expect(modelCallFailure(codex)).toEqual({ kind: "model-rejected", model: "gpt-5.5", chatgpt: true });
  expect(modelCallFailure("404 The model `gpt-9` does not exist or you do not have access to it.")).toEqual({ kind: "model-rejected", model: "gpt-9", chatgpt: false });
  expect(modelCallFailure('{"error":{"code":"model_not_found","message":"no such model"}}')).toEqual({ kind: "model-rejected", model: null, chatgpt: false });
  expect(modelCallFailure("OpenAI is not connected. Open Settings to sign in with ChatGPT.")).toEqual({ kind: "not-signed-in" });
  expect(modelCallFailure("Connection error.")).toEqual({ kind: "offline" });
  expect(modelCallFailure('429 {"error":{"message":"Rate limit reached"}}')).toEqual({ kind: "provider", detail: "Rate limit reached" });
  expect(modelCallFailure("529 overloaded_error")).toEqual({ kind: "provider", detail: "529 overloaded_error" });
});
