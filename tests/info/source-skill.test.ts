// The onboarding skill prompt (src/info/source-skill.ts): the consent rule, the
// no-menu candidate discipline, and the onboarding-only opening paragraph. There
// is no built-in source list to inject. Run: bun test.

import { expect, test } from "bun:test";
import { addSourceSystemPrompt } from "../../src/info/sources/source-skill";
import { BUILTIN_SOURCES } from "../../src/info/sources/builtins";

test("prompt states the consent rule and the trial-before-add rule", () => {
  const p = addSourceSystemPrompt();
  expect(p).toMatch(/only call add_source after the user explicitly agrees/i);
  expect(p).toMatch(/always trial before adding/i);
  expect(p).toMatch(/probe_source/);
});

test("prompt injects no source menu — no builtin names or ids leak in", () => {
  const p = addSourceSystemPrompt({ onboarding: true });
  expect(p).toMatch(/no built-in list of sources/i);
  for (const s of BUILTIN_SOURCES) {
    expect(p).not.toContain(s.id);
    expect(p).not.toContain(s.name);
  }
});

test("prompt requires multi-round digging before proposing candidates", () => {
  const p = addSourceSystemPrompt();
  expect(p).toMatch(/one or two questions at a time/i);
  expect(p).toMatch(/never dump a list/i);
  expect(p).toMatch(/at most 2-3 candidates/i);
});

test("onboarding drafts the first profile via update_profile from the user's own words", () => {
  const p = addSourceSystemPrompt({ onboarding: true });
  expect(p).toMatch(/first run/i);
  expect(p).toMatch(/update_profile/);
  expect(p).toMatch(/no invented taste/i);
  expect(addSourceSystemPrompt({ onboarding: false })).not.toMatch(/first run/i);
});

test("prompt grants descriptor authorship and carries the grammar", () => {
  const p = addSourceSystemPrompt();
  expect(p).toMatch(/draft or adapt a descriptor yourself/i);
  expect(p).toMatch(/Source descriptor grammar/);
  // The grammar names each pipe kind so the model can author one.
  expect(p).toContain("listpage");
  expect(p).toContain("fetch-page");
});

test("language instruction is included when a language is set", () => {
  expect(addSourceSystemPrompt({ aiLanguage: "zh-CN" })).toContain("简体中文");
});
