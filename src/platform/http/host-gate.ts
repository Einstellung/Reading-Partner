// The one limiter for outbound requests, per host (docs/pitfall/502). Both live
// transports — reading's readingFetch and info's infoFetch — pass every attempt
// through the process-wide gate at the bottom, whatever retry loop or caller sits
// above them, so a nightly collect, a topic search and a reading-side lookup
// running at once share one clock per host instead of keeping one each.
//
// Per host group, two things:
// - spacing: a minimum gap between requests. A serial group also lets one
//   request out at a time and measures the gap from the previous answer, which
//   is what arXiv asks for (one request per three seconds, one connection).
// - cooldown, per lane rather than per group (arXiv, Hugging Face, S2's DOI
//   lookup, citation graph and recommendations, OpenAlex's citation graph): once
//   a lane answers with its rate limit, nothing goes to it from any caller until
//   a backoff passes; the group's other lanes keep their turns. The backoff grows
//   on repeats, is never shorter than the Retry-After asked for, and is kept in
//   localStorage so a restart does not go straight back to the host.

import { throwIfAborted } from "../app/abort";
import type { FetchFn } from "../app/host";
import { retryAfterMs } from "./retry-after";

// Thrown when a request is terminally rate-limited (429 after every retry).
// The pipeline treats this as "cool down and retry later", not a hard failure.
export class RateLimitError extends Error {
  constructor(public readonly host: string) {
    super(`HTTP 429 from ${host}`);
    this.name = "RateLimitError";
  }
}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError;
}

// Thrown instead of sending a request while the host or lane is cooling down
// from an earlier rate limit. A rate limit like any other to callers that only
// ask isRateLimitError; one that wants to say "nothing was sent" asks for this.
// `refused` marks the one request that was sent and drew the rate limit.
export class HostCoolingDownError extends RateLimitError {
  constructor(
    host: string,
    public readonly until: number,
    private readonly now: number,
    public readonly refused = false,
  ) {
    super(host);
    const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
    this.message = refused
      ? `${host} refused the request with a rate limit; cooling down (${minutes} min left)`
      : `${host} is cooling down after a rate limit (${minutes} min left); no request sent`;
    this.name = "HostCoolingDownError";
  }

  /** The same cooldown, said of the request it refused. */
  asRefusal(): HostCoolingDownError {
    return new HostCoolingDownError(this.host, this.until, this.now, true);
  }
}

export function isHostCoolingDown(e: unknown): e is HostCoolingDownError {
  return e instanceof HostCoolingDownError;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

// The one wait on a real timer, for every backoff in the app that has no fake
// clock injected.
export const sleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

export const realClock: Clock = { now: () => Date.now(), sleep };

export interface GroupPolicy {
  intervalMs: number;
  // One request at a time; the gap runs from the previous answer.
  serial: boolean;
}

// Hugging Face's paper search has a rate-limit bucket of its own (50 requests
// per 5 minutes anonymous, seen in its RateLimit headers 2026-10-18), apart from
// the Hub API's 500. It is gated as a lane of its own: a key that is not a
// hostname, with its own spacing and its own cooldown.
export const HF_PAPER_SEARCH_LANE = "huggingface.co/api/papers/search";

// Topic search asks Semantic Scholar which arXiv paper a DOI is (docs/info/88).
// Without a key S2's shared pool answers 429 often; the lookup is best effort,
// so it cools down on a rate limit and is skipped meanwhile, without stopping
// S2's other callers, which wait out their 429s.
export const S2_DOI_LANE = "api.semanticscholar.org/graph/v1/paper/DOI";

// A study's graph expansion (docs/info/92): the id batch and the citation and
// reference walks, and the recommendations, each best effort the same way. The
// reading side's citation walk goes through the graph lane too, and is skipped
// while it cools down.
export const S2_GRAPH_LANE = "api.semanticscholar.org/graph/v1/paper/batch+edges";
export const S2_REC_LANE = "api.semanticscholar.org/recommendations";

// OpenAlex's side of the same walk, its fallback: works by id (`/works/{id}`)
// and the `cites:` and `openalex_id:` filters. Searches stay on the host.
export const OPENALEX_GRAPH_LANE = "api.openalex.org/works+graph";

const S2_EDGES_PATH = /^\/graph\/v1\/paper\/.+\/(citations|references)\/?$/;
const OPENALEX_GRAPH_FILTER = /(^|,)(cites|openalex_id):/;

/** The gate key of a request: its hostname, or the lane a host splits into. */
export function gateKeyOf(url: string): string {
  const u = new URL(url);
  const path = u.pathname;
  if (u.hostname === "huggingface.co" && path.startsWith("/api/papers/search")) return HF_PAPER_SEARCH_LANE;
  if (u.hostname === "api.semanticscholar.org") {
    if (path.startsWith("/recommendations/")) return S2_REC_LANE;
    if (path === "/graph/v1/paper/batch" || S2_EDGES_PATH.test(path)) return S2_GRAPH_LANE;
    if (path.startsWith("/graph/v1/paper/DOI:")) return S2_DOI_LANE;
  }
  if (u.hostname === "api.openalex.org") {
    if (path.startsWith("/works/") && path.length > "/works/".length) return OPENALEX_GRAPH_LANE;
    if (path === "/works" && OPENALEX_GRAPH_FILTER.test(u.searchParams.get("filter") ?? "")) return OPENALEX_GRAPH_LANE;
  }
  return u.hostname;
}

// Hosts and lanes that share one clock. arXiv's one-request-per-three-seconds
// rule is per IP across its hosts, so the export API, the abstract/HTML pages and
// the PDFs are one group for spacing. An S2 key is one request per second over
// every endpoint together, so S2 and all its lanes are one group too.
export const HOST_GROUP: Record<string, string> = {
  "arxiv.org": "arxiv",
  "www.arxiv.org": "arxiv",
  "export.arxiv.org": "arxiv",
  "huggingface.co": "huggingface",
  [HF_PAPER_SEARCH_LANE]: "huggingface-search",
  "api.semanticscholar.org": "semanticscholar",
  [S2_DOI_LANE]: "semanticscholar",
  [S2_GRAPH_LANE]: "semanticscholar",
  [S2_REC_LANE]: "semanticscholar",
  "api.openalex.org": "openalex",
  [OPENALEX_GRAPH_LANE]: "openalex",
};

// The hosts and lanes a rate limit cools down. The rest of S2 and OpenAlex wait
// out their 429s in the retry loop instead.
export const COOLS_DOWN: ReadonlySet<string> = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "huggingface.co",
  HF_PAPER_SEARCH_LANE,
  S2_DOI_LANE,
  S2_GRAPH_LANE,
  S2_REC_LANE,
  OPENALEX_GRAPH_LANE,
]);

// A cooldown is kept per host, not per group: the export API rate-limits on its
// own while arxiv.org's pages and PDFs still answer (seen 2026-10-17/18), so its
// 429 must not stop the paper reads.
const COOLDOWN_KEY: Record<string, string> = {
  "www.arxiv.org": "arxiv.org",
};

const cooldownKeyOf = (host: string): string => COOLDOWN_KEY[host] ?? host;

export const GROUP_POLICY: Record<string, GroupPolicy> = {
  // arXiv's usage policy: one request per three seconds, one connection.
  arxiv: { intervalMs: 3000, serial: true },
  // An S2 key's one request per second, with room; the shared free pool is
  // happier with spacing too.
  semanticscholar: { intervalMs: 1500, serial: false },
  // Keyless OpenAlex allows 10 req/s; stay well under it.
  openalex: { intervalMs: 500, serial: false },
  // NCBI E-utilities allow 3 requests/second without a key, and a topic search
  // is two calls (esearch then efetch) back to back.
  "eutils.ncbi.nlm.nih.gov": { intervalMs: 400, serial: false },
  // The Hub API allows 500 requests per 5 minutes per IP anonymous.
  huggingface: { intervalMs: 1000, serial: false },
  // Paper search: 50 per 5 minutes, so one per six seconds can never exceed it.
  "huggingface-search": { intervalMs: 6000, serial: false },
};

/** First cooldown after a rate limit; each repeat doubles it, up to the max. */
export const COOLDOWN_BASE_MS = 10 * 60_000;
export const COOLDOWN_MAX_MS = 4 * 60 * 60_000;
// A Retry-After past this is a broken header, not a wait to honour.
const RETRY_AFTER_CAP_MS = 24 * 60 * 60_000;
// A strike this long after the previous one starts the count again.
const STRIKE_MEMORY_MS = 24 * 60 * 60_000;
// A serial slot is given back after this even if the answer never comes, so one
// hung request cannot stop the group for good.
const MAX_HOLD_MS = 90_000;

const STORE_KEY = "reading-partner.host-cooldown.v1";

/** Where cooldowns are kept between runs. */
export interface CooldownStore {
  load(): string | null;
  save(raw: string): void;
}

export function memoryStore(): CooldownStore {
  let raw: string | null = null;
  return { load: () => raw, save: (v) => void (raw = v) };
}

// localStorage when there is one (the webview), memory otherwise (bun, tests).
function defaultStore(): CooldownStore {
  const memory = memoryStore();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    load: () => {
      try {
        return ls()?.getItem(STORE_KEY) ?? memory.load();
      } catch {
        return memory.load();
      }
    },
    save: (raw) => {
      memory.save(raw);
      try {
        ls()?.setItem(STORE_KEY, raw);
      } catch {
        // Memory still holds it for this process.
      }
    },
  };
}

interface Strike {
  until: number;
  strikes: number;
  at: number;
}

export interface HostGate {
  /** Wait for the host's turn; the returned release ends a serial slot. Throws HostCoolingDownError while cooling down. */
  acquire(host: string, defaultIntervalMs: number, signal?: AbortSignal | null): Promise<() => void>;
  /** Read an answer: a rate limit starts (or extends) the lane's cooldown, a success clears it. */
  observe(host: string, res: Response): Promise<void>;
  /** The error a request to the host would get now, or null when it may go. */
  coolingDown(host: string): HostCoolingDownError | null;
}

const groupOf = (host: string): string => HOST_GROUP[host] ?? host;

// arXiv answers its limiter with 429, and sometimes with 403 "Rate exceeded."
async function isRateLimitAnswer(res: Response): Promise<boolean> {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  try {
    return /rate exceeded/i.test(await res.clone().text());
  } catch {
    return false;
  }
}

export function createHostGate(opts: { clock?: Clock; store?: CooldownStore } = {}): HostGate {
  const clock = opts.clock ?? realClock;
  const store = opts.store ?? defaultStore();
  const last = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();

  const readStrikes = (): Record<string, Strike> => {
    try {
      const parsed: unknown = JSON.parse(store.load() ?? "{}");
      return parsed && typeof parsed === "object" ? (parsed as Record<string, Strike>) : {};
    } catch {
      return {};
    }
  };

  const coolingDown = (host: string): HostCoolingDownError | null => {
    if (!COOLS_DOWN.has(host)) return null;
    const s = readStrikes()[cooldownKeyOf(host)];
    const now = clock.now();
    return s && typeof s.until === "number" && s.until > now ? new HostCoolingDownError(host, s.until, now) : null;
  };

  return {
    coolingDown,

    async acquire(host, defaultIntervalMs, signal) {
      const group = groupOf(host);
      const policy = GROUP_POLICY[group] ?? (defaultIntervalMs > 0 ? { intervalMs: defaultIntervalMs, serial: false } : null);
      if (!policy) return () => {};
      const early = coolingDown(host);
      if (early) throw early;
      // Each caller's turn ends when it has taken its gap (or, serial, when its
      // answer is in); the next in line waits on that.
      let done!: () => void;
      const turn = new Promise<void>((r) => (done = r));
      const prev = tails.get(group) ?? Promise.resolve();
      tails.set(group, prev.then(() => turn));
      await prev;
      try {
        throwIfAborted(signal ?? undefined);
        const lastAt = last.get(group);
        if (lastAt !== undefined) {
          const wait = lastAt + policy.intervalMs - clock.now();
          if (wait > 0) await clock.sleep(wait);
        }
        // A request queued behind the one that drew the rate limit stays home.
        const cooling = coolingDown(host);
        if (cooling) throw cooling;
        throwIfAborted(signal ?? undefined);
      } catch (e) {
        done();
        throw e;
      }
      last.set(group, clock.now());
      if (!policy.serial) {
        done();
        return () => {};
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        last.set(group, clock.now());
        done();
      };
      const timer = setTimeout(release, MAX_HOLD_MS);
      return release;
    },

    async observe(host, res) {
      if (!COOLS_DOWN.has(host)) return;
      const key = cooldownKeyOf(host);
      const strikes = readStrikes();
      if (res.ok) {
        if (strikes[key]) {
          delete strikes[key];
          store.save(JSON.stringify(strikes));
        }
        return;
      }
      if (!(await isRateLimitAnswer(res))) return;
      const now = clock.now();
      const prior = strikes[key];
      const count = prior && now - prior.at < STRIKE_MEMORY_MS ? prior.strikes + 1 : 1;
      const backoff = Math.min(COOLDOWN_BASE_MS * 2 ** (count - 1), COOLDOWN_MAX_MS);
      const asked = Math.min(retryAfterMs(res.headers.get("retry-after"), now) ?? 0, RETRY_AFTER_CAP_MS);
      strikes[key] = { until: now + Math.max(backoff, asked), strikes: count, at: now };
      store.save(JSON.stringify(strikes));
    },
  };
}

/** A transport with every request passed through the gate: spacing and cooldown before, the answer read after. */
export function gatedFetch(inner: FetchFn, defaultIntervalMs: number, gate: HostGate = hostGate): FetchFn {
  return async (url, init) => {
    const host = gateKeyOf(url);
    const release = await gate.acquire(host, defaultIntervalMs, init?.signal);
    try {
      const res = await inner(url, init);
      await gate.observe(host, res);
      return res;
    } finally {
      release();
    }
  };
}

/** The process-wide gate the live transports share. */
export const hostGate: HostGate = createHostGate();
