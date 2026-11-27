// The custom endpoint form's rules, apart from its rendering: what the URL
// field says about what was typed, when the model list is worth asking for, and
// which sentence a test request's verdict is shown as.

import { checkBaseUrl, type ToolProbeVerdict } from "../../../ai/custom-provider";

export type UrlProblem = "custom.notHttps" | "custom.invalidUrl";

// The sentence under the URL field, or null. An empty field says nothing: the
// user has not typed anything wrong yet.
export function urlProblem(input: string): UrlProblem | null {
  const check = checkBaseUrl(input);
  if (check.ok || check.reason === "empty") return null;
  return check.reason === "notHttps" ? "custom.notHttps" : "custom.invalidUrl";
}

// The URL and key the model list is fetched with, or null while either is not
// usable yet.
export function modelListRequest(urlInput: string, key: string): { baseUrl: string; key: string } | null {
  const check = checkBaseUrl(urlInput);
  const trimmed = key.trim();
  return check.ok && trimmed ? { baseUrl: check.url, key: trimmed } : null;
}

export type VerdictMessage =
  | { key: "custom.noTools" | "custom.auth" }
  | { key: "custom.failed"; detail: string };

// What to tell the user after the test request. Null means it passed and the
// endpoint is saved.
export function verdictMessage(verdict: ToolProbeVerdict): VerdictMessage | null {
  switch (verdict.kind) {
    case "ok":
      return null;
    case "noTools":
      return { key: "custom.noTools" };
    case "auth":
      return { key: "custom.auth" };
    case "failed":
      return { key: "custom.failed", detail: verdict.detail };
  }
}
