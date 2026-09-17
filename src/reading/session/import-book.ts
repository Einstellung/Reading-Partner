// Importing an EPUB on the phone (docs/70): the shelf's Import button.
//
// The bytes are taken at once rather than on first open, the way the desk does
// it (open-file.ts): the path the iOS picker hands over is a copy the system may
// sweep, so a topic row that only points at it may point at nothing later. Once
// the book is in the library the path is only a name.
//
// The phone mirrors no books, so the blob is then sent to the account by hand,
// or no other device could open it. That step is separate from the import: the
// book is on the shelf and readable here whether or not the upload works.
//
// The io is an argument so this can be run without a filesystem.

import { open } from "@tauri-apps/plugin-dialog";
import { appData } from "../../platform/app/appdata";
import { importBook } from "../../platform/app/library";
import { normalizeFilePath } from "../../platform/app/path";
import { addFileToTopic, setFileHash } from "../../platform/app/topics";
import { pushBook } from "../../platform/sync";
import { isEpub } from "../epub/sniff";

export interface ImportBookIo {
  /** The path the reader picked, or null when the picker was dismissed. */
  pickEpub(): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  importBook(bytes: Uint8Array, originalPath: string): Promise<{ hash: string }>;
  addFileToTopic(topicId: string, path: string): Promise<void>;
  setFileHash(topicId: string, path: string, hash: string): Promise<void>;
  pushBook(hash: string): Promise<"uploaded" | "no-account">;
}

export const importBookIo: ImportBookIo = {
  pickEpub: async () => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
  readFile: (path) => appData.readPicked(path),
  importBook,
  addFileToTopic,
  setFileHash,
  pushBook,
};

export const NOT_AN_EPUB = "That file is not an EPUB, so it was not imported";
export const UPLOAD_FAILED =
  "The book is on this phone, but it could not be uploaded to your account";

export type ImportResult =
  | { kind: "cancelled" }
  | { kind: "refused"; why: string }
  | { kind: "imported"; bookId: string };

/**
 * Ask for an EPUB and file it under the topic, bytes and all. Nothing is
 * written for a file that is not an EPUB, whatever its name says.
 */
export async function importEpub(
  topicId: string,
  io: ImportBookIo = importBookIo,
): Promise<ImportResult> {
  const picked = await io.pickEpub();
  if (picked === null) return { kind: "cancelled" };
  // The form the topic store keeps (docs/pitfall/106), so the row the hash is
  // written to is the row that was added.
  const path = normalizeFilePath(picked);
  const bytes = await io.readFile(path);
  if (!isEpub(bytes)) return { kind: "refused", why: NOT_AN_EPUB };
  const { hash } = await io.importBook(bytes, path);
  await io.addFileToTopic(topicId, path);
  await io.setFileHash(topicId, path, hash);
  return { kind: "imported", bookId: hash };
}

/**
 * Send an imported book to the account. The line to say, or null when there
 * is nothing to say: uploaded, or no account to upload to — the book is
 * readable here either way.
 */
export async function uploadImported(
  bookId: string,
  io: ImportBookIo = importBookIo,
): Promise<string | null> {
  try {
    await io.pushBook(bookId);
    return null;
  } catch (e) {
    console.warn("failed to upload the imported book", e);
    return UPLOAD_FAILED;
  }
}
