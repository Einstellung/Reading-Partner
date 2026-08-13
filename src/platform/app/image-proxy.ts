// External article images, made loadable by the webview (docs/pitfall/30). The
// CSP img-src has no https: and COEP require-corp drops every cross-origin
// subresource without a CORP header, so `<img src="https://cdn/a.jpg">` can
// never load directly. src-tauri/src/image_proxy.rs registers an `img:` URI
// scheme that fetches the original and replays it with the CORP header; this
// module points the markup at it, at render time.
//
// Render time, not persist time: what is stored stays the plain https URL, so a
// cached or synced article carries URLs rather than platform-shaped local ones
// and keeps rendering if the scheme is ever renamed.

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "./host";

// The scheme registered in src-tauri/src/lib.rs. convertFileSrc turns it into
// `img://localhost/<encoded>` on macOS/iOS/Linux and `http://img.localhost/
// <encoded>` on Windows/Android — hence never hand-assembling the URL.
export const IMAGE_PROXY_SCHEME = "img";

// What the handler receives: the image URL and the page it appears on, each
// percent-encoded, joined by "/". convertFileSrc escapes the whole thing again
// into one path segment, so the separator is the only bare "/" the handler sees
// after decoding once and neither half can widen into the other.
//
// The page URL becomes the Referer of the outbound request. CDNs with hotlink
// protection (image.jiqizhixin.com among them) answer 403 to a request without
// one and 200 to the same request with the article's own site, so it decides
// whether the article has pictures at all. It is empty when the caller has no
// page URL — which is why it is a separate segment rather than something read
// out of the markup: only the host knows it, and markup must never be able to
// set an outbound request header.
export function imageProxyPayload(imageUrl: string, pageUrl?: string | null): string {
  const referer = pageUrl && /^https?:\/\//i.test(pageUrl) ? pageUrl : "";
  return `${encodeURIComponent(imageUrl)}/${encodeURIComponent(referer)}`;
}

// The webview URL for one external image, or null when there is no route for
// it: outside Tauri (bun dev, tests) the protocol does not exist, and a data:
// or relative src needs no rewrite. A null leaves the src untouched.
export function proxyImageUrl(url: string, pageUrl?: string | null): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  if (!isTauri()) return null;
  return convertFileSrc(imageProxyPayload(url, pageUrl), IMAGE_PROXY_SCHEME);
}

// The source text of an attribute value is not the value: sanitize.ts writes
// "&", '"', "<" and ">" out as entities, and a regex reads back what it wrote
// rather than what the renderer will decode. Undo exactly those four, "&amp;"
// last so `&amp;lt;` comes back as the text "&lt;" and not as "<". Anything else
// an entity could spell cannot be in there — the sanitizer rebuilt this tag from
// a parsed URL — so this is the inverse of that escape and not a decoder.
function decodeAttrValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Point every external <img> in sanitized article HTML at `toProxy(src)`, only
// touching the value of src. No attribute is ever introduced — sanitizeArticleHtml
// stays the security boundary and this runs after it. `toProxy` is injected so
// the rewrite is testable without a webview.
export function rewriteImageSrcs(html: string, toProxy: (url: string) => string | null): string {
  return html.replace(
    /(<img\b[^>]*?\ssrc\s*=\s*")([^"]*)(")/gi,
    (full, pre: string, raw: string, post: string) => {
      const src = decodeAttrValue(raw);
      const proxied = toProxy(src);
      // convertFileSrc percent-encodes the whole payload, so the result carries
      // no quote or ampersand; escaping both anyway keeps that an assumption
      // this function does not depend on.
      return proxied === null
        ? full
        : `${pre}${proxied.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}${post}`;
    },
  );
}

// Sanitized article HTML ready for the webview. `pageUrl` is the article's own
// URL as the host knows it (never anything parsed out of the body). Outside
// Tauri the HTML comes back unchanged, so bun/dev renders the original https
// URLs.
export function articleHtmlForWebview(html: string, pageUrl?: string | null): string {
  return rewriteImageSrcs(html, (src) => proxyImageUrl(src, pageUrl));
}
