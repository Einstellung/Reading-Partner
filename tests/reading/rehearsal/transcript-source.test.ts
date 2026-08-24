// Which machine hears the rehearsal
// (src/reading/rehearsal/transcript-source.ts). The branch itself, with both
// sides faked: under bun the host has neither dictation nor a recorder, and
// what has to be checked is that the choice is made once and that no source at
// all comes back as null rather than as an error.
// Run: ./scripts/t.sh

import { expect, test } from "bun:test";
import { chooseTranscriptSource } from "../../../src/reading/rehearsal/transcript-source";
import type { TranscriptSource } from "../../../src/reading/rehearsal/source";

const stub = (): TranscriptSource => ({
  start: async () => {},
  cut: () => {},
  stop: async () => {},
});

function hosts(opts: {
  onDevice: boolean;
  dictated?: TranscriptSource | null;
  desktop?: TranscriptSource | null;
}) {
  const calls = { dictated: 0, desktop: 0 };
  const host = {
    onDevice: opts.onDevice,
    dictated: async () => {
      calls.dictated++;
      return opts.dictated ?? null;
    },
    desktop: async () => {
      calls.desktop++;
      return opts.desktop ?? null;
    },
  };
  return { host, calls };
}

test("a host that transcribes on device never touches the recorder", async () => {
  const onDevice = stub();
  const h = hosts({ onDevice: true, dictated: onDevice, desktop: stub() });
  expect(await chooseTranscriptSource(h.host)).toBe(onDevice);
  expect(h.calls).toEqual({ dictated: 1, desktop: 0 });
});

test("every other host records and uploads", async () => {
  const desktop = stub();
  const h = hosts({ onDevice: false, dictated: stub(), desktop });
  expect(await chooseTranscriptSource(h.host)).toBe(desktop);
  expect(h.calls).toEqual({ dictated: 0, desktop: 1 });
});

test("the side that was chosen coming back empty is a run with no words, not the other side", async () => {
  const h = hosts({ onDevice: true, dictated: null, desktop: stub() });
  expect(await chooseTranscriptSource(h.host)).toBeNull();
  expect(h.calls.desktop).toBe(0);

  const g = hosts({ onDevice: false, desktop: null });
  expect(await chooseTranscriptSource(g.host)).toBeNull();
  expect(g.calls.dictated).toBe(0);
});
