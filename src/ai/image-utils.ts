// Paste-to-chat image preprocessing: shrink a pasted screenshot to a
// model-friendly size before it ever hits the wire. Anthropic downsamples
// anything past ~1568px on the long edge and rejects a single image over 5 MB
// (docs/05), so we do the resize ourselves to save tokens and fail early on
// oversized input. Runs in the webview (needs canvas / createImageBitmap).

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

// Compress a pasted image blob. Transparent source (PNG with real alpha) stays
// PNG to keep the transparency; everything else becomes JPEG q0.85, which is far
// smaller for photos and screenshots. Rejects images still over 5 MB after
// compression rather than letting the provider bounce them.
export async function compressImage(blob: Blob): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not process the image (no canvas context).");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const mediaType: CompressedImage["mediaType"] =
    blob.type === "image/png" && hasAlpha(ctx, width, height) ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mediaType, mediaType === "image/jpeg" ? JPEG_QUALITY : undefined);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

  const bytes = base64Bytes(data);
  if (bytes > MAX_BYTES) {
    throw new Error(
      `Image is too large after compression (${(bytes / 1024 / 1024).toFixed(1)} MB, max 5 MB).`,
    );
  }
  return { data, mediaType };
}
