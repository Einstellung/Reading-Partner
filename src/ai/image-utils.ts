// Paste-to-chat image preprocessing: shrink a pasted screenshot to a
// model-friendly size before it ever hits the wire. Anthropic downsamples
// anything past ~1568px on the long edge and rejects a single image over 5 MB
// (docs/05), so we do the resize ourselves to save tokens and fail early on
// oversized input. Runs in the webview (canvas), decoding via createImageBitmap
// with an <img> fallback for WebKitGTK; also accepts raw RGBA from the Tauri
// clipboard path (compressImageData).

const MAX_EDGE = 1568;
const MAX_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

export interface CompressedImage {
  data: string; // bare base64, no data: prefix (matches ChatMessage.images)
  mediaType: "image/png" | "image/jpeg";
}

// Longest edge capped at MAX_EDGE, aspect ratio preserved, never upscaled.
export function scaledSize(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Decoded byte length of a base64 string (ignoring padding), for the size cap.
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function hasAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

type Drawable = CanvasImageSource & { width: number; height: number };

// Draw a decoded source scaled to fit MAX_EDGE and encode it. Transparent
// content (real alpha) stays PNG to keep the transparency; everything else
// becomes JPEG q0.85, far smaller for photos and screenshots. Rejects anything
// still over 5 MB rather than letting the provider bounce it.
function encodeDrawable(source: Drawable, srcW: number, srcH: number, probeAlpha: boolean): CompressedImage {
  const { width, height } = scaledSize(srcW, srcH);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image (no canvas context).");
  ctx.drawImage(source, 0, 0, width, height);

  const mediaType: CompressedImage["mediaType"] =
    probeAlpha && hasAlpha(ctx, width, height) ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mediaType, mediaType === "image/jpeg" ? JPEG_QUALITY : undefined);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

  const bytes = base64Bytes(data);
  if (bytes > MAX_BYTES) {
    throw new Error(`Image is too large after compression (${(bytes / 1024 / 1024).toFixed(1)} MB, max 5 MB).`);
  }
  return { data, mediaType };
}

// Decode a blob to a drawable. Prefer createImageBitmap; fall back to an <img>
// element, since WebKitGTK's createImageBitmap has been unreliable for pasted
// blobs. Returns a cleanup to release the bitmap / object URL after drawing.
async function decodeBlob(blob: Blob): Promise<{ source: Drawable; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height, cleanup: () => bmp.close() };
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not decode the image."));
      img.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

// Compress a pasted image blob (the DOM clipboard path).
export async function compressImage(blob: Blob): Promise<CompressedImage> {
  const d = await decodeBlob(blob);
  try {
    return encodeDrawable(d.source, d.width, d.height, blob.type === "image/png");
  } finally {
    d.cleanup();
  }
}

// Compress raw RGBA pixels (row-major, top to bottom) — the shape Tauri's
// clipboard readImage() returns on platforms whose DOM paste event carries no
// image data (WebKitGTK). Alpha is always probed since the source has a channel.
export async function compressImageData(rgba: Uint8Array, width: number, height: number): Promise<CompressedImage> {
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("Could not process the image (no canvas context).");
  sctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return encodeDrawable(src, width, height, true);
}
