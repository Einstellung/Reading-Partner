// The topic searches on disk (docs/info/88 主题配置): one JSON file under
// AppData, in sync range, records-merged on the search id (palace/kinds.ts).
//
// Read through readGuardedFile for the reason info-labs.json is: a search is
// drafted with the reader in conversation and nothing can rebuild one, and
// every change here is load-modify-save, so a read that failed must not become
// the list that gets written.

import {
  appGuardedFileIo,
  quarantineBeforeWrite,
  readGuardedFile,
  type GuardedFileIo,
} from "../../platform/app/guarded-file";
import { entryId, parseTopicSearchesFile, topicSearchesFileBody, type ParsedTopicSearches } from "./topic-searches";
import type { TopicSearch } from "./types";

export const TOPIC_SEARCHES_FILE = "info-topic-searches.json";

export type TopicSearchIo = GuardedFileIo<ParsedTopicSearches>;

export const topicSearchIo: TopicSearchIo = appGuardedFileIo();

// The searches as last read or written on this device, for the one reader that
// cannot wait on the disk: the line a running tool shows is made in one step
// (legion/durable/contract.ts AgentToolStart.label).
let known: readonly TopicSearch[] = [];

/** The topic searches as last seen, possibly none yet; read it, do not rely on it. */
export function knownTopicSearches(): readonly TopicSearch[] {
  return known;
}

async function readFile(io: TopicSearchIo): Promise<ParsedTopicSearches> {
  const file = (await readGuardedFile(io, TOPIC_SEARCHES_FILE, parseTopicSearchesFile)) ?? {
    searches: [],
    foreign: [],
    repaired: false,
  };
  if (io === topicSearchIo) known = file.searches;
  return file;
}

/** Every search in the file, active and stopped alike. */
export async function loadTopicSearches(io: TopicSearchIo = topicSearchIo): Promise<TopicSearch[]> {
  return (await readFile(io)).searches;
}

/**
 * Whether the reader has a topic search at all, active or stopped: what X's
 * sign-in row waits for (site-session.ts). A file that cannot be read answers
 * no; nothing is written from this answer, and the row comes back with the file.
 */
export async function hasTopicSearches(io: TopicSearchIo = topicSearchIo): Promise<boolean> {
  try {
    return (await loadTopicSearches(io)).length > 0;
  } catch {
    return false;
  }
}

// Apply a change and write the file; entries this build could not read go back
// unchanged. A change that returns null writes nothing. Returns what is on disk
// afterwards.
async function mutate(
  io: TopicSearchIo,
  change: (searches: TopicSearch[]) => TopicSearch[] | null,
): Promise<TopicSearch[]> {
  const file = await readFile(io);
  const next = change(file.searches);
  if (next === null) return file.searches;
  const taken = new Set(next.map((s) => s.id));
  const foreign = file.foreign.filter((e) => !taken.has(entryId(e)));
  if (file.repaired && !(await quarantineBeforeWrite(io, TOPIC_SEARCHES_FILE))) return file.searches;
  await io.write(TOPIC_SEARCHES_FILE, topicSearchesFileBody(next, foreign));
  if (io === topicSearchIo) known = next;
  return next;
}

/** Write one search. An id already in the file is replaced. */
export async function putTopicSearch(search: TopicSearch, io: TopicSearchIo = topicSearchIo): Promise<TopicSearch[]> {
  return mutate(io, (all) => [...all.filter((s) => s.id !== search.id), search]);
}

/**
 * Change one search in place. The changed record, or null when there is no
 * such id (and then nothing is written).
 */
export async function changeTopicSearch(
  id: string,
  change: (search: TopicSearch) => TopicSearch,
  io: TopicSearchIo = topicSearchIo,
): Promise<TopicSearch | null> {
  let changed: TopicSearch | null = null;
  const after = await mutate(io, (all) => {
    const at = all.findIndex((s) => s.id === id);
    if (at < 0) return null;
    changed = change(all[at]);
    return all.map((s, i) => (i === at ? (changed as TopicSearch) : s));
  });
  // A write refused over unplaceable entries leaves the old record on disk.
  return changed !== null && after.includes(changed) ? changed : null;
}
