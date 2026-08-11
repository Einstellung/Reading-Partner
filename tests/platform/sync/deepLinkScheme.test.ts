// The mobile OAuth redirect lives in two files that no compiler relates: the
// client id is injected into the Vite build by a workflow, and its reversed form
// is registered as a deep-link scheme in tauri.conf.json (which generates the iOS
// CFBundleURLTypes and the Android intent-filter). If they drift, authorization
// still succeeds and the redirect then lands nowhere — the app just never comes
// back. Assert they agree for the builds we actually ship. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { reversedClientId } from "../../../src/platform/sync/authFlow";

const root = new URL("../../../", import.meta.url).pathname;

function schemes(): string[] {
  const conf = JSON.parse(readFileSync(`${root}src-tauri/tauri.conf.json`, "utf8"));
  return conf.plugins["deep-link"].mobile.flatMap((m: { scheme: string[] }) => m.scheme);
}

// The workflows write the client id literally (it is public: a mobile OAuth client
// has no secret and is bound to the bundle/package identity, PKCE does the rest).
function clientIdFromWorkflow(file: string, variable: string): string {
  const yaml = readFileSync(`${root}.github/workflows/${file}`, "utf8");
  const hit = yaml.match(new RegExp(`^\\s*${variable}:\\s*(\\S+)\\s*$`, "m"));
  expect(hit).not.toBeNull();
  return hit![1];
}

test("the Android APK build's client id is registered as a deep-link scheme", () => {
  const id = clientIdFromWorkflow("android-apk.yml", "VITE_GOOGLE_ANDROID_CLIENT_ID");
  expect(schemes()).toContain(reversedClientId(id));
});

test("the iOS builds' client id is still registered alongside it", () => {
  for (const wf of ["ios-testflight.yml", "ios-sideload-ipa.yml"]) {
    const id = clientIdFromWorkflow(wf, "VITE_GOOGLE_IOS_CLIENT_ID");
    expect(schemes()).toContain(reversedClientId(id));
  }
});

test("no mobile workflow bakes in the desktop client secret", () => {
  for (const wf of ["android-apk.yml", "ios-testflight.yml", "ios-sideload-ipa.yml"]) {
    const yaml = readFileSync(`${root}.github/workflows/${wf}`, "utf8");
    const assigned = yaml.match(/^\s*VITE_GOOGLE_CLIENT_SECRET:\s*(\S+)\s*$/m);
    // iOS may pass it through from a repo secret; a literal value would be a leak.
    if (assigned) expect(assigned[1]).toMatch(/^\$\{\{\s*secrets\./);
  }
});

test("the Android APK build does not bake in the desktop client at all", () => {
  const yaml = readFileSync(`${root}.github/workflows/android-apk.yml`, "utf8");
  expect(yaml).not.toMatch(/^\s*VITE_GOOGLE_CLIENT_ID:/m);
  expect(yaml).not.toMatch(/^\s*VITE_GOOGLE_CLIENT_SECRET:/m);
});
