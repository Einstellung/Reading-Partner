// Delete old GitHub Actions artifacts by release line, not by date.
//
// A line is major.minor. The current line (package.json's version in this
// checkout) is kept whole, and so are the three lines before it — "before" by
// sorting the lines that actually occur among the artifacts, not by subtracting,
// so at 1.2 the three are 1.1, 1.0 and whichever 0.x is highest. Everything older
// is deleted.
//
// An artifact's version is package.json at the commit its workflow run built
// (workflow_run.head_sha, read through the contents API once per sha). An
// artifact whose version cannot be read is kept.
//
// Usage: bun scripts/prune-artifacts.ts [--dry-run] [--repo owner/name]
// Token: GITHUB_TOKEN, else GH_TOKEN, else `gh auth token`.
// Repo:  --repo, else GITHUB_REPOSITORY, else the origin remote.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url).pathname;
const API = "https://api.github.com";

/** How many lines survive, the current one included. */
export const KEPT_LINES = 4;

export interface VersionedArtifact {
  id: number;
  /** null when the version could not be determined. */
  version: string | null;
}

type Line = [major: number, minor: number];

/** major.minor of a semver-ish string ("0.21.6", "v1.2.0-beta.1"), or null. */
export function lineOf(version: string | null): Line | null {
  if (!version) return null;
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const compareLines = (a: Line, b: Line) => a[0] - b[0] || a[1] - b[1];
const key = (l: Line) => `${l[0]}.${l[1]}`;

/** The lines to keep: the current one and the next KEPT_LINES - 1 below it that occur. */
export function keptLines(current: string, versions: (string | null)[]): string[] {
  const cur = lineOf(current);
  if (!cur) throw new Error(`current version "${current}" is not major.minor.patch`);
  const below = new Map<string, Line>();
  for (const v of versions) {
    const l = lineOf(v);
    if (l && compareLines(l, cur) < 0) below.set(key(l), l);
  }
  const older = [...below.values()].sort((a, b) => compareLines(b, a)).slice(0, KEPT_LINES - 1);
  return [key(cur), ...older.map(key)];
}

/**
 * Ids to delete. Kept: an unreadable version, a kept line, and anything newer
 * than the current line (a build from a branch ahead of this checkout).
 */
export function artifactsToDelete(current: string, artifacts: VersionedArtifact[]): number[] {
  const kept = new Set(keptLines(current, artifacts.map((a) => a.version)));
  const cur = lineOf(current)!;
  return artifacts
    .filter((a) => {
      const l = lineOf(a.version);
      return l !== null && !kept.has(key(l)) && compareLines(l, cur) < 0;
    })
    .map((a) => a.id);
}

// ---- GitHub API ----

interface ApiArtifact {
  id: number;
  name: string;
  expired: boolean;
  workflow_run?: { head_sha?: string | null } | null;
}

function token(): string {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

function repo(args: string[]): string {
  const i = args.indexOf("--repo");
  if (i >= 0 && args[i + 1]) return args[i + 1];
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execFileSync("git", ["-C", ROOT, "config", "--get", "remote.origin.url"], {
    encoding: "utf8",
  }).trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`cannot tell the repository from origin "${url}"; pass --repo owner/name`);
  return m[1];
}

async function main(args: string[]) {
  const dryRun = args.includes("--dry-run");
  const slug = repo(args);
  const auth = token();
  const call = (path: string, init: RequestInit = {}, accept = "application/vnd.github+json") =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

  const current = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")).version as string;

  const listed: ApiArtifact[] = [];
  for (let page = 1; ; page++) {
    const res = await call(`/repos/${slug}/actions/artifacts?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`list artifacts: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { total_count: number; artifacts: ApiArtifact[] };
    listed.push(...body.artifacts);
    if (body.artifacts.length < 100 || listed.length >= body.total_count) break;
  }
  // An expired artifact already has no storage to give back.
  const live = listed.filter((a) => !a.expired);

  const bySha = new Map<string, Promise<string | null>>();
  const versionAt = (sha: string) => {
    let v = bySha.get(sha);
    if (!v) {
      v = call(`/repos/${slug}/contents/package.json?ref=${sha}`, {}, "application/vnd.github.raw")
        .then(async (res) => (res.ok ? (JSON.parse(await res.text()).version ?? null) : null))
        .catch(() => null);
      bySha.set(sha, v);
    }
    return v;
  };
  const versioned = await Promise.all(
    live.map(async (a) => {
      const sha = a.workflow_run?.head_sha;
      return { ...a, version: sha ? await versionAt(sha) : null };
    }),
  );

  const doomed = new Set(artifactsToDelete(current, versioned));
  console.log(`repo ${slug}, current ${current}, kept lines ${keptLines(current, versioned.map((a) => a.version)).join(", ")}`);
  for (const a of versioned) {
    const verdict = doomed.has(a.id) ? "delete" : "keep";
    console.log(`${verdict.padEnd(6)} ${String(a.version ?? "unknown").padEnd(10)} ${a.name} (${a.id})`);
  }
  console.log(
    `${versioned.length - doomed.size} keep, ${doomed.size} delete` +
      (listed.length > live.length ? `, ${listed.length - live.length} already expired` : "") +
      (dryRun ? " (dry run, nothing deleted)" : ""),
  );
  if (dryRun) return;

  for (const id of doomed) {
    const res = await call(`/repos/${slug}/actions/artifacts/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`delete artifact ${id}: ${res.status} ${await res.text()}`);
  }
  console.log(`deleted ${doomed.size}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
