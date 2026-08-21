// The mobile OAuth redirect lives in two files that no compiler relates: the
// client id is injected into the Vite build by a workflow, and its reversed form
// is registered as a deep-link scheme in tauri.conf.json (which generates the iOS
// CFBundleURLTypes and the Android intent-filter). If they drift, authorization
// still succeeds and the redirect then lands nowhere — the app just never comes
// back. Assert they agree for the builds we actually ship. Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { reversedClientId } from "../../../src/platform/sync/authFlow";
import type { PlistValue } from "../../../scripts/ios-deep-link-plist";
import {
  deepLinkUrlTypes,
  injectUrlTypes,
  missingSchemes,
  parseBinaryPlist,
  parsePlist,
  parseXmlPlist,
  requiredSchemes,
  schemesInPlist,
} from "../../../scripts/ios-deep-link-plist";

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

// The other half of the same joint: a scheme in tauri.conf.json only reaches the
// device if it is in the shipped Info.plist. It used to get there as a side
// effect of compiling tauri-plugin-deep-link, which a warm CI cache skips (see
// docs/pitfall/157), so the iOS workflows now write it themselves and assert it
// back out of the ipa. What follows covers the pure halves of
// scripts/ios-deep-link-plist.ts.

// What `tauri ios init` leaves behind, trimmed to the shape that matters.
const GENERATED_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>en</string>
\t<key>CFBundleIdentifier</key>
\t<string>com.xinyuan.readingpartner</string>
\t<key>UISupportedInterfaceOrientations</key>
\t<array>
\t\t<string>UIInterfaceOrientationPortrait</string>
\t\t<string>UIInterfaceOrientationLandscapeLeft</string>
\t</array>
\t<key>ITSAppUsesNonExemptEncryption</key>
\t<false/>
</dict>
</plist>
`;

// Written by python3's plistlib, the same bplist00 format Xcode compiles a
// bundled plist into, so the parser is read against a real one.
const BINARY_WITH_SCHEMES =
  "YnBsaXN0MDDXAQIDBAUGBwgJChESExRfEBJDRkJ1bmRsZUlkZW50aWZpZXJfEBpDRkJ1bmRsZVNob3J0VmVyc2lvblN0cmluZ18QEENGQnVuZGxlVVJMVHlwZXNfEA9DRkJ1bmRsZVZlcnNpb25fEB1JVFNBcHBVc2VzTm9uRXhlbXB0RW5jcnlwdGlvbl8QEE1pbmltdW1PU1ZlcnNpb25fEBxVSVJlcXVpcmVkRGV2aWNlQ2FwYWJpbGl0aWVzXxAaY29tLnhpbnl1YW4ucmVhZGluZ3BhcnRuZXJWMC4xMC4xoQvSDA0OD18QD0NGQnVuZGxlVVJMTmFtZV8QEkNGQnVuZGxlVVJMU2NoZW1lc18QHmNvbS5nb29nbGV1c2VyY29udGVudC5hcHBzLmFhYaIOEF8QHmNvbS5nb29nbGV1c2VyY29udGVudC5hcHBzLmJiYlI1MwhUMTYuMKEVVWFybTY0AAgAFwAsAEkAXABuAI4AoQDAAN0A5ADmAOsA/QESATMBNgFXAVoBWwFgAWIAAAAAAAACAQAAAAAAAAAWAAAAAAAAAAAAAAAAAAABaA==";

// The same plist as builds 48 and 53 shipped it: everything except that key.
const BINARY_WITHOUT_SCHEMES =
  "YnBsaXN0MDDWAQIDBAUGBwgJCgsMXxASQ0ZCdW5kbGVJZGVudGlmaWVyXxAaQ0ZCdW5kbGVTaG9ydFZlcnNpb25TdHJpbmdfEA9DRkJ1bmRsZVZlcnNpb25fEB1JVFNBcHBVc2VzTm9uRXhlbXB0RW5jcnlwdGlvbl8QEE1pbmltdW1PU1ZlcnNpb25fEBxVSVJlcXVpcmVkRGV2aWNlQ2FwYWJpbGl0aWVzXxAaY29tLnhpbnl1YW4ucmVhZGluZ3BhcnRuZXJWMC4xMC4xUjUzCFQxNi4woQ1VYXJtNjQIFSpHWXmMq8jP0tPY2gAAAAAAAAEBAAAAAAAAAA4AAAAAAAAAAAAAAAAAAADg";

function plistBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function conf(): unknown {
  return JSON.parse(readFileSync(`${root}src-tauri/tauri.conf.json`, "utf8"));
}

test("what gets registered comes from tauri.conf.json and nowhere else", () => {
  expect(requiredSchemes(conf())).toEqual(schemes());
});

test("app links and web schemes are not URL types", () => {
  const fake = {
    plugins: {
      "deep-link": {
        mobile: [
          { scheme: ["com.example.app", "https"], appLink: false },
          { scheme: ["https"], host: "example.com" }, // a Universal Link: entitlement, not scheme
          { host: "implicit.example.com" }, // no scheme at all defaults to https+http
        ],
      },
    },
  };
  expect(deepLinkUrlTypes(fake)).toEqual([
    { name: "com.example.app", schemes: ["com.example.app"] },
  ]);
  expect(requiredSchemes({})).toEqual([]);
});

test("injecting registers every scheme and touches nothing else", () => {
  const injected = injectUrlTypes(GENERATED_PLIST, deepLinkUrlTypes(conf()));
  const plist = parseXmlPlist(injected);
  const dict = plist as Record<string, PlistValue>;

  expect(missingSchemes(plist, requiredSchemes(conf()))).toEqual([]);
  expect(dict.CFBundleIdentifier).toBe("com.xinyuan.readingpartner");
  expect(dict.ITSAppUsesNonExemptEncryption).toBe(false);
  expect(dict.UISupportedInterfaceOrientations).toEqual([
    "UIInterfaceOrientationPortrait",
    "UIInterfaceOrientationLandscapeLeft",
  ]);
});

test("injecting twice, or over what the build script wrote, leaves one entry", () => {
  const types = [{ name: "com.example.app", schemes: ["com.example.app"] }];
  const once = injectUrlTypes(GENERATED_PLIST, types);
  expect(injectUrlTypes(once, types)).toBe(once);

  // A cold cache does run the plugin's build.rs, which writes its own entry;
  // ours must replace it, not sit beside a second CFBundleURLTypes key.
  const stale = injectUrlTypes(GENERATED_PLIST, [
    { name: "com.stale.app", schemes: ["com.stale.app"] },
  ]);
  const rewritten = injectUrlTypes(stale, types);
  expect(rewritten.match(/CFBundleURLTypes/g)?.length).toBe(1);
  expect(schemesInPlist(parseXmlPlist(rewritten))).toEqual(["com.example.app"]);
});

test("a shipped plist without the key is reported missing, not read as fine", () => {
  const shipped = parseBinaryPlist(plistBytes(BINARY_WITHOUT_SCHEMES));
  expect(schemesInPlist(shipped)).toEqual([]);
  expect(missingSchemes(shipped, ["com.googleusercontent.apps.aaa"])).toEqual([
    "com.googleusercontent.apps.aaa",
  ]);
});

test("the binary plist an ipa carries is read back", () => {
  const shipped = parsePlist(plistBytes(BINARY_WITH_SCHEMES));
  const dict = shipped as Record<string, PlistValue>;
  expect(schemesInPlist(shipped)).toEqual([
    "com.googleusercontent.apps.aaa",
    "com.googleusercontent.apps.bbb",
  ]);
  expect(missingSchemes(shipped, ["com.googleusercontent.apps.bbb"])).toEqual([]);
  expect(dict.CFBundleVersion).toBe("53");
  expect(dict.ITSAppUsesNonExemptEncryption).toBe(false);
});
