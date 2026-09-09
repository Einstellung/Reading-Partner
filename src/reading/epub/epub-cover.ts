// A shelf cover for an EPUB: the image the package document names, decoded by
// the webview and scaled to the shelf's size as a JPEG (docs/64). Only the
// container and the package are read — the spine stays zipped — so this costs
// one small inflate and one image decode per book, once.

import { parsePackage, readContainer } from "./package";
import { openZip } from "./zip";

export type EpubCoverResult =
  | { kind: "ok"; jpeg: Uint8Array; author: string | null }
  /** The package names no cover image, or names an entry the archive lacks. */
  | { kind: "no-cover"; cause: string }
  /** The image would not decode or encode. */
  | { kind: "render"; cause: unknown };

export interface EpubCoverOptions {
  width: number;
  quality: number;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("cover image did not decode"));
    img.src = url;
  });
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("cover did not encode"));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function renderEpubCover(bytes: Uint8Array, opts: EpubCoverOptions): Promise<EpubCoverResult> {
  let entry: string | null = null;
  let author: string | null = null;
  let image: Uint8Array | null = null;
  try {
    const zip = openZip(bytes);
    const opfEntry = readContainer(zip);
    const opf = opfEntry ? zip.text(opfEntry) : null;
    const pkg = opf && opfEntry ? parsePackage(opf, opfEntry) : null;
    if (!pkg) return { kind: "no-cover", cause: "no package document" };
    author = pkg.creator;
    entry = pkg.coverEntry;
    if (!entry) return { kind: "no-cover", cause: "the package names no cover image" };
    image = zip.bytes(entry);
    if (!image) return { kind: "no-cover", cause: `cover entry missing: ${entry}` };
  } catch (e) {
    return { kind: "render", cause: e };
  }
  const ext = entry.slice(entry.lastIndexOf(".") + 1).toLowerCase();
  const url = URL.createObjectURL(new Blob([image.slice() as unknown as BlobPart], { type: MIME[ext] ?? "" }));
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w <= 0 || h <= 0) return { kind: "render", cause: "cover has no size" };
    const scale = Math.min(1, opts.width / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { kind: "render", cause: "no 2d context" };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { kind: "ok", jpeg: await toJpeg(canvas, opts.quality), author };
  } catch (e) {
    return { kind: "render", cause: e };
  } finally {
    URL.revokeObjectURL(url);
  }
}
