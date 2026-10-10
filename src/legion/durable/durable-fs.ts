// pi-durable's portable JSONL storage (@earendil-works/pi-durable/storage/jsonl)
// on AppData. Spike only: docs/research/pi-durable-spike.md.
//
// JsonlStorage takes a FileSystem from @earendil-works/pi-durable/env, an
// interface of 26 members built for the harness's coding tools. The storage
// itself calls eleven of them (dist/storage/jsonl/storage.js); those are the
// ones implemented here, and openDurableJsonl is the one place that hands the
// partial object over as the whole interface.
//
// Paths: an absolute path is an AppData-relative path with a leading slash, as
// in platform/app/session-fs.ts, and a relative one resolves against
// DURABLE_ROOT.

import type { Context } from "@earendil-works/chord";
import { FileError, err, ok, type FileInfo, type FileSystem, type Result } from "@earendil-works/pi-durable/env";
import { JsonlStorage } from "@earendil-works/pi-durable/storage/jsonl";
import type { AppDataFs } from "../../platform/app/appdata";

export const DURABLE_ROOT = "/durable";

/** The AppData methods the facade needs. */
export type DurableDisk = Pick<
  AppDataFs,
  "exists" | "readBytes" | "writeBytes" | "appendText" | "readDir" | "mkdirp" | "stat" | "remove" | "rename"
>;

/** The FileSystem members JsonlStorage calls. */
export type JsonlFileSystem = Pick<
  FileSystem,
  | "id"
  | "cwd"
  | "absolutePath"
  | "joinPath"
  | "createDir"
  | "appendFile"
  | "flushFile"
  | "remove"
  | "writeFile"
  | "renameFile"
  | "listDir"
  | "truncateFile"
  | "readBinaryFile"
>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function resolve(path: string, cwd: string): string {
  const from = path === "" ? cwd : path.startsWith("/") ? path : `${cwd}/${path}`;
  const out: string[] = [];
  for (const part of from.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

function failed(verb: string, path: string, cause: unknown): FileError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new FileError("unknown", `failed to ${verb} ${path}: ${message}`, path);
}

export function createDurableFileSystem(disk: DurableDisk, root: string = DURABLE_ROOT): JsonlFileSystem {
  const cwd = root;

  // Resolve, run, and turn a throw into a Result: not_found when the path is
  // gone, so the storage can tell a missing file from a failing one.
  async function run<T>(verb: string, path: string, body: (rel: string, full: string) => Promise<T>): Promise<Result<T, FileError>> {
    const full = resolve(path, cwd);
    const rel = full.slice(1);
    try {
      return ok(await body(rel, full));
    } catch (cause) {
      if (!(await disk.exists(rel).catch(() => true))) {
        return err(new FileError("not_found", `no such file or directory: ${full}`, full));
      }
      return err(failed(verb, full, cause));
    }
  }

  const text = (content: string | Uint8Array): string =>
    typeof content === "string" ? content : decoder.decode(content);
  const bytes = (content: string | Uint8Array): Uint8Array =>
    typeof content === "string" ? encoder.encode(content) : content;

  return {
    id: `appdata:${root}`,
    cwd,
    async absolutePath(path) {
      return ok(resolve(path, cwd));
    },
    async joinPath(parts) {
      return ok(resolve(parts.join("/"), cwd));
    },
    createDir(path) {
      return run("create", path, (rel) => disk.mkdirp(rel));
    },
    appendFile(path, content) {
      return run("append to", path, (rel) => disk.appendText(rel, text(content)));
    },
    // AppData has no fsync; the storage calls this only with { fsync: true }.
    async flushFile() {
      return ok(undefined);
    },
    remove(path, options) {
      return run("remove", path, async (rel) => {
        if (options?.force && !(await disk.exists(rel))) return;
        await disk.remove(rel);
      });
    },
    writeFile(path, content) {
      return run("write", path, (rel) => disk.writeBytes(rel, bytes(content)));
    },
    renameFile(from, to) {
      return run("rename", from, (rel) => disk.rename(rel, resolve(to, cwd).slice(1)));
    },
    listDir(path) {
      return run("list", path, async (rel, full) => {
        const entries = await disk.readDir(rel);
        const infos: FileInfo[] = [];
        for (const entry of entries) {
          const stat = entry.isFile ? await disk.stat(`${rel}/${entry.name}`) : null;
          infos.push({
            name: entry.name,
            path: `${full}/${entry.name}`,
            kind: entry.isDirectory ? "directory" : entry.isSymlink ? "symlink" : "file",
            size: stat?.size ?? 0,
            mtimeMs: stat?.mtimeMs ?? 0,
          });
        }
        return infos;
      });
    },
    // Recovery only: cutting a torn last line. AppData has no truncate.
    truncateFile(path, size) {
      return run("truncate", path, async (rel) => {
        const current = await disk.readBytes(rel);
        await disk.writeBytes(rel, current.slice(0, size));
      });
    },
    readBinaryFile(path) {
      return run("read", path, (rel) => disk.readBytes(rel));
    },
  };
}

/** Open (or create) a JSONL storage directory on AppData. */
export function openDurableJsonl(directory: string, disk: DurableDisk, context: Context): Promise<JsonlStorage> {
  const fs = createDurableFileSystem(disk);
  return JsonlStorage.open(directory, fs as FileSystem, context);
}
