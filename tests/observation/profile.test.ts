// User profile persistence + one-time rename migration (src/observation/profile/profile.ts).
// There is no factory seed, so a first run (no file) returns an empty profile and
// writes nothing; an existing file is read verbatim. When only the old
// info-profile.md exists, loadProfile promotes it to user-profile.md once and
// leaves the old file in place. AppData is a per-path in-memory map. Run: bun
// test.

import { beforeEach, expect, test } from "bun:test";
// The live Apply path, over the real store rather than an injected one: what
// the wiring does with a failed read is the whole question here.
import { applyProfileUpdate } from "../../src/info/companion/card-actions";
import {
  LEGACY_PROFILE_FILE,
  PROFILE_FILE,
  ProfileUnreadableError,
  loadProfile,
  loadProfileForWrite,
  saveProfile,
} from "../../src/observation/profile/profile";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

let disk: FakeDisk;

beforeEach(() => {
  disk = installAppData();
});

// Writes of a profile document, by either name. The store writes through the
// real writeTextAtomic here — nothing about it is stubbed, because the guarded
// read is the thing under test and it has to run against a real disk that can
// refuse to open a file.
const writes = (): number =>
  disk.writes.filter((p) => p === PROFILE_FILE || p === LEGACY_PROFILE_FILE).length;

test("loadProfile returns empty and writes nothing when no file exists", async () => {
  expect(await loadProfile()).toBe("");
  expect(writes()).toBe(0);
});

test("loadProfile reads an existing profile verbatim", async () => {
  disk.files.set(PROFILE_FILE, "I care about robotics.");
  expect(await loadProfile()).toBe("I care about robotics.");
  expect(writes()).toBe(0);
});

test("saveProfile then loadProfile round-trips through the new file", async () => {
  await saveProfile("Harsher on vendor PR.");
  expect(disk.files.has(PROFILE_FILE)).toBe(true);
  expect(await loadProfile()).toBe("Harsher on vendor PR.");
});

test("loadProfile migrates the legacy info-profile.md once, leaving the old file", async () => {
  disk.files.set(LEGACY_PROFILE_FILE, "legacy taste");
  const got = await loadProfile();
  expect(got).toBe("legacy taste");
  // Promoted to the new name, old file untouched.
  expect(disk.files.get(PROFILE_FILE)).toBe("legacy taste");
  expect(disk.files.get(LEGACY_PROFILE_FILE)).toBe("legacy taste");
  expect(writes()).toBe(1);
});

test("the new file wins over a stale legacy file and no migration write happens", async () => {
  disk.files.set(PROFILE_FILE, "current");
  disk.files.set(LEGACY_PROFILE_FILE, "old");
  expect(await loadProfile()).toBe("current");
  expect(writes()).toBe(0);
});

// --- unreadable is not empty ------------------------------------------------
//
// A read that failed used to come back as "" — the same answer as "no profile
// yet". Every writer then splices onto nothing and saves, and one failed read
// costs the reader the document. The two answers have to be different ones.

const WRITTEN = "Interests: robotics.\nBackground: builds them for a living.\n";

test("a profile that cannot be read raises for a writer, and its bytes stay where they are", async () => {
  disk.files.set(PROFILE_FILE, WRITTEN);
  disk.unreadable.add(PROFILE_FILE);

  expect(loadProfileForWrite()).rejects.toThrow(ProfileUnreadableError);
  // Nothing wrote, and the document is still on disk exactly as it was.
  expect(writes()).toBe(0);
  expect(disk.files.get(PROFILE_FILE)).toBe(WRITTEN);
});

test("readers carry on with an empty profile while writers are held off", async () => {
  disk.files.set(PROFILE_FILE, WRITTEN);
  disk.unreadable.add(PROFILE_FILE);
  // A briefing must not fail because the identity document would not open.
  expect(await loadProfile()).toBe("");
  expect(writes()).toBe(0);
});

test("a legacy file that cannot be read holds the migration rather than retiring it", async () => {
  disk.files.set(LEGACY_PROFILE_FILE, "legacy taste");
  disk.unreadable.add(LEGACY_PROFILE_FILE);

  expect(loadProfileForWrite()).rejects.toThrow(ProfileUnreadableError);
  // Had a write been allowed, user-profile.md would exist and the promotion
  // would never run again — the old build's profile orphaned by one bad read.
  expect(disk.files.has(PROFILE_FILE)).toBe(false);
  expect(disk.files.get(LEGACY_PROFILE_FILE)).toBe("legacy taste");
  expect(writes()).toBe(0);
});

// Missing and unreadable have to stay different answers: a first run must reach
// a write, and only a file that is there and would not open may hold one off.
test("no file at all is still the first run: empty, and a writer may go ahead", async () => {
  expect(await loadProfile()).toBe("");
  expect(await loadProfileForWrite()).toBe("");
});

test("Apply over an unreadable profile writes nothing at all", async () => {
  const onDisk = [
    "Interests: robotics, macro.",
    "Background: builds them for a living.",
    "",
    "<!-- ai-guess:begin -->",
    "- picks books about the era, not the method | basis: three margin notes | since: 2026-07-01",
    "<!-- ai-guess:end -->",
    "",
  ].join("\n");
  disk.files.set(PROFILE_FILE, onDisk);
  disk.unreadable.add(PROFILE_FILE);

  // The card that drafted this was shown the same failed read, so its declared
  // half is a profile written as if the reader had none.
  const out = await applyProfileUpdate("Interests: robotics.", { collecting: true, hasBriefing: true });

  expect(out).toEqual({ ok: false, canRetriage: false });
  expect(writes()).toBe(0);
  expect(disk.files.get(PROFILE_FILE)).toBe(onDisk);
});
