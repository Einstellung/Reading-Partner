// Register the deep-link URL schemes in the generated iOS Info.plist, and prove
// they are still in the shipped ipa.
//
//   bun scripts/ios-deep-link-plist.ts inject          (after `tauri ios init`)
//   bun scripts/ios-deep-link-plist.ts verify <path>   (an .ipa, a .app, or an Info.plist)
//
// The single source of truth stays src-tauri/tauri.conf.json
// (plugins.deep-link.mobile[].scheme); nothing here knows a scheme literal.
//
// Why this exists: tauri-plugin-deep-link writes CFBundleURLTypes from its
// build.rs, i.e. as a side effect of *compiling that crate*. src-tauri/gen/apple
// is regenerated on every CI run, but a warm Swatinem/rust-cache skips
// recompiling the dependency, so the side effect never replays and the fresh
// Info.plist keeps no URL types at all. Nothing fails: the ipa builds, uploads
// and installs, and Google's OAuth callback then hits a scheme no app claims —
// Safari says the address is invalid and sign-in is dead. Builds 48 and 53
// shipped that way. See docs/pitfall/157-a-cached-crate-never-replays-its-build-script.md.
//
// The injection mirrors what the build script writes (same key layout, one dict
// per mobile entry), so a cold cache that does run the build script produces the
// same file rather than a conflicting one.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

export interface UrlType {
  name: string;
  schemes: string[];
}

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue };

/** The mobile entries as CFBundleURLTypes dicts, mirroring the plugin's build.rs. */
export function deepLinkUrlTypes(conf: unknown): UrlType[] {
  const mobile = (conf as { plugins?: { "deep-link"?: { mobile?: unknown } } })?.plugins?.[
    "deep-link"
  ]?.mobile;
  if (!Array.isArray(mobile)) return [];

  const types: UrlType[] = [];
  for (const entry of mobile as Array<Record<string, unknown>>) {
    // Defaults copied from the plugin's config.rs: an entry with no scheme means
    // https+http, and such an entry is an app link (a Universal Link, carried by
    // an entitlement) unless it says otherwise — no URL scheme to register.
    const declared = Array.isArray(entry?.scheme)
      ? (entry.scheme as unknown[]).filter((s): s is string => typeof s === "string")
      : ["https", "http"];
    const isWebLink = declared.some((s) => s === "https" || s === "http");
    const appLink =
      typeof entry?.appLink === "boolean"
        ? entry.appLink
        : isWebLink && typeof entry?.host === "string";
    if (appLink) continue;

    const schemes = declared.filter((s) => s !== "https" && s !== "http");
    if (schemes.length === 0) continue;
    types.push({ name: declared[0], schemes });
  }
  return types;
}

/** Every custom scheme the app must claim, flattened. */
export function requiredSchemes(conf: unknown): string[] {
  return deepLinkUrlTypes(conf).flatMap((t) => t.schemes);
}

/** Every scheme a parsed Info.plist actually claims. */
export function schemesInPlist(plist: PlistValue): string[] {
  const types = (plist as { CFBundleURLTypes?: PlistValue })?.CFBundleURLTypes;
  if (!Array.isArray(types)) return [];
  const out: string[] = [];
  for (const type of types) {
    const schemes = (type as { CFBundleURLSchemes?: PlistValue })?.CFBundleURLSchemes;
    if (!Array.isArray(schemes)) continue;
    for (const scheme of schemes) if (typeof scheme === "string") out.push(scheme);
  }
  return out;
}

/** The required schemes this plist does not claim. Empty means the build is sound. */
export function missingSchemes(plist: PlistValue, required: string[]): string[] {
  const present = new Set(schemesInPlist(plist));
  return required.filter((s) => !present.has(s));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function urlTypesBlock(types: UrlType[], indent: string): string {
  const i2 = indent + "\t";
  const i3 = i2 + "\t";
  const i4 = i3 + "\t";
  const dicts = types.map((type) => {
    const schemes = type.schemes.map((s) => `${i4}<string>${escapeXml(s)}</string>`).join("\n");
    return [
      `${i2}<dict>`,
      `${i3}<key>CFBundleURLSchemes</key>`,
      `${i3}<array>`,
      schemes,
      `${i3}</array>`,
      `${i3}<key>CFBundleURLName</key>`,
      `${i3}<string>${escapeXml(type.name)}</string>`,
      `${i2}</dict>`,
    ].join("\n");
  });
  return [
    `${indent}<key>CFBundleURLTypes</key>`,
    `${indent}<array>`,
    ...dicts,
    `${indent}</array>`,
  ].join("\n");
}

const TAG = /<(\/?)([A-Za-z0-9_:.-]+)([^>]*?)(\/?)>/g;

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  start: number;
  end: number;
}

function scanTags(text: string): Tag[] {
  const tags: Tag[] = [];
  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m !== null; m = TAG.exec(text)) {
    tags.push({
      name: m[2],
      closing: m[1] === "/",
      selfClosing: m[4] === "/",
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return tags;
}

/**
 * Replace the CFBundleURLTypes entry of an XML plist, or append one. Idempotent:
 * the existing entry (whoever wrote it) is dropped whole before the new one goes
 * in, so a second run — or a cold-cache build script run — leaves one entry, not
 * two conflicting ones.
 */
export function injectUrlTypes(xml: string, types: UrlType[]): string {
  const bare = xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const tags = scanTags(bare);

  let text = xml;
  const keyAt = tags.findIndex(
    (t, i) =>
      t.name === "key" &&
      !t.closing &&
      !t.selfClosing &&
      bare.slice(t.end, tags[i + 1]?.start ?? t.end).trim() === "CFBundleURLTypes",
  );
  if (keyAt >= 0) {
    // From <key> to the end of the value that follows its </key>: walk the tag
    // stream with a depth counter so a nested <array>/<dict> cannot end it early.
    const valueStart = keyAt + 2; // the </key> then the value's opening tag
    let depth = 0;
    let last = -1;
    for (let i = valueStart; i < tags.length; i++) {
      const tag = tags[i];
      if (tag.selfClosing) {
        if (depth === 0) {
          last = i;
          break;
        }
      } else if (tag.closing) {
        depth -= 1;
        if (depth === 0) {
          last = i;
          break;
        }
      } else {
        depth += 1;
      }
    }
    if (last < 0) throw new Error("Info.plist: CFBundleURLTypes has no closing tag");
    // Take the whole lines the entry sits on, so no blank indentation is left.
    const from = text.lastIndexOf("\n", tags[keyAt].start) + 1;
    let to = tags[last].end;
    if (text[to] === "\n") to += 1;
    text = text.slice(0, from) + text.slice(to);
  }

  if (types.length === 0) return text;

  // Insert just before the root dict closes.
  const closeDict = text.lastIndexOf("</dict>");
  if (closeDict < 0) throw new Error("Info.plist: no <dict> to insert into");
  const lineStart = text.lastIndexOf("\n", closeDict) + 1;
  const own = text.slice(lineStart, closeDict);
  const indent = /^\s*$/.test(own) ? own : "";
  const at = indent === own ? lineStart : closeDict;
  return text.slice(0, at) + urlTypesBlock(types, indent + "\t") + "\n" + text.slice(at);
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9A-Fa-f]+|amp|lt|gt|quot|apos);/g, (whole, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        if (entity.startsWith("#x") || entity.startsWith("#X"))
          return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
        return whole;
    }
  });
}

/** Enough of the XML plist grammar to read an Info.plist. */
export function parseXmlPlist(text: string): PlistValue {
  const bare = text.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
  const tags = scanTags(bare);
  const rootAt = tags.findIndex((t) => t.name === "plist" && !t.closing);
  if (rootAt < 0) throw new Error("not an XML plist: no <plist> element");

  let at = rootAt + 1;

  function content(open: Tag): string {
    const close = tags[at];
    if (!close || !close.closing || close.name !== open.name)
      throw new Error(`XML plist: <${open.name}> is not closed`);
    at += 1;
    return unescapeXml(bare.slice(open.end, close.start));
  }

  function value(): PlistValue {
    const tag = tags[at];
    if (!tag) throw new Error("XML plist: value expected");
    at += 1;
    if (tag.selfClosing) {
      if (tag.name === "true") return true;
      if (tag.name === "false") return false;
      if (tag.name === "array") return [];
      if (tag.name === "dict") return {};
      if (tag.name === "string") return "";
      throw new Error(`XML plist: unsupported empty <${tag.name}/>`);
    }
    switch (tag.name) {
      case "dict": {
        const dict: { [key: string]: PlistValue } = {};
        while (tags[at] && !(tags[at].closing && tags[at].name === "dict")) {
          const keyTag = tags[at];
          if (keyTag.name !== "key" || keyTag.closing)
            throw new Error("XML plist: <key> expected inside <dict>");
          at += 1;
          const key = content(keyTag);
          dict[key] = value();
        }
        at += 1;
        return dict;
      }
      case "array": {
        const array: PlistValue[] = [];
        while (tags[at] && !(tags[at].closing && tags[at].name === "array")) array.push(value());
        at += 1;
        return array;
      }
      case "string":
        return content(tag);
      case "integer":
        return parseInt(content(tag).trim(), 10);
      case "real":
        return parseFloat(content(tag).trim());
      case "date":
        return new Date(content(tag).trim());
      case "data": {
        const binary = atob(content(tag).replace(/\s+/g, ""));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }
      case "true":
        content(tag);
        return true;
      case "false":
        content(tag);
        return false;
      default:
        throw new Error(`XML plist: unsupported element <${tag.name}>`);
    }
  }

  return value();
}

/**
 * The binary plist an ipa carries (Xcode compiles every bundled plist to
 * bplist00, so the shipped file is never the XML we wrote).
 */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!magic.startsWith("bplist")) throw new Error("not a binary plist");

  const trailer = bytes.byteLength - 32;
  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const count = Number(view.getBigUint64(trailer + 8));
  const top = Number(view.getBigUint64(trailer + 16));
  const tableAt = Number(view.getBigUint64(trailer + 24));

  function uint(at: number, size: number): number {
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + bytes[at + i];
    return n;
  }

  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(uint(tableAt + i * offsetSize, offsetSize));

  function object(index: number): PlistValue {
    const at = offsets[index];
    if (at === undefined) throw new Error(`binary plist: no object ${index}`);
    const marker = bytes[at];
    const kind = marker >> 4;
    const low = marker & 0x0f;

    // A length of 0xf means the count is the integer object that follows.
    function sized(): { length: number; body: number } {
      if (low !== 0x0f) return { length: low, body: at + 1 };
      const intMarker = bytes[at + 1];
      if (intMarker >> 4 !== 0x1) throw new Error("binary plist: bad extended length");
      const width = 1 << (intMarker & 0x0f);
      return { length: uint(at + 2, width), body: at + 2 + width };
    }

    switch (kind) {
      case 0x0:
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        throw new Error(`binary plist: unsupported marker 0x${marker.toString(16)}`);
      case 0x1: {
        const width = 1 << low;
        // 16-byte integers are signed and rare in an Info.plist; read the low half.
        return width === 8 ? Number(view.getBigInt64(at + 1)) : uint(at + 1, width);
      }
      case 0x2:
        return low === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      case 0x3:
        // Seconds since 2001-01-01 UTC.
        return new Date((view.getFloat64(at + 1) + 978307200) * 1000);
      case 0x4: {
        const { length, body } = sized();
        return bytes.slice(body, body + length);
      }
      case 0x5: {
        const { length, body } = sized();
        return new TextDecoder("ascii").decode(bytes.subarray(body, body + length));
      }
      case 0x6: {
        const { length, body } = sized();
        let s = "";
        for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint16(body + i * 2));
        return s;
      }
      case 0x8: {
        const width = low + 1;
        return uint(at + 1, width);
      }
      case 0xa:
      case 0xc: {
        const { length, body } = sized();
        const array: PlistValue[] = [];
        for (let i = 0; i < length; i++) array.push(object(uint(body + i * refSize, refSize)));
        return array;
      }
      case 0xd: {
        const { length, body } = sized();
        const dict: { [key: string]: PlistValue } = {};
        for (let i = 0; i < length; i++) {
          const key = object(uint(body + i * refSize, refSize));
          const val = object(uint(body + (length + i) * refSize, refSize));
          if (typeof key !== "string") throw new Error("binary plist: non-string dict key");
          dict[key] = val;
        }
        return dict;
      }
      default:
        throw new Error(`binary plist: unsupported type 0x${kind.toString(16)}`);
    }
  }

  return object(top);
}

/** Either plist encoding; the ipa carries binary, the generated project XML. */
export function parsePlist(bytes: Uint8Array): PlistValue {
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head.startsWith("bplist")) return parseBinaryPlist(bytes);
  return parseXmlPlist(new TextDecoder().decode(bytes));
}

// ---------------------------------------------------------------- CLI

function loadConf(): unknown {
  return JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
}

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

/** Every generated iOS project's Info.plist (`gen/apple/<app>_iOS/Info.plist`). */
function generatedPlists(): string[] {
  const apple = join(ROOT, "src-tauri/gen/apple");
  let entries: string[];
  try {
    entries = readdirSync(apple);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith("_iOS"))
    .map((name) => join(apple, name, "Info.plist"))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    });
}

function run(command: string[]): Uint8Array {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    fail(`${command.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
  return new Uint8Array(result.stdout);
}

/** Read Payload/<app>.app/Info.plist out of an ipa without unpacking it. */
function plistFromIpa(ipa: string): Uint8Array {
  const listing = new TextDecoder().decode(run(["unzip", "-Z1", ipa]));
  const entries = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(line));
  if (entries.length === 0) fail(`${ipa}: no Payload/*.app/Info.plist inside`);
  if (entries.length > 1) fail(`${ipa}: ${entries.length} app bundles inside: ${entries.join(", ")}`);
  return run(["unzip", "-p", ipa, entries[0]]);
}

function plistAt(target: string): Uint8Array {
  if (target.endsWith(".ipa")) return plistFromIpa(target);
  const path = target.endsWith(".app") ? join(target, "Info.plist") : target;
  return new Uint8Array(readFileSync(path));
}

function inject(): void {
  const conf = loadConf();
  const types = deepLinkUrlTypes(conf);
  if (types.length === 0) fail("tauri.conf.json declares no deep-link scheme to register");

  const plists = generatedPlists();
  if (plists.length === 0) fail("no src-tauri/gen/apple/*_iOS/Info.plist — run `tauri ios init` first");

  for (const path of plists) {
    const injected = injectUrlTypes(readFileSync(path, "utf8"), types);
    writeFileSync(path, injected);
    const missing = missingSchemes(parseXmlPlist(injected), requiredSchemes(conf));
    if (missing.length > 0) fail(`${path}: injection did not take: ${missing.join(", ")}`);
    console.log(`${path}: registered ${requiredSchemes(conf).join(", ")}`);
  }
}

function verify(target: string): void {
  const required = requiredSchemes(loadConf());
  if (required.length === 0) fail("tauri.conf.json declares no deep-link scheme to verify");

  const plist = parsePlist(plistAt(target));
  const present = schemesInPlist(plist);
  console.log(`${target}: CFBundleURLSchemes = ${present.length > 0 ? present.join(", ") : "(none)"}`);

  const missing = missingSchemes(plist, required);
  if (missing.length > 0) {
    fail(
      `${target} does not claim ${missing.join(", ")} — OAuth callbacks would land nowhere. ` +
        "See docs/pitfall/157-a-cached-crate-never-replays-its-build-script.md.",
    );
  }
  console.log(`deep-link schemes present: ${required.join(", ")}`);
}

if (import.meta.main) {
  const [command, target] = process.argv.slice(2);
  if (command === "inject") inject();
  else if (command === "verify") {
    if (!target) fail("usage: bun scripts/ios-deep-link-plist.ts verify <ipa|app|Info.plist>");
    verify(target);
  } else {
    fail("usage: bun scripts/ios-deep-link-plist.ts inject | verify <ipa|app|Info.plist>");
  }
}
