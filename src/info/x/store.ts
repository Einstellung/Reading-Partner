// The X posts taken in as leads (docs/84): one record per post, with the
// documents that came of it. The post is the source information of those
// documents, kept beside them rather than in their bodies; a post that led to
// nothing is kept all the same, as the record alone.
//
// One file, a map by post id, records-merged when synced: two devices taking in
// two posts both keep theirs, and the same post taken in again replaces its own
// entry with what the newer read found.

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../platform/app/guarded-file";
import { isObject } from "../../platform/std/json";
import type { XPostRecord } from "./read-post";

export const X_POSTS_FILE = "info-x-posts.json";

export interface XPostEntry {
  record: XPostRecord;
  /** Library hashes of the documents that came of the post, its own and its links'. */
  documents: string[];
  /** Epoch milliseconds of the read this entry is from. */
  takenAt: number;
}

export interface XPostsFile {
  posts: Record<string, XPostEntry>;
}

export type XPostsIo = GuardedFileIo<XPostsFile>;

const xPostsIo: XPostsIo = appGuardedFileIo();

export function parseXPostsFile(raw: unknown): XPostsFile | null {
  if (!isObject(raw)) return null;
  return { posts: isObject(raw.posts) ? (raw.posts as Record<string, XPostEntry>) : {} };
}

/** Every post kept so far, by id. */
export async function loadXPosts(io: XPostsIo = xPostsIo): Promise<Record<string, XPostEntry>> {
  return (await readGuardedFile(io, X_POSTS_FILE, parseXPostsFile))?.posts ?? {};
}

/**
 * Keep one post's record. The documents of an earlier read of the same post
 * stay listed: taking it in again on another book does not unmake them.
 */
export async function saveXPost(entry: XPostEntry, io: XPostsIo = xPostsIo): Promise<void> {
  const posts = await loadXPosts(io);
  const before = posts[entry.record.id]?.documents ?? [];
  posts[entry.record.id] = { ...entry, documents: [...new Set([...before, ...entry.documents])] };
  await io.write(X_POSTS_FILE, JSON.stringify({ posts }, null, 2));
}
