import { describe, expect, test } from "bun:test";
import {
  createUpdateRunner,
  restartLabel,
  UPDATE_CHECK_INTERVAL_MS,
  type FoundUpdate,
  type UpdateHost,
} from "../../../src/platform/app/update-policy";

interface FakeUpdate extends FoundUpdate {
  downloads: number;
  installs: number;
  closed: boolean;
}

function fakeUpdate(version: string, opts: { failDownload?: boolean; failInstall?: boolean } = {}): FakeUpdate {
  const u: FakeUpdate = {
    version,
    downloads: 0,
    installs: 0,
    closed: false,
    async download() {
      u.downloads++;
      if (opts.failDownload) throw new Error("network");
    },
    async install() {
      u.installs++;
      if (opts.failInstall) throw new Error("password refused");
    },
    async close() {
      u.closed = true;
    },
  };
  return u;
}

function setup(results: Array<FoundUpdate | null | Error>) {
  const queue = [...results];
  let checks = 0;
  let relaunches = 0;
  const logged: string[] = [];
  const host: UpdateHost = {
    async check() {
      checks++;
      const next = queue.shift() ?? null;
      if (next instanceof Error) throw next;
      return next;
    },
    async relaunch() {
      relaunches++;
    },
  };
  let tick: (() => void) | null = null;
  let interval = 0;
  let cancelled = false;
  const runner = createUpdateRunner(
    host,
    {
      every(fn, ms) {
        tick = fn;
        interval = ms;
        return () => {
          cancelled = true;
        };
      },
    },
    (m) => logged.push(m),
  );
  return {
    runner,
    logged,
    checks: () => checks,
    relaunches: () => relaunches,
    tick: () => tick?.(),
    interval: () => interval,
    cancelled: () => cancelled,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("update runner", () => {
  test("checks at start and on a six-hour schedule", async () => {
    const t = setup([null, null]);
    t.runner.start();
    await flush();
    expect(t.checks()).toBe(1);
    expect(t.interval()).toBe(UPDATE_CHECK_INTERVAL_MS);
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
    t.tick();
    await flush();
    expect(t.checks()).toBe(2);
    t.runner.stop();
    expect(t.cancelled()).toBe(true);
  });

  test("a found version is downloaded and then offered", async () => {
    const u = fakeUpdate("0.21.0");
    const t = setup([u]);
    let notified = 0;
    t.runner.subscribe(() => notified++);
    await t.runner.checkNow();
    expect(u.downloads).toBe(1);
    expect(u.installs).toBe(0);
    expect(t.runner.snapshot()).toEqual({ kind: "ready", version: "0.21.0" });
    expect(notified).toBe(1);
    expect(restartLabel(t.runner.snapshot())).toBe("Restart to update (v0.21.0)");
  });

  test("nothing new leaves the state alone", async () => {
    const t = setup([null]);
    await t.runner.checkNow();
    expect(t.runner.snapshot()).toEqual({ kind: "none" });
    expect(restartLabel(t.runner.snapshot())).toBeNull();
  });

  test("the same version found again is not downloaded twice", async () => {
    const first = fakeUpdate("0.21.0");
    const again = fakeUpdate("0.21.0");
    const t = setup([first, again]);
    await t.runner.checkNow();
    await t.runner.checkNow();
    expect(again.downloads).toBe(0);
    expect(again.closed).toBe(true);
    expect(first.closed).toBe(false);
  });

  test("a newer version replaces the one waiting", async () => {
    const older = fakeUpdate("0.21.0");
    const newer = fakeUpdate("0.21.1");
    const t = setup([older, newer]);
    await t.runner.checkNow();
    await t.runner.checkNow();
    expect(t.runner.snapshot()).toEqual({ kind: "ready", version: "0.21.1" });
    expect(older.closed).toBe(true);
  });

  test("failures are logged and wait for the next check", async () => {
    const broken = fakeUpdate("0.21.0", { failDownload: true });
    const t = setup([new Error("offline"), broken]);
    await t.runner.checkNow();
    await t.runner.checkNow();
    expect(t.logged).toEqual(["update check failed", "update check failed"]);
    expect(t.runner.snapshot()).toEqual({ kind: "none" });
    expect(t.checks()).toBe(2);
  });

  test("overlapping checks collapse into the one in flight", async () => {
    const t = setup([null, null]);
    const a = t.runner.checkNow();
    const b = t.runner.checkNow();
    await Promise.all([a, b]);
    expect(t.checks()).toBe(1);
  });

  test("apply installs and relaunches", async () => {
    const u = fakeUpdate("0.21.0");
    const t = setup([u]);
    await t.runner.checkNow();
    const applying = t.runner.applyNow();
    expect(t.runner.snapshot()).toEqual({ kind: "installing", version: "0.21.0" });
    await applying;
    expect(u.installs).toBe(1);
    expect(t.relaunches()).toBe(1);
  });

  test("a refused install puts the entry back", async () => {
    const u = fakeUpdate("0.21.0", { failInstall: true });
    const t = setup([u]);
    await t.runner.checkNow();
    await t.runner.applyNow();
    expect(t.relaunches()).toBe(0);
    expect(t.logged).toEqual(["update install failed"]);
    expect(t.runner.snapshot()).toEqual({ kind: "ready", version: "0.21.0" });
  });

  test("apply with nothing downloaded does nothing", async () => {
    const t = setup([]);
    await t.runner.applyNow();
    expect(t.relaunches()).toBe(0);
  });

  test("no checks run once installing", async () => {
    const u = fakeUpdate("0.21.0");
    const t = setup([u, fakeUpdate("0.21.1")]);
    await t.runner.checkNow();
    const applying = t.runner.applyNow();
    await t.runner.checkNow();
    await applying;
    expect(t.checks()).toBe(1);
  });
});
