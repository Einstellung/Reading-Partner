// X posts as the embed endpoint and the permalink script answer them, shaped
// after the real answers measured for docs/84 (scaled down).

import type { FetchedBytes } from "../../../src/workshop/bindery";
import { syndicationUrl } from "../../../src/info/x/post";
import type { PageAttempt, XReadDeps } from "../../../src/info/x/read-post";

export const AUTHOR = { name: "Movez", screen_name: "0xMovez" };

export function syn(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    __typename: "Tweet",
    created_at: "2026-10-04T18:03:05.000Z",
    user: AUTHOR,
    entities: { urls: [] },
    mediaDetails: [],
    ...fields,
  };
}

export const LONG_FULL =
  "Andrej Karpathy predicted the future of AI once again.\n\n" +
  "this 18-page PDF breaks down the case for running that core on your own machine. ".repeat(4) +
  "\n\nthe real question is which of my 1000 calls ever needed the smart one.";

/** A long post: the embed's text is cut and only `note_tweet` says so. */
export function longPost(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const cut = LONG_FULL.slice(0, 160);
  return syn({ id_str: id, text: cut, display_text_range: [0, cut.length], note_tweet: { id: "Tm90ZQ" }, ...extra });
}

export const ARTICLE_TITLE = "How to set up your first Local LLM in 10 Steps";
export const ARTICLE_BODY = [
  "Most people who try to run a model at home end up with an idle graphics card.",
  "Step one is choosing the model. ".repeat(12),
  "Step two is the runtime. ".repeat(12),
];

export function articlePost(id: string): Record<string, unknown> {
  return syn({
    id_str: id,
    text: "https://t.co/XAkdvTknvM",
    display_text_range: [0, 23],
    entities: {
      urls: [{ url: "https://t.co/XAkdvTknvM", expanded_url: `https://x.com/i/article/${id}` }],
    },
    article: {
      title: ARTICLE_TITLE,
      preview_text: ARTICLE_BODY[0],
      cover_media: { media_info: { original_img_url: "https://pbs.twimg.com/media/COVER.jpg" } },
    },
  });
}

export interface FakePost {
  handle: string;
  id: string;
  text: string;
  images?: string[];
  links?: { href: string; text: string }[];
  /** Status ids it links to besides its own (a quoted post). */
  quotes?: string[];
}

/** One <article> as PERMALINK_SCRIPT returns it. */
export function pagePost(p: FakePost): Record<string, unknown> {
  const anchors = [
    { href: `https://x.com/${p.handle}`, path: `/${p.handle}`, text: "" },
    ...(p.quotes ?? []).map((q) => ({ href: `https://x.com/x/status/${q}`, path: `/someone/status/${q}`, text: "Oct 4" })),
    ...(p.links ?? []).map((l) => ({ href: l.href, path: l.href, text: l.text })),
    { href: `https://x.com/${p.handle}/status/${p.id}`, path: `/${p.handle}/status/${p.id}`, text: "2:03 AM · Oct 5, 2026" },
  ];
  return { anchors, images: p.images ?? [], videos: 0, text: p.text };
}

export function page(...posts: FakePost[]): PageAttempt {
  return { value: { url: "https://x.com/", title: "X", posts: posts.map(pagePost) }, detail: null };
}

/** The innerText of a focal post the way the signed-out page lays it out. */
export function focalText(handle: string, body: string, tail = ""): string {
  return `\nMovez\n\n@${handle}\n\n\n\nShow translation\n${body}\n${tail}\n2:03 AM · Oct 5, 2026\n·\n175.1K\nViews\n\n72\n\n\n145\n\n\n1.2K\n\n\n2K\n`;
}

function json(value: unknown): FetchedBytes {
  return { ok: true, status: 200, bytes: new TextEncoder().encode(JSON.stringify(value)), contentType: "application/json" };
}

export interface FakeX {
  deps: XReadDeps;
  pagesRead: string[];
  fetched: string[];
}

/** Deps answering the embed for these posts, these pages, and these t.co links. */
export function fakeX(
  posts: Record<string, unknown>[],
  pages: Record<string, PageAttempt> | null,
  redirects: Record<string, string> = {},
  claimed: (url: string) => boolean = () => false,
): FakeX {
  const pagesRead: string[] = [];
  const fetched: string[] = [];
  const byUrl = new Map(posts.map((p) => [syndicationUrl(String(p.id_str)), p]));
  return {
    pagesRead,
    fetched,
    deps: {
      fetch: async (url) => {
        fetched.push(url);
        const post = byUrl.get(url);
        return post ? json(post) : { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };
      },
      readPage: pages
        ? async (url) => {
            pagesRead.push(url);
            return pages[url] ?? { value: { posts: [] }, detail: "no such page" };
          }
        : null,
      resolveRedirect: async (url) => redirects[url] ?? null,
      claimedBySite: claimed,
    },
  };
}
