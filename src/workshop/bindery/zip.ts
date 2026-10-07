// Reading entries out of an EPUB container. An EPUB is a zip file, and every
// part of it — the package document, the navigation document, each spine
// document, each image — is one entry read by its archive-relative path.
//
// fflate (MIT, no dependencies) does the inflating. It is used in two modes and
// the split matters on a 71 MB book: the whole archive is never inflated at
// once. The markup entries (a fraction of a percent of the bytes) are inflated
// eagerly, because parsing needs all of them; the images are inflated one at a
// time, when something asks for one. A filtered unzipSync still walks the
// central directory, which is cheap, and inflates only what the filter accepts.

import { unzipSync } from "fflate";

// Entries inflated up front: everything the parse reads. Matched on the name's
// extension, lower-cased, plus the two fixed names the format defines.
const MARKUP_EXTENSIONS = new Set(["xhtml", "html", "htm", "xml", "ncx", "opf", "css"]);
const FIXED_NAMES = new Set(["mimetype", "META-INF/container.xml"]);

function isMarkup(name: string): boolean {
  if (FIXED_NAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return MARKUP_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export interface ZipEntry {
  name: string;
  /** Uncompressed size in bytes, off the central directory. */
  size: number;
}

export interface EpubZip {
  /** Every entry in the archive, in central-directory order. */
  entries: readonly ZipEntry[];
  has(name: string): boolean;
  /** An eagerly inflated markup entry decoded as UTF-8, or null when absent. */
  text(name: string): string | null;
  /** Any entry's bytes, inflated on demand. Null when the entry is absent. */
  bytes(name: string): Uint8Array | null;
}

const utf8 = new TextDecoder("utf-8");

// The BOM a Windows-authored XHTML file can start with. An XML parser handed one
// reports a fatal error at the document's first character, so it comes off here
// rather than being diagnosed five layers up.
function decodeText(bytes: Uint8Array): string {
  const s = utf8.decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function openZip(archive: Uint8Array): EpubZip {
  const entries: ZipEntry[] = [];
  const markup = unzipSync(archive, {
    filter: (file) => {
      entries.push({ name: file.name, size: file.originalSize ?? 0 });
      return isMarkup(file.name);
    },
  });
  const names = new Set(entries.map((e) => e.name));
  const lazy = new Map<string, Uint8Array>();

  return {
    entries,
    has: (name) => names.has(name),
    text: (name) => {
      const found = markup[name];
      return found ? decodeText(found) : null;
    },
    bytes: (name) => {
      if (!names.has(name)) return null;
      const eager = markup[name];
      if (eager) return eager;
      const cached = lazy.get(name);
      if (cached) return cached;
      const out = unzipSync(archive, { filter: (f) => f.name === name })[name];
      if (!out) return null;
      lazy.set(name, out);
      return out;
    },
  };
}

// Resolve an archive-relative reference (an OPF manifest href, an <img src>)
// against the entry it appeared in, and strip any fragment. Zip paths carry no
// scheme and no host, so the walk is done here rather than by handing a URL
// parser a fake origin.
export function resolveZipPath(fromEntry: string, href: string): string {
  const clean = href.split("#")[0];
  if (clean === "") return fromEntry;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // A stray "%" in a filename is not an escape; the raw name is the entry.
  }
  const stack = clean.startsWith("/") ? [] : fromEntry.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** The fragment of a href ("chap1.xhtml#p42" -> "p42"), or null. */
export function hrefFragment(href: string): string | null {
  const hash = href.indexOf("#");
  if (hash < 0 || hash === href.length - 1) return null;
  return decodeURIComponent(href.slice(hash + 1));
}
