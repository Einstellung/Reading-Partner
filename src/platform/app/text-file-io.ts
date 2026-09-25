// The disk half of a store that keeps one whole file of text and rewrites it
// on every change: the file's text, or null when it is not there yet, and an
// atomic write of the replacement. Read a store's own module for what a
// missing-vs-unreadable file means to it — the read here only tells the two
// apart, it does not decide what either one means.

import { appData } from "./appdata";
import { writeTextAtomic } from "./atomic-fs";

/** What such a store needs of the disk. */
export interface TextFileIo {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

/** The AppData on this device. */
export function appTextFileIo(): TextFileIo {
  return {
    async read(path) {
      if (!(await appData.exists(path))) return null;
      return await appData.readText(path);
    },
    write(path, content) {
      return writeTextAtomic(path, content);
    },
  };
}
