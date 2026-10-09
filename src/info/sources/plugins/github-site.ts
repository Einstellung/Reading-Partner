// A pasted GitHub link read as the document it names (docs/85), the site
// adapter the GitHub plugin hangs on its `site`. Three shapes:
//
// - A repo (or a directory of one, /tree/<ref>/<dir>): its README.
// - A book repo, whose README is only a table of contents and whose chapters
//   are Markdown files: the whole book, README first, one section per chapter.
//   The order is SUMMARY.md's (GitBook's and mdBook's table of contents) when
//   the directory has one. Without it, a repo is a book only when it is mostly
//   prose (Markdown is at least half of the files under the README's directory,
//   pictures not counted): then the README's own list of chapter links when it
//   links at least BOOK_MIN_README_LINKS Markdown files in the repo, else the
//   Markdown files in the tree whose names start with a number, when there are
//   at least that many. A code project whose README links its docs is its
//   README. A book with a chapter that cannot be fetched is not made: the
//   rejection names what is missing.
// - A Markdown file (/blob/<ref>/<file>.md): that file alone.
//
// The README comes from the REST API, which finds it whatever its name and says
// which branch it is on; everything else comes from raw.githubusercontent.com,
// since the API allows 60 unauthenticated requests an hour and a book has forty
// chapters. The tree is asked for (one more API call) only when there is no
// SUMMARY.md.

import {
  markdownToHtml,
  rejection,
  resolveMarkdownTitle,
  type BinderyDeps,
  type FetchBytes,
  type Manuscript,
  type ManuscriptSection,
  type Rejection,
  type SiteAdapter,
} from "../../../workshop/bindery";
import { htmlToText } from "../../../workshop/extract/sanitize";
import { oneLine } from "../../../platform/std/text";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const WEB = "https://github.com";

/** A README that links this many Markdown files in its repo is a table of contents. */
export const BOOK_MIN_README_LINKS = 3;
// Chapters fetched at once.
const CHAPTER_CONCURRENCY = 4;

// github.com paths that are pages of the site, not an owner.
const NOT_OWNERS = new Set([
  "about", "apps", "collections", "contact", "customer-stories", "enterprise", "events",
  "explore", "features", "issues", "login", "marketplace", "new", "notifications", "orgs",
  "organizations", "pricing", "pulls", "search", "security", "settings", "signup", "site",
  "sponsors", "topics", "trending",
]);

// Files a README links that are about the project, not chapters of it.
const NOT_CHAPTERS =
  /^(?:license|licence|contributing|changelog|changes|history|code_of_conduct|security|authors|support|governance|maintainers|readme)(?:\.|$)/i;

const MARKDOWN_FILE = /\.(?:md|markdown)$/i;
// Figures of a book, left out when weighing how much of it is prose.
const PICTURE_FILE = /\.(?:png|jpe?g|gif|svg|webp|bmp|ico)$/i;

/** What a GitHub link names. `dir` and `file` are repo paths without a leading slash. */
export type GithubTarget =
  | { kind: "repo"; owner: string; repo: string; ref?: string; dir: string }
  | { kind: "file"; owner: string; repo: string; ref: string; file: string };

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The repo, directory or Markdown file a github.com link names, or null. */
export function githubTargetOfUrl(raw: string): GithubTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const segments = url.pathname.split("/").filter((s) => s !== "").map(decoded);
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (NOT_OWNERS.has(owner.toLowerCase()) || repo === "") return null;
  const rest = segments.slice(2);
  if (rest.length === 0) return { kind: "repo", owner, repo, dir: "" };
  if (rest[0] === "tree" && rest.length >= 2) {
    return { kind: "repo", owner, repo, ref: rest[1], dir: rest.slice(2).join("/") };
  }
  if (rest[0] === "blob" && rest.length >= 3 && MARKDOWN_FILE.test(rest[rest.length - 1])) {
    return { kind: "file", owner, repo, ref: rest[1], file: rest.slice(2).join("/") };
  }
  return null;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** A file's raw URL. */
export function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${RAW}/${owner}/${repo}/${encodePath(ref)}/${encodePath(path)}`;
}

function blobUrl(owner: string, repo: string, ref: string, path: string): string {
  return `${WEB}/${owner}/${repo}/blob/${encodePath(ref)}/${encodePath(path)}`;
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

// A repo path joined and normalized; null when it climbs out of the repo.
function joinRepoPath(dir: string, relative: string): string | null {
  const parts = relative.startsWith("/") ? [] : dir.split("/").filter((s) => s !== "");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// --- fetching ----------------------------------------------------------------

type Got = { ok: true; text: string } | { ok: false; status: number };

async function getText(fetch: FetchBytes, url: string): Promise<Got> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, text: new TextDecoder("utf-8").decode(res.bytes) };
  } catch {
    return { ok: false, status: 0 };
  }
}

function base64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

interface Readme {
  markdown: string;
  path: string;
  ref: string;
}

// The directory's README through the API, which knows its name and the default
// branch. When the API will not answer (its hourly limit), README.md on raw at
// the ref asked for, or HEAD.
async function fetchReadme(
  fetch: FetchBytes,
  t: Extract<GithubTarget, { kind: "repo" }>,
): Promise<Readme | Rejection> {
  const where = t.dir === "" ? "" : `/${encodePath(t.dir)}`;
  const query = t.ref === undefined ? "" : `?ref=${encodeURIComponent(t.ref)}`;
  const api = await getText(fetch, `${API}/repos/${t.owner}/${t.repo}/readme${where}${query}`);
  const name = `${t.owner}/${t.repo}${t.dir === "" ? "" : `/${t.dir}`}`;
  if (api.ok) {
    try {
      const json = JSON.parse(api.text) as { content?: string; path?: string; download_url?: string };
      const path = json.path ?? "";
      if (typeof json.content === "string" && path !== "") {
        return { markdown: base64Utf8(json.content), path, ref: t.ref ?? refOfDownload(json.download_url, path, t) };
      }
    } catch {
      // Not the JSON the API answers with: try raw below.
    }
  } else if (api.status === 404) {
    return rejection("unreachable", `GitHub has no README for ${name}, or the repository is private`);
  }
  const path = t.dir === "" ? "README.md" : `${t.dir}/README.md`;
  const ref = t.ref ?? "HEAD";
  const raw = await getText(fetch, rawUrl(t.owner, t.repo, ref, path));
  if (!raw.ok) {
    const why = api.ok ? "" : ` (the API answered HTTP ${api.status})`;
    return rejection("unreachable", `GitHub did not serve the README of ${name}${why}`);
  }
  return { markdown: raw.text, path, ref };
}

// The branch a README's download_url is on: its segments between the repo and
// the README's own path. HEAD when it does not say.
function refOfDownload(
  downloadUrl: string | undefined,
  path: string,
  t: { owner: string; repo: string },
): string {
  if (!downloadUrl) return "HEAD";
  try {
    const segments = new URL(downloadUrl).pathname.split("/").filter((s) => s !== "").map(decoded);
    const tail = path.split("/").length;
    if (segments[0] !== t.owner || segments[1] !== t.repo || segments.length <= 2 + tail) return "HEAD";
    return segments.slice(2, segments.length - tail).join("/");
  } catch {
    return "HEAD";
  }
}

// --- chapters -----------------------------------------------------------------

export interface ChapterLink {
  /** The chapter's repo path. */
  path: string;
  /** What the table of contents calls it; may be empty. */
  title: string;
}

const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const LINK =
  /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/**
 * The Markdown files a table of contents links, in its order: repo paths
 * resolved against the directory it sits in, each once, with the project's own
 * files (licence, changelog, the README itself) left out.
 */
export function chapterLinks(markdown: string, fromDir: string, readmePath: string): ChapterLink[] {
  const out: ChapterLink[] = [];
  const seen = new Set<string>([readmePath]);
  for (const m of markdown.replace(FENCE, "").matchAll(LINK)) {
    if (m[1] === "!") continue;
    let href = m[3].startsWith("<") ? m[3].slice(1, -1) : m[3];
    if (HAS_SCHEME.test(href) || href.startsWith("//") || href.startsWith("#")) continue;
    href = decoded(href.replace(/[?#].*$/, ""));
    if (!MARKDOWN_FILE.test(href)) continue;
    const path = joinRepoPath(fromDir, href);
    if (path === null || seen.has(path) || NOT_CHAPTERS.test(baseName(path))) continue;
    seen.add(path);
    out.push({ path, title: oneLine(htmlToText(markdownToHtml(m[2]))) });
  }
  return out;
}

/** The title a table of contents gives a file, when it links it. */
function linkTitle(markdown: string, fromDir: string, path: string): string {
  for (const m of markdown.replace(FENCE, "").matchAll(LINK)) {
    const href = decoded((m[3].startsWith("<") ? m[3].slice(1, -1) : m[3]).replace(/[?#].*$/, ""));
    if (!HAS_SCHEME.test(href) && joinRepoPath(fromDir, href) === path) {
      return oneLine(htmlToText(markdownToHtml(m[2])));
    }
  }
  return "";
}

const numericOrder = new Intl.Collator("en", { numeric: true }).compare;

/** Markdown files under `dir` whose names start with a number, in numeric order. */
export function numberedChapters(paths: readonly string[], dir: string, readmePath: string): ChapterLink[] {
  const prefix = dir === "" ? "" : `${dir}/`;
  return paths
    .filter((p) => p.startsWith(prefix) && p !== readmePath && MARKDOWN_FILE.test(p))
    .filter((p) => /^\d/.test(baseName(p)) && !NOT_CHAPTERS.test(baseName(p)))
    .sort(numericOrder)
    .map((path) => ({ path, title: "" }));
}

/**
 * Whether the files under `dir` are mostly prose: Markdown is at least half of
 * them, pictures not counted. An empty listing (the API did not answer) is not.
 */
export function mostlyProse(paths: readonly string[], dir: string): boolean {
  const prefix = dir === "" ? "" : `${dir}/`;
  const files = paths.filter((p) => p.startsWith(prefix) && !PICTURE_FILE.test(p));
  const markdown = files.filter((p) => MARKDOWN_FILE.test(p)).length;
  return markdown > 0 && markdown * 2 >= files.length;
}

async function treePaths(fetch: FetchBytes, owner: string, repo: string, ref: string): Promise<string[]> {
  const got = await getText(fetch, `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (!got.ok) return [];
  try {
    const json = JSON.parse(got.text) as { tree?: { path?: string; type?: string }[] };
    return (json.tree ?? []).filter((e) => e.type === "blob" && typeof e.path === "string").map((e) => e.path as string);
  } catch {
    return [];
  }
}

// --- Markdown to a section -----------------------------------------------------

interface Place {
  owner: string;
  repo: string;
  ref: string;
  /** The directory of the file the Markdown came from. */
  dir: string;
}

const ATTRIBUTE = /(\s)(src|href)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const GITHUB_FILE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i;

const unescapeAttr = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/**
 * Relative pictures and links made absolute, as GitHub resolves them: a picture
 * to its raw file (a picture on a github.com blob page too), a link to its page
 * on github.com.
 */
export function absolutizeRepoLinks(html: string, place: Place): string {
  return html.replace(ATTRIBUTE, (whole, space: string, name: string, eq: string, dq?: string, sq?: string) => {
    const value = unescapeAttr(dq ?? sq ?? "");
    const isSrc = name.toLowerCase() === "src";
    let target: string | null = null;
    const onGithub = GITHUB_FILE.exec(value);
    if (onGithub && isSrc) {
      target = `${RAW}/${onGithub[1]}/${onGithub[2]}/${onGithub[3].replace(/\?raw=true$/, "")}`;
    } else if (value !== "" && !HAS_SCHEME.test(value) && !value.startsWith("//") && !value.startsWith("#")) {
      const [, pathPart, suffix] = /^([^?#]*)(.*)$/.exec(value) ?? ["", value, ""];
      const path = joinRepoPath(place.dir, decoded(pathPart));
      if (path !== null) {
        target = isSrc
          ? rawUrl(place.owner, place.repo, place.ref, path)
          : blobUrl(place.owner, place.repo, place.ref, path) + suffix;
      }
    }
    return target === null ? whole : `${space}${name}${eq}"${escapeAttr(target)}"`;
  });
}

function sectionHtml(markdown: string, place: Place): string {
  return absolutizeRepoLinks(markdownToHtml(markdown, { allowHtml: true }), place);
}

// --- the three shapes ------------------------------------------------------------

async function mapLimit<T, R>(items: readonly T[], limit: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await f(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function readFile(
  fetch: FetchBytes,
  t: Extract<GithubTarget, { kind: "file" }>,
  sourceUrl: string,
): Promise<Manuscript | Rejection> {
  const got = await getText(fetch, rawUrl(t.owner, t.repo, t.ref, t.file));
  if (!got.ok) {
    return rejection("unreachable", `GitHub did not serve ${t.file} (HTTP ${got.status})`);
  }
  const { title, body } = resolveMarkdownTitle(got.text);
  const place = { owner: t.owner, repo: t.repo, ref: t.ref, dir: dirOf(t.file) };
  return {
    title: title || baseName(t.file).replace(MARKDOWN_FILE, ""),
    author: t.owner,
    sourceUrl,
    sections: [{ html: sectionHtml(body, place) }],
    images: [],
  };
}

async function readRepo(
  fetch: FetchBytes,
  t: Extract<GithubTarget, { kind: "repo" }>,
  sourceUrl: string,
): Promise<Manuscript | Rejection> {
  const readme = await fetchReadme(fetch, t);
  if ("ok" in readme) return readme;
  const { owner, repo, ref } = { ...t, ref: readme.ref };
  const readmeDir = dirOf(readme.path);
  const { title: readmeTitle, body: readmeBody } = resolveMarkdownTitle(readme.markdown);
  const title = readmeTitle || `${owner}/${repo}`;
  const opening = sectionHtml(readmeBody, { owner, repo, ref, dir: readmeDir });

  let chapters: ChapterLink[] = [];
  let openingHeading = "";
  const summaryPath = readmeDir === "" ? "SUMMARY.md" : `${readmeDir}/SUMMARY.md`;
  const summary = await getText(fetch, rawUrl(owner, repo, ref, summaryPath));
  if (summary.ok) {
    chapters = chapterLinks(summary.text, readmeDir, readme.path);
    openingHeading = linkTitle(summary.text, readmeDir, readme.path);
  }
  if (chapters.length === 0) {
    const paths = await treePaths(fetch, owner, repo, ref);
    if (mostlyProse(paths, readmeDir)) {
      const listed = chapterLinks(readme.markdown, readmeDir, readme.path);
      const numbered = numberedChapters(paths, readmeDir, readme.path);
      if (listed.length >= BOOK_MIN_README_LINKS) chapters = listed;
      else if (numbered.length >= BOOK_MIN_README_LINKS) chapters = numbered;
    }
  }

  const base = { title, author: owner, sourceUrl, images: [] };
  if (chapters.length === 0) return { ...base, sections: [{ html: opening }] };

  const fetched = await mapLimit(chapters, CHAPTER_CONCURRENCY, async (c) => ({
    chapter: c,
    got: await getText(fetch, rawUrl(owner, repo, ref, c.path)),
  }));
  const missing = fetched.filter((f) => !f.got.ok).map((f) => f.chapter.path);
  if (missing.length > 0) {
    return rejection(
      "unreachable",
      `${missing.length} of the book's ${chapters.length} chapters could not be fetched: ${missing.join(", ")}`,
    );
  }
  const sections: ManuscriptSection[] = [{ heading: openingHeading || title, html: opening }];
  for (const { chapter, got } of fetched) {
    if (!got.ok) continue;
    const { title: h1, body } = resolveMarkdownTitle(got.text);
    const startsWithH1 = body !== got.text.replace(/\r\n?/g, "\n");
    const heading = chapter.title || (startsWithH1 ? h1 : "") || baseName(chapter.path).replace(MARKDOWN_FILE, "");
    const place = { owner, repo, ref, dir: dirOf(chapter.path) };
    sections.push({ heading, html: sectionHtml(body, place) });
  }
  return { ...base, sections };
}

/** A github.com link read as its README, its whole book, or one Markdown file. */
export const githubSiteAdapter: SiteAdapter = {
  name: "github",
  // A README or a single page of notes may be a few lines; it is what was asked for.
  minChars: 1,
  claims: (material) => material.kind === "url" && githubTargetOfUrl(material.url) !== null,
  async toManuscript(material, deps: BinderyDeps) {
    const target = material.kind === "url" ? githubTargetOfUrl(material.url) : null;
    if (!target) return rejection("no-adapter", "the link is not a GitHub repository or Markdown file");
    if (!deps.fetch) throw new Error("the GitHub adapter needs fetch");
    const sourceUrl =
      target.kind === "file"
        ? blobUrl(target.owner, target.repo, target.ref, target.file)
        : `${WEB}/${target.owner}/${target.repo}` +
          (target.ref === undefined ? "" : `/tree/${encodePath(target.ref)}${target.dir === "" ? "" : `/${encodePath(target.dir)}`}`);
    return target.kind === "file"
      ? readFile(deps.fetch, target, sourceUrl)
      : readRepo(deps.fetch, target, sourceUrl);
  },
};
