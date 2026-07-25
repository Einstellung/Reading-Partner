// System-clipboard image read via Tauri, for the WebKitGTK paste fallback: on
// that engine the DOM paste event frequently omits image data, so the shell
// reads the clipboard through Rust instead. The plugin import is dynamic so the
// browser/test build (and any non-Tauri host) never pulls it in.

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Returns raw RGBA pixels (row-major) + dimensions, or null when the clipboard
// holds no image (or the plugin is unavailable). Callers decide how to surface
// a null — this stays quiet so an empty/text clipboard doesn't throw.
export async function readClipboardImage(): Promise<{ rgba: Uint8Array; width: number; height: number } | null> {
  try {
    const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const image = await readImage();
    const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
    if (!size.width || !size.height) return null;
    return { rgba, width: size.width, height: size.height };
  } catch {
    return null;
  }
}
