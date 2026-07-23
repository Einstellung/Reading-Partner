// AI source probing (src/info/probe.ts): candidate path generation, response
// sniffing, feed full-text assessment, homepage link inference, descriptor
// assembly, and the probeSource orchestrator with an injected fetch. Pure logic
// only — no real network. Run: bun test.

import { expect, test } from "bun:test";
import {
  assessFeedFulltext,
  extractArticleLinks,
  feedCandidateUrls,
  generalizePath,
  idFromHost,
  inferLinkPattern,
  looksLikeSpa,
  matchBuiltinSource,
  normalizeSiteInput,
  pipeLabel,
  probeSource,
  sniffFeedFormat,
  wpJsonPosts,
} from "../../src/info/probe";
import { parseFeed } from "../../src/info/feed";
import type { SourceDescriptor } from "../../src/info/descriptor";

function res(body: string, contentType = "text/xml", status = 200): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

// --- pure helpers ----------------------------------------------------------

test("normalizeSiteInput accepts bare domains and full URLs, rejects non-domains", () => {
  expect(normalizeSiteInput("example.com")?.origin).toBe("https://example.com");
  expect(normalizeSiteInput("https://www.example.com/blog")?.host).toBe("www.example.com");
  expect(normalizeSiteInput("localhost")).toBeNull();
  expect(normalizeSiteInput("")).toBeNull();
});

test("feedCandidateUrls puts a pasted feed-path URL first, then common paths", () => {
  const urls = feedCandidateUrls("https://example.com/blog/rss");
  expect(urls[0]).toBe("https://example.com/blog/rss");
  expect(urls).toContain("https://example.com/feed");
  expect(urls).toContain("https://example.com/wp-json/wp/v2/posts");
  // A bare domain does not add a path entry first.
  expect(feedCandidateUrls("example.com")[0]).toBe("https://example.com/feed");
});

test("idFromHost drops www and dashes the domain", () => {
  expect(idFromHost("www.qbitai.com")).toBe("qbitai-com");
  expect(idFromHost("spectrum.ieee.org")).toBe("spectrum-ieee-org");
});

test("sniffFeedFormat detects rss/atom/rdf/json by body", () => {
  expect(sniffFeedFormat('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>')).toBe("rss");
  expect(sniffFeedFormat('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toBe("atom");
  expect(sniffFeedFormat('<rdf:RDF xmlns="http://purl.org/rss/1.0/"></rdf:RDF>')).toBe("rdf");
  expect(sniffFeedFormat("[{}]")).toBe("wp-json");
  expect(sniffFeedFormat("<html><body>not a feed</body></html>")).toBe("unknown");
});

test("wpJsonPosts recognizes a WordPress posts array only", () => {
  const posts = JSON.stringify([{ id: 1, title: { rendered: "T" }, content: { rendered: "<p>body</p>" } }]);
  expect(wpJsonPosts(posts)?.length).toBe(1);
  expect(wpJsonPosts("[]")).toBeNull();
  expect(wpJsonPosts('{"not":"array"}')).toBeNull();
  expect(wpJsonPosts("not json")).toBeNull();
});

test("assessFeedFulltext picks feed-field for long bodies, fetch-page for teasers", () => {
  const long = "<p>" + "word ".repeat(300) + "</p>";
  const full = parseFeed(
    `<rss><channel>${[1, 2, 3]
      .map((i) => `<item><title>T${i}</title><link>https://x/${i}</link><content:encoded><![CDATA[${long}]]></content:encoded></item>`)
      .join("")}</channel></rss>`,
  );
  const a1 = assessFeedFulltext(full);
  expect(a1.mode).toBe("feed-field");
  expect(a1.field).toBe("content:encoded");

  const teaser = parseFeed(
    `<rss><channel>${[1, 2, 3]
      .map((i) => `<item><title>T${i}</title><link>https://x/${i}</link><description>short teaser</description></item>`)
      .join("")}</channel></rss>`,
  );
  expect(assessFeedFulltext(teaser).mode).toBe("fetch-page");

  const noLink = parseFeed(
    `<rss><channel><item><title>Only a title</title></item></channel></rss>`,
  );
  expect(assessFeedFulltext(noLink).mode).toBe("none");
});

test("extractArticleLinks + inferLinkPattern find a shared SSR pattern", () => {
  const html = `
    <a href="/article/101.html">a</a>
    <a href="/article/202.html">b</a>
    <a href="https://site.com/article/303.html">c</a>
    <a href="https://other.com/x/1.html">skip cross-origin</a>
    <a href="/about">skip nav</a>`;
  const links = extractArticleLinks(html, "https://site.com");
  expect(links).toContain("/article/101.html");
  expect(links).not.toContain("/x/1.html"); // cross-origin dropped
  expect(inferLinkPattern(links)).toBe("/article/\\d+\\.html");
  // Fewer than three matches -> no pattern.
  expect(inferLinkPattern(["/article/1.html", "/about"])).toBeNull();
});

test("generalizePath escapes and generalizes digit runs", () => {
  expect(generalizePath("/p/2024/05/slug-7.html")).toBe("/p/\\d+/\\d+/slug-\\d+\\.html");
});

test("looksLikeSpa flags an empty app shell", () => {
  expect(looksLikeSpa('<html><body><div id="root"></div></body></html>')).toBe(true);
  expect(looksLikeSpa('<html><body>' + "text ".repeat(200) + '<div id="app"></div></body></html>')).toBe(false);
});

test("pipeLabel phrases each pipe type", () => {
  const feedFull: SourceDescriptor = {
    id: "a", name: "A", line: "", enabled: true,
    discovery: { kind: "feed", url: "https://a/feed" },
    fulltext: { mode: "feed-field", field: "content:encoded" },
  };
  expect(pipeLabel(feedFull)).toBe("Full text in feed");
  const none: SourceDescriptor = { ...feedFull, fulltext: { mode: "none" } };
  expect(pipeLabel(none)).toBe("Headlines only, opens in browser");
});

// --- builtin domain matching -----------------------------------------------

test("matchBuiltinSource matches a covered domain and carries its caveat", () => {
  const m = matchBuiltinSource("https://www.qbitai.com");
  expect(m?.descriptor.id).toBe("qbitai");
  expect(m?.descriptor.enabled).toBe(true);
  expect(m?.note).toMatch(/browser UA/i);
});

test("matchBuiltinSource matches a bare domain and a subdomain of a builtin", () => {
  expect(matchBuiltinSource("jiqizhixin.com")?.descriptor.id).toBe("jiqizhixin");
  // The arXiv builtin's feed host is rss.arxiv.org; the bare registrable domain matches.
  expect(matchBuiltinSource("arxiv.org")?.descriptor.id).toBe("arxiv-cs-ro");
});

test("matchBuiltinSource matches a builtin by a non-discovery host (HN item page)", () => {
  // Hacker News discovery is hn.algolia.com; the user names news.ycombinator.com.
  expect(matchBuiltinSource("news.ycombinator.com")?.descriptor.id).toBe("hacker-news");
});

test("matchBuiltinSource returns undefined for an uncovered domain", () => {
  expect(matchBuiltinSource("example.com")).toBeUndefined();
  expect(matchBuiltinSource("not a domain")).toBeUndefined();
});

test("probeSource short-circuits to a verified builtin without fetching", async () => {
  let fetched = 0;
  const fetchFn = async () => {
    fetched += 1;
    return res("", "text/html", 404);
  };
  const r = await probeSource("qbitai.com", { fetchFn });
  expect(r.ok).toBe(true);
  expect(r.descriptor?.id).toBe("qbitai");
  expect(r.note).toMatch(/browser UA/i);
  expect(fetched).toBe(0);
  expect(r.steps.some((s) => /verified built-in/i.test(s))).toBe(true);
});

// --- orchestrator (injected fetch) -----------------------------------------

test("probeSource returns a feed descriptor from the first working path", async () => {
  const feed =
    `<rss><channel>${[1, 2, 3]
      .map((i) => `<item><title>T${i}</title><link>https://blog.example.com/${i}</link><content:encoded><![CDATA[<p>${"w ".repeat(400)}</p>]]></content:encoded></item>`)
      .join("")}</channel></rss>`;
  const fetchFn = async (url: string) => {
    if (url === "https://blog.example.com/feed") return res(feed, "application/rss+xml");
    return res("nope", "text/html", 404);
  };
  const r = await probeSource("blog.example.com", { fetchFn });
  expect(r.ok).toBe(true);
  expect(r.descriptor?.discovery.kind).toBe("feed");
  expect(r.descriptor?.fulltext.mode).toBe("feed-field");
  expect(r.pipeLabel).toBe("Full text in feed");
});

test("probeSource recognizes a wp-json posts endpoint", async () => {
  const posts = JSON.stringify([
    { id: 5, title: { rendered: "Hi" }, content: { rendered: "<p>body</p>" }, link: "https://s.com/?p=5", date: "2026-01-01" },
  ]);
  const fetchFn = async (url: string) => {
    if (url.includes("/wp-json/wp/v2/posts")) return res(posts, "application/json");
    return res("", "text/html", 404);
  };
  const r = await probeSource("s.com", { fetchFn });
  expect(r.ok).toBe(true);
  expect(r.descriptor?.discovery.kind).toBe("json-api");
  expect(r.descriptor?.fulltext.mode).toBe("feed-field");
});

test("probeSource falls back to an SSR listpage when no feed exists", async () => {
  const home = `<a href="/article/1.html">a</a><a href="/article/2.html">b</a><a href="/article/3.html">c</a>`;
  const fetchFn = async (url: string) => {
    if (url === "https://ssr.com/") return res(home, "text/html");
    return res("", "text/html", 404);
  };
  const r = await probeSource("ssr.com", { fetchFn });
  expect(r.ok).toBe(true);
  expect(r.descriptor?.discovery.kind).toBe("listpage");
  expect(r.descriptor?.fulltext.mode).toBe("fetch-page");
});

test("probeSource reports honestly when a site is an SPA with no feed", async () => {
  const shell = '<html><body><div id="__next"></div></body></html>';
  const fetchFn = async (url: string) => {
    if (url === "https://spa.com/") return res(shell, "text/html");
    return res("", "text/html", 404);
  };
  const r = await probeSource("spa.com", { fetchFn });
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/single-page app/i);
  expect(r.steps.length).toBeGreaterThan(0);
});
