// Filesystem paths as the host hands them over, and the one place that turns
// them into the form the rest of the app stores and displays.
//
// iOS does not hand over a path: a PDF that arrives through the share sheet or
// the document picker comes in as a percent-encoded file URL
// ("file:///private/var/.../Inbox/%E5%85%A8%E7%90%83....pdf"). Taking the last
// segment of that verbatim put "%E5%85%A8%E7%90%83..." in the library title, the
// topic file name and the notes state (docs/pitfall/106). Everything else hands
// over a plain path.
//
// Pure, so the decoding rules are pinned by tests rather than by an import on a
// device. Nothing here touches the filesystem.

// scheme, an optional host, then the path. A string that does not declare
// itself a file URL is never decoded, so a plain path carrying a literal "%"
// ("/home/x/50%.pdf") comes back untouched.
const FILE_URL = /^file:\/\/([^/]*)(\/.*)$/i;

// A name that could be the output of percent-encoding: printable ASCII, no
// spaces, and at least one escape. Encoding produces exactly that, so a name
// with a space or a non-ASCII character is already readable and is left alone.
const ENCODED_NAME = /^(?=.*%[0-9A-Fa-f]{2})[!-~]+$/;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed escape ("%E5%" or "%zz") keeps its raw text. An import must
    // never fail over a filename.
    return segment;
  }
}

// The path a file reference should be stored under. A file URL loses its scheme
// and its escapes; anything else is returned as it came.
export function normalizeFilePath(raw: string): string {
  const match = FILE_URL.exec(raw);
  if (!match) return raw;
  const [, host, encoded] = match;
  // Segment by segment, so a segment with a broken escape is the only one that
  // keeps its raw text.
  let path = encoded.split("/").map(decodeSegment).join("/");
  // "file:///C:/books/x.pdf" is a Windows path, not a directory named "C:".
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  // A named host is a UNC share; "localhost" only means this machine.
  return host && host.toLowerCase() !== "localhost" ? `//${host}${path}` : path;
}

// The last segment of a path, on either separator.
export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

// Repair a display name that was taken from a file URL before normalizeFilePath
// existed: library titles, topic file names, the notes state's book name. Only a
// string that could be percent-encoded output is decoded, and only when the
// result still reads as a filename — an escape that is not valid UTF-8, or a
// "%2F" that would become a separator, leaves the name as it was. Idempotent:
// the decoded form no longer matches, so a second pass is a no-op.
export function decodeLegacyName(name: string): string {
  if (!name || !ENCODED_NAME.test(name)) return name;
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return name;
  }
  return /[/\\]/.test(decoded) ? name : decoded;
}
