// What is in the palace, as the soul can see it (docs/67, docs/61).
//
// The catalogue table says what every kind of data is; nothing until now let the
// soul ask what there is of it. So a turn could sit at the door and not know
// which books the reader has imported, which topics they keep, whether anything
// was ever retold. This walks the store the way sequence.ts walks the
// conversation files — list, resolve each path through the palace, group by kind
// — and hands back one entry per item with a label a person would recognise.
//
// It answers "what is there", never "what does it say". No body is read: a book
// is a title and an id, a kept article is a headline, an observation is a
// number. Reading is what the search tools are for.
//
// Which kinds the soul sees is the table's own decision: a row carries `about`
// exactly when the soul is meant to know the kind exists (palace/kinds.ts), so a
// cache, a sync ledger and a failure marker are invisible here without this file
// naming them.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import { appConversationIo, type ConversationIo } from "../conversations";
import { PALACE, resolvePalace } from "../palace";
import { appData } from "../platform/app/appdata";

// --- what the soul is shown ------------------------------------------------

/** The rows the soul may see, in table order. */
export function shownRows(): readonly { kind: string; about: string }[] {
  return PALACE.filter((r) => r.about !== undefined).map((r) => ({
    kind: r.kind,
    about: r.about!,
  }));
}

/**
 * The kinds whose items have no name of their own. An observation is a
 * paragraph and a statement is a sentence; a list of two hundred ids would cost
 * the window and say nothing, so these are counted and not listed.
 */
const COUNTED = new Set(["observation", "statements"]);

/**
 * The files read for the labels of every kind, and nothing else is ever opened.
 * Three of them are the container files whose records are themselves the items;
 * the other two are one file per item, read for its name.
 */
const LABELLED = new Set(["library", "topics", "saved-articles", "statements", "retell", "outline"]);

const LIBRARY_FILE = "library.json";
const TOPICS_FILE = "topics.json";
const ARTICLES_FILE = "saved-articles.json";
const STATEMENTS_FILE = "statements.json";

// --- the shapes ------------------------------------------------------------

/** One item of one kind: what it is called and what names it to the other tools. */
export interface CatalogueEntry {
  kind: string;
  /** The palace's id for it: a book hash, a topic id, a date, a timestamp. */
  id: string;
  /** What a person would call it. Empty where the id is the whole of the name. */
  label: string;
  /** When it arrived, unix ms, for the ordering. 0 where nothing says. */
  at: number;
  /** The topic a book is listed under, where it is listed under one. */
  under?: string;
}

export interface CatalogueKind {
  kind: string;
  about: string;
  count: number;
  /** False for a counted kind: the count is the whole answer. */
  listable: boolean;
  /** Newest first. Empty for a counted kind. */
  entries: readonly CatalogueEntry[];
}

export interface Catalogue {
  /** In table order, including the kinds there is nothing of. */
  kinds: readonly CatalogueKind[];
}

// --- the io ----------------------------------------------------------------

export interface CatalogueIo {
  /** The root listing and the file reads, shared with the conversation walk. */
  conversations: ConversationIo;
  /** File names, AppData-relative, directly under a directory. */
  listDir(dir: string): Promise<string[]>;
  /** A file's last-modified time in unix ms, or null when it is not there. */
  mtime(path: string): Promise<number | null>;
}

export const appCatalogueIo: CatalogueIo = {
  conversations: appConversationIo,
  async listDir(dir) {
    try {
      const entries = await appData.readDir(dir);
      return entries.filter((e) => e.isFile).map((e) => `${dir}/${e.name}`);
    } catch {
      return [];
    }
  },
  async mtime(path) {
    const info = await appData.stat(path).catch(() => null);
    return info ? info.mtimeMs : null;
  },
};

// --- the walk --------------------------------------------------------------

/**
 * Every path the catalogue looks at: the root, plus the one level of each
 * directory a shown kind lives in. Nothing descends further — the shown kinds
 * that sit in a directory (observations/) are flat, and the deep ones
 * (prep-<id>/, runs/) are not shown.
 */
async function walkPaths(io: CatalogueIo): Promise<string[]> {
  const paths = [...(await io.conversations.listRoot())];
  const dirs = new Set<string>();
  for (const row of PALACE) if (row.about !== undefined && row.dir) dirs.add(row.dir.prefix);
  for (const dir of [...dirs].sort()) paths.push(...(await io.listDir(dir)));
  return paths;
}

interface Stamp {
  /** Every path the walk saw, sorted, so an arrival or a deletion shows. */
  names: string;
  /** The modification time of each file the walk reads for its labels. */
  mtimes: Record<string, number>;
}

function sameStamp(a: Stamp, b: Stamp): boolean {
  if (a.names !== b.names) return false;
  const was = Object.keys(a.mtimes);
  if (was.length !== Object.keys(b.mtimes).length) return false;
  for (const name of was) if (a.mtimes[name] !== b.mtimes[name]) return false;
  return true;
}

/**
 * What the catalogue was read off: the names on disk and the times of the files
 * whose contents became labels. Which files those are follows from the names
 * alone, so this is computable without reading anything — which is what lets a
 * turn check the cache before deciding to walk.
 */
async function currentStamp(io: CatalogueIo): Promise<{ stamp: Stamp; paths: string[] }> {
  const paths = await walkPaths(io);
  const mtimes: Record<string, number> = {};
  for (const path of paths) {
    const kind = resolvePalace(path)?.row.kind;
    if (kind && LABELLED.has(kind)) mtimes[path] = (await io.mtime(path)) ?? 0;
  }
  return { stamp: { names: [...paths].sort().join("\n"), mtimes }, paths };
}

// --- reading the labels off ------------------------------------------------

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

interface Book {
  title: string;
  addedAt: number;
}

/** The shelf: a title and an arrival per book id, as sequence.ts reads it. */
async function readBooks(io: CatalogueIo): Promise<Map<string, Book>> {
  const books = new Map<string, Book>();
  const raw = parsed(await io.conversations.readText(LIBRARY_FILE)) as {
    books?: Record<string, { title?: unknown; addedAt?: unknown }>;
  } | null;
  const rows = raw?.books;
  if (!rows || typeof rows !== "object") return books;
  for (const [id, entry] of Object.entries(rows)) {
    books.set(id, { title: str(entry?.title), addedAt: num(entry?.addedAt) });
  }
  return books;
}

interface Topics {
  /** Topic id to its name. */
  names: Map<string, string>;
  /** Topic id to when it was made. */
  made: Map<string, number>;
  /** Book id to the name of the topic it is listed under. */
  under: Map<string, string>;
}

async function readTopics(io: CatalogueIo): Promise<Topics> {
  const out: Topics = { names: new Map(), made: new Map(), under: new Map() };
  const raw = parsed(await io.conversations.readText(TOPICS_FILE)) as {
    topics?: ReadonlyArray<{
      id?: unknown;
      name?: unknown;
      createdAt?: unknown;
      files?: ReadonlyArray<{ hash?: unknown }>;
    }>;
  } | null;
  for (const topic of raw?.topics ?? []) {
    const id = str(topic?.id);
    if (id === "") continue;
    const name = str(topic?.name);
    out.names.set(id, name);
    out.made.set(id, num(topic?.createdAt));
    for (const file of topic?.files ?? []) {
      const hash = str(file?.hash);
      if (hash !== "" && name !== "") out.under.set(hash, name);
    }
  }
  return out;
}

interface Article {
  id: string;
  title: string;
  savedAt: number;
}

async function readArticles(io: CatalogueIo): Promise<Article[]> {
  const raw = parsed(await io.conversations.readText(ARTICLES_FILE));
  const rows: ReadonlyArray<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as ReadonlyArray<Record<string, unknown>>)
    : Array.isArray((raw as { articles?: unknown } | null)?.articles)
      ? ((raw as { articles: ReadonlyArray<Record<string, unknown>> }).articles)
      : [];
  const articles: Article[] = [];
  for (const row of rows) {
    const id = str(row?.id);
    if (id === "") continue;
    articles.push({
      id,
      title: str(row?.title),
      savedAt: num(row?.savedAt) || num(row?.addedAt),
    });
  }
  return articles;
}

/**
 * How many statements stand. A superseded one is the sentence a later one
 * replaced (src/memory): it stays in the file as evidence of what changed and
 * is not part of what the memory holds.
 */
async function countStatements(io: CatalogueIo): Promise<number> {
  const raw = parsed(await io.conversations.readText(STATEMENTS_FILE)) as {
    statements?: ReadonlyArray<{ supersededBy?: unknown }>;
  } | null;
  const rows = raw?.statements;
  if (!Array.isArray(rows)) return 0;
  return rows.filter((s) => str(s?.supersededBy) === "").length;
}

/** The `name` a retell or an outline file carries, by id. */
async function readNames(io: CatalogueIo, paths: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const { path, id } of paths.map((path) => ({ path, id: resolvePalace(path)?.id ?? null }))) {
    if (id === null) continue;
    const raw = parsed(await io.conversations.readText(path)) as { name?: unknown } | null;
    names.set(id, str(raw?.name));
  }
  return names;
}

// --- building --------------------------------------------------------------

/** A date-keyed id read as a time, so the days sort like everything else. */
function dateAt(id: string): number {
  const ms = Date.parse(`${id}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function stampAt(id: string): number {
  const ms = Number(id);
  return Number.isFinite(ms) ? ms : 0;
}

function newestFirst(entries: CatalogueEntry[]): CatalogueEntry[] {
  return entries.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function build(io: CatalogueIo, paths: readonly string[]): Promise<Catalogue> {
  // Every path the palace claims for a kind the soul may see, by kind.
  const ids = new Map<string, string[]>();
  const filed = new Map<string, string[]>();
  function into(index: Map<string, string[]>, kind: string, value: string): void {
    const held = index.get(kind);
    if (held) held.push(value);
    else index.set(kind, [value]);
  }
  for (const path of paths) {
    const hit = resolvePalace(path);
    if (!hit?.row.about) continue;
    if (hit.id !== null) into(ids, hit.row.kind, hit.id);
    into(filed, hit.row.kind, path);
  }
  const idsOf = (kind: string): readonly string[] => ids.get(kind) ?? [];

  const books = await readBooks(io);
  const topics = await readTopics(io);
  const articles = await readArticles(io);
  const retells = await readNames(io, filed.get("retell") ?? []);
  const outlines = await readNames(io, filed.get("outline") ?? []);

  function ofBooks(kind: string): CatalogueEntry[] {
    return idsOf(kind).map((id) => ({
      kind,
      id,
      label: books.get(id)?.title ?? "",
      at: books.get(id)?.addedAt ?? 0,
    }));
  }
  function ofDays(kind: string): CatalogueEntry[] {
    return idsOf(kind).map((id) => ({ kind, id, label: id, at: dateAt(id) }));
  }
  function ofNamed(kind: string, names: ReadonlyMap<string, string>): CatalogueEntry[] {
    return idsOf(kind).map((id) => ({ kind, id, label: names.get(id) ?? "", at: stampAt(id) }));
  }

  async function entriesOf(kind: string): Promise<CatalogueEntry[]> {
    switch (kind) {
      case "library":
        return [...books].map(([id, book]) => ({
          kind,
          id,
          label: book.title,
          at: book.addedAt,
          ...(topics.under.has(id) ? { under: topics.under.get(id)! } : {}),
        }));
      case "topics":
        return [...topics.names].map(([id, name]) => ({
          kind,
          id,
          label: name,
          at: topics.made.get(id) ?? 0,
        }));
      case "saved-articles":
        return articles.map((a) => ({ kind, id: a.id, label: a.title, at: a.savedAt }));
      case "annotations":
      case "reading-thread":
        return ofBooks(kind);
      case "info-thread":
      case "conversation":
        return ofDays(kind);
      case "retell":
      case "retell-thread":
        return ofNamed(kind, retells);
      case "outline":
      case "talk-thread":
        return ofNamed(kind, outlines);
      default:
        return idsOf(kind).map((id) => ({ kind, id, label: "", at: 0 }));
    }
  }

  const kinds: CatalogueKind[] = [];
  for (const { kind, about } of shownRows()) {
    if (COUNTED.has(kind)) {
      const count =
        kind === "statements" ? await countStatements(io) : (filed.get(kind) ?? []).length;
      kinds.push({ kind, about, count, listable: false, entries: [] });
      continue;
    }
    const entries = newestFirst(await entriesOf(kind));
    kinds.push({ kind, about, count: entries.length, listable: true, entries });
  }
  return { kinds };
}

// --- the cache -------------------------------------------------------------

/**
 * The last walk and what it was read off. In memory and nothing else: a walk is
 * milliseconds, so the only thing worth avoiding is doing it twice inside one
 * turn, and a file on disk would be another palace row to register, sweep and
 * keep out of sync's way for no gain. The io is part of the key because a test
 * hands this a store of its own.
 */
let held: { io: CatalogueIo; stamp: Stamp; catalogue: Catalogue } | null = null;

/** Forget the last walk. For the tests, and for a store that was swapped out. */
export function forgetCatalogue(): void {
  held = null;
}

/**
 * What the palace holds, rebuilt when the names on disk or the files the labels
 * come from have moved. The staleness check is the whole of what a repeated
 * call costs: two directory listings and a stat per labelled file.
 */
export async function readCatalogue(io: CatalogueIo = appCatalogueIo): Promise<Catalogue> {
  const { stamp, paths } = await currentStamp(io);
  if (held && held.io === io && sameStamp(held.stamp, stamp)) return held.catalogue;
  const catalogue = await build(io, paths);
  held = { io, stamp, catalogue };
  return catalogue;
}

// --- the tools -------------------------------------------------------------

/** How many entries one kind prints before it says how many are left. */
export const LIST_CAP = 50;

function overview(catalogue: Catalogue): string {
  const lines = catalogue.kinds.map((k) => `${k.kind} (${k.count}) — ${k.about}`);
  return (
    "What this reader keeps, one line per kind of thing. " +
    "Call list_kind with a kind's name to see the entries.\n\n" +
    lines.join("\n")
  );
}

function entryLine(entry: CatalogueEntry): string {
  const label = entry.label === "" || entry.label === entry.id ? "" : `  ${entry.label}`;
  const under = entry.under ? `  [topic: ${entry.under}]` : "";
  return `${entry.id}${label}${under}`;
}

function listing(kind: CatalogueKind): string {
  if (!kind.listable) {
    return (
      `${kind.kind}: ${kind.count}. ${kind.about} ` +
      "These carry no title of their own, so there is nothing to list; " +
      "the memory tools are how they are read."
    );
  }
  if (kind.count === 0) return `No ${kind.kind} yet. ${kind.about}`;
  const shown = kind.entries.slice(0, LIST_CAP).map(entryLine);
  const rest = kind.count - shown.length;
  const tail = rest > 0 ? `\n… and ${rest} more.` : "";
  return `${kind.kind} (${kind.count}), newest first:\n${shown.join("\n")}${tail}`;
}

/**
 * The two tools that let the soul see what the reader has (docs/67). They ride
 * every turn, whatever the desk holds, because "which books do I have" is a
 * question asked at the door as often as over a book.
 *
 * Neither reads anything's content. What a book says, what a conversation said,
 * what an observation holds — those are the reading and search tools; this pair
 * is the index at the front of the building.
 */
export function buildCatalogueTools(io: CatalogueIo = appCatalogueIo): AgentTool[] {
  return [
    {
      name: "list_palace",
      description:
        "What this reader keeps in the app: every kind of thing — books, topics, " +
        "conversations, kept articles, retellings, what the memory holds — with a line " +
        "saying what it is and how many there are. Call this before telling the reader " +
        "you do not know what they have. It says what exists, not what any of it says.",
      parameters: Type.Object({}),
      execute: async () => overview(await readCatalogue(io)),
    },
    {
      name: "list_kind",
      description:
        "The entries of one kind from list_palace — ids and names, newest first — so you " +
        "can name a book, a topic or a kept article the reader has. Contents are not " +
        "read: use the reading and search tools for those.",
      parameters: Type.Object({
        kind: Type.String({
          description: 'A kind name exactly as list_palace printed it, e.g. "library".',
        }),
      }),
      execute: async (args) => {
        const want = String(args.kind ?? "");
        const catalogue = await readCatalogue(io);
        const kind = catalogue.kinds.find((k) => k.kind === want);
        if (!kind) {
          const names = catalogue.kinds.map((k) => k.kind).join(", ");
          return `There is no kind "${want}" in the palace. The kinds are: ${names}.`;
        }
        return listing(kind);
      },
    },
  ];
}
