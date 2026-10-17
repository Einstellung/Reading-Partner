import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KOKORO_COMMANDS,
  downloadState,
  kokoroStatus,
  runKokoroBench,
  speakingEngine,
  startKokoroDownload,
  type KokoroBridge,
  type KokoroStatus,
} from "../../../src/ai/voice/kokoro";

const ROOT = join(import.meta.dir, "../../..");

function status(over: Partial<KokoroStatus> = {}): KokoroStatus {
  return {
    repo: "onnx-community/Kokoro-82M-v1.1-zh-ONNX",
    revision: "6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3",
    root: "/x",
    running: false,
    current: null,
    error: null,
    ready: [],
    requested: [],
    haveBytes: 0,
    totalBytes: 0,
    files: [],
    ...over,
  };
}

function recorder() {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const bridge: KokoroBridge = {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return status() as T;
    },
  };
  return { calls, bridge };
}

describe("kokoro commands", () => {
  test("every command is declared in the plugin's build.rs and allowed by default", () => {
    const build = readFileSync(join(ROOT, "plugins/voice/build.rs"), "utf8");
    const perms = readFileSync(join(ROOT, "plugins/voice/permissions/default.toml"), "utf8");
    for (const full of Object.values(KOKORO_COMMANDS)) {
      const name = full.replace("plugin:voice|", "");
      expect(build).toContain(`"${name}"`);
      expect(perms).toContain(`"allow-${name.replace(/_/g, "-")}"`);
    }
  });

  test("the invokes carry the argument names the Rust commands read", async () => {
    const { calls, bridge } = recorder();
    await kokoroStatus(bridge);
    await startKokoroDownload(bridge, ["int8", "fp32"]);
    await runKokoroBench(bridge, { phonemes: ["ㄋㄧ2ㄏㄠ3"], threads: [1] });
    expect(calls).toEqual([
      ["plugin:voice|kokoro_status", undefined],
      ["plugin:voice|kokoro_download", { variants: ["int8", "fp32"] }],
      ["plugin:voice|kokoro_bench", { args: { phonemes: ["ㄋㄧ2ㄏㄠ3"], threads: [1] } }],
    ]);
  });
});

describe("downloadState", () => {
  test("ready wins over everything", () => {
    expect(downloadState(status({ ready: ["int8"], running: true }), "int8")).toEqual({ kind: "ready" });
  });

  test("running reports the fraction over the requested files", () => {
    const s = status({ running: true, haveBytes: 25, totalBytes: 100, current: "onnx/model_int8.onnx" });
    expect(downloadState(s, "int8")).toEqual({
      kind: "downloading",
      fraction: 0.25,
      current: "onnx/model_int8.onnx",
    });
  });

  test("a stopped download with an error is failed, keeping what it had", () => {
    const s = status({ error: "HTTP 503", haveBytes: 50, totalBytes: 100 });
    expect(downloadState(s, "int8")).toEqual({ kind: "failed", error: "HTTP 503", fraction: 0.5 });
  });

  test("nothing asked for is idle", () => {
    expect(downloadState(status(), "fp32")).toEqual({ kind: "idle" });
  });
});

describe("speakingEngine", () => {
  test("nothing until the variant is verified, and when the status is unknown", () => {
    expect(speakingEngine(null)).toBe("none");
    expect(speakingEngine(status({ running: true }))).toBe("none");
    expect(speakingEngine(status({ ready: ["int8"] }))).toBe("none");
    expect(speakingEngine(status({ ready: ["fp32"] }))).toBe("kokoro");
    expect(speakingEngine(status({ ready: ["int8"] }), "int8")).toBe("kokoro");
  });
});
