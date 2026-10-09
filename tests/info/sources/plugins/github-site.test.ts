// A pasted GitHub link read as its document (src/info/sources/plugins/github-site.ts,
// docs/85): which links it claims, an ordinary repo's README, a book repo read
// whole by SUMMARY.md, by the README's list or by numbered files when the repo is
// mostly prose, a code project whose README links its docs read as its README, a
// book with a chapter missing turned back, and a single Markdown file. The fetch
// is scripted.
// Run: bash scripts/t.sh tests/info/sources/plugins/github-site.test.ts

import { afterEach, expect, test } from "bun:test";
import {
  absolutizeRepoLinks,
  chapterLinks,
  githubSiteAdapter,
  githubTargetOfUrl,
  mostlyProse,
  rawUrl,
} from "../../../../src/info/sources/plugins/github-site";
import { githubPlugin } from "../../../../src/info/sources/plugins/github";
import {
  bind,
  readMaterial,
  registerSiteAdapter,
  type FetchedBytes,
  type Manuscript,
} from "../../../../src/workshop/bindery";
import { openZip } from "../../../../src/workshop/bindery/zip";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
});

const NOT_FOUND: FetchedBytes = { ok: false, status: 404, bytes: new Uint8Array(), contentType: "text/plain" };

function text(body: string, contentType = "text/plain; charset=utf-8"): FetchedBytes {
  return { ok: true, status: 200, bytes: new TextEncoder().encode(body), contentType };
}

function readmeJson(owner: string, repo: string, ref: string, path: string, markdown: string): FetchedBytes {
  const content = Buffer.from(markdown, "utf-8").toString("base64").replace(/(.{60})/g, "$1\n");
  return text(
    JSON.stringify({
      path,
      content,
      encoding: "base64",
      download_url: rawUrl(owner, repo, ref, path),
    }),
    "application/json",
  );
}

const readmeApi = (o: string, r: string) => `https://api.github.com/repos/${o}/${r}/readme`;
const treeApi = (o: string, r: string, ref: string) =>
  `https://api.github.com/repos/${o}/${r}/git/trees/${ref}?recursive=1`;

function scripted(responses: Record<string, FetchedBytes>) {
  const fetched: string[] = [];
  return {
    fetched,
    fetch: async (url: string): Promise<FetchedBytes> => {
      fetched.push(url);
      return responses[url] ?? NOT_FOUND;
    },
  };
}

async function read(url: string, responses: Record<string, FetchedBytes>) {
  undo = registerSiteAdapter(githubSiteAdapter);
  const host = scripted(responses);
  const got = await readMaterial({ kind: "url", url }, { fetch: host.fetch });
  return { got, fetched: host.fetched };
}

function manuscriptOf(got: Awaited<ReturnType<typeof readMaterial>>): Manuscript {
  if (!got.ok || !("manuscript" in got)) throw new Error(`no manuscript: ${JSON.stringify(got)}`);
  return got.manuscript;
}

// --- which links ------------------------------------------------------------

test("repo, directory and Markdown file links are claimed; other github.com pages are not", () => {
  expect(githubTargetOfUrl("https://github.com/karpathy/nanoGPT")).toEqual({
    kind: "repo", owner: "karpathy", repo: "nanoGPT", dir: "",
  });
  expect(githubTargetOfUrl("https://github.com/o/r.git")).toMatchObject({ kind: "repo", repo: "r" });
  expect(githubTargetOfUrl("https://github.com/o/r/tree/dev/docs/guide")).toEqual({
    kind: "repo", owner: "o", repo: "r", ref: "dev", dir: "docs/guide",
  });
  expect(githubTargetOfUrl("https://github.com/o/r/blob/main/book/%E7%AB%A0.md")).toEqual({
    kind: "file", owner: "o", repo: "r", ref: "main", file: "book/章.md",
  });
  expect(githubTargetOfUrl("https://github.com/o/r/blob/main/src/index.ts")).toBeNull();
  expect(githubTargetOfUrl("https://github.com/o/r/issues/3")).toBeNull();
  expect(githubTargetOfUrl("https://github.com/features/actions")).toBeNull();
  expect(githubTargetOfUrl("https://github.com/karpathy")).toBeNull();
  expect(githubTargetOfUrl("https://gitlab.com/o/r")).toBeNull();
  expect(githubPlugin.site).toBe(githubSiteAdapter);
});

test("a table of contents yields its Markdown links in order, each once, project files left out", () => {
  const toc = [
    "- [Intro](README.md)",
    "- [One](book/01-one.md#start)",
    "- [Two **bold**](<book/02 two.md>)",
    "- [One again](./book/01-one.md)",
    "- [Licence](LICENSE.md)",
    "- [Elsewhere](https://example.com/x.md)",
    "- ![a picture](img/x.md)",
    "```",
    "[in code](book/99.md)",
    "```",
    "- [Encoded](book/%E4%B8%89.md)",
  ].join("\n");
  expect(chapterLinks(toc, "", "README.md")).toEqual([
    { path: "book/01-one.md", title: "One" },
    { path: "book/02 two.md", title: "Two bold" },
    { path: "book/三.md", title: "Encoded" },
  ]);
  expect(chapterLinks("[up](../a.md) [sib](b.md)", "docs", "docs/README.md")).toEqual([
    { path: "a.md", title: "up" },
    { path: "docs/b.md", title: "sib" },
  ]);
});

test("relative pictures go to raw files, relative links to github.com pages", () => {
  const html =
    '<p><img src="img/a.png" alt=""> <a href="../b.md#x">b</a> <a href="#top">t</a> ' +
    '<img src="/logo.svg"> <img src="https://github.com/o/r/blob/main/c.png?raw=true"> ' +
    "<a href='https://example.com/'>e</a></p>";
  expect(absolutizeRepoLinks(html, { owner: "o", repo: "r", ref: "main", dir: "docs" })).toBe(
    '<p><img src="https://raw.githubusercontent.com/o/r/main/docs/img/a.png" alt=""> ' +
      '<a href="https://github.com/o/r/blob/main/b.md#x">b</a> <a href="#top">t</a> ' +
      '<img src="https://raw.githubusercontent.com/o/r/main/logo.svg"> ' +
      '<img src="https://raw.githubusercontent.com/o/r/main/c.png"> ' +
      "<a href='https://example.com/'>e</a></p>",
  );
});

// --- an ordinary repo ---------------------------------------------------------

const TOOL_README = [
  "# Tool",
  "",
  '<p align="center"><img src="assets/logo.png" width="200"></p>',
  "",
  "A small tool that does one thing. See [usage](docs/usage.md) and the [licence](LICENSE).",
].join("\n");

test("an ordinary repo is its README, named by its heading, with pictures resolved", async () => {
  const { got, fetched } = await read("https://github.com/o/tool", {
    [readmeApi("o", "tool")]: readmeJson("o", "tool", "main", "README.md", TOOL_README),
    [treeApi("o", "tool", "main")]: text(JSON.stringify({ tree: [{ path: "docs/usage.md", type: "blob" }] })),
  });
  const m = manuscriptOf(got);
  expect(m.title).toBe("Tool");
  expect(m.author).toBe("o");
  expect(m.sourceUrl).toBe("https://github.com/o/tool");
  expect(m.sections).toHaveLength(1);
  expect(m.sections[0].heading).toBeUndefined();
  expect(m.sections[0].html).toContain('src="https://raw.githubusercontent.com/o/tool/main/assets/logo.png"');
  expect(m.sections[0].html).toContain('href="https://github.com/o/tool/blob/main/docs/usage.md"');
  expect(m.sections[0].html).not.toContain("# Tool");
  // README by the API; SUMMARY.md and nothing else on raw; the tree once.
  expect(fetched).toEqual([
    readmeApi("o", "tool"),
    rawUrl("o", "tool", "main", "SUMMARY.md"),
    treeApi("o", "tool", "main"),
  ]);
});

test("when the API will not answer, README.md is read from raw at HEAD", async () => {
  const { got } = await read("https://github.com/o/tool", {
    [readmeApi("o", "tool")]: { ok: false, status: 403, bytes: new Uint8Array(), contentType: "application/json" },
    [rawUrl("o", "tool", "HEAD", "README.md")]: text(TOOL_README),
  });
  expect(manuscriptOf(got).title).toBe("Tool");
});

test("a repo with no README is turned back", async () => {
  const { got } = await read("https://github.com/o/none", {});
  expect(got).toMatchObject({ ok: false, reason: "unreachable" });
});

// --- book repos ------------------------------------------------------------------

const treeJson = (paths: readonly string[]) =>
  text(JSON.stringify({ tree: paths.map((path) => ({ path, type: "blob" })) }));

// `n` files named by `make`, to give a fixture the proportions of a real tree.
const files = (n: number, make: (k: number) => string) => Array.from({ length: n }, (_, k) => make(k));

const BOOK_README = "# The Book\n\nA book in chapters. Start with the [preface](book/00-preface.md).\n";
const SUMMARY = [
  "# Summary",
  "",
  "- [Read me first](README.md)",
  "## Part one",
  "- [Preface](book/00-preface.md)",
  "- [Chapter 1 · Start](book/01-start.md)",
  "## Part two",
  "- [Chapter 2 · 继续](book/02-继续.md)",
].join("\n");

function bookRepo(chapters: Record<string, string>): Record<string, FetchedBytes> {
  const out: Record<string, FetchedBytes> = {
    [readmeApi("o", "book")]: readmeJson("o", "book", "main", "README.md", BOOK_README),
    [rawUrl("o", "book", "main", "SUMMARY.md")]: text(SUMMARY),
  };
  for (const [path, body] of Object.entries(chapters)) out[rawUrl("o", "book", "main", path)] = text(body);
  return out;
}

const CHAPTERS = {
  "book/00-preface.md": "# Preface\n\nWhy this book.\n",
  "book/01-start.md": "# 1 Start\n\n![fig](../img/one.png)\n\nThe start.\n",
  "book/02-继续.md": "No heading here, only text.\n",
};

test("a book repo with SUMMARY.md is read whole, README first, one section per chapter", async () => {
  const { got, fetched } = await read("https://github.com/o/book", bookRepo(CHAPTERS));
  const m = manuscriptOf(got);
  expect(m.title).toBe("The Book");
  expect(m.sections.map((s) => s.heading)).toEqual([
    "Read me first",
    "Preface",
    "Chapter 1 · Start",
    "Chapter 2 · 继续",
  ]);
  // The chapter's own leading heading is not repeated under the section heading.
  expect(m.sections[1].html).not.toContain("<h1>");
  expect(m.sections[2].html).toContain('src="https://raw.githubusercontent.com/o/book/main/img/one.png"');
  expect(m.sections[3].html).toContain("No heading here");
  // No tree call: SUMMARY.md said what the chapters are.
  expect(fetched.filter((u) => u.includes("/git/trees/"))).toEqual([]);
  expect(fetched).toContain(rawUrl("o", "book", "main", "book/02-继续.md"));
});

test("a book binds to one EPUB whose outline lists the chapters", async () => {
  undo = registerSiteAdapter(githubSiteAdapter);
  const host = scripted(bookRepo(CHAPTERS));
  const got = await bind({ kind: "url", url: "https://github.com/o/book" }, { fetch: host.fetch });
  if (!got.ok || !("epub" in got)) throw new Error(JSON.stringify(got));
  expect(got.metadata).toMatchObject({ adapter: "github", sections: 4, title: "The Book" });
  const nav = await openZip(got.epub).text("nav.xhtml");
  for (const heading of ["Read me first", "Preface", "Chapter 1 · Start", "Chapter 2 · 继续"]) {
    expect(nav).toContain(heading);
  }
});

test("a book with a chapter that cannot be fetched is not made, and the rejection names it", async () => {
  const { "book/01-start.md": _dropped, ...rest } = CHAPTERS;
  const { got } = await read("https://github.com/o/book", bookRepo(rest));
  expect(got).toMatchObject({ ok: false, reason: "unreachable" });
  expect(!got.ok && got.message).toContain("book/01-start.md");
  expect(!got.ok && got.message).toContain("1 of the book's 3 chapters");
});

test("without SUMMARY.md, a README that lists chapters is the table of contents", async () => {
  const readme = [
    "# Notes on Things",
    "",
    "1. [Basics](ch/basics.md)",
    "2. [Middle](ch/middle.md)",
    "3. [End](ch/end.md)",
    "",
    "[Contributing](CONTRIBUTING.md)",
  ].join("\n");
  const responses: Record<string, FetchedBytes> = {
    [readmeApi("o", "notes")]: readmeJson("o", "notes", "trunk", "README.md", readme),
    [treeApi("o", "notes", "trunk")]: treeJson(["README.md", "LICENSE", "ch/basics.md", "ch/middle.md", "ch/end.md"]),
    [rawUrl("o", "notes", "trunk", "ch/basics.md")]: text("Basics body."),
    [rawUrl("o", "notes", "trunk", "ch/middle.md")]: text("Middle body."),
    [rawUrl("o", "notes", "trunk", "ch/end.md")]: text("End body."),
  };
  const { got } = await read("https://github.com/o/notes", responses);
  const m = manuscriptOf(got);
  expect(m.sections.map((s) => s.heading)).toEqual(["Notes on Things", "Basics", "Middle", "End"]);
  expect(m.sections[3].html).toContain("End body.");
});

test("a README that links fewer chapters than a book has is an ordinary README", async () => {
  const readme = "# Lib\n\nSee [install](docs/install.md) and [api](docs/api.md).\n";
  const { got, fetched } = await read("https://github.com/o/lib", {
    [readmeApi("o", "lib")]: readmeJson("o", "lib", "main", "README.md", readme),
  });
  expect(manuscriptOf(got).sections).toHaveLength(1);
  expect(fetched.some((u) => u.endsWith("docs/install.md"))).toBe(false);
});

test("with neither list, numbered Markdown files in the tree are the chapters, in numeric order", async () => {
  const tree = ["README.md", "src/x.ts", "chapters/10-ten.md", "chapters/2-two.md", "chapters/1-one.md", "notes.md"];
  const responses: Record<string, FetchedBytes> = {
    [readmeApi("o", "num")]: readmeJson("o", "num", "main", "README.md", "# Numbered\n\nChapters below.\n"),
    [treeApi("o", "num", "main")]: treeJson(tree),
  };
  for (const p of tree.filter((p) => p.startsWith("chapters/"))) {
    responses[rawUrl("o", "num", "main", p)] = text(`# Title of ${p}\n\nBody of ${p}.`);
  }
  const { got } = await read("https://github.com/o/num", responses);
  expect(manuscriptOf(got).sections.map((s) => s.heading)).toEqual([
    "Numbered",
    "Title of chapters/1-one.md",
    "Title of chapters/2-two.md",
    "Title of chapters/10-ten.md",
  ]);
});

// --- code projects -------------------------------------------------------------------

// Shapes from the live tree listings (2026-10-09): Markdown, pictures and other
// files in the proportions each repo has, plus the paths the rule looks at.
const PI_DURABLE_BOOK = ["README.md", "SUMMARY.md", "LICENSE", ...files(42, (k) => `chapters/${k + 1}-ch.md`)];
const PRAISONAI = [
  "README.md", "AGENTS.md", "ARCHITECTURE.md", "CONTRIBUTING.md", "api.md", "LICENSE",
  ...["00-ground-truth", "04-test-gating", "05-live-ci-job", "06-adapter-revival", "07-local-package-spec"].map(
    (n) => `src/praisonai-agents/docs/local-model-layer/${n}.md`,
  ),
  ...files(166, (k) => `src/praisonai-agents/docs/d${k}.md`),
  ...files(135, (k) => `docs/images/i${k}.png`),
  ...files(6546, (k) => `src/praisonai-agents/praisonaiagents/m${k}.py`),
];
const LCU_DOCS = ["docs/install.md", "docs/usage.md", "docs/config.md", "docs/api.md", "docs/faq.md", "docs/design.md"];
const LCU = [
  "README.md", "AGENTS.md", "LICENSE",
  ...LCU_DOCS,
  ...files(22, (k) => `docs/releases/0.${5 + Math.floor(k / 10)}.${k % 10}.md`),
  ...files(87, (k) => `skills/s${k}/SKILL.md`),
  ...files(9, (k) => `assets/a${k}.png`),
  ...files(280, (k) => `runtime/r${k}.mjs`),
];
const NANOGPT = [
  "README.md", "LICENSE", ".gitignore", ".gitattributes", "assets/gpt2_124M_loss.png", "assets/nanogpt.jpg",
  "data/shakespeare/readme.md", "data/shakespeare_char/readme.md", "data/openwebtext/readme.md",
  ...files(15, (k) => `p${k}.py`), "scaling_laws.ipynb", "transformer_sizing.ipynb",
];

test("a repo is mostly prose when Markdown is at least half of its files, pictures not counted", () => {
  expect(mostlyProse(PI_DURABLE_BOOK, "")).toBe(true);
  expect(mostlyProse(PRAISONAI, "")).toBe(false);
  expect(mostlyProse(LCU, "")).toBe(false);
  expect(mostlyProse(NANOGPT, "")).toBe(false);
  // Figures do not make a book less of a book.
  expect(mostlyProse(["README.md", "a.md", "b.md", ...files(20, (k) => `img/${k}.png`), "book.toml"], "")).toBe(true);
  // Only the README's directory is weighed.
  expect(mostlyProse(LCU, "docs")).toBe(true);
  // No listing, no book.
  expect(mostlyProse([], "")).toBe(false);
});

test("a code project whose README links its docs is its README", async () => {
  const readme = ["# lcu", "", ...LCU_DOCS.map((p) => `- [${p}](${p})`), ""].join("\n");
  const { got, fetched } = await read("https://github.com/o/lcu", {
    [readmeApi("o", "lcu")]: readmeJson("o", "lcu", "main", "README.md", readme),
    [treeApi("o", "lcu", "main")]: treeJson(LCU),
  });
  expect(manuscriptOf(got).sections).toHaveLength(1);
  expect(fetched.filter((u) => u.startsWith("https://raw.githubusercontent.com/o/lcu/main/docs/"))).toEqual([]);
});

test("numbered files deep in a code project are not chapters", async () => {
  for (const [repo, tree] of [["praisonai", PRAISONAI], ["nanogpt", NANOGPT]] as const) {
    const { got, fetched } = await read(`https://github.com/o/${repo}`, {
      [readmeApi("o", repo)]: readmeJson("o", repo, "main", "README.md", `# ${repo}\n\nCode.\n`),
      [treeApi("o", repo, "main")]: treeJson(tree),
    });
    expect(manuscriptOf(got).sections).toHaveLength(1);
    expect(fetched.filter((u) => u.endsWith(".md") && !u.endsWith("SUMMARY.md"))).toEqual([]);
    undo?.();
    undo = null;
  }
});

test("a prose repo without SUMMARY.md is still a book by its README's list", async () => {
  const readme = ["# Book", "", ...files(42, (k) => `- [Ch ${k + 1}](chapters/${k + 1}-ch.md)`)].join("\n");
  const tree = PI_DURABLE_BOOK.filter((p) => p !== "SUMMARY.md");
  const responses: Record<string, FetchedBytes> = {
    [readmeApi("o", "pdb")]: readmeJson("o", "pdb", "main", "README.md", readme),
    [treeApi("o", "pdb", "main")]: treeJson(tree),
  };
  for (const p of tree.filter((p) => p.startsWith("chapters/"))) responses[rawUrl("o", "pdb", "main", p)] = text("Body.");
  const { got } = await read("https://github.com/o/pdb", responses);
  expect(manuscriptOf(got).sections).toHaveLength(43);
});

// --- one file -------------------------------------------------------------------------

test("a /blob/ link to a Markdown file is that file alone", async () => {
  const path = "book/04-示例/14-聊天.md";
  const { got, fetched } = await read(
    "https://github.com/o/book/blob/main/book/04-%E7%A4%BA%E4%BE%8B/14-%E8%81%8A%E5%A4%A9.md",
    { [rawUrl("o", "book", "main", path)]: text("# 示例 14 · 聊天\n\n一问一答。![图](./a.png)\n") },
  );
  const m = manuscriptOf(got);
  expect(fetched).toEqual([rawUrl("o", "book", "main", path)]);
  expect(m.title).toBe("示例 14 · 聊天");
  expect(m.sections).toHaveLength(1);
  expect(m.sections[0].html).toContain(`src="${rawUrl("o", "book", "main", "book/04-示例/a.png")}"`);
  expect(m.sourceUrl).toBe(
    "https://github.com/o/book/blob/main/book/04-%E7%A4%BA%E4%BE%8B/14-%E8%81%8A%E5%A4%A9.md",
  );
});
