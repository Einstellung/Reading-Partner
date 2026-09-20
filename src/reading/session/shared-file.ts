// A book handed to the app from outside it: the iOS share sheet, "Open in" from
// Files, a download in Safari. The formats the app claims are declared in
// src-tauri/Info.ios.plist (CFBundleDocumentTypes), which is what puts the app
// in that sheet at all.
//
// iOS hands over no bytes. It copies the document into the app's own sandbox and
// calls application:openURL: with a file URL naming that copy
// ("file:///.../Documents/Inbox/x.pdf"); tao turns that into RunEvent::Opened and
// tauri-plugin-deep-link emits it as `deep-link://new-url` — the very channel the
// OAuth callback arrives on (platform/sync/auth.ts). One stream, two consumers,
// so each recognises only its own URLs and leaves the rest alone.
//
// From there it is the ordinary import: the bytes are read, copied into the
// library and listed under a topic in one go (import-book.ts). That happens at
// this door rather than at the first open because the Inbox copy belongs to the
// system and may be swept, leaving a row pointing at nothing.
//
// The destination is the Brief topic, always: the share sheet is outside the
// app, so whichever topic happened to be open says nothing about the document.
// docs/21 — what cannot be classified goes to the default topic, and the AI
// proposes moving it into a real one from there.

import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { isTauri } from "../../platform/app/host";
import { basename, normalizeFilePath } from "../../platform/app/path";
import { ensureBriefTopic, listTopics, type FileRef, type Topic } from "../../platform/app/topics";
import { BOOKS, fileBook, fileBookIo, type FileBookIo } from "./import-book";

const BOOK_EXTENSIONS: readonly string[] = ["pdf", "epub"];

/**
 * Whether a file name is one of the formats the reader opens. The same two the
 * bundle claims and the same two the in-app picker filters on; shared with the
 * Android share target, whose host hands over a name rather than a path.
 */
export function isBookFileName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && BOOK_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/**
 * The path a deep-link URL names a book at, or null when the URL is something
 * else: the OAuth callback on the app's own scheme, or a file that is not a
 * book. Percent-escapes are undone here rather than downstream, by the one
 * normalizer every host path goes through (docs/pitfall/106).
 */
export function sharedBookPath(url: string): string | null {
  if (!/^file:/i.test(url)) return null;
  const path = normalizeFilePath(url);
  return isBookFileName(basename(path)) ? path : null;
}

/**
 * The shared books among a batch of URLs, skipping any already taken.
 *
 * `seen` is not caution, it is the seam between the two ways one URL reaches
 * here: a cold start's URL is emitted before any listener exists and is read
 * back from getCurrent(), which does not clear it, so a URL that arrives between
 * subscribing and that read would otherwise be opened twice.
 */
export function takeSharedBooks(urls: readonly string[], seen: Set<string>): string[] {
  const taken: string[] = [];
  for (const url of urls) {
    if (seen.has(url) || sharedBookPath(url) === null) continue;
    seen.add(url);
    taken.push(url);
  }
  return taken;
}

/** The URLs the host opened the app with, however they arrive. */
export interface OpenUrlStream {
  onOpenUrl(handler: (urls: string[]) => void): Promise<() => void>;
  getCurrent(): Promise<string[] | null>;
}

// Inert off a Tauri host. The plugin reaches straight into __TAURI_INTERNALS__,
// which the page has only under the runtime; this stream is bound as the app
// tree mounts, so in tests and under a plain vite server that call throws where
// auth.ts's never did (it binds inside signIn, which those never reach).
export const deepLinkStream: OpenUrlStream = {
  onOpenUrl: (handler) => (isTauri() ? onOpenUrl(handler) : Promise.resolve(() => {})),
  // Absent on a host with no deep links wired; auth.ts reads it the same way.
  getCurrent: () => (isTauri() ? getCurrent().catch(() => null) : Promise.resolve(null)),
};

/**
 * Call `open` once per book shared into the running app, and once for the one
 * that launched it. Returns the unsubscribe.
 *
 * The listener is bound before the launch URL is read, not after: the other
 * order loses a book shared in during the gap.
 */
export function watchSharedBooks(
  open: (url: string) => void,
  stream: OpenUrlStream = deepLinkStream,
): () => void {
  const seen = new Set<string>();
  const take = (urls: string[]): void => {
    for (const url of takeSharedBooks(urls, seen)) open(url);
  };

  let stopped = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    const off = await stream.onOpenUrl(take);
    if (stopped) {
      off();
      return;
    }
    unlisten = off;
    const launched = await stream.getCurrent();
    if (launched) take(launched);
  })();

  return () => {
    stopped = true;
    unlisten?.();
  };
}

export interface SharedBookIo extends FileBookIo {
  ensureBriefTopic(): Promise<Topic>;
  listTopics(): Promise<Topic[]>;
}

export const sharedBookIo: SharedBookIo = { ...fileBookIo, ensureBriefTopic, listTopics };

/**
 * Import a shared book into the default topic and answer with the row to open.
 * Null when the URL named no book, when the bytes turn out to be neither format
 * the reader opens, or when the topic store refused the path — the store owns
 * what a row looks like, so the row is read back from it rather than assembled
 * here.
 */
export async function fileSharedBook(
  url: string,
  io: SharedBookIo = sharedBookIo,
): Promise<{ topicId: string; file: FileRef } | null> {
  const path = sharedBookPath(url);
  if (path === null) return null;
  const topic = await io.ensureBriefTopic();
  const imported = await fileBook(topic.id, path, BOOKS, io);
  if (imported.kind !== "imported") return null;
  const filed = (await io.listTopics()).find((t) => t.id === topic.id);
  const file = filed?.files.find((f) => f.path === imported.path);
  return file ? { topicId: topic.id, file } : null;
}
