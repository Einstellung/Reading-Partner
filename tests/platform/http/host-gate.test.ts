// The host gate (docs/pitfall/502): one clock per host group for every live
// caller, serial arXiv slots, and the cooldown after a rate limit. Fake clock,
// fake transports, memory store — no timers waited on, no network.

import { expect, test } from "bun:test";
import {
  COOLDOWN_BASE_MS,
  COOLDOWN_MAX_MS,
  createHostGate,
  gatedFetch,
  gateKeyOf,
  HF_PAPER_SEARCH_LANE,
  isHostCoolingDown,
  memoryStore,
  S2_DOI_LANE,
  type CooldownStore,
} from "../../../src/platform/http/host-gate";

function fakeClock() {
  const c = {
    t: 1_000_000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const ok = () => new Response("<feed/>", { status: 200 });

test("two callers' transports share one arXiv clock across its hosts", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  const sent: number[] = [];
  const inner = async () => {
    sent.push(clock.t);
    return ok();
  };
  // A collect's transport and a topic search's, as infoFetch and readingFetch are.
  const collect = gatedFetch(inner, 0, gate);
  const search = gatedFetch(inner, 1000, gate);
  await Promise.all([
    collect("https://export.arxiv.org/api/query?a"),
    search("https://export.arxiv.org/api/query?b"),
    search("https://arxiv.org/html/2401.00001"),
  ]);
  expect(sent).toEqual([1_000_000, 1_003_000, 1_006_000]);
});

test("a serial group lets one request out at a time and spaces from the answer", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  let inFlight = 0;
  let most = 0;
  const starts: number[] = [];
  const inner = async () => {
    inFlight++;
    most = Math.max(most, inFlight);
    starts.push(clock.t);
    clock.t += 5000; // a slow answer
    inFlight--;
    return ok();
  };
  const f = gatedFetch(inner, 0, gate);
  await Promise.all([f("https://export.arxiv.org/api/query?a"), f("https://export.arxiv.org/api/query?b")]);
  expect(most).toBe(1);
  // The second goes three seconds after the first answer, not after its start.
  expect(starts[1] - starts[0]).toBe(8000);
});

test("other listed hosts are spaced start to start, unlisted ones only with a default", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  const f = gatedFetch(async () => ok(), 0, gate);
  await f("https://api.semanticscholar.org/a");
  await f("https://api.semanticscholar.org/b");
  await f("https://example.com/a");
  await f("https://example.com/b");
  expect(clock.sleeps).toEqual([1500]);
  const reading = gatedFetch(async () => ok(), 1000, gate);
  await reading("https://example.org/a");
  await reading("https://example.org/b");
  expect(clock.sleeps).toEqual([1500, 1000]);
});

test("a 429 cools that arXiv host down for every caller, and nothing is sent to it", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  let sent = 0;
  const limited = gatedFetch(
    async () => {
      sent++;
      return new Response("", { status: 429 });
    },
    0,
    gate,
  );
  const other = gatedFetch(
    async () => {
      sent++;
      return ok();
    },
    1000,
    gate,
  );
  expect((await limited("https://export.arxiv.org/api/query?a")).status).toBe(429);
  const err = await other("https://export.arxiv.org/api/query?b").catch((e) => e);
  expect(isHostCoolingDown(err)).toBe(true);
  expect(err.message).toContain("no request sent");
  expect(err.until).toBe(1_000_000 + COOLDOWN_BASE_MS);
  expect(sent).toBe(1);
  // Unrelated hosts are not held.
  expect((await other("https://api.openalex.org/works")).status).toBe(200);
  clock.t += COOLDOWN_BASE_MS;
  expect((await other("https://export.arxiv.org/api/query?b")).status).toBe(200);
});

test("the export API's 429 does not stop arxiv.org's pages, which keep the shared spacing; arxiv.org's own 429 does", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  const sent: { url: string; at: number }[] = [];
  const f = gatedFetch(
    async (url) => {
      sent.push({ url: String(url), at: clock.t });
      return String(url).includes("export.") || String(url).includes("/limited") ? new Response("", { status: 429 }) : ok();
    },
    0,
    gate,
  );
  expect((await f("https://export.arxiv.org/api/query?id_list=2401.00001")).status).toBe(429);
  expect((await f("https://arxiv.org/html/2401.00001")).status).toBe(200);
  expect((await f("https://arxiv.org/pdf/2401.00001")).status).toBe(200);
  expect(sent.map((s) => s.at)).toEqual([1_000_000, 1_003_000, 1_006_000]);
  expect(isHostCoolingDown(await f("https://export.arxiv.org/api/query?id_list=2401.00002").catch((e) => e))).toBe(true);
  // A success on arxiv.org leaves the export API's cooldown standing.
  expect(gate.coolingDown("export.arxiv.org")).not.toBeNull();

  expect((await f("https://arxiv.org/limited")).status).toBe(429);
  expect(isHostCoolingDown(await f("https://arxiv.org/html/2401.00003").catch((e) => e))).toBe(true);
  expect(isHostCoolingDown(await f("https://www.arxiv.org/abs/2401.00003").catch((e) => e))).toBe(true);
  expect(sent.length).toBe(4);
});

test("Hugging Face's paper search is a lane of its own: its own spacing and its own cooldown", async () => {
  expect(gateKeyOf("https://huggingface.co/api/papers/search?q=a")).toBe(HF_PAPER_SEARCH_LANE);
  expect(gateKeyOf("https://huggingface.co/api/daily_papers")).toBe("huggingface.co");
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  const sent: { url: string; at: number }[] = [];
  const f = gatedFetch(
    async (url) => {
      sent.push({ url: String(url), at: clock.t });
      return String(url).includes("q=limited") ? new Response("", { status: 429 }) : ok();
    },
    0,
    gate,
  );
  await f("https://huggingface.co/api/papers/search?q=a");
  await f("https://huggingface.co/api/papers/search?q=b");
  await f("https://huggingface.co/api/daily_papers");
  await f("https://huggingface.co/api/papers/2401.00001");
  // Searches six seconds apart; the API on its own one-second clock.
  expect(sent.map((s) => s.at)).toEqual([1_000_000, 1_006_000, 1_006_000, 1_007_000]);
  expect((await f("https://huggingface.co/api/papers/search?q=limited")).status).toBe(429);
  const err = await f("https://huggingface.co/api/papers/search?q=c").catch((e) => e);
  expect(isHostCoolingDown(err)).toBe(true);
  expect(err.until).toBe(clock.t + COOLDOWN_BASE_MS);
  // The Hub API keeps answering while the search lane cools down.
  expect((await f("https://huggingface.co/api/daily_papers")).status).toBe(200);
  expect(gate.coolingDown("huggingface.co")).toBeNull();
});

test("Semantic Scholar's DOI lookup is a lane of its own that cools down on a 429; S2's other calls do not", async () => {
  expect(gateKeyOf("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1103/x?fields=externalIds")).toBe(S2_DOI_LANE);
  expect(gateKeyOf("https://api.semanticscholar.org/graph/v1/paper/arXiv:2401.00001")).toBe("api.semanticscholar.org");
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  let sent = 0;
  const f = gatedFetch(
    async () => {
      sent++;
      return new Response("", { status: 429 });
    },
    0,
    gate,
  );
  expect((await f("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1103/a")).status).toBe(429);
  const err = await f("https://api.semanticscholar.org/graph/v1/paper/DOI:10.1103/b").catch((e) => e);
  expect(isHostCoolingDown(err)).toBe(true);
  expect(sent).toBe(1);
  expect((await f("https://api.semanticscholar.org/graph/v1/paper/search?query=a")).status).toBe(429);
  expect(gate.coolingDown("api.semanticscholar.org")).toBeNull();
});

test("a request queued behind the one that drew the 429 stays home", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  let sent = 0;
  const f = gatedFetch(
    async () => {
      sent++;
      return new Response("", { status: 429 });
    },
    0,
    gate,
  );
  const results = await Promise.allSettled([f("https://export.arxiv.org/a"), f("https://export.arxiv.org/b")]);
  expect(sent).toBe(1);
  expect(results[1].status).toBe("rejected");
  expect(isHostCoolingDown((results[1] as PromiseRejectedResult).reason)).toBe(true);
});

test("repeats double the cooldown up to the max, a success resets it, Retry-After is honoured", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  const until = () => gate.coolingDown("export.arxiv.org")?.until ?? null;
  await gate.observe("export.arxiv.org", new Response("", { status: 429 }));
  expect(until()).toBe(clock.t + COOLDOWN_BASE_MS);
  clock.t += COOLDOWN_BASE_MS;
  await gate.observe("export.arxiv.org", new Response("", { status: 429 }));
  expect(until()).toBe(clock.t + 2 * COOLDOWN_BASE_MS);
  for (let i = 0; i < 10; i++) await gate.observe("export.arxiv.org", new Response("", { status: 429 }));
  expect(until()).toBe(clock.t + COOLDOWN_MAX_MS);
  await gate.observe("export.arxiv.org", ok());
  expect(until()).toBeNull();
  await gate.observe("export.arxiv.org", new Response("", { status: 429, headers: { "retry-after": "7200" } }));
  expect(until()).toBe(clock.t + 7_200_000);
});

test("403 Rate exceeded counts as the rate limit; a plain 403 does not", async () => {
  const gate = createHostGate({ store: memoryStore() });
  await gate.observe("export.arxiv.org", new Response("Forbidden", { status: 403 }));
  expect(gate.coolingDown("export.arxiv.org")).toBeNull();
  const res = new Response("Rate exceeded.", { status: 403 });
  await gate.observe("export.arxiv.org", res);
  expect(gate.coolingDown("export.arxiv.org")).not.toBeNull();
  // The body is still there for the caller.
  expect(await res.text()).toBe("Rate exceeded.");
});

test("a cooldown is kept in the store, so a new gate (a restart) honours it", async () => {
  const clock = fakeClock();
  const store: CooldownStore = memoryStore();
  await createHostGate({ clock, store }).observe("export.arxiv.org", new Response("", { status: 429 }));
  const restarted = createHostGate({ clock, store });
  expect(isHostCoolingDown(restarted.coolingDown("export.arxiv.org"))).toBe(true);
  // A broken store reads as no cooldown rather than a crash.
  const broken = createHostGate({ clock, store: { load: () => "{not json", save: () => {} } });
  expect(broken.coolingDown("export.arxiv.org")).toBeNull();
});

test("hosts without a cooldown policy never cool down", async () => {
  const gate = createHostGate({ store: memoryStore() });
  await gate.observe("api.semanticscholar.org", new Response("", { status: 429 }));
  expect(gate.coolingDown("api.semanticscholar.org")).toBeNull();
});

test("an aborted caller gives its turn back without sending", async () => {
  const clock = fakeClock();
  const gate = createHostGate({ clock, store: memoryStore() });
  let sent = 0;
  const f = gatedFetch(
    async () => {
      sent++;
      return ok();
    },
    0,
    gate,
  );
  const ctl = new AbortController();
  ctl.abort();
  const err = await f("https://export.arxiv.org/a", { signal: ctl.signal }).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(sent).toBe(0);
  expect((await f("https://export.arxiv.org/b")).status).toBe(200);
});
