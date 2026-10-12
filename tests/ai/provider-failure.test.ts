import { expect, test } from "bun:test";
import { providerFailureName } from "../../src/ai/provider-failure";

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
