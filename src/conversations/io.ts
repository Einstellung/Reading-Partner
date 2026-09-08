// The disk, as this capability needs it: list the root, read a file, read one
// thread file's threads. Injectable so search and topic resolution are testable
// against a literal store rather than a spied host package, and because the
// real one answers "not there" with a throw where every caller here wants null.

import { appData } from "../platform/app/appdata";
import { peekThreads, type Thread } from "../platform/app/threads";

export interface ConversationIo {
  /** File names directly under AppData. Directories are not descended into. */
  listRoot(): Promise<string[]>;
  /** A file's text, or null when it is not there or will not open. */
  readText(path: string): Promise<string | null>;
  /**
   * The threads of threads-<fileKey>.json, read from disk rather than from the
   * store's cache — nothing here is the conversation the reader is in, and the
   * cache holds only the book that is open (platform/app/threads.ts).
   */
  peekThreads(fileKey: string): Promise<Thread[]>;
}

export const appConversationIo: ConversationIo = {
  async listRoot() {
    try {
      return (await appData.readDir(".")).filter((e) => e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  },
  async readText(path) {
    try {
      return await appData.readText(path);
    } catch {
      return null;
    }
  },
  peekThreads,
};

/**
 * The store key of a thread file: "threads-<key>.json" without its wrapper, the
 * argument peekThreads takes. Null for a name that is not a thread file.
 *
 * Taken off the filename rather than off the palace row's captured id, because
 * the specific rows capture what follows their own prefix — threads-retell-7
 * captures "7" — while the store is keyed by "retell-7".
 */
export function threadFileKey(name: string): string | null {
  if (!name.startsWith("threads-") || !name.endsWith(".json")) return null;
  const key = name.slice("threads-".length, -".json".length);
  return key === "" ? null : key;
}

/** The file a store key names. The inverse of threadFileKey. */
export function threadFileName(fileKey: string): string {
  return `threads-${fileKey}.json`;
}
