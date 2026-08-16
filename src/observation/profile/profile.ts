// The user profile: a cross-scenario identity document, the system's one durable
// statement about the user. Both scenarios read it — the daily briefing's triage
// (docs/16) and the reading companion.
//
// It has two halves and two writers. Everything the user declared is written
// only through the chat update_profile confirm card, with the user pressing
// Apply. Below it sits a guess section the AI writes on its own (guess.ts),
// which is the only thing an automatic write may ever touch — the declared half
// comes back byte for byte because no automatic path hands it to a model.
// It is the user's own data, synced between devices.
// There is no factory seed: no interests are preset. The profile is written only
// when the user (or the onboarding draft they Apply) puts taste into it; until
// then it is empty and triage judges on an item's own merit.
// Persisted to AppData/user-profile.md.

import {
  BaseDirectory,
  exists,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { readGuardedText, writeTextAtomic } from "../../platform/app/atomic-fs";
import type { GuessState } from "./guess";

export const PROFILE_FILE = "user-profile.md";
// The name an older build wrote (an info-only profile, before it was promoted to
// the cross-scenario identity). loadProfile migrates it once, on first read.
export const LEGACY_PROFILE_FILE = "info-profile.md";

// The profile's shape and size discipline. Injected verbatim into every prompt
// that drafts or revises the profile (the update_profile tool, the info
// companion, first-run onboarding) so the model keeps the document small and
// well-organized rather than appending to it forever.
export const PROFILE_SKELETON_GUIDANCE = [
  "The profile is a short free-text markdown document — the one identity both the",
  "daily briefing and the reading companion share. Organize it under four",
  "conventional sections (omit, or leave empty, any the user has not spoken to):",
  "- Interests: the fields and sub-areas they follow.",
  "- Taste: what they are allergic to, what forms they prefer.",
  "- Background: how deep they are, broken down by field.",
  "- Now: what they are reading, digging into, or preparing right now — each entry",
  "  dated with an absolute month (YYYY-MM).",
  "Keep the whole thing under half a page (~1500 characters). When a new",
  "preference conflicts with an existing line, rewrite that line rather than",
  "adding a second; merge entries of the same kind; tighten any section that",
  "bloats. Refuse to append endlessly — propose a merge instead. Do not silently",
  "drop a stale Now entry: when one looks out of date, ask the user in chat whether",
  "it still holds before changing it. When drafting the first profile, include only",
  "what the user has actually said — no invented taste, unspoken sections left out.",
].join("\n");

// The profile as it is on disk, and whether a writer may replace it. Empty and
// writable is the first-run case: no file, nothing seeded, and the first thing
// written becomes the profile. Empty and NOT writable is the failure this type
// exists to name — the file is there and could not be read, so the empty string
// is what a failed read had to return, not what the reader wrote. A writer that
// cannot tell the two apart replaces a profile it never saw with one built from
// nothing (docs/13, 拉下来之后，本地那份缓存).
export interface ProfileRead {
  text: string;
  writable: boolean;
}

/** Raised by loadProfileForWrite when the profile could not be read. */
export class ProfileUnreadableError extends Error {
  constructor(file: string) {
    super(`${file} could not be read`);
    this.name = "ProfileUnreadableError";
  }
}

// Load the profile, saying whether what came back is the document. No file means
// no profile yet — empty, writable, nothing seeded. A read that failed is empty
// and not writable: the bytes are still on disk untouched, and the next write
// must not be the thing that replaces them.
//
// One-time migration: when the new file is absent but an older build's
// info-profile.md exists, promote its content to user-profile.md and return it.
// The old file is left in place so a device still on the old build keeps reading
// it through the shared synced folder. A legacy file that exists and cannot be
// read is also not writable: creating user-profile.md from an empty base would
// retire the migration, and the older build's profile would never be promoted.
export async function loadProfileGuarded(): Promise<ProfileRead> {
  const read = await readGuardedText(PROFILE_FILE);
  if (read.status === "ok") return { text: read.value, writable: true };
  if (read.status === "corrupt") return { text: "", writable: false };

  const legacy = await readGuardedText(LEGACY_PROFILE_FILE);
  if (legacy.status === "missing") return { text: "", writable: true };
  if (legacy.status === "corrupt") return { text: "", writable: false };
  try {
    await writeTextAtomic(PROFILE_FILE, legacy.value);
  } catch {
    // If the promote-write fails, the legacy content is still returned; the
    // next read tries the migration again.
  }
  return { text: legacy.value, writable: true };
}

// For readers: the profile, or "" when there is none. A read failure returns
// empty too, never blocking a briefing — nothing on this path writes, so an
// empty prompt section is the whole cost.
export async function loadProfile(): Promise<string> {
  return (await loadProfileGuarded()).text;
}

// For writers: the profile, or a throw. Every path that saves the document back
// goes through this one, so "could not read it" can never arrive at a write
// looking like "there is nothing in it".
export async function loadProfileForWrite(): Promise<string> {
  const read = await loadProfileGuarded();
  if (!read.writable) throw new ProfileUnreadableError(PROFILE_FILE);
  return read.text;
}

export async function saveProfile(text: string): Promise<void> {
  await writeTextAtomic(PROFILE_FILE, text);
}

// --- the guess pass's bookkeeping ---

// When the guess pass last ran and how far the observations had got by then
// (guess.ts). Its own file rather than a topic's meta.json: the pass looks
// across every topic at once, so no topic owns the stamp. Local bookkeeping, not
// content — a device that syncs the profile and re-runs the pass once loses
// nothing.
export const GUESS_STATE_FILE = "profile-guess.json";

export async function loadGuessState(): Promise<GuessState> {
  try {
    if (!(await exists(GUESS_STATE_FILE, { baseDir: BaseDirectory.AppData }))) {
      return { lastRunAt: null, lastMemoryAt: null };
    }
    const raw = await readTextFile(GUESS_STATE_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as Partial<GuessState>;
    return {
      lastRunAt: typeof parsed.lastRunAt === "number" ? parsed.lastRunAt : null,
      lastMemoryAt: typeof parsed.lastMemoryAt === "number" ? parsed.lastMemoryAt : null,
    };
  } catch {
    // An unreadable stamp reads as "never ran". The gate then lets one pass
    // through, which rewrites the file.
    return { lastRunAt: null, lastMemoryAt: null };
  }
}

export async function saveGuessState(state: GuessState): Promise<void> {
  await writeTextAtomic(GUESS_STATE_FILE, JSON.stringify(state, null, 2));
}
