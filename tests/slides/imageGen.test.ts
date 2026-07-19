// Unit tests for the image-relay client (src/slides/imageGen.ts): request
// building, the poll state parser, and the submit→poll→result flow driven by an
// injected fetch — no network, no spend. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildGenerationRequest,
  buildPollRequest,
  generateImage,
  parseTaskId,
  parseTaskState,
  pollDelayMs,
  resolveImageGenConfig,
  type HttpRequest,
  type ImageGenDeps,
} from "../../src/slides/imageGen";

const config = resolveImageGenConfig({ apiBase: null, model: null, apiKey: "secret" });

test("resolveImageGenConfig applies defaults and trims a trailing slash", () => {
  expect(config.apiBase).toBe("https://www.right.codes");
  expect(config.model).toBe("gpt-image-2");
  const custom = resolveImageGenConfig({ apiBase: "https://x.test/", model: "m", apiKey: "k" });
  expect(custom.apiBase).toBe("https://x.test");
  expect(custom.model).toBe("m");
});

test("buildGenerationRequest carries the async 16:9 body and bearer auth", () => {
  const req = buildGenerationRequest(config, { prompt: "a cat", image: "data:image/png;base64,AAA" });
  expect(req.url).toBe("https://www.right.codes/draw/v1/images/generations");
  expect(req.init.method).toBe("POST");
  expect(req.init.headers.Authorization).toBe("Bearer secret");
  const body = JSON.parse(req.init.body!);
  expect(body).toMatchObject({ model: "gpt-image-2", prompt: "a cat", async: true, n: 1, size: "16:9" });
  expect(body.image).toEqual(["data:image/png;base64,AAA"]);
});

test("buildGenerationRequest omits image when none is given", () => {
  const body = JSON.parse(buildGenerationRequest(config, { prompt: "x" }).init.body!);
  expect("image" in body).toBe(false);
});

test("buildPollRequest targets the task and authenticates", () => {
  const req = buildPollRequest(config, "task-42");
  expect(req.url).toBe("https://www.right.codes/v1/tasks/task-42");
  expect(req.init.method).toBe("GET");
  expect(req.init.headers.Authorization).toBe("Bearer secret");
});

test("parseTaskId accepts task_id or id, else throws", () => {
  expect(parseTaskId({ task_id: "a" })).toBe("a");
  expect(parseTaskId({ id: "b" })).toBe("b");
  expect(parseTaskId({ id: 7 })).toBe("7");
  expect(() => parseTaskId({})).toThrow();
});

test("parseTaskState normalizes phases and image shapes", () => {
  expect(parseTaskState({ status: "pending" }).phase).toBe("pending");
  expect(parseTaskState({ status: "succeeded", data: [{ url: "http://x/i.png" }] })).toMatchObject({
    phase: "completed",
    images: [{ url: "http://x/i.png" }],
  });
  expect(parseTaskState({ status: "completed", images: [{ b64_json: "QUJD" }] }).images).toEqual([
    { b64: "QUJD" },
  ]);
  const failed = parseTaskState({ status: "failed", error: { message: "nope" } });
  expect(failed.phase).toBe("failed");
  expect(failed.error).toBe("nope");
});

test("pollDelayMs ramps from 2s toward a 5s ceiling", () => {
  expect(pollDelayMs(0)).toBe(2000);
  expect(pollDelayMs(1)).toBe(3500);
  expect(pollDelayMs(10)).toBe(5000);
});

// A fetch fake: first call is the submit, the rest are polls, served from a
// scripted queue. sleep advances a virtual clock so the timeout path is reachable
// without real time.
function makeDeps(pollResponses: unknown[], opts: { failSubmit?: boolean; url?: boolean } = {}): {
  deps: ImageGenDeps;
  calls: HttpRequest[];
} {
  let t = 0;
  const calls: HttpRequest[] = [];
  let poll = 0;
  const deps: ImageGenDeps = {
    fetch: async (req) => {
      calls.push(req);
      if (req.url.includes("/generations")) {
        return { ok: !opts.failSubmit, status: opts.failSubmit ? 500 : 200, json: async () => ({ task_id: "t1" }) };
      }
      const body = pollResponses[Math.min(poll, pollResponses.length - 1)];
      poll++;
      return { ok: true, status: 200, json: async () => body };
    },
    fetchBytes: async () => new Uint8Array([65, 66, 67]), // "ABC"
    sleep: async () => {
      t += 20_000;
    },
    now: () => t,
  };
  return { deps, calls };
}

test("generateImage: async task, base64 result", async () => {
  const { deps } = makeDeps([
    { status: "pending" },
    { status: "pending" },
    { status: "completed", data: [{ b64_json: "QUJD" }] },
  ]);
  const url = await generateImage(config, { prompt: "x" }, deps);
  expect(url).toBe("data:image/png;base64,QUJD");
});

test("generateImage: url result is fetched to bytes and encoded", async () => {
  const { deps, calls } = makeDeps([{ status: "completed", data: [{ url: "http://img/x.png" }] }]);
  const url = await generateImage(config, { prompt: "x" }, deps);
  expect(url).toBe(`data:image/png;base64,${btoa("ABC")}`);
  expect(calls[0].url).toContain("/generations");
});

test("generateImage: a failed task rejects with the error", async () => {
  const { deps } = makeDeps([{ status: "failed", error: "content policy" }]);
  await expect(generateImage(config, { prompt: "x" }, deps)).rejects.toThrow("content policy");
});

test("generateImage: a submit HTTP error rejects", async () => {
  const { deps } = makeDeps([], { failSubmit: true });
  await expect(generateImage(config, { prompt: "x" }, deps)).rejects.toThrow("submit failed");
});

test("generateImage: never-completing task times out", async () => {
  const { deps } = makeDeps([{ status: "pending" }]);
  await expect(generateImage(config, { prompt: "x" }, deps)).rejects.toThrow("timed out");
});

test("generateImage: aborts before submitting when the signal is already aborted", async () => {
  const { deps } = makeDeps([{ status: "completed", data: [{ b64: "QUJD" }] }]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateImage(config, { prompt: "x" }, { ...deps, signal: controller.signal }),
  ).rejects.toThrow("aborted");
});
