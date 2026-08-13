// The sim bridge asks vite not to serve its token file. It used to ask through
// the `config()` hook, which cost every other secret in the project: vite
// resolves the field as `server.fs?.deny || [".env", ".env.*", "*.{crt,pem}"]`,
// so a supplied list is the whole list and the three defaults are gone —
// `GET /.env` came back 200 with the body and a plaintext sourcemap of it.
// The ask now happens in `configResolved`, on the array vite already resolved.
// Live proof is two dev servers in docs/pitfall/124; this is the unit fence.
// Run: bun test.

import { expect, test } from "bun:test";
import { simBridge } from "../scripts/sim-bridge";
import { resolvedConfig, VITE_DEFAULT_DENY } from "./sim-bridge-harness";

function denyAfterResolve(host: string | boolean | undefined = undefined): string[] {
  const plugin = simBridge();
  const config = resolvedConfig(host);
  (plugin.configResolved as (c: unknown) => void)(config);
  return config.server.fs.deny;
}

test("the plugin never hands vite a deny list through config()", () => {
  // A `config()` hook returning `server.fs.deny` replaces the defaults no
  // matter how the returned object is shaped, so the hook must not carry one.
  const plugin = simBridge();
  const config = plugin.config as ((...args: unknown[]) => unknown) | undefined;
  const returned = config?.({}, { command: "serve", mode: "development" }) as
    | { server?: { fs?: { deny?: unknown } } }
    | undefined;
  expect(returned?.server?.fs?.deny).toBeUndefined();
});

test("vite's three defaults survive the plugin", () => {
  const deny = denyAfterResolve();
  for (const pattern of VITE_DEFAULT_DENY) expect(deny).toContain(pattern);
});

test("the token patterns are added on top", () => {
  const deny = denyAfterResolve();
  expect(deny).toContain("**/.sim-bridge/**");
  expect(deny).toContain("**/sim-bridge/*/token");
  expect(deny.length).toBe(VITE_DEFAULT_DENY.length + 2);
});

test("a checkout that set its own deny list keeps it", () => {
  // Same code path: by configResolved the array holds whatever vite settled on,
  // so a project's own patterns are added to rather than thrown away.
  const plugin = simBridge();
  const config = { server: { host: undefined, port: 1420, fs: { deny: ["secrets/**"] } } };
  (plugin.configResolved as (c: unknown) => void)(config);
  expect(config.server.fs.deny).toEqual(["secrets/**", "**/.sim-bridge/**", "**/sim-bridge/*/token"]);
});

test("the deny list is asked for even on a host that turns the channel off", () => {
  // configResolved returns early once it decides the bridge is off; the push
  // has to happen before that, or the token file is denied only when the
  // channel that writes it happens to be enabled.
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(denyAfterResolve(true)).toContain("**/.sim-bridge/**");
  } finally {
    console.warn = warn;
  }
});
