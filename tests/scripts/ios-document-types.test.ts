// The document types the ipa must claim (scripts/ios-document-types.ts), read
// off src-tauri/Info.ios.plist and asserted against a built artifact's plist.
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXmlPlist } from "../../scripts/ios-deep-link-plist";
import {
  contentTypesInPlist,
  missingContentTypes,
} from "../../scripts/ios-document-types";

const ROOT = join(import.meta.dir, "../..");

const plist = (body: string) =>
  parseXmlPlist(
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>`,
  );

const DOC_TYPES = `
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>EPUB Book</string>
      <key>LSItemContentTypes</key><array><string>org.idpf.epub-container</string></array>
    </dict>
    <dict>
      <key>CFBundleTypeName</key><string>PDF Document</string>
      <key>LSItemContentTypes</key><array><string>com.adobe.pdf</string></array>
    </dict>
  </array>`;

test("the UTIs are collected across every document type", () => {
  expect(contentTypesInPlist(plist(DOC_TYPES))).toEqual([
    "org.idpf.epub-container",
    "com.adobe.pdf",
  ]);
});

test("a plist with no document types claims nothing", () => {
  expect(contentTypesInPlist(plist("<key>CFBundleName</key><string>x</string>"))).toEqual([]);
});

test("a merge that dropped the key names what is missing", () => {
  const required = ["com.adobe.pdf", "org.idpf.epub-container"];
  expect(missingContentTypes(plist(DOC_TYPES), required)).toEqual([]);
  expect(missingContentTypes(plist("<key>CFBundleName</key><string>x</string>"), required)).toEqual(
    required,
  );
});

// The bundle's own declaration is the source of truth the CI step reads; an
// empty one would make the assertion vacuously pass.
test("Info.ios.plist declares both formats the reader opens", () => {
  const source = readFileSync(join(ROOT, "src-tauri/Info.ios.plist"), "utf8");
  expect(contentTypesInPlist(parseXmlPlist(source)).sort()).toEqual([
    "com.adobe.pdf",
    "org.idpf.epub-container",
  ]);
});
