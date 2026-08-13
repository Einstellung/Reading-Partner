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
import type { Plugin } from "vite";

// Just enough of node's IncomingMessage to read a body, written structurally so
// this file needs no node type package of its own.
type BodyStream = {
  url?: string;
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

  return {
    name: "sim-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__sim", async (req, res) => {
        const path = (req.url ?? "/").split("?")[0];
        const json = (code: number, value: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(value));
        };

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
          const body = JSON.parse((await readBody(req)) || "{}");
          const resolve = waiting.get(body.id);
          if (resolve) {
            waiting.delete(body.id);
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
          const body = JSON.parse((await readBody(req)) || "{}");
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
        return [{ tag: "script", injectTo: "head-prepend", children: CLIENT }];
      },
    },
  };
}
