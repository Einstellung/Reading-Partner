// One walk over every conversation file the app holds, and the read cache that
// makes walking it affordable.
//
// Searching and the time index (src/soul/sequence.ts) both want the same pass:
// list the root, keep the names the catalogue calls a conversation, read each
// file's threads. Written once here because two walkers would answer "every
// conversation" differently the moment a kind is added to the table — which is
// exactly what the door conversation was.

import { threadFileKey, type ConversationIo } from "./io";
import { threadKindOf, type ThreadKind } from "./topic-of";
import type { Thread } from "../platform/app/threads";

/** One conversation file, as the walk hands it over. */
export interface ThreadFile {
  /** The store key the file name holds (threadFileKey). */
  fileKey: string;
  name: string;
  kind: ThreadKind;
  threads: Thread[];
}

/**
 * One pass over the store reads topics.json, and every retell and outline a
 * talk thread points at, once each. Without this the topic resolution runs per
 * thread and a library of thirty books reads topics.json thirty times.
 */
export function memoizeIo(io: ConversationIo): ConversationIo {
  const texts = new Map<string, Promise<string | null>>();
  let root: Promise<string[]> | null = null;
  return {
    listRoot() {
      root ??= io.listRoot();
      return root;
    },
    readText(path) {
      let hit = texts.get(path);
      if (!hit) {
        hit = io.readText(path);
        texts.set(path, hit);
      }
      return hit;
    },
    peekThreads: (fileKey) => io.peekThreads(fileKey),
  };
}

/**
 * Every conversation file on disk, in the order the root lists them. A file
 * whose name no thread row claims is skipped, and so is one that will not read.
 */
export async function* walkThreadFiles(io: ConversationIo): AsyncGenerator<ThreadFile> {
  for (const name of await io.listRoot()) {
    const kind = threadKindOf(name);
    const fileKey = kind ? threadFileKey(name) : null;
    if (!kind || !fileKey) continue;
    yield { fileKey, name, kind, threads: await io.peekThreads(fileKey) };
  }
}
