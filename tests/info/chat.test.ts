// Unit tests for the floating info-chat system prompts (src/info/companion/chat.ts): the
// output-language wiring on both threads, and the shared companion context —
// profile, source roster, per-item source, the full filtered clip list, and the
// update_profile anti-over-trigger rule. Run: bun test.

import { expect, test } from "bun:test";
import {
  articleChatSystemPrompt,
  briefingChatSystemPrompt,
  formatProfile,
  formatSources,
  type CompanionContext,
} from "../../src/info/companion/chat";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { Briefing } from "../../src/info/briefing/types";
import { languageInstruction } from "../../src/platform/app/settings";

const SOURCES: SourceDescriptor[] = [
  {
    id: "qbitai", name: "量子位", line: "AI industry", enabled: true,
    discovery: { kind: "feed", url: "https://q/feed" }, fulltext: { mode: "fetch-page" },
  },
  {
    id: "hn", name: "Hacker News", line: "tech front page", enabled: false,
    discovery: { kind: "feed", url: "https://hn/feed" }, fulltext: { mode: "feed-field" },
  },
];

const CTX: CompanionContext = { profile: "I like hard technical substance.", sources: SOURCES };

const BRIEFING: Briefing = {
  date: "2026-07-21",
  generatedAt: 0,
  overview: "A slow day.",
  items: {
    a1: { title: "Model X ships", url: "https://x.test", source: "qbitai", sourceName: "量子位", publishedAt: "2026-07-21" },
    f1: { title: "Vendor Y announces", url: "https://y.test", source: "qbitai", sourceName: "量子位", publishedAt: "2026-07-21" },
  },
  mustRead: [{ itemId: "a1", reason: "you track releases" }],
  oneLiners: [{ line: "Z raised a round.", itemId: "z1" }],
  outOfLane: [],
  filtered: [{ itemId: "f1", category: "vendor PR" }],
};

// Against languageInstruction rather than a retyped copy of its wording: a
// reworded directive should not be a test edit, and `not.toContain` on a
// hand-copied fragment goes quietly vacuous the moment the wording moves. These
// prompts splice the directive in mid-prompt rather than appending it, so this
// asserts presence and absence rather than whole-string equality.
test("briefingChatSystemPrompt pins output only when a language is set", () => {
  const unset = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(briefingChatSystemPrompt(BRIEFING, { ...CTX, aiLanguage: "zh-CN" })).toContain(
    languageInstruction("zh-CN"),
  );
  expect(unset).not.toContain(languageInstruction("zh-CN"));
  expect(briefingChatSystemPrompt(BRIEFING, { ...CTX, aiLanguage: "auto" })).toBe(unset);
});

test("articleChatSystemPrompt pins output only when a language is set", () => {
  const unset = articleChatSystemPrompt("overview", "Title", "body", CTX);
  expect(articleChatSystemPrompt("overview", "Title", "body", { ...CTX, aiLanguage: "pt" })).toContain(
    languageInstruction("pt"),
  );
  expect(unset).not.toContain(languageInstruction("pt"));
});

test("both threads carry the profile, source roster, and the full tool set", () => {
  for (const prompt of [briefingChatSystemPrompt(BRIEFING, CTX), articleChatSystemPrompt("ov", "T", "b", CTX)]) {
    expect(prompt).toContain("I like hard technical substance.");
    expect(prompt).toContain("量子位");
    expect(prompt).toContain("Hacker News");
    expect(prompt).toContain("update_profile");
    expect(prompt).toContain("probe_source");
    expect(prompt).toContain("add_source");
    expect(prompt).toContain("generate_briefing");
  }
});

test("the base role names the companion's fuller capabilities, not a read-only helper", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(prompt).toContain("regenerate today's briefing");
  expect(prompt).toContain("on the user's request, never on your own");
});

test("the tool guidance holds update_profile back to a stated preference", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Do NOT propose a profile change on your own");
});

test("the tool guidance grants descriptor authorship and carries the grammar", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(prompt).toContain("write or adapt yourself");
  expect(prompt).toContain("Source descriptor grammar");
});

test("the tool guidance holds generate_briefing to an explicit request and names both scopes", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Call generate_briefing ONLY when the user explicitly asks");
  expect(prompt).toContain("not after adding a source");
  expect(prompt).toContain("'retriage'");
  expect(prompt).toContain("'full'");
  expect(prompt).toContain("If a run is already in progress, say so");
});

test("the tool guidance carries the four-section skeleton and size discipline", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Interests");
  expect(prompt).toContain("Taste");
  expect(prompt).toContain("Background");
  expect(prompt).toContain("Now");
  expect(prompt).toContain("under half a page");
});

test("the briefing thread names each item's source and lists every filtered clip", () => {
  const prompt = briefingChatSystemPrompt(BRIEFING, CTX);
  // must-read item carries its source name
  expect(prompt).toContain("Model X ships — 量子位 — you track releases");
  // filtered items appear in full: title, source, category (not just a count),
  // and the heading says which of the two filters they came from (docs/35).
  expect(prompt).toContain("Filtered as noise after reading the full text (1)");
  expect(prompt).toContain("Vendor Y announces — 量子位 — vendor PR");
  // No screen ran on this briefing, so nothing claims one did.
  expect(prompt).not.toContain("Screened out before fetching");
});

test("the screening tally reaches the companion as a count, never as a list of titles", () => {
  const prompt = briefingChatSystemPrompt(
    {
      ...BRIEFING,
      screen: { discovered: 412, kept: 9, dropped: 403, cappedOut: 0, droppedIds: ["d1", "d2"] },
    },
    CTX,
  );
  expect(prompt).toContain("Screened out before fetching: 403 of 412");
  // The ids are on record in the briefing file, not in the prompt.
  expect(prompt).not.toContain("d1");
  // And the companion is told the list it can see is not the whole day.
  expect(prompt).toContain("not the whole day");
});

test("a briefing trimmed by the fetch ceiling says so in the companion's context", () => {
  const prompt = briefingChatSystemPrompt(
    {
      ...BRIEFING,
      screen: { discovered: 500, kept: 120, dropped: 380, cappedOut: 22, droppedIds: [] },
    },
    CTX,
  );
  expect(prompt).toContain("22 more cleared the screen but were cut by the daily fetch ceiling");
});

test("formatSources marks disabled sources and handles an empty roster", () => {
  expect(formatSources(SOURCES)).toContain("Hacker News — tech front page [disabled]");
  expect(formatSources([])).toContain("(none yet)");
});

test("formatProfile falls back when empty", () => {
  expect(formatProfile("  ")).toContain("(no profile set)");
});
