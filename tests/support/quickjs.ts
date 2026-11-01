// The QuickJS engine for tests that run run_code (legion/codemode): read from
// the installed quickjs-wasi package, where the app fetches its self-hosted copy.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

let compiled: Promise<WebAssembly.Module> | undefined;

export function testQuickJsWasm(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm")));
  return compiled;
}
