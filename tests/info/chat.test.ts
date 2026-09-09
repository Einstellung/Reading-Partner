// The info companion's system prompt, as the desk assembles it (src/info/
// briefer/desk.ts over src/info/briefer/chat.ts): the output-language wiring
// on both threads, and the shared companion context — profile, source roster,
// per-item source, the full filtered clip list, and the update_profile
// anti-over-trigger rule.
//
// Asserted through openDesk + assembleTurn rather than off the prompt functions,
// because that is now the only way the app builds one: the briefing is a thing on
// the desk and an article is a second thing beside it (docs/61). The formatting
// helpers are still pure and still asserted directly. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn } from "../../src/ai/assemble";
import { openDesk, type DeskEnv, type DeskRef } from "../../src/desk";
import {
  formatProfile,
  formatSignInSites,
  formatSources,
  type CompanionContext,
} from "../../src/info/briefer/chat";
import {
  INFO_ARTICLE_KIND,
  INFO_BRIEFING_KIND,
  registerInfoDesk,
} from "../../src/info/briefer/desk";
import { DEFAULT_SETTINGS } from "../../src/platform/app/settings";
import { BRIEF_TOPIC_ID } from "../../src/platform/app/topics";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { installAppData } from "../support/appdata-fake";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { Briefing } from "../../src/info/collect/types";
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

registerInfoDesk();

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
});

function env(): DeskEnv {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
    },
    topic: { id: BRIEF_TOPIC_ID, name: "Brief" },
    thread: { key: "info-2026-07-21", id: "briefing-2026-07-21" },
  };
}

async function assemble(refs: DeskRef[]): Promise<string> {
  const turn = await assembleTurn({ desk: await openDesk(refs, env()) });
  return turn!.systemPrompt;
}

function briefingPrompt(b: Briefing, ctx: CompanionContext): Promise<string> {
  return assemble([{ kind: INFO_BRIEFING_KIND, ref: { dateKey: b.date, briefing: b, ctx } }]);
}

function noBriefingPrompt(
  ctx: CompanionContext,
  opts: { error?: string; notices?: string[] } = {},
): Promise<string> {
  return assemble([
    {
      kind: INFO_BRIEFING_KIND,
      ref: {
        dateKey: "2026-07-21",
        briefing: null,
        ctx,
        error: opts.error ?? null,
        notices: opts.notices ?? [],
      },
    },
  ]);
}

// The article desk: the day's briefing and the piece pulled out of it, in that
// order, which is what an article chat lays.
function articlePrompt(title: string, text: string, ctx: CompanionContext): Promise<string> {
  return assemble([
    { kind: INFO_BRIEFING_KIND, ref: { dateKey: BRIEFING.date, briefing: BRIEFING, ctx } },
    {
      kind: INFO_ARTICLE_KIND,
      ref: {
        dateKey: BRIEFING.date,
        itemId: "a1",
        title,
        overview: BRIEFING.overview,
        bodyText: text,
      },
    },
  ]);
}

// Against languageInstruction rather than a retyped copy of its wording: a
// reworded directive should not be a test edit, and `not.toContain` on a
// hand-copied fragment goes quietly vacuous the moment the wording moves. These
// prompts splice the directive in mid-prompt rather than appending it, so this
// asserts presence and absence rather than whole-string equality.
test("the briefing thread pins output only when a language is set", async () => {
  const unset = await briefingPrompt(BRIEFING, CTX);
  expect(await briefingPrompt(BRIEFING, { ...CTX, aiLanguage: "zh-CN" })).toContain(
    languageInstruction("zh-CN"),
  );
  expect(unset).not.toContain(languageInstruction("zh-CN"));
  expect(await briefingPrompt(BRIEFING, { ...CTX, aiLanguage: "auto" })).toBe(unset);
});

test("the article thread pins output only when a language is set", async () => {
  const unset = await articlePrompt("Title", "body", CTX);
  expect(await articlePrompt("Title", "body", { ...CTX, aiLanguage: "pt" })).toContain(
    languageInstruction("pt"),
  );
  expect(unset).not.toContain(languageInstruction("pt"));
});

// An article chat is the day's conversation with one piece pulled to the front,
// so the companion still has the briefing, the profile and every tool.
test("the article desk is the briefing and then the article", async () => {
  const prompt = await articlePrompt("The paper", "the full body text", CTX);
  expect(prompt).toContain("Overview: A slow day.");
  expect(prompt).toContain('The user is reading this article: "The paper".');
  expect(prompt).toContain("the full body text");
  expect(prompt.indexOf("Overview: A slow day.")).toBeLessThan(
    prompt.indexOf("The user is reading this article"),
  );
});

test("both threads carry the profile, source roster, and the full tool set", async () => {
  for (const prompt of [await briefingPrompt(BRIEFING, CTX), await articlePrompt("T", "b", CTX)]) {
    expect(prompt).toContain("I like hard technical substance.");
    expect(prompt).toContain("量子位");
    expect(prompt).toContain("Hacker News");
    expect(prompt).toContain("update_profile");
    expect(prompt).toContain("probe_source");
    expect(prompt).toContain("add_source");
    expect(prompt).toContain("generate_briefing");
  }
});

test("the base role names the companion's fuller capabilities, not a read-only helper", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  expect(prompt).toContain("regenerate today's briefing");
  expect(prompt).toContain("on the user's request, never on your own");
});

test("the tool guidance holds update_profile back to a stated preference", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Do NOT propose a profile change on your own");
});

test("the tool guidance grants descriptor authorship and carries the grammar", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  expect(prompt).toContain("write or adapt yourself");
  expect(prompt).toContain("Source descriptor grammar");
});

test("the tool guidance holds generate_briefing to an explicit request and names both scopes", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Call generate_briefing ONLY when the user explicitly asks");
  expect(prompt).toContain("not after adding a source");
  expect(prompt).toContain("'retriage'");
  expect(prompt).toContain("'full'");
  expect(prompt).toContain("If a run is already in progress, say so");
});

test("the tool guidance carries the four-section skeleton and size discipline", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  expect(prompt).toContain("Interests");
  expect(prompt).toContain("Taste");
  expect(prompt).toContain("Background");
  expect(prompt).toContain("Now");
  expect(prompt).toContain("under half a page");
});

test("the briefing thread names each item's source and lists every filtered clip", async () => {
  const prompt = await briefingPrompt(BRIEFING, CTX);
  // must-read item carries its source name
  expect(prompt).toContain("Model X ships — 量子位 — you track releases");
  // filtered items appear in full: title, source, category (not just a count),
  // and the heading says which of the two filters they came from (docs/35).
  expect(prompt).toContain("Filtered as noise after reading the full text (1)");
  expect(prompt).toContain("Vendor Y announces — 量子位 — vendor PR");
  // No screen ran on this briefing, so nothing claims one did.
  expect(prompt).not.toContain("Screened out before fetching");
});

test("the screening tally reaches the companion as a count, never as a list of titles", async () => {
  const prompt = await briefingPrompt(
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

test("a briefing trimmed by the fetch ceiling says so in the companion's context", async () => {
  const prompt = await briefingPrompt(
    {
      ...BRIEFING,
      screen: { discovered: 500, kept: 120, dropped: 380, cappedOut: 22, droppedIds: [] },
    },
    CTX,
  );
  expect(prompt).toContain("22 more cleared the screen but were cut by the daily fetch ceiling");
});

// --- the thread before there is a briefing (docs/35) -------------------------

test("the no-briefing thread carries the companion's context and can still generate one", async () => {
  const prompt = await noBriefingPrompt(CTX);
  expect(prompt).toContain("I like hard technical substance.");
  expect(prompt).toContain("量子位");
  expect(prompt).toContain("generate_briefing");
  expect(prompt).toContain("There is no briefing for today yet.");
  // There is no Generate button any more, so the companion has to know where the
  // briefing comes from — and that it must not offer one unasked.
  expect(prompt).toContain("there is no button for it");
  expect(prompt).toContain("Do not offer");
});

test("the no-briefing thread passes on why the last attempt failed, and says nothing when there was none", async () => {
  expect(await noBriefingPrompt(CTX, { error: "no network" })).toContain(
    "The last attempt to build one failed: no network",
  );
  expect(await noBriefingPrompt(CTX)).not.toContain("The last attempt");
});

// On a reader the old sentence is simply false: nothing is collected when this
// app opens, because it happens on another machine (docs/36).
test("a device that does not collect is not told the briefing arrives when it opens", async () => {
  const prompt = await noBriefingPrompt(
    { ...CTX, collecting: false },
    { notices: ["kestrel last checked in 5 hours ago."] },
  );
  expect(prompt).not.toContain("there is no button for it");
  expect(prompt).toContain("This device does not collect");
  expect(prompt).toContain("leaves the request");
  // And it can say what it knows about the machine that would have built it.
  expect(prompt).toContain("kestrel last checked in 5 hours ago.");
});

// A companion told about add_source on a device that does not have it will
// promise a subscription it cannot make.
test("a device that does not collect describes no add-source tools", async () => {
  const prompt = await noBriefingPrompt({ ...CTX, collecting: false });
  expect(prompt).not.toContain("probe_source");
  expect(prompt).not.toContain("trial_source");
  expect(prompt).toContain("cannot add sources on this device");
  // read_page and the profile tool stay, and so does what they need.
  expect(prompt).toContain("read_page");
  expect(prompt).toContain("update_profile");
});

test("the no-briefing thread pins output only when a language is set", async () => {
  const unset = await noBriefingPrompt(CTX);
  expect(await noBriefingPrompt({ ...CTX, aiLanguage: "zh-CN" })).toContain(
    languageInstruction("zh-CN"),
  );
  expect(unset).not.toContain(languageInstruction("zh-CN"));
});

test("formatSources marks disabled sources and handles an empty roster", () => {
  expect(formatSources(SOURCES)).toContain("Hacker News — tech front page [disabled]");
  expect(formatSources([])).toContain("(none yet)");
});

test("formatProfile falls back when empty", () => {
  expect(formatProfile("  ")).toContain("(no profile set)");
});

// --- the sign-in window ------------------------------------------------------

const BLOOMBERG: SourceDescriptor = {
  id: "bloomberg-technology", name: "Bloomberg Technology", line: "tech business", enabled: true,
  discovery: { kind: "feed", url: "https://b/feed" },
  fulltext: { mode: "webview", signInUrl: "https://www.bloomberg.com/account/signin" },
};

test("a host that can open a sign-in window gets the tool, the rules, and the site list", async () => {
  const prompt = await briefingPrompt(BRIEFING, {
    ...CTX,
    sources: [...SOURCES, BLOOMBERG],
    canSignIn: true,
  });
  expect(prompt).toContain("open_site_sign_in(site)");
  // The site is picked from the user's own list, and the window is opened on
  // their word — the two rules that must survive any later edit of this prompt.
  expect(prompt).toContain("`site` is an identifier, never a");
  expect(prompt).toContain("Never open one on your own initiative");
  expect(prompt).toContain("- bloomberg.com — Bloomberg Technology");
});

test("a host with no webview is told nothing about a window it cannot open", async () => {
  const prompt = await briefingPrompt(BRIEFING, { ...CTX, sources: [...SOURCES, BLOOMBERG] });
  expect(prompt).not.toContain("open_site_sign_in");
  expect(prompt).not.toContain("bloomberg.com — ");
  // The tools it does have are untouched.
  expect(prompt).toContain("generate_briefing");
});

test("formatSignInSites says plainly when no source has a sign-in", () => {
  expect(formatSignInSites(SOURCES)).toContain("nothing to sign in to");
  expect(formatSignInSites([BLOOMBERG])).toContain("on the user's request only");
});
