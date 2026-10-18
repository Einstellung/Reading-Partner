// The MiMo key saved before 2026-10-18 is deleted once and nothing else in
// credentials.json moves. Run: bash scripts/t.sh tests/ai/auth/retired-tts-key.test.ts
//
// Every key-shaped string below is fake.

import { beforeEach, expect, test } from "bun:test";
import { dropRetiredTtsKey } from "../../../src/ai/auth/credentials";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const FILE = "credentials.json";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

function stored(): Record<string, unknown> {
  return JSON.parse(disk.files.get(FILE) ?? "{}");
}

test("the retired key is deleted and the other device key stays", async () => {
  disk.files.set(
    FILE,
    JSON.stringify({
      voiceTts: { type: "apiKey", key: "tts-key-not-real" },
      voiceStt: { type: "apiKey", key: "stt-key-not-real" },
    }),
  );
  await dropRetiredTtsKey();
  expect(stored()).toEqual({ voiceStt: { type: "apiKey", key: "stt-key-not-real" } });
});

test("with no retired key the file is not written", async () => {
  const before = JSON.stringify({ voiceStt: { type: "apiKey", key: "stt-key-not-real" } });
  disk.files.set(FILE, before);
  await dropRetiredTtsKey();
  expect(disk.files.get(FILE)).toBe(before);
});
