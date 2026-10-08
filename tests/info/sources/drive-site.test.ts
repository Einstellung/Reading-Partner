// A Google Drive link read as the file (src/info/sources/drive-site.ts, docs/85):
// which links it claims, a PDF passed through whole and named by the file name
// Drive gives it, and every page Drive answers with instead turned back.
// Run: bash scripts/t.sh tests/info/sources/drive-site.test.ts

import { afterEach, expect, test } from "bun:test";
import {
  driveDownloadUrl,
  driveSiteAdapter,
  driveTargetOfUrl,
} from "../../../src/info/sources/drive-site";
import { registerSourceSiteAdapters } from "../../../src/info/sources/plugins/all";
import {
  bind,
  registerSiteAdapter,
  registeredSiteAdapters,
  type FetchedBytes,
} from "../../../src/workshop/bindery";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
});

const ID = "1bPfAgQOAUb9NzTjOn1BkboqIlByjTTT0";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

function served(body: Uint8Array | string, contentType: string, contentDisposition?: string): FetchedBytes {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { ok: true, status: 200, bytes, contentType, ...(contentDisposition ? { contentDisposition } : {}) };
}

async function bound(url: string, answer: FetchedBytes) {
  undo = registerSiteAdapter(driveSiteAdapter);
  const fetched: string[] = [];
  const result = await bind(
    { kind: "url", url },
    {
      fetch: async (u) => {
        fetched.push(u);
        return answer;
      },
    },
  );
  return { result, fetched };
}

test("file share links, open?id= and download links name the file; folders are told apart", () => {
  for (const url of [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}`,
    `https://drive.google.com/file/u/0/d/${ID}/view`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    `https://drive.usercontent.google.com/download?id=${ID}&export=download`,
  ]) {
    expect(driveTargetOfUrl(url)).toEqual({ kind: "file", id: ID });
  }
  expect(driveTargetOfUrl(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toEqual({
    kind: "folder",
    id: ID,
  });
  expect(driveTargetOfUrl(`https://drive.google.com/drive/u/1/folders/${ID}`)).toMatchObject({ kind: "folder" });
  expect(driveTargetOfUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull();
  expect(driveTargetOfUrl("https://drive.google.com/")).toBeNull();
});

test("the startup registration hands the bindery the Drive adapter", () => {
  registerSourceSiteAdapters();
  expect(registeredSiteAdapters()).toContain("drive");
});

test("a shared PDF is downloaded through uc?export=download and passed through, named by Content-Disposition", async () => {
  const { result, fetched } = await bound(
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    served(PDF, "application/octet-stream", 'attachment; filename="Local-LLM-Karpathy-Thesis.pdf"'),
  );
  expect(fetched).toEqual([driveDownloadUrl(ID)]);
  expect(result).toMatchObject({
    ok: true,
    passedThrough: true,
    format: "pdf",
    metadata: {
      title: "Local-LLM-Karpathy-Thesis",
      adapter: "drive",
      sourceUrl: `https://drive.google.com/file/d/${ID}/view`,
    },
  });
  expect(result.ok && "bytes" in result && result.bytes).toEqual(PDF);
});

test("a UTF-8 file name in filename* is preferred, and a nameless PDF is named by its id", async () => {
  const named = await bound(
    `https://drive.google.com/open?id=${ID}`,
    served(PDF, "application/pdf", `attachment; filename="x.pdf"; filename*=UTF-8''%E8%AE%BA%E6%96%87.pdf`),
  );
  expect(named.result).toMatchObject({ metadata: { title: "论文" } });
  const nameless = await bound(`https://drive.google.com/open?id=${ID}`, served(PDF, "application/pdf"));
  expect(nameless.result).toMatchObject({ metadata: { title: `Drive file ${ID}` } });
});

test("Drive's virus-scan confirm page is a rejection, not a document", async () => {
  const page =
    "<!DOCTYPE html><html><head><title>Google Drive - Virus scan warning</title></head>" +
    "<body>Google Drive can't scan this file for viruses.</body></html>";
  const { result } = await bound(`https://drive.google.com/file/d/${ID}/view`, served(page, "text/html; charset=utf-8"));
  expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  expect(!result.ok && result.message).toContain("virus-scan");
});

test("a sign-in page is a login-wall rejection, even when Drive calls it octet-stream", async () => {
  const page =
    '<html><head><meta charset="utf-8"></head><body><a href="https://accounts.google.com/ServiceLogin">Sign in</a></body></html>';
  const { result } = await bound(`https://drive.google.com/file/d/${ID}/view`, served(page, "application/octet-stream"));
  expect(result).toMatchObject({ ok: false, reason: "login-wall" });
});

test("a missing file, a non-PDF file and a folder are each turned back with their reason", async () => {
  const missing = await bound(`https://drive.google.com/file/d/${ID}/view`, {
    ok: false,
    status: 404,
    bytes: new Uint8Array(),
    contentType: "text/html",
  });
  expect(missing.result).toMatchObject({ ok: false, reason: "unreachable" });
  const zip = await bound(`https://drive.google.com/file/d/${ID}/view`, served("PK\u0003\u0004rest", "application/zip"));
  expect(zip.result).toMatchObject({ ok: false, reason: "unreachable" });
  expect(!zip.result.ok && zip.result.message).toContain("not a PDF");
  const folder = await bound(`https://drive.google.com/drive/folders/${ID}`, served(PDF, "application/pdf"));
  expect(folder.result).toMatchObject({ ok: false, reason: "no-adapter" });
  expect(!folder.result.ok && folder.result.message).toContain("folders are not supported");
  expect(folder.fetched).toEqual([]);
});
