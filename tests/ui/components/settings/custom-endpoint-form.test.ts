// The custom endpoint form's rules (src/ui/components/settings/custom-endpoint-form.ts):
// what the URL field says, when the model list is asked for, and which sentence
// each probe verdict becomes. Run: bun test.

import { expect, test } from "bun:test";
import {
  modelListRequest,
  urlProblem,
  verdictMessage,
} from "../../../../src/ui/components/settings/custom-endpoint-form";

test("the URL field complains about http and about non-URLs, not about an empty field", () => {
  expect(urlProblem("")).toBeNull();
  expect(urlProblem("https://api.example.com/v1")).toBeNull();
  expect(urlProblem("http://api.example.com/v1")).toBe("custom.notHttps");
  expect(urlProblem("api.example.com")).toBe("custom.invalidUrl");
});

test("the model list is asked for only with an https URL and a key", () => {
  expect(modelListRequest("https://api.example.com/v1/", " sk ")).toEqual({
    baseUrl: "https://api.example.com/v1",
    key: "sk",
  });
  expect(modelListRequest("https://api.example.com/v1", "  ")).toBeNull();
  expect(modelListRequest("http://api.example.com/v1", "sk")).toBeNull();
  expect(modelListRequest("", "sk")).toBeNull();
});

test("a passed probe says nothing; the others each have their sentence", () => {
  expect(verdictMessage({ kind: "ok" })).toBeNull();
  expect(verdictMessage({ kind: "noTools" })).toEqual({ key: "custom.noTools" });
  expect(verdictMessage({ kind: "auth" })).toEqual({ key: "custom.auth" });
  expect(verdictMessage({ kind: "failed", detail: "HTTP 500" })).toEqual({ key: "custom.failed", detail: "HTTP 500" });
});
