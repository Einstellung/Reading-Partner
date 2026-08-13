// Links that leave the app, opened in the system browser instead of in the
// webview. A webview navigation replaces the whole document and the window has
// no back gesture and no address bar, so following a link in place loses the
// open book and the running conversation until the app is restarted
// (docs/pitfall/94).
//
// Two layers cover this. src-tauri/src/navigation.rs cancels any such
// navigation whatever produced it; this module is the explicit half, so a click
// on a link in a model reply or in an article body is handled where it happens
// rather than caught on the way out.
//
// On iOS openUrl hands the URL to UIApplication and the user comes back through
// the app switcher with the app exactly where they left it; on the desktop it
// starts the default browser. Both need `opener:allow-open-url` to admit the
// URL — the capability scope is the reason a link can be swallowed silently.

import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./host";

// What a click on an anchor should do.
export type LinkAction =
  // Hand this URL to the system browser.
  | { kind: "external"; url: string }
  // A navigation to our own origin: it would reload the SPA and throw away
  // every bit of unsaved state. Swallow it.
  | { kind: "block" }
  // An in-page anchor, or a scheme this app does not route. Leave it alone.
  | { kind: "pass" };

// The rule, as a pure function of the href and the page it sits on. `base` is
// the document URL: `tauri://localhost/` in a release build, the vite dev
// server in development.
export function classifyLink(href: string | null | undefined, base: string): LinkAction {
  const raw = href?.trim();
  if (!raw) return { kind: "pass" };
  // A fragment never navigates.
  if (raw.startsWith("#")) return { kind: "pass" };

  let url: URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
    url = new URL(raw, baseUrl);
  } catch {
    // Not resolvable: the webview will not go anywhere either.
    return { kind: "pass" };
  }

  // Same origin — including every relative href, which resolves to it. Checked
  // before the scheme because the app's own origin is `tauri:` in a release
  // build, and a relative link there is just as destructive as an external one.
  if (url.protocol === baseUrl.protocol && url.host === baseUrl.host) return { kind: "block" };

  if (url.protocol === "http:" || url.protocol === "https:") {
    return { kind: "external", url: url.href };
  }
  return { kind: "pass" };
}

// The document URL, or the release origin when there is no document (unit
// tests). Only the origin part of it is ever used.
function currentBase(): string {
  if (typeof window === "undefined" || !window.location) return "tauri://localhost/";
  return window.location.href;
}

export function linkActionFor(href: string | null | undefined): LinkAction {
  return classifyLink(href, currentBase());
}

// Fire and forget: nothing in the UI waits for the browser to come up.
export function openExternal(url: string): void {
  const host = typeof window === "undefined" ? undefined : window;
  if (!host) return;
  if (isTauri()) {
    void openUrl(url).catch((err) => {
      console.error("failed to open link in the system browser", url, err);
    });
    return;
  }
  // Browser dev server: no opener command, and a new tab is the equivalent.
  // Under bun there is a `window` but no `open`, and nothing to open either.
  host.open?.(url, "_blank", "noopener,noreferrer");
}

// One click, delegated. Structurally typed so the same function serves a React
// synthetic event and a native one, and so the anchor lookup is exercisable
// without a DOM.
export interface AnchorLike {
  getAttribute(name: string): string | null;
}
export interface DelegatedClickEvent {
  target: unknown;
  defaultPrevented?: boolean;
  preventDefault(): void;
}

function closestAnchor(target: unknown): AnchorLike | null {
  const el = target as { closest?: (selector: string) => AnchorLike | null } | null;
  if (!el || typeof el.closest !== "function") return null;
  return el.closest("a");
}

// Click handler for a block of injected HTML: the anchors inside it are not
// rendered by React, so the one listener on the container is what routes them.
export function handleDelegatedLinkClick(e: DelegatedClickEvent): void {
  if (e.defaultPrevented) return;
  const anchor = closestAnchor(e.target);
  if (!anchor) return;
  const action = linkActionFor(anchor.getAttribute("href"));
  if (action.kind === "pass") return;
  e.preventDefault();
  if (action.kind === "external") openExternal(action.url);
}
