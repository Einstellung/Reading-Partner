// Prove the shipped ipa still claims the formats the reader opens.
//
//   bun scripts/ios-document-types.ts verify <path>   (an .ipa, a .app, or an Info.plist)
//
// The source of truth is src-tauri/Info.ios.plist (CFBundleDocumentTypes);
// nothing here knows a UTI literal.
//
// Why this exists: unlike the deep-link schemes there is no injection step to
// get wrong — the keys are written by hand and merged into the generated
// Info.plist at build time (docs/pitfall/184). What there is no way to see is
// whether the merge happened: `tauri ios init` produces a plist without them,
// so grepping gen/apple proves nothing, and a build that quietly dropped them
// still builds, uploads and installs. It fails only on a device, as the app
// missing from the share sheet — no error anywhere.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fail,
  parsePlist,
  parseXmlPlist,
  plistAt,
  type PlistValue,
} from "./ios-deep-link-plist";

const ROOT = new URL("../", import.meta.url).pathname;

/** Every UTI a parsed plist claims to open, across all its document types. */
export function contentTypesInPlist(plist: PlistValue): string[] {
  const types = (plist as { CFBundleDocumentTypes?: PlistValue })?.CFBundleDocumentTypes;
  if (!Array.isArray(types)) return [];
  const out: string[] = [];
  for (const type of types) {
    const utis = (type as { LSItemContentTypes?: PlistValue })?.LSItemContentTypes;
    if (!Array.isArray(utis)) continue;
    for (const uti of utis) if (typeof uti === "string") out.push(uti);
  }
  return out;
}

/** The required UTIs this plist does not claim. Empty means the build is sound. */
export function missingContentTypes(plist: PlistValue, required: string[]): string[] {
  const present = new Set(contentTypesInPlist(plist));
  return required.filter((uti) => !present.has(uti));
}

// ---------------------------------------------------------------- CLI

function requiredContentTypes(): string[] {
  const source = readFileSync(join(ROOT, "src-tauri/Info.ios.plist"), "utf8");
  return contentTypesInPlist(parseXmlPlist(source));
}

function verify(target: string): void {
  const required = requiredContentTypes();
  if (required.length === 0) fail("src-tauri/Info.ios.plist declares no document type to verify");

  const plist = parsePlist(plistAt(target));
  const present = contentTypesInPlist(plist);
  console.log(
    `${target}: LSItemContentTypes = ${present.length > 0 ? present.join(", ") : "(none)"}`,
  );

  const missing = missingContentTypes(plist, required);
  if (missing.length > 0) {
    fail(
      `${target} does not claim ${missing.join(", ")} — the share sheet and Files would not ` +
        "offer this app for one. See docs/pitfall/184-info-ios-plist-merges-at-build-time.md.",
    );
  }
  console.log(`document types present: ${required.join(", ")}`);
}

if (import.meta.main) {
  const [command, target] = process.argv.slice(2);
  if (command === "verify") {
    if (!target) fail("usage: bun scripts/ios-document-types.ts verify <ipa|app|Info.plist>");
    verify(target);
  } else {
    fail("usage: bun scripts/ios-document-types.ts verify <ipa|app|Info.plist>");
  }
}
