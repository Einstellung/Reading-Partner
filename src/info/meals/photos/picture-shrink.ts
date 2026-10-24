// Shrinking a drawn dish picture before it is kept (docs/73 图片).
//
// A provider answers with whatever it draws: the ChatGPT sign-in sends a PNG of
// a few MB, and every kept picture travels to every device on the data channel.
// So before the file is written its longest side comes down to MAX_PICTURE_EDGE
// and it becomes a JPEG, on the device that drew it. The decode and encode are
// the webview's (createImageBitmap or <img>, then a canvas), behind a port so
// the rule is testable without one. A picture that will not decode or encode is
// kept as the provider sent it: failing to shrink never loses the picture.

import { decodeBlob, scaledSize } from "../../../ai/image-utils";
import { sniffImageType } from "../../../ai/image-generation";

export const MAX_PICTURE_EDGE = 1024;
export const PICTURE_JPEG_QUALITY = 0.85;

/** A picture decoded: its size, and a JPEG of it at a given size. */
export interface DecodedPicture {
  width: number;
  height: number;
  jpeg(width: number, height: number, quality: number): Promise<Uint8Array>;
  close(): void;
}

/** The host half: decode a picture's bytes. Throws when it cannot. */
export interface PictureResizer {
  open(bytes: Uint8Array, mediaType: string): Promise<DecodedPicture>;
}

export interface KeptPicture {
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * The bytes to keep for a drawn picture: a JPEG no wider or taller than
 * MAX_PICTURE_EDGE, or the original when it already is one or when the host
 * cannot redraw it.
 */
export async function shrinkDrawnPicture(
  bytes: Uint8Array,
  mediaType: string,
  resizer: PictureResizer,
): Promise<KeptPicture> {
  const original = { bytes, mediaType };
  let decoded: DecodedPicture | null = null;
  try {
    decoded = await resizer.open(bytes, mediaType);
    const { width, height } = decoded;
    if (!(width > 0 && height > 0)) return original;
    if (mediaType === "image/jpeg" && Math.max(width, height) <= MAX_PICTURE_EDGE) return original;
    const size = scaledSize(width, height, MAX_PICTURE_EDGE);
    const jpeg = await decoded.jpeg(size.width, size.height, PICTURE_JPEG_QUALITY);
    return sniffImageType(jpeg) === "image/jpeg" ? { bytes: jpeg, mediaType: "image/jpeg" } : original;
  } catch {
    return original;
  } finally {
    try {
      decoded?.close();
    } catch {
      // Nothing to keep from a failed release.
    }
  }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("the picture did not encode"));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      "image/jpeg",
      quality,
    );
  });
}

/** The webview's resizer: decodeBlob (createImageBitmap, else <img>), then a canvas. */
export const webviewPictureResizer: PictureResizer = {
  async open(bytes, mediaType) {
    if (typeof document === "undefined") throw new Error("no canvas on this host");
    const d = await decodeBlob(new Blob([bytes as BlobPart], { type: mediaType }));
    return {
      width: d.width,
      height: d.height,
      async jpeg(width, height, quality) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        // A JPEG has no alpha: paint white under anything transparent.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(d.source, 0, 0, width, height);
        return canvasJpeg(canvas, quality);
      },
      close: d.cleanup,
    };
  },
};
