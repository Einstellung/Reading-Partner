// The shared companion tools (src/info/companion/companion-tools.ts): the update_profile
// tool drafts a confirm card and writes nothing; the tool set includes the three
// source tools; the status label extends the source labels. Card sink injected;
// no save, no fetch. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCompanionTools,
  buildGenerateBriefingTool,
  buildReadPageTool,
  buildSignInTool,
  buildUpdateProfileTool,
  companionToolStatusLabel,
  type BriefingScope,
  type SiteSignInDeps,
} from "../../src/info/companion/companion-tools";
import { signInSites } from "../../src/info/sources/site-session";
import type { ProfileUpdateCardData } from "../../src/info/briefing/cards";
import type { SourceDescriptor } from "../../src/info/sources/descriptor";
import type { ExtractReadable } from "../../src/info/extract/readable-select";
import type { SessionStatus, SignInOutcome } from "../../src/info/extract/webview-session";
import type { RunStart } from "../../src/info/briefing/pipeline";

const extract: ExtractReadable = () => ({ title: "t", contentHtml: "<p>b</p>", textContent: "b" });

function deps(cards: ProfileUpdateCardData[]) {
  return {
    fetchFn: async () => new Response(""),
    extract,
    addSource: async () => {},
    onProbeCard: () => {},
    onProfileCard: (c: ProfileUpdateCardData) => cards.push(c),
    startBriefing: () => "started" as const,
  };
}

test("update_profile fires a draft card with the full profile and writes nothing", async () => {
  const cards: ProfileUpdateCardData[] = [];
  const tool = buildUpdateProfileTool({ onProfileCard: (c) => cards.push(c) });
  const out = await tool.execute({ profile: "New profile text.", summary: "Harsher on PR" });
  expect(cards.length).toBe(1);
  expect(cards[0].kind).toBe("profile-update");
  expect(cards[0].phase).toBe("draft");
  expect(cards[0].profile).toBe("New profile text.");
  expect(cards[0].summary).toBe("Harsher on PR");
  expect(String(out)).toMatch(/Apply it themselves/i);
});

test("update_profile rejects an empty profile or missing summary", async () => {
  const tool = buildUpdateProfileTool({ onProfileCard: () => {} });
  await expect(tool.execute({ profile: "  ", summary: "x" })).rejects.toThrow(/full revised profile/i);
  await expect(tool.execute({ profile: "text", summary: "" })).rejects.toThrow(/summary/i);
});

test("buildCompanionTools mounts the source tools plus read_page, update_profile and generate_briefing", () => {
  const names = buildCompanionTools(deps([])).map((t) => t.name);
  expect(names).toContain("probe_source");
  expect(names).toContain("trial_source");
  expect(names).toContain("add_source");
  expect(names).toContain("read_page");
  expect(names).toContain("update_profile");
  expect(names).toContain("generate_briefing");
});

test("read_page fetches a page and reports its title, text, and links", async () => {
  const html = `<html><head><title>News Hub</title></head>
    <body><nav><a href="/lists/65.html">时政</a></nav><p>Front page.</p></body></html>`;
  const tool = buildReadPageTool({
    fetchFn: async () => new Response(html, { headers: { "content-type": "text/html" } }),
  });
  const out = String(await tool.execute({ url: "jiemian.com" }));
  expect(out).toMatch(/Title: News Hub/);
  expect(out).toMatch(/Front page\./);
  expect(out).toMatch(/时政 → https:\/\/jiemian\.com\/lists\/65\.html/);
});

test("read_page returns a non-HTML body raw with its content-type", async () => {
  const feed = '<?xml version="1.0"?><rss><channel></channel></rss>';
  const tool = buildReadPageTool({
    fetchFn: async () => new Response(feed, { headers: { "content-type": "application/rss+xml" } }),
  });
  const out = String(await tool.execute({ url: "https://site.com/feed" }));
  expect(out).toMatch(/non-HTML content \(content-type: application\/rss\+xml\)/);
  expect(out).toMatch(/<rss>/);
});

test("read_page reports an HTTP error and a fetch failure without throwing", async () => {
  const notFound = buildReadPageTool({ fetchFn: async () => new Response("", { status: 404 }) });
  expect(String(await notFound.execute({ url: "https://site.com/x" }))).toMatch(/HTTP 404/);
  const broke = buildReadPageTool({
    fetchFn: async () => {
      throw new Error("network down");
    },
  });
  expect(String(await broke.execute({ url: "https://site.com/x" }))).toMatch(/Could not read.*network down/);
});

test("read_page rejects an empty or invalid URL", async () => {
  const tool = buildReadPageTool({ fetchFn: async () => new Response("") });
  await expect(tool.execute({ url: "  " })).rejects.toThrow(/needs a URL/i);
  await expect(tool.execute({ url: "http://" })).rejects.toThrow(/valid http/i);
});

test("companionToolStatusLabel labels the companion tools and defers to source labels", () => {
  expect(companionToolStatusLabel("read_page", { url: "https://site.com" })).toMatch(/Reading https:\/\/site\.com/);
  expect(companionToolStatusLabel("update_profile", {})).toMatch(/Drafting a profile update/);
  expect(companionToolStatusLabel("generate_briefing", { scope: "full" })).toMatch(/Regenerating the briefing/);
  expect(companionToolStatusLabel("generate_briefing", { scope: "retriage" })).toMatch(/Re-sorting today's briefing/);
  expect(companionToolStatusLabel("add_source", {})).toMatch(/Adding the source/);
  expect(companionToolStatusLabel("open_site_sign_in", { site: "bloomberg.com" })).toMatch(
    /Waiting for the bloomberg\.com sign-in/,
  );
});

function briefingDeps() {
  const started: BriefingScope[] = [];
  let running = false;
  return {
    started,
    setRunning: (v: boolean) => {
      running = v;
    },
    // The host's own answer: a request that arrives while a run is going joins
    // that run rather than starting one, and reports "busy" so the tool can say so.
    deps: {
      startBriefing: (s: BriefingScope): RunStart => {
        if (running) return "busy";
        started.push(s);
        return "started";
      },
    },
  };
}

test("generate_briefing starts a full regeneration and returns without claiming completion", async () => {
  const h = briefingDeps();
  const tool = buildGenerateBriefingTool(h.deps);
  const out = String(await tool.execute({ scope: "full" }));
  expect(h.started).toEqual(["full"]);
  expect(out).toMatch(/re-collecting every source/i);
  expect(out).toMatch(/do not say the briefing is done/i);
});

test("generate_briefing scope 'retriage' re-sorts without re-collecting", async () => {
  const h = briefingDeps();
  const out = String(await buildGenerateBriefingTool(h.deps).execute({ scope: "retriage" }));
  expect(h.started).toEqual(["retriage"]);
  expect(out).toMatch(/re-triage of today's items/i);
});

// The bug this guards: the refusal used to be invisible to the host, so the chat
// drew a progress card for a run that never began and the companion reported a
// start that never happened. The tool has to read the answer and say so.
test("generate_briefing reports a refusal instead of claiming its request started", async () => {
  const h = briefingDeps();
  h.setRunning(true);
  const out = String(await buildGenerateBriefingTool(h.deps).execute({ scope: "full" }));
  expect(h.started).toEqual([]);
  expect(out).toMatch(/already under way/i);
  expect(out).toMatch(/started nothing/i);
  expect(out).not.toMatch(/Started a full regeneration/i);
});

test("generate_briefing rejects an unknown scope", async () => {
  const h = briefingDeps();
  await expect(buildGenerateBriefingTool(h.deps).execute({ scope: "partial" })).rejects.toThrow(/retriage.*full|scope/i);
  expect(h.started).toEqual([]);
});

// --- open_site_sign_in ------------------------------------------------------
//
// The property under test: the tool picks a site out of the user's own source
// list and takes the URL from that record, so no string the model passes can
// decide where a login window points. Only the pure half is covered here — the
// window itself is Rust and a real screen.

const BLOOMBERG_SOURCE: SourceDescriptor = {
  id: "bloomberg-technology",
  name: "Bloomberg Technology",
  line: "tech business",
  enabled: true,
  discovery: { kind: "feed", url: "https://feeds.bloomberg.com/technology/news.rss" },
  fulltext: { mode: "webview", signInUrl: "https://www.bloomberg.com/account/signin" },
};

const SIGNED_IN: SessionStatus = {
  status: "ok",
  signedIn: true,
  checkedUrl: "https://www.bloomberg.com/",
  finalUrl: "https://www.bloomberg.com/",
  title: "Bloomberg",
  elapsedMs: 4000,
  detail: null,
};

// A fake host: records what it was asked to open and check, answers with what
// the window and the check found.
function signInDeps(
  opts: {
    sources?: SourceDescriptor[];
    outcome?: SignInOutcome | Error;
    status?: SessionStatus | Error;
  } = {},
) {
  const opened: string[] = [];
  const checked: string[] = [];
  const d: SiteSignInDeps = {
    signInSites: async () => signInSites(opts.sources ?? [BLOOMBERG_SOURCE]),
    openSignIn: async (site) => {
      opened.push(site.signInUrl);
      if (opts.outcome instanceof Error) throw opts.outcome;
      return opts.outcome ?? { closed: true, elapsedMs: 42_000 };
    },
    checkSession: async (site) => {
      checked.push(site.checkUrl);
      if (opts.status instanceof Error) throw opts.status;
      return opts.status ?? SIGNED_IN;
    },
  };
  return { d, opened, checked };
}

test("open_site_sign_in is mounted only where the host can really open a window", () => {
  expect(buildCompanionTools(deps([])).map((t) => t.name)).not.toContain("open_site_sign_in");
  const withWindow = buildCompanionTools({ ...deps([]), siteSignIn: signInDeps().d });
  expect(withWindow.map((t) => t.name)).toContain("open_site_sign_in");
});

test("open_site_sign_in opens the URL its own source list holds, then reports the check", async () => {
  const h = signInDeps();
  const out = String(await buildSignInTool(h.d).execute({ site: "bloomberg.com" }));
  expect(h.opened).toEqual(["https://www.bloomberg.com/account/signin"]);
  expect(h.checked).toEqual(["https://www.bloomberg.com/"]);
  expect(out).toMatch(/closed the bloomberg\.com sign-in window after 42s/);
  expect(out).toMatch(/they are signed in/);
  expect(out).toMatch(/Bloomberg Technology/);
});

test("open_site_sign_in refuses an address and opens nothing", async () => {
  // The injection case: an article body telling the model to sign in somewhere.
  // There is no parameter that carries a URL, and none of these is the name of a
  // site the user subscribes to, so nothing opens.
  const h = signInDeps();
  const tool = buildSignInTool(h.d);
  for (const arg of [
    "https://bloomberg.com.evil.test/signin",
    "https://www.bloomberg.com/account/signin",
    "evil.test",
  ]) {
    const out = String(await tool.execute({ site: arg }));
    expect(out).toMatch(/not a site in the user's source list/);
    // The refusal shows the real list so the model can ask rather than guess.
    expect(out).toMatch(/bloomberg\.com — Bloomberg Technology/);
  }
  expect(h.opened).toEqual([]);
});

test("open_site_sign_in says there is nothing to open when no source has a sign-in", async () => {
  const h = signInDeps({ sources: [{ ...BLOOMBERG_SOURCE, fulltext: { mode: "fetch-page" } }] });
  const out = String(await buildSignInTool(h.d).execute({ site: "bloomberg.com" }));
  expect(out).toMatch(/None of the user's sources has a sign-in page/);
  expect(h.opened).toEqual([]);
  await expect(buildSignInTool(h.d).execute({ site: " " })).rejects.toThrow(/needs a site/i);
});

test("open_site_sign_in reports a signed-out check as a failed sign-in, not a success", async () => {
  const h = signInDeps({ status: { ...SIGNED_IN, signedIn: false } });
  const out = String(await buildSignInTool(h.d).execute({ site: "bloomberg-technology" }));
  expect(out).toMatch(/still offers a sign-in/);
  expect(out).toMatch(/do not reopen the window unless they ask/);
});

test("a check that could not tell is reported as neither signed in nor out", async () => {
  const h = signInDeps({
    status: { ...SIGNED_IN, status: "blocked", signedIn: false, detail: "bot wall: Are you a robot?" },
  });
  const out = String(await buildSignInTool(h.d).execute({ site: "bloomberg.com" }));
  expect(out).toMatch(/could not tell \(bot wall/);
  expect(out).toMatch(/cannot confirm/);
});

test("a window still open after the wait is not checked and claims nothing", async () => {
  const h = signInDeps({ outcome: { closed: false, elapsedMs: 1_200_000 } });
  const out = String(await buildSignInTool(h.d).execute({ site: "bloomberg.com" }));
  expect(out).toMatch(/still open after 20 minutes/);
  expect(out).toMatch(/Nothing is confirmed/);
  expect(h.checked).toEqual([]);
});

test("a window that could not open, and a check that failed, are both reported honestly", async () => {
  const failed = signInDeps({ outcome: new Error("webview fetch state is not registered") });
  const out = String(await buildSignInTool(failed.d).execute({ site: "bloomberg.com" }));
  expect(out).toMatch(/could not be opened: webview fetch state is not registered/);
  expect(failed.checked).toEqual([]);

  const noCheck = signInDeps({ status: new Error("load timed out") });
  const out2 = String(await buildSignInTool(noCheck.d).execute({ site: "bloomberg.com" }));
  expect(out2).toMatch(/closed the bloomberg\.com sign-in window/);
  expect(out2).toMatch(/session check that follows failed: load timed out/);
});
