// src/smoke/bench-journal.ts: the bench's rows, on their way into a file. What
// is worth testing here is not that JSON.stringify works — it is that a row and
// its line agree, that the lines come out in the order the holds happened, and
// that a file which cannot be written does not take the bench down with it. All
// three are things a device would only reveal after a build and an install.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  benchHoldLine,
  benchProbeLine,
  benchProfileLine,
  benchSessionLine,
  createBenchJournal,
  type BenchEntry,
} from "../../src/smoke/bench-journal";
import type { Heard } from "../../src/smoke/hold-outcome";

const spoke: Heard = { ms: 3000, levels: 45, volatiles: 8, finals: 2, peak: 0.6 };

const hold = (over: Partial<BenchEntry> = {}): BenchEntry => ({
  index: 1,
  outcome: "sent",
  text: "你好",
  heard: spoke,
  locale: "zh-CN",
  profile: "current",
  ...over,
});

// A collector standing in for the fs plugin.
function recorder() {
  const lines: string[] = [];
  return {
    lines,
    append: async (line: string) => {
      lines.push(line);
    },
  };
}

// A write held open until someone lets it go.
function gate() {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open };
}

test("a line carries everything needed to place the hold afterwards", () => {
  const parsed = JSON.parse(benchHoldLine(hold(), 1_700_000_000_000));
  expect(parsed.kind).toBe("hold");
  expect(parsed.wall).toBe(1_700_000_000_000);
  expect(parsed.at).toBe(new Date(1_700_000_000_000).toISOString());
  expect(parsed.index).toBe(1);
  expect(parsed.outcome).toBe("sent");
  expect(parsed.locale).toBe("zh-CN");
  expect(parsed.profile).toBe("current");
  expect(parsed.chars).toBe(2);
  expect(parsed.text).toBe("你好");
  expect(parsed.heard).toEqual(spoke);
});

test("every line is one line", () => {
  // The file is read by tail and by a line-at-a-time parser; a stray newline in
  // a transcript would split one hold into two records.
  const line = benchHoldLine(hold({ text: "first\nsecond" }), 1);
  expect(line.endsWith("\n")).toBe(true);
  expect(line.trimEnd().includes("\n")).toBe(false);
  expect(JSON.parse(line).text).toBe("first\nsecond");
  expect(benchSessionLine(1).endsWith("\n")).toBe(true);
});

test("the outcomes that produce no message still get a line", () => {
  // These are the rows the bench exists for: a cancel and a bar that did
  // nothing look the same on the phone, and the file has to tell them apart.
  const cancel = JSON.parse(benchHoldLine(hold({ outcome: "cancel", text: "" }), 1));
  expect(cancel.outcome).toBe("cancel");
  expect(cancel.chars).toBe(0);
  const silent = JSON.parse(
    benchHoldLine(hold({ outcome: "silent", text: "", heard: { ...spoke, levels: 0, peak: 0 } }), 1),
  );
  expect(silent.outcome).toBe("silent");
  expect(silent.heard.levels).toBe(0);
});

test("a typed line has no hold to report", () => {
  const parsed = JSON.parse(benchHoldLine(hold({ outcome: "typed", heard: null }), 1));
  expect(parsed.outcome).toBe("typed");
  expect(parsed.heard).toBeNull();
});

test("the session line opens the file for one process", async () => {
  const fs = recorder();
  const journal = createBenchJournal(fs.append, () => 7);
  journal.session();
  journal.hold(hold());
  await journal.idle();
  expect(fs.lines.map((l) => JSON.parse(l).kind)).toEqual(["session", "hold"]);
  expect(JSON.parse(fs.lines[0]).wall).toBe(7);
});

test("rows land in the order they happened even when writes overlap", async () => {
  // Holds arrive from pointer handlers that do not wait for each other. Two
  // appends in flight are two IPC calls racing for the end of the same file.
  const fs = recorder();
  const first = gate();
  let held = false;
  const slow = async (line: string) => {
    if (!held) {
      held = true;
      await first.shut;
    }
    await fs.append(line);
  };
  const journal = createBenchJournal(slow, () => 0);
  journal.hold(hold({ index: 1 }));
  journal.hold(hold({ index: 2 }));
  journal.hold(hold({ index: 3 }));
  expect(fs.lines).toEqual([]);
  first.open();
  await journal.idle();
  expect(fs.lines.map((l) => JSON.parse(l).index)).toEqual([1, 2, 3]);
});

test("each row is stamped when it happened, not when it reached the disk", async () => {
  const fs = recorder();
  let clock = 100;
  const journal = createBenchJournal(async (line) => {
    clock += 1000;
    await fs.append(line);
  }, () => clock);
  journal.hold(hold({ index: 1 }));
  journal.hold(hold({ index: 2 }));
  await journal.idle();
  expect(fs.lines.map((l) => JSON.parse(l).wall)).toEqual([100, 100]);
});

test("a write that fails does not take the next one with it", async () => {
  // The bench is a person holding a phone. A file that cannot be written is not
  // a reason to stop the run or to lose the rows after it.
  const fs = recorder();
  const journal = createBenchJournal(async (line) => {
    if (JSON.parse(line).index === 1) throw new Error("no space");
    await fs.append(line);
  }, () => 0);
  journal.hold(hold({ index: 1 }));
  journal.hold(hold({ index: 2 }));
  await journal.idle();
  expect(fs.lines.map((l) => JSON.parse(l).index)).toEqual([2]);
});

// The file is read afterwards as several runs of holds on different audio
// settings. A timing without its setting is not a measurement, and the setting
// is native state the row on screen has no other way of knowing.
test("every hold carries the audio profile it ran on", () => {
  const parsed = JSON.parse(benchHoldLine(hold({ profile: "reuse" }), 1));
  expect(parsed.profile).toBe("reuse");
});

test("a switch is a line of its own, so a run of holds reads as a group", () => {
  const parsed = JSON.parse(benchProfileLine("echoCancelledInput", 1_700_000_000_000));
  expect(parsed.kind).toBe("profile");
  expect(parsed.profile).toBe("echoCancelledInput");
  expect(parsed.at).toBe(new Date(1_700_000_000_000).toISOString());
});

// The probe takes the microphone away from dictation. A hold that behaves
// strangely right after one is explained by the line above it, which is the
// only reason these are in the same file.
test("a probe stage is recorded with whatever the native side answered", () => {
  const state = { stage: "tap", engineRunning: true, tapInstalled: true, buffers: 12 };
  const parsed = JSON.parse(benchProbeLine("tap", state, 1));
  expect(parsed.kind).toBe("probe");
  expect(parsed.stage).toBe("tap");
  expect(parsed.state).toEqual(state);
});

test("a probe that was refused still gets a line, with null for the state", () => {
  const parsed = JSON.parse(benchProbeLine("engine", undefined, 1));
  expect(parsed.stage).toBe("engine");
  expect(parsed.state).toBeNull();
});

test("switches and probes queue behind the holds in the order they happened", async () => {
  const fs = recorder();
  const journal = createBenchJournal(fs.append, () => 0);
  journal.session();
  journal.profile("reuse");
  journal.hold(hold({ profile: "reuse" }));
  journal.probe("session", { stage: "session" });
  await journal.idle();
  expect(fs.lines.map((l) => JSON.parse(l).kind)).toEqual(["session", "profile", "hold", "probe"]);
});
