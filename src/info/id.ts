// Stable item id: djb2 over source + slug/url, so an article keeps the same id
// across refetches and the feedback log can reference it. Pure (no DOM/fs), so
// the adapters and their tests share one definition.

import type { InfoSource } from "./types";

export function itemId(source: InfoSource, key: string): string {
  const s = `${source}:${key}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${source}-${h.toString(16)}`;
}
