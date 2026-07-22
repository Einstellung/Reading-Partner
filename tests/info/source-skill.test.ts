// The add-source skill prompt (src/info/source-skill.ts): the consent rule, the
// injected catalog, and the onboarding-only opening paragraph. Run: bun test.

import { expect, test } from "bun:test";
import { addSourceSystemPrompt } from "../../src/info/source-skill";
import { SOURCE_KNOWLEDGE } from "../../src/info/knowledge";

test("prompt states the consent rule and the trial-before-add rule", () => {
  const p = addSourceSystemPrompt();
  expect(p).toMatch(/only call add_source after the user explicitly agrees/i);
  expect(p).toMatch(/always trial before adding/i);
  expect(p).toMatch(/probe_source/);
});

test("prompt injects every catalog source by id", () => {
  const p = addSourceSystemPrompt();
  for (const k of SOURCE_KNOWLEDGE) {
    expect(p).toContain(k.id);
  }
});

test("onboarding adds an opening paragraph; default does not", () => {
  expect(addSourceSystemPrompt({ onboarding: true })).toMatch(/first run/i);
  expect(addSourceSystemPrompt({ onboarding: false })).not.toMatch(/first run/i);
});

test("language instruction is included when a language is set", () => {
  expect(addSourceSystemPrompt({ aiLanguage: "zh-CN" })).toContain("简体中文");
});
