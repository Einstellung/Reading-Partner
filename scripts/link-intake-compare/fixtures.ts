// The comparison script's dry run (docs/86 「第一期」): the eight links of
// docs/84 「实测」 as recorded shapes, scaled down. Posts and permalink pages are
// built with the unit tests' X fixtures, the pages the posts point at are a few
// lines of HTML, and GitHub and Google Drive are stub site adapters standing in
// for the real ones. Nothing here reaches the network; it only proves the
// script's plumbing end to end.

import type { PageAttempt, XReadDeps } from "../../src/info/x/read-post";
import { registerSiteAdapter, registeredSiteAdapters, type FetchedBytes, type Material } from "../../src/workshop/bindery";
import { ARTICLE_BODY, ARTICLE_TITLE, articlePost, fakeX, focalText, page, syn } from "../../tests/info/x/fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const PROSE = "This paragraph carries enough plain words to pass the quality gate on its own. ".repeat(10);

function htmlPage(title: string, body: string): FetchedBytes {
  return {
    ok: true,
    status: 200,
    contentType: "text/html; charset=utf-8",
    bytes: enc(`<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${body}</article></body></html>`),
  };
}

const user = (handle: string) => ({ user: { name: handle, screen_name: handle } });

/** A long post as the embed answers it: the opening only, with `note_tweet`. */
function longEmbed(handle: string, id: string, full: string, urls: { url: string; expanded_url: string }[] = []) {
  const cut = full.slice(0, 160);
  return syn({ ...user(handle), id_str: id, text: cut, display_text_range: [0, cut.length], note_tweet: { id: "Tm90ZQ" }, entities: { urls } });
}

function shortEmbed(handle: string, id: string, text: string, url: string) {
  const t = `${text} https://t.co/${id.slice(-4)}`;
  return syn({
    ...user(handle),
    id_str: id,
    text: t,
    display_text_range: [0, t.length],
    entities: { urls: [{ url: `https://t.co/${id.slice(-4)}`, expanded_url: url }] },
  });
}

function articleEmbed(handle: string, id: string) {
  return { ...articlePost(id), ...user(handle) };
}

const xUrl = (handle: string, id: string) => `https://x.com/${handle}/status/${id}`;
const longText = (topic: string) =>
  `${topic}\n\n` + `Here is a longer thought about ${topic}, written out at length so it reads as a post of its own. `.repeat(5);

const ID = {
  fankaishuoai: "2106777694969176314",
  robotbird01: "2107026689935200274",
  kirkdborne: "2106806020043313226",
  "0xMovez": "2106807332688580789",
  jiangkoumo_: "2107011055243440334",
  suyuan1711: "2102744129235193975",
  lonely__mh: "2103501883449180167",
  manorgw: "2107295528438337635",
};
const QUOTED = "2106761689123139973";
const MOVEZ_REPLY = "2106807332688580999";
const BOOK = "https://github.com/robotbird01/pi-durable-book";
const PRAISON = "https://github.com/MervinPraison/PraisonAI";
const SKILL = "https://github.com/someone/skills/blob/main/claude-cleanup/SKILL.md";
const KIRK_PDF = "https://drive.google.com/file/d/KIRKPDF/view";
const MOVEZ_PDF = "https://drive.google.com/file/d/MOVEZPDF/view";

/** The X side of the dry run: embeds, permalink pages and t.co, all recorded. */
export function dryRunX(): XReadDeps {
  const robotFull = longText("pi-durable, the Chinese handbook");
  const movezFull = longText("Local LLM: the cognitive core thesis");
  const jiangFull = longText("Pi Durable day four: what the community built");
  const manorFull = longText("PraisonAI, agents in a few lines");
  const posts = [
    shortEmbed("fankaishuoai", ID.fankaishuoai, "Codex computer use, moved to any harness", "https://github.com/amontlabs/lcu"),
    longEmbed("robotbird01", ID.robotbird01, robotFull, [{ url: "https://t.co/rb", expanded_url: BOOK }]),
    shortEmbed("kirkdborne", ID.kirkdborne, "Understanding Harness Engineering, a 48-page PDF", KIRK_PDF),
    longEmbed("0xMovez", ID["0xMovez"], movezFull),
    longEmbed("jiangkoumo_", ID.jiangkoumo_, jiangFull, [{ url: "https://t.co/fl", expanded_url: "https://fly.io/" }]),
    articleEmbed("suyuan1711", ID.suyuan1711),
    articleEmbed("lonely__mh", ID.lonely__mh),
    longEmbed("manorgw", ID.manorgw, manorFull),
  ];
  // The quoted Article, as the embed of the quoting post carries it.
  (posts[3] as Record<string, unknown>).quoted_tweet = articleEmbed("0xMovez", QUOTED);
  const article = (handle: string, tail: string) => focalText(handle, `${ARTICLE_TITLE}\n\n${ARTICLE_BODY.join("\n\n")}\n\n${tail}`);
  const pages: Record<string, PageAttempt> = {
    [xUrl("robotbird01", ID.robotbird01)]: page({
      handle: "robotbird01",
      id: ID.robotbird01,
      text: focalText("robotbird01", `${robotFull}\n${BOOK}`),
      links: [{ href: BOOK, text: "github.com/robotbird01/pi-durable-book" }],
    }),
    [xUrl("0xMovez", ID["0xMovez"])]: page(
      { handle: "0xMovez", id: ID["0xMovez"], quotes: [QUOTED], text: focalText("0xMovez", movezFull) },
      {
        handle: "0xMovez",
        id: MOVEZ_REPLY,
        text: focalText("0xMovez", `The PDF: ${MOVEZ_PDF}`),
        links: [{ href: MOVEZ_PDF, text: "drive.google.com/file/d/…" }],
      },
    ),
    [xUrl("0xMovez", QUOTED)]: page({ handle: "0xMovez", id: QUOTED, text: article("0xMovez", "") }),
    [xUrl("jiangkoumo_", ID.jiangkoumo_)]: page({ handle: "jiangkoumo_", id: ID.jiangkoumo_, text: focalText("jiangkoumo_", jiangFull) }),
    [xUrl("suyuan1711", ID.suyuan1711)]: page({
      handle: "suyuan1711",
      id: ID.suyuan1711,
      text: article("suyuan1711", `Install the skill: ${SKILL}`),
      links: [{ href: SKILL, text: "claude-cleanup/SKILL.md" }],
    }),
    [xUrl("lonely__mh", ID.lonely__mh)]: page({
      handle: "lonely__mh",
      id: ID.lonely__mh,
      text: article("lonely__mh", "Sources below."),
      links: [
        { href: "https://about.fb.com/news/2026/10/muse/", text: "Meta announces Muse" },
        { href: "https://ai.meta.com/blog/how-we-designed-muse/", text: "How We Designed Muse" },
        { href: "https://muse.ai/", text: "muse.ai" },
        { href: "https://claude.ai/login", text: "claude.ai" },
      ],
    }),
    [xUrl("manorgw", ID.manorgw)]: page({
      handle: "manorgw",
      id: ID.manorgw,
      text: focalText("manorgw", `${manorFull}\n${PRAISON}`),
      links: [{ href: PRAISON, text: "github.com/MervinPraison/PraisonAI" }],
    }),
  };
  return fakeX(posts, pages).deps;
}

/** The pages the posts point at, for the generic fetch. Anything else is a 404. */
export const DRY_RUN_PAGES: Record<string, FetchedBytes> = {
  "https://fly.io/": htmlPage("Fly.io: deploy app servers close to your users", `<p>${PROSE}</p><p>Sign up free. Pricing.</p>`),
  "https://about.fb.com/news/2026/10/muse/": htmlPage("Introducing Muse", `<p>${PROSE}</p>`),
  "https://ai.meta.com/blog/how-we-designed-muse/": htmlPage("How We Designed Muse", `<p>${PROSE}</p>`),
  "https://claude.ai/login": htmlPage("Sign in - Claude", "<p>Sign in to continue.</p>"),
};

function prose(n: number): string {
  return `<p>${PROSE}</p>`.repeat(n);
}

/**
 * Stub GitHub and Drive adapters under the real ones' names, so the dry run
 * routes as the app does without the network. Returns the undo.
 */
export function registerDryRunAdapters(): () => void {
  const undo: (() => void)[] = [];
  for (const name of registeredSiteAdapters()) {
    undo.push(registerSiteAdapter({ name, claims: () => false, toManuscript: async () => ({ ok: false, reason: "empty", message: "" }) }));
  }
  const urlOf = (m: Material) => (m.kind === "url" ? m.url : "");
  undo.push(
    registerSiteAdapter({
      name: "github",
      claims: (m) => /^https:\/\/github\.com\//.test(urlOf(m)),
      toManuscript: async (m) => {
        const url = urlOf(m);
        if (url.includes("pi-durable-book")) {
          return {
            title: "pi-durable-book",
            sourceUrl: url,
            sections: Array.from({ length: 43 }, (_, i) => ({ heading: i === 0 ? "README" : `Chapter ${i}`, html: prose(4) })),
            images: [],
          };
        }
        const name = url.split("/").slice(3, 5).join("/");
        return { title: name, sourceUrl: url, sections: [{ html: prose(2) }], images: [] };
      },
    }),
  );
  undo.push(
    registerSiteAdapter({
      name: "drive",
      claims: (m) => /^https:\/\/drive\.google\.com\/file\/d\//.test(urlOf(m)),
      toManuscript: async (m) => ({
        kind: "whole",
        format: "pdf",
        bytes: enc(`%PDF-1.7\n% ${urlOf(m)}\n`),
        title: urlOf(m).includes("KIRK") ? "Understanding Harness Engineering" : "Local LLM The Cognitive Core Thesis",
        sourceUrl: urlOf(m),
      }),
    }),
  );
  return () => {
    for (const u of undo.reverse()) u();
  };
}
