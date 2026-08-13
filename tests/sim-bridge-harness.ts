// A stand-in for the two node objects the sim bridge's middleware touches, so a
// test can drive the real handler (scripts/sim-bridge.ts) instead of a copy of
// its rules. The request delivers its body on a later tick, the way a socket
// does — a body that arrived synchronously would let a handler pass that reads
// it in the wrong order.

type HeaderBag = Record<string, string | string[] | undefined>;

export type FakeRes = {
  statusCode: number;
  writableEnded: boolean;
  body: string;
  headers: Record<string, string>;
  ended: Promise<void>;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
};

export function fakeReq(
  url: string,
  opts: { method?: string; headers?: HeaderBag; body?: string } = {},
) {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = { data: [], end: [], error: [] };
  const req = {
    url,
    method: opts.method ?? "GET",
    headers: { host: "localhost:1420", ...(opts.headers ?? {}) } as HeaderBag,
    destroyed: false,
    on(event: string, cb: (arg?: unknown) => void) {
      listeners[event].push(cb);
      // readBody registers data, then end. Once it has both, hand over the
      // body asynchronously.
      if (event === "end") {
        setTimeout(() => {
          if (opts.body !== undefined) for (const d of listeners.data) d(opts.body);
          cb();
        }, 0);
      }
      return req;
    },
  };
  return req;
}

export function fakeRes(): FakeRes {
  let settle!: () => void;
  const ended = new Promise<void>((r) => {
    settle = r;
  });
  const res: FakeRes = {
    statusCode: 200,
    writableEnded: false,
    body: "",
    headers: {},
    ended,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      if (chunk !== undefined) res.body += chunk;
      res.writableEnded = true;
      settle();
    },
  };
  return res;
}

// Everything the plugin reads off vite's dev server, plus a hole to catch the
// middleware it registers. The port is the one the socket is listening on, the
// way node reports it — the guard holds a request's Host against that, not
// against what the request itself claims.
export function fakeServer(root: string, port = 1420) {
  let handler: ((req: unknown, res: unknown) => unknown) | undefined;
  return {
    server: {
      config: { root, server: { port } },
      httpServer: { on() {}, address: () => ({ address: "127.0.0.1", family: "IPv4", port }) },
      middlewares: {
        use(_prefix: string, fn: (req: unknown, res: unknown) => unknown) {
          handler = fn;
        },
      },
    },
    call(req: unknown, res: unknown) {
      if (!handler) throw new Error("the plugin registered no middleware");
      return handler(req, res);
    },
  };
}
