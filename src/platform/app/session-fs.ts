// pi-agent-core's FileSystem, implemented on AppData, so the harness can keep
// its durable sessions where everything else this app keeps lives.
//
// The harness stores a session as one append-only JSONL file per session, and
// JsonlSessionRepo takes the filesystem as a constructor argument rather than
// reaching for node: it calls thirteen methods, all of which appdata.ts already
// has. That is the whole reason the harness runs in a WebView at all, so this
// module is the seam — nothing above it knows the harness is writing files, and
// nothing below it knows the files are a session.
//
// Confinement. Every method that touches the disk resolves its argument and
// then refuses anything that is not SESSIONS_ROOT or below it: a path is a
// string the harness composed, and one `..` too many would otherwise put a
// session file on top of library.json. absolutePath and joinPath are the two
// exceptions, and deliberately so — they are pure string operations that touch
// nothing, and the repo calls absolutePath on the session's `cwd`, which is a
// grouping key that names no file of ours (it becomes a slugged directory
// name). Confining those two would refuse to create a session at all.
//
// The namespace is the app's own: an absolute path here is an AppData-relative
// path with a leading slash, so "/session/x/y.jsonl" is AppData's
// "session/x/y.jsonl". There is no second root to escape into.
//
// Never throws. The interface (dist/harness/types.d.ts) says so explicitly, and
// the repo reads every Result rather than catching: a method that threw would
// come out of the harness as an unhandled rejection rather than as a session
// that failed to open.

import { appData, type AppDataFs } from "./appdata";
import {
  FileError,
  err,
  ok,
  type FileInfo as PiFileInfo,
  type FileSystem,
  type Result,
} from "@earendil-works/pi-agent-core";

/**
 * Where the harness's sessions live, as this filesystem addresses them. The
 * AppData-relative prefix is the same string without the leading slash, and is
 * the `session` row of the palace table (src/palace/kinds.ts).
 */
export const SESSIONS_ROOT = "/session";

const ROOT_PREFIX = `${SESSIONS_ROOT}/`;

// AppData-relative form of an addressed path: the leading slash off.
function toAppData(path: string): string {
  return path.slice(1);
}

// Absolute, normalized, symlink-free — there are no symlinks in AppData as this
// app addresses it. A relative path resolves against `cwd`, which is the
// sessions root, and `..` is folded away rather than passed on, so what comes
// out is what the confinement check below gets to judge.
//
// `path` is typed as a string and arrives undefined: JsonlSessionRepo resolves
// a session's `cwd` through absolutePath before it knows whether the session
// has one (docs/pitfall/305). A missing path is the current directory, which is
// what node's own resolve(cwd) would say.
function resolve(path: string, cwd: string): string {
  const from =
    path === undefined || path === ""
      ? cwd
      : path.startsWith("/")
        ? path
        : `${cwd}/${path}`;
  const out: string[] = [];
  for (const part of from.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function notFound(path: string): FileError {
  return new FileError("not_found", `no such file or directory: ${path}`, path);
}

function failed(verb: string, path: string, cause: unknown): FileError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new FileError("unknown", `failed to ${verb} ${path}: ${message}`, path);
}

// Why the four below say no rather than doing something plausible. The JSONL
// session repo calls none of them; they are there for the harness's built-in
// shell, read and write tools, which this app does not mount. An implementation
// nothing exercises is an implementation nobody finds out is wrong, and the
// day a tool does reach for one, "not supported" names the decision that has to
// be made instead of half working.
function unsupported(method: string, reason: string): FileError {
  return new FileError("not_supported", `${method} is not supported on AppData: ${reason}`);
}

const NOT_MOUNTED =
  "the JSONL session repo never calls it, and this app mounts none of the harness's " +
  "built-in filesystem tools";

/**
 * pi's FileSystem over AppData, confined to {@link SESSIONS_ROOT}.
 *
 * `fs` is the AppData door, injected so a test can hand in a disk that is a Map.
 */
export function createSessionFileSystem(fs: AppDataFs = appData): FileSystem {
  const cwd = SESSIONS_ROOT;

  // The resolved path, or the error that says it left the sessions tree. Every
  // method that touches the disk starts here.
  function inside(path: string): { path: string } | { error: FileError } {
    const full = resolve(path, cwd);
    if (full !== SESSIONS_ROOT && !full.startsWith(ROOT_PREFIX)) {
      return {
        error: new FileError(
          "permission_denied",
          `${full} is outside the harness session store (${SESSIONS_ROOT})`,
          full,
        ),
      };
    }
    return { path: full };
  }

  // One shape for the thirteen: resolve, confine, run, and turn anything thrown
  // into a Result. `missing` maps a throw to not_found when the file is gone,
  // which is the one failure every caller tells apart from the rest.
  async function guarded<T>(
    verb: string,
    path: string,
    run: (full: string, relative: string) => Promise<Result<T, FileError>>,
  ): Promise<Result<T, FileError>> {
    const seen = inside(path);
    if ("error" in seen) return err(seen.error);
    try {
      return await run(seen.path, toAppData(seen.path));
    } catch (e) {
      return err(failed(verb, seen.path, e));
    }
  }

  // What kind of thing is at a path. AppData's stat is flattened to size and
  // mtime (appdata.ts), so the kind has to come from somewhere else: a listing
  // of the path itself succeeds for a directory and throws for a file. One
  // extra call, paid only by fileInfo, which the repo calls once per session
  // file while listing the store.
  async function kindOf(relative: string): Promise<"file" | "directory"> {
    try {
      await fs.readDir(relative);
      return "directory";
    } catch {
      return "file";
    }
  }

  return {
    cwd,

    // --- pure string operations, unconfined (see the header) ---------------

    async absolutePath(path) {
      return ok(resolve(path, cwd));
    },

    // Concatenation, not resolution: a segment that starts with a slash is a
    // segment, the way node's join treats one, rather than a new root. The repo
    // joins a root it already has with a name, and a name that looked absolute
    // restarting the path is how a file ends up outside the store.
    async joinPath(parts) {
      return ok(resolve(parts.filter((p) => p !== "").join("/"), cwd));
    },

    // --- the thirteen the session repo calls ---------------------------------

    readTextFile(path) {
      return guarded("read", path, async (full, relative) => {
        if (!(await fs.exists(relative))) return err(notFound(full));
        return ok(await fs.readText(relative));
      });
    },

    // pi's JSONL session storage opens a session file through this to read its
    // header before deciding which format it is. AppData has no streaming read —
    // one host call hands back the whole file — so the reader walks a string
    // already in memory. `terminated` is what the repo uses to spot a torn final
    // record and rewrite the file without it, so the last line's missing newline
    // has to be reported rather than smoothed over.
    openTextLineReader(path) {
      return guarded("read", path, async (full, relative) => {
        if (!(await fs.exists(relative))) return err(notFound(full));
        const text = await fs.readText(relative);
        let at = 0;
        return ok({
          async readLine() {
            if (at >= text.length) return ok(undefined);
            const nl = text.indexOf("\n", at);
            const line = nl === -1 ? text.slice(at) : text.slice(at, nl);
            at = nl === -1 ? text.length : nl + 1;
            return ok({ text: line, terminated: nl !== -1 });
          },
          async close() {},
        });
      });
    },

    // Reads the whole file and then cuts. The interface allows stopping early
    // and AppData cannot: a read is one host call that hands back the bytes.
    // The one caller wants the first line of a session file to learn its
    // header, and a session file is the app's own log, not a stranger's.
    readTextLines(path, options) {
      return guarded("read", path, async (full, relative) => {
        if (!(await fs.exists(relative))) return err(notFound(full));
        const lines = (await fs.readText(relative)).split("\n");
        if (lines[lines.length - 1] === "") lines.pop();
        return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines));
      });
    },

    // Atomic, because a session file is the only record of a run in progress
    // and this is the call that rewrites one whole (the repo stages a snapshot
    // here and renames it into place). appData.writeAtomic creates the parent
    // directories itself; appData.writeBytes does not, so the byte path makes
    // them, which is the one asymmetry between the two branches.
    writeFile(path, content) {
      return guarded("write", path, async (_full, relative) => {
        if (typeof content === "string") await fs.writeAtomic(relative, content);
        else {
          const slash = relative.lastIndexOf("/");
          if (slash > 0) await fs.mkdirp(relative.slice(0, slash));
          await fs.writeBytes(relative, content);
        }
        return ok(undefined);
      });
    },

    // The hot path: one transaction is one line appended. An O_APPEND of a
    // short line is already all-or-nothing, and the atomic writer would rewrite
    // the whole session to add to it (atomic-fs.ts says the same thing about
    // the event log).
    appendFile(path, content) {
      return guarded("append", path, async (_full, relative) => {
        const text = typeof content === "string" ? content : new TextDecoder().decode(content);
        await fs.appendText(relative, text);
        return ok(undefined);
      });
    },

    renameFile(sourcePath, destinationPath) {
      return guarded("rename", sourcePath, async (full, relative) => {
        const target = inside(destinationPath);
        if ("error" in target) return err(target.error);
        if (!(await fs.exists(relative))) return err(notFound(full));
        await fs.rename(relative, toAppData(target.path));
        return ok(undefined);
      });
    },

    fileInfo(path) {
      return guarded("stat", path, async (full, relative) => {
        const info = await fs.stat(relative);
        if (!info) return err(notFound(full));
        const kind = await kindOf(relative);
        return ok({
          name: basename(full),
          path: full,
          kind,
          size: kind === "directory" ? 0 : info.size,
          mtimeMs: info.mtimeMs,
        } satisfies PiFileInfo);
      });
    },

    // Name, kind and path only. A listing that stat-ed every child would cost
    // one host call per file to fill in fields the session repo never reads —
    // it filters the listing by kind and by name and then opens what it wants.
    listDir(path) {
      return guarded("list", path, async (full, relative) => {
        if (!(await fs.exists(relative))) return err(notFound(full));
        const entries = await fs.readDir(relative);
        return ok(
          entries.map((e) => ({
            name: e.name,
            path: `${full === "/" ? "" : full}/${e.name}`,
            kind: e.isDirectory ? ("directory" as const) : ("file" as const),
            size: 0,
            mtimeMs: 0,
          })),
        );
      });
    },

    exists(path) {
      return guarded("check", path, async (_full, relative) => ok(await fs.exists(relative)));
    },

    // Always recursive, like appData.mkdirp: a directory whose parent is
    // missing is nobody's intent, and the repo creates a session directory two
    // levels down on a store that may not exist yet.
    createDir(path) {
      return guarded("create", path, async (_full, relative) => {
        await fs.mkdirp(relative);
        return ok(undefined);
      });
    },

    // `force` is the repo sweeping up a staging file it may already have lost;
    // a path that is not there is then not a failure. Without it, a removal of
    // something missing is, because the caller asked for a file to go away and
    // was told nothing about it.
    remove(path, options) {
      return guarded("remove", path, async (full, relative) => {
        if (!(await fs.exists(relative))) {
          return options?.force ? ok(undefined) : err(notFound(full));
        }
        if (options?.recursive) await fs.removeDir(relative);
        else await fs.remove(relative);
        return ok(undefined);
      });
    },

    // --- the five nothing here calls ---------------------------------------

    async readBinaryFile(_path) {
      return err(unsupported("readBinaryFile", NOT_MOUNTED));
    },

    async canonicalPath(_path) {
      return err(
        unsupported(
          "canonicalPath",
          "AppData as this app addresses it has no symlinks, so a canonical path would be " +
            "absolutePath under another name, and a caller asking for one is asking about a " +
            "filesystem this is not",
        ),
      );
    },

    async createTempDir() {
      return err(unsupported("createTempDir", "AppData has no scratch area and nothing sweeps one"));
    },

    async createTempFile() {
      return err(
        unsupported("createTempFile", "AppData has no scratch area and nothing sweeps one"),
      );
    },

    // The one of the five that cannot report anything: it returns void and the
    // interface forbids it throwing. There is nothing to release — every call
    // above is a host call that has already finished.
    async cleanup() {},
  };
}
