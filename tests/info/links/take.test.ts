// The link agent (src/info/links, docs/86) with no network and no model: pages
// are fixtures, X answers are the recorded shapes in tests/info/x/fixtures, and
// the loop is a scripted SubagentTurnFn calling the three tools.
// Run: bash scripts/t.sh tests/info/links

import { beforeEach, expect, test } from "bun:test";
import { takeLinkIn, type LinkIntakeDeps } from "../../../src/info/links/take";
import { call, scriptedTurn, type ScriptedRound } from "../../../src/info/links/scripted-turn";
import { addressKey, MAX_DOCUMENTS, STEPS_SPENT } from "../../../src/info/links/session";
import { loadLinkRecords, saveLinkRecord, type LinkRecordEntry, type LinkRecordsIo } from "../../../src/info/links/store";
import { xLinkReader } from "../../../src/info/x/reader";
import { registeredSiteAdapters, registerSiteAdapter, type FetchedBytes } from "../../../src/workshop/bindery";
import { htmlToText } from "../../../src/workshop/extract/sanitize";
import { ARTICLE_BODY, ARTICLE_TITLE, articlePost, fakeX, focalText, LONG_FULL, longPost, page, syn } from "../x/fixtures";

// Other files leave site adapters registered (the registry is module-wide), and
// a repository link one of them claims is read by it rather than by the generic
// path these fixtures stand in for. Registering a stub under each name and
// undoing it removes whatever was there.
beforeEach(() => {
  for (const name of registeredSiteAdapters()) {
    registerSiteAdapter({ name, claims: () => false, toManuscript: async () => ({ ok: false, reason: "empty", message: "" }) })();
  }
});

const PROSE = "The quick brown fox jumps over the lazy dog and keeps on running. ".repeat(8);
const enc = (s: string) => new TextEncoder().encode(s);

function html(title: string, body: string, nav = ""): FetchedBytes {
  return {
    ok: true,
    status: 200,
    contentType: "text/html; charset=utf-8",
    bytes: enc(`<html><head><title>${title}</title></head><body><nav>${nav}</nav><article>${body}</article></body></html>`),
  };
}
const a = (href: string, text: string) => `<a href="${href}">${text}</a>`;
const PDF = (name: string): FetchedBytes => ({ ok: true, status: 200, contentType: "application/pdf", bytes: enc(`%PDF-1.7\n% ${name}\n`) });

function extractReadable(page: string) {
  const body = /<article>([\s\S]*)<\/article>/.exec(page)?.[1];
  if (!body) return null;
  return { title: /<title>(.*?)<\/title>/.exec(page)?.[1] ?? "", contentHtml: body, textContent: htmlToText(body) };
}

interface Harness {
  deps: LinkIntakeDeps<string, { hash: string }>;
  fetched: string[];
  saved: { key: string; entry: LinkRecordEntry }[];
  filedTo: string[];
}

function harness(pages: Record<string, FetchedBytes>, turn: LinkIntakeDeps<string, { hash: string }>["turn"], extra: Partial<LinkIntakeDeps<string, { hash: string }>> = {}): Harness {
  const fetched: string[] = [];
  const saved: Harness["saved"] = [];
  const filedTo: string[] = [];
  return {
    fetched,
    saved,
    filedTo,
    deps: {
      fetch: async (url) => {
        fetched.push(url);
        return pages[url] ?? { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };
      },
      extractReadable,
      readers: [],
      file: async (built, slug, target) => {
        const bytes = "passedThrough" in built ? built.bytes : built.epub;
        filedTo.push(target);
        const hash = String(Bun.hash(bytes));
        return { hash, title: built.metadata.title || slug, document: { hash } };
      },
      saveRecord: async (key, entry) => {
        saved.push({ key, entry });
      },
      turn,
      now: () => 1_000,
      ...extra,
    },
  };
}

const POST = "https://blog.test/post";
const REPO = "https://github.com/o/r";
const BLOG_PAGES = {
  [POST]: html(
    "A post",
    `<p>${PROSE}</p><p>See ${a(REPO, "the repo")} and ${a("https://www.blog.test/post/#top", "top")}.</p>`,
    `${a("https://blog.test/", "Home")}${a(`${REPO}/`, "repo again")}`,
  ),
  [REPO]: html("o/r", `<h2>Install</h2><p>${PROSE}</p><p>${a("https://blog.test/", "blog")} ${a("https://docs.test/guide", "guide")}</p>`),
};

test("numbers run on across opens, body links first, and one address gets one number", async () => {
  const { turn, log } = scriptedTurn([{ calls: [call.open(2)] }, { calls: [call.finish("the post points at the repo")] }]);
  const h = harness(BLOG_PAGES, turn);
  const got = await takeLinkIn(POST, "book-1", h.deps);
  expect(got.candidates.map((c) => [c.n, c.url, c.from])).toEqual([
    [1, POST, null],
    [2, REPO, 1],
    [3, "https://blog.test/", 1],
    [4, "https://docs.test/guide", 2],
  ]);
  expect(log.task).toContain("#2 [github repo · body] the repo — github.com/o/r");
  expect(log.task).toContain("#3 [homepage · page] Home — blog.test");
  expect(log.results[0].text).toContain("#4 [web page · body] guide — docs.test/guide");
  expect(addressKey("https://www.blog.test/post/#top")).toBe(addressKey(POST));
  expect(got.stop).toEqual({ kind: "finished", note: "the post points at the repo" });
});

test("a second open and a later file fetch nothing more", async () => {
  const { turn, log } = scriptedTurn([{ calls: [call.open(2), call.open(2), call.file(2)] }, { calls: [call.finish("")] }]);
  const h = harness(BLOG_PAGES, turn);
  const got = await takeLinkIn(POST, "book-1", h.deps);
  expect(h.fetched.filter((u) => u === REPO)).toHaveLength(1);
  expect(log.results[1].text.startsWith("(#2 was opened before")).toBe(true);
  expect(log.results[2].text).toMatch(/^Filed: "o\/r", \d+ characters, 1 section\.$/);
  expect(got.filed.map((f) => f.url)).toEqual([REPO]);
  expect(h.filedTo).toEqual(["book-1"]);
  expect(got.toolCalls).toBe(4);
});

test("a rejection goes back to the model word for word, and it can try another candidate", async () => {
  const pages = {
    [POST]: html("A post", `<p>${PROSE}</p>${a("https://login.test/x", "the doc")} ${a("https://files.test/paper.pdf", "pdf")}`),
    "https://login.test/x": html("Wall", "<p>Sign in to continue reading.</p>"),
    "https://files.test/paper.pdf": PDF("paper"),
  };
  const { turn, log } = scriptedTurn([{ calls: [call.file(2)] }, { calls: [call.file(3)] }, { calls: [call.finish("the first link was a wall")] }]);
  const got = await takeLinkIn(POST, "b", harness(pages, turn).deps);
  expect(log.results[0].text).toBe('Rejected: the page is a sign-in or script wall ("Sign in to continue"), not the content.');
  expect(log.results[1].text).toMatch(/^Filed: "paper", PDF, \d+ bytes\.$/);
  expect(got.notes).toContain('Not taken: login.test/x: the page is a sign-in or script wall ("Sign in to continue"), not the content.');
  expect(got.notes).toContain("Not taken: blog.test/post: the AI did not choose it.");
  expect(got.notes.find((l) => l.startsWith("Path:"))).toBe(
    'Path: #1 blog.test/post (opened) → #2 login.test/x (rejected: the page is a sign-in or script wall ("Sign in to continue"), not the content) → #3 files.test/paper.pdf (PDF, filed).',
  );
  expect(got.notes[got.notes.length - 1]).toBe('The AI finished. Its note (the AI\'s words): "the first link was a wall"');
  expect(got.lead).toBe('Read the web page "A post".');
});

test("the tool-call cap counts the program's open of #1, and past it nothing runs", async () => {
  const { turn, log } = scriptedTurn([{ calls: Array.from({ length: 12 }, () => call.open(1)) }, { answer: "done" }]);
  const got = await takeLinkIn(POST, "b", harness(BLOG_PAGES, turn).deps);
  expect(log.results.slice(0, 11).every((r) => r.text !== STEPS_SPENT)).toBe(true);
  expect(log.results[11].text).toBe(STEPS_SPENT);
  expect(got.toolCalls).toBe(12);
  expect(got.stop.kind).toBe("steps");
  expect(got.notes[got.notes.length - 1]).toBe("Stopped: the step limit was reached at #1 blog.test/post.");
});

test("no more than six documents, and a run that only talks runs out of rounds", async () => {
  const links = Array.from({ length: 7 }, (_, i) => `https://files.test/p${i}.pdf`);
  const pages: Record<string, FetchedBytes> = { [POST]: html("Many", `<p>${PROSE}</p>${links.map((l, i) => a(l, `p${i}`)).join(" ")}`) };
  links.forEach((l, i) => (pages[l] = PDF(`p${i}`)));
  const { turn, log } = scriptedTurn([{ calls: links.map((_, i) => call.file(i + 2)) }, { calls: [call.finish("")] }]);
  const got = await takeLinkIn(POST, "b", harness(pages, turn).deps);
  expect(got.filed).toHaveLength(MAX_DOCUMENTS);
  expect(log.results[6].text).toBe("Rejected: 6 documents are filed already, the most one link may bring in.");

  const talker = scriptedTurn(() => ({ calls: [] }) as ScriptedRound);
  const idle = await takeLinkIn(POST, "b", harness(BLOG_PAGES, talker.turn).deps);
  expect(idle.stop).toEqual({ kind: "rounds", at: 1 });
  expect(idle.rounds).toBe(8);
  expect(idle.notes).toContain("Not opened: #2 [github repo · body] the repo — github.com/o/r; #3 [homepage · page] Home — blog.test.");
});

test("a model call that breaks off before anything is filed fails the run; after, the receipt says where", async () => {
  const broken = scriptedTurn([{ error: "401 invalid x-api-key" }]);
  await expect(takeLinkIn(POST, "b", harness(BLOG_PAGES, broken.turn).deps)).rejects.toThrow("401 invalid x-api-key");

  const late = scriptedTurn([{ calls: [call.file(2)] }, { error: "network down" }]);
  const got = await takeLinkIn(POST, "b", harness(BLOG_PAGES, late.turn).deps);
  expect(got.filed).toHaveLength(1);
  expect(got.notes[got.notes.length - 1]).toBe("Stopped: the model call broke off at #2 github.com/o/r (network down).");
});

test("the record is saved under its key with the trail, and records merge their documents", async () => {
  const { turn } = scriptedTurn([{ calls: [call.file(2)] }, { calls: [call.finish("repo filed")] }]);
  const h = harness(BLOG_PAGES, turn);
  await takeLinkIn(POST, "b", h.deps);
  expect(h.saved).toHaveLength(1);
  const { key, entry } = h.saved[0];
  expect(key).toBe("web:blog.test/post");
  expect(entry).toMatchObject({ source: "web", url: POST, record: { title: "A post" }, note: "repo filed", takenAt: 1_000 });
  expect(entry.trail.map((s) => [s.n, s.action])).toEqual([[1, "open"], [2, "file"]]);

  let disk: string | null = null;
  const io: LinkRecordsIo = {
    read: async (_f, validate) => (disk === null ? { status: "missing" } : { status: "ok", value: validate(JSON.parse(disk))! }),
    write: async (_f, contents) => {
      disk = contents;
    },
    quarantine: async () => null,
    reportCorrupt: () => {},
  };
  await saveLinkRecord(key, entry, io);
  await saveLinkRecord(key, { ...entry, documents: ["other"], note: "again" }, io);
  await saveLinkRecord("x:1", { ...entry, source: "x", documents: [] }, io);
  const records = await loadLinkRecords(io);
  expect(records[key].documents).toEqual([...entry.documents, "other"]);
  expect(records[key].note).toBe("again");
  expect(Object.keys(records)).toEqual([key, "x:1"]);
});

const ID = "2106807332688580789";
const X_URL = `https://x.com/0xMovez/status/${ID}`;

test("an X Article is #1's own content, and its inline links are listed with their hint", async () => {
  const body = ARTICLE_BODY.join("\n\n");
  const x = fakeX([articlePost(ID)], {
    [X_URL]: page({
      handle: "0xMovez",
      id: ID,
      text: focalText("0xMovez", `${ARTICLE_TITLE}\n\n142\n\n\n3.3K\n\n\n${body}\n\nRead https://github.com/a/skill\n`),
      links: [{ href: "https://github.com/a/skill", text: "https://github.com/a/skill" }],
    }),
  });
  const { turn, log } = scriptedTurn([{ calls: [call.file(1)] }, { calls: [call.finish("the Article is the content")] }]);
  const got = await takeLinkIn(X_URL, "b", harness({}, turn, { readers: [xLinkReader(x.deps)] }).deps);
  expect(log.task).toContain(`#1 x.com/0xMovez/status/${ID} (read with x)`);
  expect(log.task).toContain("Form: X Article");
  expect(log.task).toContain("Can be filed: yes, it passes the quality gate.");
  expect(log.task).toContain("#2 [github repo · in Article] https://github.com/a/skill — github.com/a/skill");
  expect(got.candidates).toHaveLength(2);
  expect(got.filed.map((f) => f.title)).toEqual([ARTICLE_TITLE]);
  expect(got.lead).toBe(`Read an X Article ("${ARTICLE_TITLE}") by @0xMovez (2026-10-04).`);
});

test("a long post whose text was cut short has no content of its own to file", async () => {
  const x = fakeX(
    [longPost(ID, { entities: { urls: [{ url: "https://t.co/g", expanded_url: REPO }] } })],
    null,
  );
  const { turn, log } = scriptedTurn([{ calls: [call.file(1), call.file(2)] }, { calls: [call.finish("")] }]);
  const got = await takeLinkIn(X_URL, "b", harness(BLOG_PAGES, turn, { readers: [xLinkReader(x.deps)] }).deps);
  expect(log.task).toContain("Text (only the opening):");
  expect(log.task).toContain("Can be filed: no — its full text is only on the post's page, which this device cannot read (the desktop app can).");
  expect(got.candidates.every((c) => c.material.kind === "url")).toBe(true);
  expect(log.results[0].text).toBe("Rejected: its full text is only on the post's page, which this device cannot read (the desktop app can).");
  expect(got.filed.map((f) => f.url)).toEqual([REPO]);
});

test("a long post read whole is #1's content; a quoted Article read whole takes a number of its own", async () => {
  const QID = "2106761689123139973";
  const x = fakeX([longPost(ID, { quoted_tweet: articlePost(QID) })], {
    [X_URL]: page({ handle: "0xMovez", id: ID, quotes: [QID], text: focalText("0xMovez", LONG_FULL) }),
    [`https://x.com/0xMovez/status/${QID}`]: page({
      handle: "0xMovez",
      id: QID,
      text: focalText("0xMovez", `${ARTICLE_TITLE}\n\n${ARTICLE_BODY.join("\n\n")}`),
    }),
  });
  const { turn, log } = scriptedTurn([{ calls: [call.file(2)] }, { calls: [call.finish("the post is a lead to its Article")] }]);
  const got = await takeLinkIn(X_URL, "b", harness({}, turn, { readers: [xLinkReader(x.deps)] }).deps);
  expect(log.task).toMatch(/Text \(whole, \d+ characters\):\nAndrej Karpathy/);
  expect(LONG_FULL.startsWith("Andrej Karpathy")).toBe(true);
  expect(log.task).toContain("Quotes an X Article");
  expect(got.candidates.map((c) => [c.n, c.material.kind])).toEqual([
    [1, "html"],
    [2, "html"],
  ]);
  expect(log.task).toMatch(/#2 \[content read · quoted post\] How to set up your first Local LLM in 10 Steps; X Article by Movez \(@0xMovez\), \d+ characters, read whole — x\.com\/0xMovez\/status\/2106761689123139973/);
  expect(got.filed.map((f) => f.title)).toEqual([ARTICLE_TITLE]);
  expect(got.notes).toContain(`Not taken: x.com/0xMovez/status/${ID}: the AI did not choose it.`);
});

test("a post that cannot be read at all is not handed to the model", async () => {
  const x = fakeX([syn({ id_str: "1", text: "x" })], {});
  const { turn, log } = scriptedTurn([{ answer: "done" }]);
  await expect(takeLinkIn(X_URL, "b", harness({}, turn, { readers: [xLinkReader(x.deps)] }).deps)).rejects.toThrow(
    "the post does not exist or is not public",
  );
  expect(log.task).toBe("");
});
