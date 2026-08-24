// The argument names of the two Rust filesystem commands, read off both sides
// and compared. src-tauri/src/atomic_fs.rs declares them; the invoke calls in
// src/platform/app/appdata.ts spell them as object keys, and nothing between
// the two languages checks that those spellings agree.
//
// Why it has to be its own test. The contract used to be held incidentally, by
// three fake invokes in the suite that destructure `args.path` and
// `args.contents` — remove them, or ban the command names from tests, and
// renaming `contents` on either side leaves the whole suite green and breaks
// only on a device. A rename is exactly the sort of edit that looks safe.
//
// Modelled on tests/layering.test.ts: read the source, say what both sides
// claim, and fail if they stop agreeing.
//
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RUST = fileURLToPath(new URL("../../../src-tauri/src/atomic_fs.rs", import.meta.url));
const PORT = fileURLToPath(new URL("../../../src/platform/app/appdata.ts", import.meta.url));

// Injected by Tauri from the invoke handler, never sent by the caller, so they
// are not part of the argument object.
const INJECTED = /AppHandle|Window|State<|Request<|Channel</;

/**
 * Tauri v2 takes a snake_case Rust parameter as camelCase on the JS side. Both
 * of today's names are one word, so the conversion is a no-op — it is here so
 * that adding a `dry_run` cannot make this test wrong in the quiet direction.
 */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Command name -> the argument names it expects, in declaration order. */
function rustCommands(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g;
  for (const m of source.matchAll(re)) {
    const params = m[2]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !INJECTED.test(p))
      .map((p) => camel(p.split(":")[0].trim()));
    out.set(m[1], params);
  }
  return out;
}

/** Command name -> the keys of the object literal the port passes it. */
function portInvocations(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /invoke(?:<[^>]*>)?\(\s*"([a-z_]+)"\s*,\s*\{([^}]*)\}\s*\)/g;
  for (const m of source.matchAll(re)) {
    const keys = m[2]
      .split(",")
      .map((k) => k.split(":")[0].trim())
      .filter((k) => k.length > 0);
    out.set(m[1], keys);
  }
  return out;
}

const rust = rustCommands(readFileSync(RUST, "utf8"));
const port = portInvocations(readFileSync(PORT, "utf8"));

test("both commands are still declared in Rust and still called from the port", () => {
  expect([...rust.keys()].sort()).toEqual(["quarantine_file", "write_text_file_atomic"]);
  expect([...port.keys()].sort()).toEqual(["quarantine_file", "write_text_file_atomic"]);
});

test("write_text_file_atomic is invoked with the parameter names it declares", () => {
  expect(rust.get("write_text_file_atomic")).toEqual(["path", "contents"]);
  expect(port.get("write_text_file_atomic")).toEqual(rust.get("write_text_file_atomic"));
});

test("quarantine_file is invoked with the parameter names it declares", () => {
  expect(rust.get("quarantine_file")).toEqual(["path"]);
  expect(port.get("quarantine_file")).toEqual(rust.get("quarantine_file"));
});

test("no other invoke in the port names a command Rust does not declare", () => {
  for (const command of port.keys()) expect([...rust.keys()]).toContain(command);
});
