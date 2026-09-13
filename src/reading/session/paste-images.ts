// What a paste does to the open conversation, lifted out of App. One global
// path, owned by the shell and independent of focus: an image on the event is
// staged for the next send, and a paste that carries nothing at all is the
// WebKitGTK case (pitfall 16), where the image never reached the event and has
// to be read from the host instead. Text keeps its default behaviour.
//
// Nothing here is silent: every way this can fail leaves a sentence on the
// conversation it was pasted into.

import { compressImage, compressImageData, type CompressedImage } from "../../ai/image-utils";
import { readClipboardImage } from "../../platform/app/clipboard";
import { isTauri } from "../../platform/app/host";

export const NO_VISION_HINT =
  "This model can't read images. Switch to a vision model in Settings.";
export const NO_CLIPBOARD_IMAGE_HINT = "Couldn't read an image from the clipboard.";

/** The parts of a clipboard event this reads. A real ClipboardEvent is one. */
export interface PasteLike {
  clipboardData: {
    items: ArrayLike<{ kind: string; type: string; getAsFile(): Blob | null }> | null;
    getData(format: string): string;
  } | null;
  preventDefault(): void;
}

export interface PasteImageDeps {
  /** Whether the model this would be sent to can read an image at all. */
  takesImages(): boolean;
  /** A sentence for the composer, or "" to clear the one standing there. */
  hint(text: string): void;
  stage(produce: () => Promise<CompressedImage>): void;
  /**
   * The system clipboard, read through the host. Null where there is no host to
   * ask, which is also where the browser's own event is the whole story.
   */
  readSystemImage: (() => Promise<{ rgba: Uint8Array; width: number; height: number } | null>) | null;
}

/** The host's clipboard reader, or null in a plain browser. */
export function systemImageReader(): PasteImageDeps["readSystemImage"] {
  return isTauri() ? readClipboardImage : null;
}

export function imagesOn(e: PasteLike): Blob[] {
  const items = e.clipboardData?.items;
  const blobs: Blob[] = [];
  if (!items) return blobs;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) blobs.push(f);
    }
  }
  return blobs;
}

export function createPasteHandler(deps: PasteImageDeps): (e: PasteLike) => Promise<void> {
  return async (e) => {
    // Everything that decides the event's fate runs before the first await, so
    // preventDefault is still the paste's own turn.
    const blobs = imagesOn(e);
    if (blobs.length > 0) {
      e.preventDefault();
      if (!deps.takesImages()) {
        deps.hint(NO_VISION_HINT);
        return;
      }
      deps.hint("");
      for (const b of blobs) deps.stage(() => compressImage(b));
      return;
    }
    // No image in the event. Text paste keeps its default behaviour, and so does
    // an empty one where there is no host clipboard to fall back to.
    const text = e.clipboardData?.getData("text") ?? "";
    if (text.trim() !== "" || !deps.readSystemImage) return;
    e.preventDefault();
    const img = await deps.readSystemImage();
    if (!img) {
      deps.hint(NO_CLIPBOARD_IMAGE_HINT);
      return;
    }
    if (!deps.takesImages()) {
      deps.hint(NO_VISION_HINT);
      return;
    }
    deps.hint("");
    deps.stage(() => compressImageData(img.rgba, img.width, img.height));
  };
}
