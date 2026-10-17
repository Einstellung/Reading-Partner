import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KOKORO_COMMANDS, type KokoroBridge, type KokoroStatus } from "../../../../src/ai/voice/kokoro";
import {
  FALLBACK_TOTAL_BYTES,
  POLL_MS,
  createVoicePoller,
  megabytes,
  percentOf,
  variantBytes,
  voiceRowView,
  type Clock,
} from "../../../../src/ui/components/settings/on-device-voice";

const ROOT = join(import.meta.dir, "../../../..");
const FP32 = 339_369_442;
const VOICE = 522_240;

function files(fp32Have: number, voicesHave = 0) {
  return [
    { path: "onnx/model.onnx", size: FP32, have: fp32Have, ready: fp32Have === FP32 },
    { path: "onnx/model_fp16.onnx", size: 163_630_554, have: 0, ready: false },
    { path: "onnx/model_int8.onnx", size: 127_356_504, have: 127_356_504, ready: true },
    { path: "voices/zf_001.bin", size: VOICE, have: voicesHave, ready: voicesHave === VOICE },
    { path: "voices/af_maple.bin", size: VOICE, have: voicesHave, ready: voicesHave === VOICE },
  ];
}

function status(over: Partial<KokoroStatus> = {}): KokoroStatus {
  return {
    repo: "r",
    revision: "v",
    root: "/x",
    running: false,
    current: null,
    error: null,
    ready: [],
    requested: [],
    haveBytes: 0,
    totalBytes: 0,
    files: files(0),
    ...over,
  };
}

describe("variantBytes", () => {
  test("counts the fp32 model and the voices, not the other variants", () => {
    expect(variantBytes(status({ files: files(1000, VOICE) }), "fp32")).toEqual({
      have: 1000 + 2 * VOICE,
      total: FP32 + 2 * VOICE,
    });
  });

  test("reads a partial download after a relaunch, when totalBytes is zero", () => {
    const s = status({ files: files(FP32 / 2), totalBytes: 0, haveBytes: 0 });
    expect(variantBytes(s, "fp32").have).toBe(FP32 / 2);
  });

  test("falls back to the manifest size when the plugin lists no files", () => {
    expect(variantBytes(status({ files: [] }), "fp32")).toEqual({ have: 0, total: FALLBACK_TOTAL_BYTES });
    expect(FALLBACK_TOTAL_BYTES).toBe(FP32 + 2 * VOICE);
  });
});

describe("formatting", () => {
  test("megabytes are decimal and rounded", () => {
    expect(megabytes(FALLBACK_TOTAL_BYTES)).toBe(340);
    expect(megabytes(0)).toBe(0);
  });

  test("percent is floored and held under 100", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(3, 3)).toBe(99);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("voiceRowView", () => {
  test("no status reads as idle at the manifest size", () => {
    expect(voiceRowView(null)).toEqual({ kind: "idle", totalMB: 340, resumable: false, percent: 0 });
  });

  test("idle with bytes on disk is resumable", () => {
    const v = voiceRowView(status({ files: files(FP32 / 2) }));
    expect(v).toEqual({ kind: "idle", totalMB: 340, resumable: true, percent: 49 });
  });

  test("running is downloading, with percent and MB", () => {
    const v = voiceRowView(status({ running: true, files: files(170_000_000, VOICE) }));
    expect(v).toEqual({ kind: "downloading", percent: 50, haveMB: 171, totalMB: 340 });
  });

  test("an error from the plugin is failed, keeping the progress", () => {
    const v = voiceRowView(status({ error: "sha256 mismatch", files: files(100_000_000) }));
    expect(v).toMatchObject({ kind: "failed", error: "sha256 mismatch", percent: 29 });
  });

  test("a refused download command is failed even with no status", () => {
    expect(voiceRowView(null, { startError: "denied" })).toMatchObject({ kind: "failed", error: "denied" });
  });

  test("starting shows until the status says running", () => {
    expect(voiceRowView(status(), { starting: true }).kind).toBe("starting");
    expect(voiceRowView(status({ running: true }), { starting: true }).kind).toBe("downloading");
  });

  test("ready wins over everything, and only for fp32", () => {
    expect(voiceRowView(status({ ready: ["fp32"], error: "old" })).kind).toBe("ready");
    expect(voiceRowView(status({ ready: ["int8"] })).kind).toBe("idle");
  });
});

// A clock stepped by hand: `tick` runs whatever is due.
function manualClock() {
  let pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  let next = 1;
  const clock: Clock = {
    setTimeout(fn, ms) {
      const id = next++;
      pending.push({ fn, ms, id });
      return id;
    },
    clearTimeout(id) {
      pending = pending.filter((p) => p.id !== id);
    },
  };
  return {
    clock,
    pending: () => pending.map((p) => p.ms),
    tick() {
      const due = pending;
      pending = [];
      for (const p of due) p.fn();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function scripted(statuses: Array<KokoroStatus | Error>) {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const bridge: KokoroBridge = {
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      calls.push([command, args]);
      const s = statuses.shift() ?? status();
      if (s instanceof Error) throw s;
      return s as T;
    },
  };
  return { bridge, calls };
}

describe("createVoicePoller", () => {
  test("reads once on open and stops when nothing is running", async () => {
    const { bridge, calls } = scripted([status()]);
    const c = manualClock();
    const seen: KokoroStatus[] = [];
    createVoicePoller(bridge, (s) => seen.push(s), () => {}, c.clock).kick();
    await flush();
    expect(calls.map((x) => x[0])).toEqual([KOKORO_COMMANDS.status]);
    expect(seen.length).toBe(1);
    expect(c.pending()).toEqual([]);
  });

  test("keeps reading every second while a download already runs", async () => {
    const { bridge, calls } = scripted([status({ running: true }), status({ running: true }), status({ ready: ["fp32"] })]);
    const c = manualClock();
    createVoicePoller(bridge, () => {}, () => {}, c.clock).kick();
    await flush();
    expect(c.pending()).toEqual([POLL_MS]);
    c.tick();
    await flush();
    c.tick();
    await flush();
    expect(calls.length).toBe(3);
    expect(c.pending()).toEqual([]);
  });

  test("a status read that throws is skipped quietly", async () => {
    const { bridge } = scripted([new Error("plugin not found")]);
    const c = manualClock();
    const seen: KokoroStatus[] = [];
    const errors: string[] = [];
    createVoicePoller(bridge, (s) => seen.push(s), (e) => errors.push(e), c.clock).kick();
    await flush();
    expect(seen).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("start asks for fp32 at the top level, then polls", async () => {
    const { bridge, calls } = scripted([status({ running: true }), status({ running: true })]);
    const c = manualClock();
    await createVoicePoller(bridge, () => {}, () => {}, c.clock).start();
    await flush();
    expect(calls[0]).toEqual([KOKORO_COMMANDS.download, { variants: ["fp32"] }]);
    expect(calls[1][0]).toBe(KOKORO_COMMANDS.status);
    expect(c.pending()).toEqual([POLL_MS]);
  });

  test("a refused start goes to onError as a string", async () => {
    const bridge: KokoroBridge = {
      invoke: async () => {
        throw "Command kokoro_download not allowed";
      },
    };
    const errors: string[] = [];
    await createVoicePoller(bridge, () => {}, (e) => errors.push(e), manualClock().clock).start();
    expect(errors).toEqual(["Command kokoro_download not allowed"]);
  });

  test("stop cancels the pending read and drops a read in flight", async () => {
    const { bridge } = scripted([status({ running: true })]);
    const c = manualClock();
    const seen: KokoroStatus[] = [];
    const p = createVoicePoller(bridge, (s) => seen.push(s), () => {}, c.clock);
    p.kick();
    p.stop();
    await flush();
    expect(seen).toEqual([]);
    expect(c.pending()).toEqual([]);
  });

  test("a second kick replaces the first loop rather than doubling it", async () => {
    const { bridge } = scripted([status({ running: true }), status({ running: true })]);
    const c = manualClock();
    const p = createVoicePoller(bridge, () => {}, () => {}, c.clock);
    p.kick();
    p.kick();
    await flush();
    expect(c.pending()).toEqual([POLL_MS]);
  });
});

describe("strings", () => {
  test("every locale has the on-device voice keys with the same placeholders", () => {
    const keys = [
      "onDeviceVoice",
      "onDeviceVoiceHint",
      "onDeviceVoiceSize",
      "onDeviceVoiceDownload",
      "onDeviceVoiceResume",
      "onDeviceVoiceStarting",
      "onDeviceVoiceProgress",
      "onDeviceVoiceFailed",
      "onDeviceVoiceRetry",
      "onDeviceVoiceReady",
    ];
    const en = readFileSync(join(ROOT, "src/i18n/messages/settings/en.ts"), "utf8");
    const holes = (src: string, key: string) => {
      const m = src.match(new RegExp(`"optional\\.${key}": "([^"]*)"`));
      expect(m).not.toBeNull();
      return (m![1].match(/\{\w+\}/g) ?? []).sort();
    };
    for (const loc of ["zh-CN", "ja", "ko", "es", "fr", "de", "pt", "ru"]) {
      const src = readFileSync(join(ROOT, `src/i18n/messages/settings/${loc}.ts`), "utf8");
      for (const k of keys) expect(holes(src, k)).toEqual(holes(en, k));
    }
  });
});
