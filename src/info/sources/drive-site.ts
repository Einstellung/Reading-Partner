// A Google Drive file link read as the file (docs/85, docs/84): the site
// adapter info registers for Drive, beside the libraries' own in
// sources/plugins/all.ts. A share link opens Drive's viewer, a page; the same id
// on `uc?export=download` is the file itself, named in Content-Disposition.
//
// Only a PDF is a document here. What Drive answers with a page instead (a
// sign-in for a file that is not shared, the confirm step for a file too big
// to virus-scan, a missing file) is a rejection that says which, never a
// document. Folder links are turned back: a folder is not one document.

import {
  isPdfBytes,
  looksLikeHtml,
  pdfDocument,
  rejection,
  type FetchedBytes,
  type SiteAdapter,
} from "../../workshop/bindery";

/** What a Drive link names. */
export type DriveTarget = { kind: "file"; id: string } | { kind: "folder"; id: string };

const DRIVE_HOSTS = new Set(["drive.google.com", "drive.usercontent.google.com"]);
const ID = /^[A-Za-z0-9_-]{10,}$/;

/** The file or folder a Drive link names, or null. */
export function driveTargetOfUrl(raw: string): DriveTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!DRIVE_HOSTS.has(url.hostname)) return null;
  const path = url.pathname;
  const file = /\/file\/(?:u\/\d+\/)?d\/([^/]+)/.exec(path);
  if (file && ID.test(file[1])) return { kind: "file", id: file[1] };
  const folder = /\/folders\/([^/]+)/.exec(path);
  if (folder && ID.test(folder[1])) return { kind: "folder", id: folder[1] };
  const queried = url.searchParams.get("id") ?? "";
  if (!ID.test(queried)) return null;
  if (/^\/(?:open|uc|download)\/?$/.test(path)) return { kind: "file", id: queried };
  if (/^\/folderview\/?$/.test(path)) return { kind: "folder", id: queried };
  return null;
}

/** The URL that downloads a Drive file rather than opening its viewer. */
export function driveDownloadUrl(id: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
}

// Why Drive answered a download with a page: the sentence the reader is told.
function pageRejection(res: FetchedBytes) {
  const html = new TextDecoder("utf-8").decode(res.bytes.subarray(0, 200_000));
  if (/virus/i.test(html)) {
    return rejection(
      "unreachable",
      "Drive asks to confirm the download of a file too large to virus-scan, and served that page instead of the file",
    );
  }
  if (/ServiceLogin|accounts\.google\.com\/(?:v\d\/)?signin|\bsign in\b/i.test(html)) {
    return rejection("login-wall", "the Drive file is not shared publicly; Drive asked for a sign-in");
  }
  return rejection("unreachable", "Drive answered with a web page, not the file");
}

export const driveSiteAdapter: SiteAdapter = {
  name: "drive",
  claims: (material) => material.kind === "url" && driveTargetOfUrl(material.url) !== null,
  async toManuscript(material, deps) {
    const target = material.kind === "url" ? driveTargetOfUrl(material.url) : null;
    if (!target) return rejection("no-adapter", "the link is not a Google Drive file");
    if (target.kind === "folder") {
      return rejection("no-adapter", "Google Drive folders are not supported; link a single file");
    }
    if (!deps.fetch) throw new Error("the Drive adapter needs fetch");
    let res: FetchedBytes;
    try {
      res = await deps.fetch(driveDownloadUrl(target.id));
    } catch {
      return rejection("unreachable", "Google Drive could not be reached");
    }
    if (!res.ok) {
      const why = res.status === 404 ? "has no file with that id, or it is not shared" : `answered HTTP ${res.status}`;
      return rejection("unreachable", `Google Drive ${why}`);
    }
    if (isPdfBytes(res.bytes)) {
      return pdfDocument(res, `https://drive.google.com/file/d/${target.id}/view`, `Drive file ${target.id}`);
    }
    if (looksLikeHtml(res.bytes) || /^text\/html\b/i.test(res.contentType ?? "")) {
      return pageRejection(res);
    }
    return rejection("unreachable", "the Drive file is not a PDF, and only PDFs are taken from Drive");
  },
};
