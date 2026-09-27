// The marker the housekeeper ships itself: the generic retention rules, age,
// keep-last and tail, read straight off the palace rows (docs/80).
//
// Which files a row has is found by listing the directories its samples sit in
// and asking the palace which row each name belongs to. A kind whose files are
// spread over id-named directories is out of reach of that, and is a domain
// marker's business rather than a generic rule's.

import { PALACE, type PalaceRow, type Retention } from "../palace";
import type { GarbageMarker, Mark, MarkContext } from "./marker";

/** The name generic rules are marked under, in the log and in authorisation. */
export const GENERIC_MARKER = "retention";

const DAY_MS = 24 * 60 * 60 * 1000;

type GenericRule = Extract<Retention, { rule: "age" | "keep-last" | "tail" }>;

export function isGenericRule(r: Retention): r is GenericRule {
  return r.rule === "age" || r.rule === "keep-last" || r.rule === "tail";
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

function join(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

// The first row whose match takes the path, in table order, as resolvePalace
// answers it — over the rows handed in, so a test can bring its own.
function resolve(rows: readonly PalaceRow[], path: string): { row: PalaceRow; id: string | null } | null {
  for (const row of rows) {
    const hit = row.match(path);
    if (hit) return { row, id: hit.id };
  }
  return null;
}

// Whole local days between a YYYY-MM-DD and now, or null for a name that is not
// a date.
function daysSince(date: string, now: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - then) / DAY_MS);
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

interface Found {
  path: string;
  id: string | null;
}

async function markRow(
  rule: GenericRule,
  files: readonly Found[],
  ctx: MarkContext,
): Promise<Mark[]> {
  const out: Mark[] = [];
  if (rule.rule === "age") {
    for (const f of files) {
      if (rule.from === "name-date") {
        const age = f.id === null ? null : daysSince(f.id, ctx.now);
        if (age !== null && age > rule.days) {
          out.push({ path: f.path, action: "delete", reason: `dated ${f.id}, older than ${rule.days} days` });
        }
        continue;
      }
      const info = await ctx.io.stat(f.path);
      // No mtime, no age: a platform that does not report one never ages a file out.
      if (!info || info.mtimeMs <= 0) continue;
      if (ctx.now - info.mtimeMs > rule.days * DAY_MS) {
        const when = new Date(info.mtimeMs).toISOString();
        out.push({ path: f.path, action: "delete", reason: `modified ${when}, older than ${rule.days} days` });
      }
    }
    return out;
  }
  if (rule.rule === "keep-last") {
    const byDir = new Map<string, { path: string; key: number | string }[]>();
    for (const f of files) {
      let key: number | string = f.path;
      if (rule.by === "mtime") {
        const info = await ctx.io.stat(f.path);
        if (!info || info.mtimeMs <= 0) continue;
        key = info.mtimeMs;
      }
      const list = byDir.get(dirOf(f.path)) ?? [];
      list.push({ path: f.path, key });
      byDir.set(dirOf(f.path), list);
    }
    for (const list of byDir.values()) {
      list.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
      for (const old of list.slice(rule.count)) {
        out.push({ path: old.path, action: "delete", reason: `beyond the newest ${rule.count} by ${rule.by}` });
      }
    }
    return out;
  }
  for (const f of files) {
    const text = await ctx.io.readText(f.path);
    if (text === null) continue;
    const lines = lineCount(text);
    if (lines > rule.lines) {
      out.push({
        path: f.path,
        action: "truncate-tail",
        keepLines: rule.lines,
        reason: `${lines} lines, keeps the last ${rule.lines}`,
      });
    }
  }
  return out;
}

/** The generic marker over a palace table; the real one unless a test brings its own. */
export function genericMarker(rows: readonly PalaceRow[] = PALACE): GarbageMarker {
  return {
    name: GENERIC_MARKER,
    async mark(ctx) {
      const ruled = rows.filter((r) => isGenericRule(r.retention));
      if (ruled.length === 0) return [];
      const dirs = new Set(ruled.flatMap((r) => r.samples.map(dirOf)));
      const found = new Map<PalaceRow, Found[]>();
      for (const dir of [...dirs].sort()) {
        const entries = await ctx.io.list(dir).catch(() => []);
        for (const entry of entries) {
          if (!entry.isFile) continue;
          const path = join(dir, entry.name);
          const hit = resolve(rows, path);
          if (!hit || !ruled.includes(hit.row)) continue;
          const list = found.get(hit.row) ?? [];
          if (!list.some((f) => f.path === path)) list.push({ path, id: hit.id });
          found.set(hit.row, list);
        }
      }
      const out: Mark[] = [];
      for (const [row, files] of found) {
        out.push(...(await markRow(row.retention as GenericRule, files, ctx)));
      }
      return out;
    },
  };
}
