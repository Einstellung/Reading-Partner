// The GitHub plugin's lookup slot (docs/88): the facts of one repo a post links,
// read from the REST API anonymously. Three requests per repo: /repos/{r} for
// stars, forks, creation, license and the default branch; the latest commit on
// that branch; /releases/latest. A repo GitHub does not have (or a private one)
// is null; one with no commits or no release leaves those facts null.
//
// The anonymous quota is 60 requests an hour per address, and a topic search
// run looks up at most 30 repos (an initial value, docs/88). The counted entry
// point is RepoLookups: one per run, it caps the repos, remembers each one it
// already asked about, and stops asking once GitHub reports too little quota
// left for another lookup. The run reads its counters for the result file.
//
// Each request gives up after REQUEST_TIMEOUT_MS. Several lookups may run side
// by side (lookupMany); the quota check counts those still in flight.
//
// Every request goes through the injected fetch, so tests script it.

import { throwIfAborted } from "../../../platform/app/abort";
import type { FetchFn } from "../../../platform/app/host";
import { githubRepoOfUrl } from "./github-site";

const API = "https://api.github.com";
const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** Requests one lookup spends. */
export const REQUESTS_PER_LOOKUP = 3;
/** Repos a run looks up at most (docs/88, initial value). */
export const DEFAULT_REPO_LOOKUPS = 30;
/** How long one request may take before it is given up: one hung answer must not stall a run (seen 288 s, 2026-10-22). */
export const REQUEST_TIMEOUT_MS = 20_000;
/** Lookups run side by side when a run asks for several at once. */
export const LOOKUP_CONCURRENCY = 4;

export interface RepoFacts {
  /** "owner/repo" as GitHub spells it (after a rename, the new name). */
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  createdAt: string;
  defaultBranch: string;
  /** Committer date of the default branch's head; null for an empty repo. */
  lastCommitAt: string | null;
  /** The latest published release; null when the repo has none. */
  release: { tag: string; publishedAt: string | null } | null;
  /** SPDX id, or the license's name when GitHub has no SPDX id for it; null without one. */
  license: string | null;
}

export interface LookupDeps {
  fetchFn: FetchFn;
  signal?: AbortSignal;
  /** Per request; REQUEST_TIMEOUT_MS when absent. */
  timeoutMs?: number;
}

/** GitHub said the anonymous quota is spent (403/429 with no requests remaining). */
export class GithubRateLimitError extends Error {
  constructor(readonly status: number, readonly resetAt: number | null) {
    super(`GitHub's anonymous quota is spent (HTTP ${status})`);
    this.name = "GithubRateLimitError";
  }
}

/**
 * "owner/repo", or any github.com link into a repo, as { owner, repo }; null
 * for anything else.
 */
export function repoHandle(handle: string): { owner: string; repo: string } | null {
  const s = handle.trim();
  if (/^https?:\/\//i.test(s)) return githubRepoOfUrl(s);
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?$/.exec(s);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return { owner: m[1], repo: m[2] };
}

interface Got {
  status: number;
  body: unknown;
  // x-ratelimit-remaining, when the response carried it.
  remaining: number | null;
}

function headerInt(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url: string, deps: LookupDeps, seen: (remaining: number | null) => void): Promise<Got> {
  throwIfAborted(deps.signal);
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const init: RequestInit = { headers: HEADERS, signal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout };
  let res: Response;
  try {
    res = await deps.fetchFn(url, init);
  } catch (e) {
    if (timeout.aborted && !deps.signal?.aborted) throw new Error(`GitHub did not answer within ${Math.round((deps.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)} s for ${url}`);
    throw e;
  }
  const remaining = headerInt(res, "x-ratelimit-remaining");
  seen(remaining);
  if ((res.status === 403 || res.status === 429) && remaining === 0) {
    const reset = headerInt(res, "x-ratelimit-reset");
    throw new GithubRateLimitError(res.status, reset === null ? null : reset * 1000);
  }
  if (!res.ok) return { status: res.status, body: null, remaining };
  return { status: res.status, body: await res.json(), remaining };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function httpError(status: number, url: string): Error {
  return new Error(`GitHub answered HTTP ${status} for ${url}`);
}

/**
 * One repo's facts, uncounted. Null when GitHub has no such public repo.
 * Throws GithubRateLimitError on a spent quota, and an Error on any other
 * failed request. `seen` hears every response's remaining-quota header.
 */
export async function lookupRepoFacts(
  handle: string,
  deps: LookupDeps,
  seen: (remaining: number | null) => void = () => {},
): Promise<RepoFacts | null> {
  const ref = repoHandle(handle);
  if (!ref) return null;
  const base = `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const repo = await getJson(base, deps, seen);
  if (repo.status === 404) return null;
  if (repo.status !== 200) throw httpError(repo.status, base);
  const r = repo.body as Record<string, unknown>;
  const fullName = str(r.full_name) ?? `${ref.owner}/${ref.repo}`;
  const defaultBranch = str(r.default_branch) ?? "HEAD";
  // A renamed repo answers under its new name; ask the rest there.
  const here = `${API}/repos/${fullName.split("/").map(encodeURIComponent).join("/")}`;

  const commitsUrl = `${here}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=1`;
  const commits = await getJson(commitsUrl, deps, seen);
  let lastCommitAt: string | null = null;
  // 409: the repo is empty.
  if (commits.status === 200) {
    const head = Array.isArray(commits.body) ? (commits.body[0] as Record<string, unknown> | undefined) : undefined;
    const commit = head?.commit as { committer?: { date?: unknown }; author?: { date?: unknown } } | undefined;
    lastCommitAt = str(commit?.committer?.date) ?? str(commit?.author?.date);
  } else if (commits.status !== 409 && commits.status !== 404) {
    throw httpError(commits.status, commitsUrl);
  }

  const releaseUrl = `${here}/releases/latest`;
  const latest = await getJson(releaseUrl, deps, seen);
  let release: RepoFacts["release"] = null;
  // 404: no published release.
  if (latest.status === 200) {
    const rel = latest.body as Record<string, unknown>;
    const tag = str(rel.tag_name);
    if (tag) release = { tag, publishedAt: str(rel.published_at) };
  } else if (latest.status !== 404) {
    throw httpError(latest.status, releaseUrl);
  }

  const lic = r.license as { spdx_id?: unknown; name?: unknown } | null | undefined;
  const spdx = str(lic?.spdx_id);
  const license = spdx && spdx !== "NOASSERTION" ? spdx : str(lic?.name);

  return {
    fullName,
    url: str(r.html_url) ?? `https://github.com/${fullName}`,
    description: str(r.description),
    stars: num(r.stargazers_count),
    forks: num(r.forks_count),
    createdAt: str(r.created_at) ?? "",
    defaultBranch,
    lastCommitAt,
    release,
    license,
  };
}

export type RepoLookup =
  | { kind: "found"; facts: RepoFacts }
  | { kind: "missing" }
  // Not asked: the run's repo cap is reached, or GitHub's quota is (nearly) spent.
  | { kind: "skipped"; reason: "cap" | "quota" };

/**
 * A run's counted repo lookups. The same repo (case-insensitive) is asked once
 * and answered from memory after that, without counting again. Failures other
 * than a spent quota propagate and are not remembered.
 */
export class RepoLookups {
  private readonly answers = new Map<string, RepoLookup>();
  private asked = 0;
  private sent = 0;
  private quota: number | null = null;
  private spent = false;
  private inFlight = 0;
  private readonly pending = new Map<string, Promise<RepoLookup>>();

  constructor(readonly cap: number = DEFAULT_REPO_LOOKUPS) {}

  /** Repos asked about so far (cached answers not counted again). */
  get used(): number {
    return this.asked;
  }
  /** Repos that may still be asked about under the cap. */
  get remaining(): number {
    return Math.max(0, this.cap - this.asked);
  }
  /** Requests sent to GitHub. */
  get requests(): number {
    return this.sent;
  }
  /** GitHub's own count of requests left this hour, from the last response; null before any. */
  get quotaRemaining(): number | null {
    return this.quota;
  }

  async lookup(handle: string, deps: LookupDeps): Promise<RepoLookup> {
    const ref = repoHandle(handle);
    if (!ref) return { kind: "missing" };
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    const known = this.answers.get(key) ?? this.pending.get(key);
    if (known) return known;
    if (this.asked >= this.cap) return { kind: "skipped", reason: "cap" };
    // Lookups in flight will spend theirs from the quota last seen.
    if (this.spent || (this.quota !== null && this.quota - this.inFlight * REQUESTS_PER_LOOKUP < REQUESTS_PER_LOOKUP)) {
      return { kind: "skipped", reason: "quota" };
    }
    this.asked++;
    this.inFlight++;
    const asking = this.ask(handle, key, deps).finally(() => {
      this.inFlight--;
      this.pending.delete(key);
    });
    this.pending.set(key, asking);
    return asking;
  }

  /**
   * Look several repos up, LOOKUP_CONCURRENCY at a time, under the same cap and
   * quota as one by one; the answers are remembered for `lookup`. A failed
   * lookup is left for `lookup` to meet again.
   */
  async lookupMany(handles: readonly string[], deps: LookupDeps): Promise<void> {
    const queue = [...handles];
    const worker = async () => {
      for (let h = queue.shift(); h !== undefined; h = queue.shift()) {
        if (deps.signal?.aborted) return;
        await this.lookup(h, deps).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, worker));
  }

  private async ask(handle: string, key: string, deps: LookupDeps): Promise<RepoLookup> {
    let facts: RepoFacts | null;
    try {
      facts = await lookupRepoFacts(handle, deps, (remaining) => {
        this.sent++;
        if (remaining !== null) this.quota = remaining;
      });
    } catch (e) {
      if (e instanceof GithubRateLimitError) {
        this.spent = true;
        return { kind: "skipped", reason: "quota" };
      }
      throw e;
    }
    const answer: RepoLookup = facts ? { kind: "found", facts } : { kind: "missing" };
    this.answers.set(key, answer);
    return answer;
  }
}
