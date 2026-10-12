// A background run killed mid-pass is not resumed: the next process aborts
// its conversation before resume(), asks nothing, and is idle (docs/soul/87,
// "第三阶段"; the pass reruns from its own files on its next trigger).

import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverBeforeResume } from "../../../src/legion/durable/recover";
import { openTestRuntime } from "./support/runtime";

const CHILD = join(import.meta.dir, "background-crash-child.ts");

/** Run the child until it prints ARMED, then SIGKILL it (only this PID). */
async function killWhenArmed(mode: string, root: string): Promise<void> {
  const child = Bun.spawn(["bun", CHILD, mode, root], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (!out.includes("ARMED")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`child exited before arming: ${out}`);
      out += decoder.decode(value);
    }
  } finally {
    child.kill("SIGKILL");
    await child.exited;
  }
}

for (const mode of ["in-tool", "mid-text"]) {
  test(`killed ${mode}: the background conversation is aborted, not resumed or asked again`, async () => {
    const root = mkdtempSync(join(tmpdir(), "durable-background-crash-"));
    await killWhenArmed(mode, root);
    const t = await openTestRuntime({ root, responses: [fauxAssistantMessage(fauxText("asked again"))] });
    const recovered = await recoverBeforeResume(t.runtime, ctx);
    expect(recovered.map((r) => r.outcome)).toEqual(["background"]);
    const until = Date.now() + 10_000;
    for (;;) {
      const inspection = await t.runtime.harness.inspect(ctx);
      if (inspection.tasks.length === 0 && inspection.submissions.length === 0) break;
      if (Date.now() > until) throw new Error("still live");
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(t.requests).toHaveLength(0);
    expect(t.recorded).toBe(0);
    await t.runtime.close(ctx);
  }, 30_000);
}
