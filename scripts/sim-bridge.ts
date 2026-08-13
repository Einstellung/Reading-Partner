// Dev-only control channel for the iOS simulator test loop (scripts/ios-sim.sh).
//
// The simulator runs the app against this dev server, so the dev server is
// already a two-way pipe into the webview — it just needs a lane for commands.
// This plugin injects a small client into every dev HTML page; the client
// long-polls for JavaScript to run and posts the result back. `ios-sim.sh eval`
// pushes a snippet in over curl and gets the value out, which is what makes a
// gesture observable: real fingers go in through idb, and the page's own view of
// what happened (event log, scrollTop, transforms) comes back out through here.
//
// `apply: "serve"` keeps all of it out of `vite build` — no production bundle
// ever sees the client, and the endpoints exist only while `bun run dev` runs.
//
// The other half of that fence is the address the dev server is bound to. On
// loopback the simulator can reach the channel because it shares this machine's
// localhost, and nothing off this machine can. `tauri ios dev` against a
// physical device needs `--host`, and the moment the server answers on a LAN
// address anyone on that network could POST JavaScript into the page holding
// the developer's own library, notes and signed-in sessions. So a non-loopback
// bind installs neither the endpoints nor the client, and says so once instead
// of leaving the loop looking broken. `IOS_SIM_BRIDGE_ALLOW_REMOTE=1` in front
// of a single run is the way to take that trade knowingly.
//
// A loopback bind keeps other machines out. It does not keep out the browser
// already running on this one: any page the developer visits can post a form to
// http://localhost:1420, and `enctype="text/plain"` is one of the three form
// encodings that skip the CORS preflight, so the browser sends it cross-origin
// without asking. The response is unreadable to that page, but /eval does not
// need to answer to do the damage — the code is already running next to the
// library, the notes and the signed-in sessions. Nothing about the port is
// secret either: it is strictPort 1420.
//
// So the endpoints are split into two lanes with different callers, and each
// lane is held to what its caller can do (guardRequest):
//
//   the page's lane   /poll /result /log, called by the injected client. Same
//                     origin or nothing: a request carrying Sec-Fetch-Site or
//                     Origin from anywhere else is refused, and a browser will
//                     not let a page lie about either. "Same origin" is
//                     measured against the address this server is actually
//                     listening on, never against the Host the caller wrote —
//                     see SelfAddress below.
//   the driver's lane /eval /logs, called by curl from scripts/ios-sim.sh.
//                     Three fences, because this is the lane that runs code:
//                     a per-run token the plugin writes to a file only a local
//                     process can read, a content type no form can produce, and
//                     a refusal of any request wearing the headers a browser
//                     attaches to its own requests. The last one is what makes
//                     a forged Origin useless — a page that claimed to be
//                     same-origin would still be a page.
//
// Both lanes first have to be addressed to this server. "Same origin" used to
// mean "the Origin matches the Host header", which is a comparison of two
// things the caller wrote: a page on a domain whose DNS points at 127.0.0.1
// arrives with Host: evil.example:1420, Origin: http://evil.example:1420 and
// Sec-Fetch-Site: same-origin, all of them true from the browser's side, and it
// passed. It could then hold /poll open and take the command meant for the real
// page, and post results and logs back. So the Host is checked against what the
// server knows it is — loopback, on the port it is listening on — before either
// lane is consulted.
//
// The consequence worth knowing: /eval cannot be driven from the browser
// console on the dev page either. That is the same rule doing its job, and curl
// with the token is the way in.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { Plugin } from "vite";

// Just enough of node's IncomingMessage to read a body and place its caller,
// written structurally so the request type needs no import.
type BodyStream = {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  on(event: "data", cb: (chunk: unknown) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
};

// How long a poll from the page is held open before answering 204. Long enough
// that an idle page makes ~2 requests a minute, short enough that a restarted
// dev server is picked up quickly.
const POLL_HOLD_MS = 20_000;
// How long `eval` waits for the page to answer before giving up. The page may
// legitimately be mid-navigation or mid-reload.
const EVAL_TIMEOUT_MS = 30_000;
// Cap on retained log lines (uncaught errors and page notes).
const LOG_CAP = 500;

const CLIENT = `
(() => {
  if (window.__sim) return;
  const notes = [];
  window.__sim = {
    notes,
    // Anything the page wants to hand back out of band.
    note: (...a) => { notes.push(a.length === 1 ? a[0] : a); return notes.length; },
  };
  const post = (path, body) =>
    fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const safe = (v) => {
    try { return JSON.parse(JSON.stringify(v === undefined ? null : v)); }
    catch (e) { return String(v); }
  };
  async function loop() {
    for (;;) {
      try {
        const r = await fetch("/__sim/poll", { cache: "no-store" });
        if (r.status === 200) {
          const cmd = await r.json();
          let out;
          try { out = { id: cmd.id, ok: true, value: safe(await (0, eval)(cmd.code)) }; }
          catch (e) { out = { id: cmd.id, ok: false, error: String((e && e.stack) || e) }; }
          await post("/__sim/result", out);
          continue;
        }
      } catch (e) { /* dev server restarting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  loop();
  addEventListener("error", (e) =>
    post("/__sim/log", { kind: "error", msg: String(e.message), at: e.filename + ":" + e.lineno }).catch(() => {}));
  addEventListener("unhandledrejection", (e) =>
    post("/__sim/log", { kind: "rejection", msg: String((e.reason && e.reason.stack) || e.reason) }).catch(() => {}));
})();
`;

// Whether vite will bind somewhere only this machine can reach, decided from
// the host as vite resolved it: `undefined` and `false` are vite's own default
// (localhost), `true` is a bare `--host` and means every interface, a string is
// taken literally. Anything unrecognised counts as remote — being wrong the
// other way costs a debugging session, being wrong this way costs the data in
// the page. Exported for tests/sim-bridge.test.ts.
export function isLoopbackHost(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true;
  if (host === true) return false;
  // A bracketed or zone-suffixed IPv6 literal is the same address as the bare
  // one: [::1] and ::1%lo0 are both the loopback.
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  return (
    name === "localhost" ||
    // The whole 127.0.0.0/8, not just 127.0.0.1 — all of it routes to lo.
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name) ||
    /^(?:0{1,4}:){7}0{0,3}1$/.test(name) ||
    name === "::1"
  );
}

// What to call the bind address in the message, since the two interesting
// cases are the ones with no address in them.
function describeHost(host: string | boolean | undefined): string {
  if (host === undefined || host === false) return "localhost";
  if (host === true) return "every interface";
  return host;
}

function readBody(req: BodyStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// The two lanes. Everything else under /__sim is a 404 the handler writes.
const PAGE_PATHS = new Set(["/poll", "/result", "/log"]);
const DRIVER_PATHS = new Set(["/eval", "/logs"]);

// Headers a browser attaches to requests its own page made, and that no script
// in that page is allowed to set or remove. Seeing any of them on the driver's
// lane means the caller is a web page whatever else it claims, which is the
// whole answer to a forged Origin.
const BROWSER_MARKS = ["origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"] as const;

// A form can send exactly three content types (urlencoded, multipart, plain
// text) and fetch cannot send anything else cross-origin without a preflight
// this server never answers. So requiring this one is a fence a page cannot
// climb even before the token is checked.
const EVAL_CONTENT_TYPE = "application/x-sim-bridge-eval";
const TOKEN_HEADER = "x-sim-bridge-token";

// Neither token file is under the tree vite serves any more — the old one in
// node_modules is deleted at startup, the new one lives outside the root — but
// fs.deny is what holds if a checkout's `server.fs.allow` is ever widened to
// reach the cache directory, and it covers both names.
const DENY = ["**/.sim-bridge/**", "**/sim-bridge/*/token"];

// Where the per-run secret goes. It used to be node_modules/.sim-bridge/token,
// which is per-checkout and git-ignored but also inside the tree vite serves:
// `GET /node_modules/.sim-bridge/token` came back 200 with the token in the
// body, labelled text/javascript with a sourcemap of itself appended. A secret
// the server hands to anyone who asks defends nothing. So it lives outside the
// project root entirely, in the per-user cache directory, one directory per
// checkout keyed by the root path — two worktrees running dev servers still get
// two tokens, and no request path reaches either.
function cacheHome(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches");
  return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}

// Exported for tests/sim-bridge-csrf.test.ts, which checks it lands outside the
// root, and mirrored by bridge_token_file() in scripts/ios-sim.sh.
export function defaultTokenPath(root: string): string {
  const key = createHash("sha256").update(resolvePath(root)).digest("hex").slice(0, 16);
  return join(cacheHome(), "sim-bridge", key, "token");
}

// scripts/ios-sim.sh derives the same path (bridge_token_file) and reads the
// same env var, so a run on a spare port can be pointed somewhere else without
// touching either side.
function tokenPath(root: string): string {
  return process.env.IOS_SIM_BRIDGE_TOKEN_FILE || defaultTokenPath(root);
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Removed and rewritten rather than truncated, so the mode is the one asked for
// even if something left a world-readable file behind.
function writeToken(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    rmSync(file);
  } catch {
    /* not there */
  }
  writeFileSync(file, token + "\n", { mode: 0o600 });
}

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Verdict = { ok: true } | { ok: false; status: number; error: string };

type GuardedRequest = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};

// What the server knows about where it answers: the host vite resolved (the
// same value isLoopbackHost is asked about) and the port it is actually
// listening on. Both come from this side of the socket, which is the point —
// the Host header does not. `exposed` is IOS_SIM_BRIDGE_ALLOW_REMOTE: the
// server is on an address it was warned about, reached under a name only the
// LAN's DNS knows, so there is no name to check it against and the warning
// printed at startup is the whole protection.
type SelfAddress = { host: string | boolean | undefined; port: number | undefined; exposed: boolean };

// Split an authority ("localhost:1420", "[::1]:1420", "evil.example") into its
// parts, or nothing if it is not one. Parsed as a URL so the bracket form and
// the port are handled the way a browser writes them; anything carrying a path,
// userinfo or query is not an authority at all.
function splitAuthority(authority: string): { host: string; port: number } | null {
  const text = authority.trim().toLowerCase();
  if (!text || /[/\\?#@]/.test(text)) return null;
  try {
    const url = new URL(`http://${text}`);
    if (url.username || url.password || url.pathname !== "/") return null;
    return { host: url.hostname, port: url.port ? Number(url.port) : 80 };
  } catch {
    return null;
  }
}

// Whether an authority names this very server. A hostname that merely resolves
// here does not: that is the DNS rebinding case, where evil.example points at
// 127.0.0.1 so the browser calls its page and this server the same origin. Only
// the loopback names count, plus the literal address vite was told to bind when
// IOS_SIM_BRIDGE_ALLOW_REMOTE put it on one. The port has to match too, because
// http://localhost:9999 is another origin — another local process, or another
// dev server the developer has a page open from.
function authorityIsSelf(authority: string | undefined, self: SelfAddress): boolean {
  if (authority === undefined) return false;
  const parsed = splitAuthority(authority);
  if (!parsed) return false;
  if (self.port !== undefined && parsed.port !== self.port) return false;
  if (self.exposed) return true;
  if (isLoopbackHost(parsed.host)) return true;
  return typeof self.host === "string" && self.host.trim().toLowerCase() === parsed.host;
}

// Whether this request may reach the endpoint it asked for. Driven through the
// middleware by tests/sim-bridge-csrf.test.ts, which posts the attack at it.
function guardRequest(req: GuardedRequest, token: string, self: SelfAddress): Verdict {
  const head = (name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const method = (req.method || "GET").toUpperCase();
  const deny = (status: number, error: string): Verdict => ({ ok: false, status, error });

  // Before either lane: the request has to be addressed to this server, by a
  // name this server has. HTTP/2 puts it in :authority instead.
  if (DRIVER_PATHS.has(req.path) || PAGE_PATHS.has(req.path)) {
    const authority = head("host") ?? head(":authority");
    if (!authorityIsSelf(authority, self)) {
      return deny(403, `${req.path} is not addressed to this dev server (Host: ${authority ?? "absent"})`);
    }
  }

  if (DRIVER_PATHS.has(req.path)) {
    for (const mark of BROWSER_MARKS) {
      if (head(mark) !== undefined) {
        return deny(403, `${req.path} is not reachable from a browser page (${mark} was set)`);
      }
    }
    const offered = head(TOKEN_HEADER);
    if (!token || offered === undefined || !secretsMatch(offered, token)) {
      return deny(403, `${req.path} needs the token this dev server wrote at start`);
    }
    if (req.path === "/eval") {
      if (method !== "POST") return deny(405, "/eval takes POST");
      // `content-type: application/x-sim-bridge-eval; charset=utf-8` is the
      // same declaration; only the type itself has to match.
      const type = (head("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type !== EVAL_CONTENT_TYPE) return deny(415, `/eval takes ${EVAL_CONTENT_TYPE}`);
    } else if (method !== "GET") {
      return deny(405, "/logs takes GET");
    }
    return { ok: true };
  }

  if (PAGE_PATHS.has(req.path)) {
    const site = head("sec-fetch-site");
    if (site !== undefined && site !== "same-origin") {
      return deny(403, `${req.path} is for this page only (Sec-Fetch-Site: ${site})`);
    }
    const origin = head("origin");
    if (origin !== undefined && !originIsSelf(origin, self)) {
      return deny(403, `${req.path} is for this page only (Origin: ${origin})`);
    }
    if (method !== (req.path === "/poll" ? "GET" : "POST")) {
      return deny(405, `${req.path} was called with ${method}`);
    }
    return { ok: true };
  }

  return { ok: true };
}

// An Origin the browser wrote is a serialized origin, so its authority is the
// part worth comparing — with this server's own address, not with the Host the
// same caller wrote a line above it. `null` (a sandboxed or opaque origin) is
// not a URL and so matches nothing.
function originIsSelf(origin: string, self: SelfAddress): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return authorityIsSelf(url.host, self);
  } catch {
    return false;
  }
}

// A body that is not an object is a body from something that is not the client,
// and an unguarded JSON.parse here takes the dev server down with it — killing
// the developer's session and whatever ios-sim loop was running.
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function simBridge(): Plugin {
  const queue: Array<{ id: number; code: string }> = [];
  const waiting = new Map<number, (r: unknown) => void>();
  // Every poll currently held open. A page reload leaves its old poll hanging
  // here until the socket dies, so there can legitimately be more than one, and
  // handing a command to the dead one loses it — hence the liveness check
  // before anything is taken off the queue.
  const polls = new Set<() => void>();
  let seq = 0;
  const logs: unknown[] = [];
  // Set in configResolved, read by both hooks below. False means this plugin
  // registers nothing at all.
  let enabled = false;
  // The host as vite resolved it, kept so a request's Host header can be held
  // against the address this server actually answers on. `exposedRemote` is the
  // knowing trade: a bare --host serves the page under whatever name the LAN
  // reaches it by, and this side never learns that name.
  let boundHost: string | boolean | undefined;
  let exposedRemote = false;

  return {
    name: "sim-bridge",
    apply: "serve",
    // The resolved config is the one answer for --host, the config file and the
    // env at once; process.argv would only see one of the three.
    configResolved(config) {
      // Pushed here, not returned from `config()`. Vite resolves the field as
      // `server.fs?.deny || ['.env', '.env.*', '*.{crt,pem}']`, so any list this
      // plugin hands to `config()` becomes the whole list and drops those three
      // — a dev server that serves `/.env` verbatim. By configResolved the
      // array already holds whatever vite settled on, and appending adds to it.
      // See docs/pitfall/124.
      config.server.fs.deny.push(...DENY);
      const host = config.server.host;
      boundHost = host;
      if (isLoopbackHost(host)) {
        enabled = true;
        return;
      }
      const where = describeHost(host);
      if (process.env.IOS_SIM_BRIDGE_ALLOW_REMOTE === "1") {
        enabled = true;
        exposedRemote = true;
        console.warn(
          `sim-bridge: EXPOSED on ${where} by IOS_SIM_BRIDGE_ALLOW_REMOTE=1 —` +
            ` anyone who can reach this port can run JavaScript in your app page.`,
        );
        return;
      }
      enabled = false;
      console.warn(
        `sim-bridge: off — the dev server is on ${where}, not loopback, so the` +
          ` ios-sim eval channel is not installed. Prefix one run with` +
          ` IOS_SIM_BRIDGE_ALLOW_REMOTE=1 to expose it anyway.`,
      );
    },
    configureServer(server) {
      if (!enabled) return;
      // Fresh at every start: a token left behind by a dead server opens
      // nothing, because the server that would honour it is gone. Which is also
      // the answer to `kill -9` (what ios-sim.sh's `up` does to the previous
      // server) skipping the close hook below — startup is the guarantee,
      // shutdown is the tidying.
      const token = newToken();
      const file = tokenPath(server.config.root);
      writeToken(file, token);
      // And take the one an older version of this plugin left inside
      // node_modules with it, since that one is inside the tree vite serves.
      rmSync(join(server.config.root, "node_modules", ".sim-bridge"), { recursive: true, force: true });
      server.httpServer?.on("close", () => {
        try {
          rmSync(file);
        } catch {
          /* already gone */
        }
      });

      // The port the socket is on, which is not always the one in the config:
      // strictPort is off by default, so vite may have moved. Read per request
      // because the server is not listening yet when this hook runs. `undefined`
      // (middleware mode, or before the first listen) drops the port half of the
      // comparison and leaves the hostname half, which is the rebinding fence.
      const selfPort = (): number | undefined => {
        const address = server.httpServer?.address?.();
        if (address && typeof address === "object" && typeof address.port === "number") return address.port;
        const configured = server.config.server.port;
        return typeof configured === "number" ? configured : undefined;
      };

      server.middlewares.use("/__sim", async (req, res) => {
        const path = (req.url ?? "/").split("?")[0];
        const json = (code: number, value: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(value));
        };

        const verdict = guardRequest(
          { path, method: req.method ?? "GET", headers: req.headers ?? {} },
          token,
          { host: boundHost, port: selfPort(), exposed: exposedRemote },
        );
        if (!verdict.ok) {
          json(verdict.status, { error: verdict.error });
          return;
        }

        // The page asks for work. Held open so an idle page is nearly silent.
        if (path === "/poll") {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              const done = () => {
                clearTimeout(timer);
                polls.delete(done);
                resolve();
              };
              const timer = setTimeout(done, POLL_HOLD_MS);
              polls.add(done);
            });
          }
          // Whoever is on the other end of this one may be gone (reload,
          // navigation): answering it would drop the command on the floor.
          if (req.destroyed || res.writableEnded) return;
          const cmd = queue.shift();
          if (!cmd) {
            res.statusCode = 204;
            res.end();
            return;
          }
          json(200, cmd);
          return;
        }

        // The page answers.
        if (path === "/result") {
          const body = parseJsonObject(await readBody(req));
          if (!body) {
            json(400, { error: "body is not a JSON object" });
            return;
          }
          const id = typeof body.id === "number" ? body.id : NaN;
          const resolve = waiting.get(id);
          if (resolve) {
            waiting.delete(id);
            resolve(body);
          }
          json(200, { accepted: !!resolve });
          return;
        }

        // The driver pushes JavaScript in and waits for its value.
        if (path === "/eval") {
          const code = await readBody(req);
          const id = ++seq;
          queue.push({ id, code });
          for (const w of [...polls]) w();
          const result = await new Promise<unknown>((resolve) => {
            waiting.set(id, resolve);
            setTimeout(() => {
              if (waiting.delete(id)) {
                // Drop it rather than let a page that comes back later run a
                // command whose answer nobody is waiting for.
                const at = queue.findIndex((c) => c.id === id);
                if (at >= 0) queue.splice(at, 1);
                resolve({ id, ok: false, error: "timeout: the page never answered" });
              }
            }, EVAL_TIMEOUT_MS);
          });
          json(200, result);
          return;
        }

        if (path === "/log") {
          const body = parseJsonObject(await readBody(req));
          if (!body) {
            json(400, { error: "body is not a JSON object" });
            return;
          }
          logs.push({ t: Date.now(), ...body });
          if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP);
          json(200, { ok: true });
          return;
        }

        // Read and drain what the page has reported.
        if (path === "/logs") {
          const out = logs.slice();
          logs.length = 0;
          json(200, out);
          return;
        }

        json(404, { error: "unknown endpoint" });
      });
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        if (!enabled) return;
        return [{ tag: "script", injectTo: "head-prepend", children: CLIENT }];
      },
    },
  };
}
