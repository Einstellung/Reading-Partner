// Rewriting article image srcs onto the img: proxy (src/platform/app/image-proxy.ts).
// The proxy mapper is injected, so no webview is needed. Run: bun test.

import { expect, test } from "bun:test";
import {
  articleHtmlForWebview,
  imageProxyPayload,
  proxyImageUrl,
  rewriteImageSrcs,
} from "../../src/platform/app/image-proxy";

// Stands in for convertFileSrc on macOS/iOS/Linux.
const toProxy = (url: string): string | null =>
  /^https?:\/\//i.test(url) ? `img://localhost/${encodeURIComponent(url)}` : null;

test("rewrites an external src and leaves the other attributes alone", () => {
  const html = '<img src="https://cdn/a.jpg" loading="lazy">';
  expect(rewriteImageSrcs(html, toProxy)).toBe(
    '<img src="img://localhost/https%3A%2F%2Fcdn%2Fa.jpg" loading="lazy">',
  );
});

test("leaves data: and relative srcs untouched", () => {
  const html = '<img src="data:image/png;base64,QQ"><img src="/local.png">';
  expect(rewriteImageSrcs(html, toProxy)).toBe(html);
});

test("rewrites every image, not just the first", () => {
  const html = '<img src="https://cdn/a.jpg"><p>x</p><img src="http://cdn/b.png">';
  const out = rewriteImageSrcs(html, toProxy);
  expect(out).toContain("img://localhost/https%3A%2F%2Fcdn%2Fa.jpg");
  expect(out).toContain("img://localhost/http%3A%2F%2Fcdn%2Fb.png");
});

test("a query string and non-ASCII survive the round trip", () => {
  const url = "https://cdn.example.com/图片.jpg?w=640&h=480";
  const out = rewriteImageSrcs(`<img src="${url}">`, toProxy);
  const encoded = /src="img:\/\/localhost\/([^"]*)"/.exec(out)?.[1] ?? "";
  expect(decodeURIComponent(encoded)).toBe(url);
  // The rewritten attribute value carries no bare ampersand.
  expect(out).not.toContain("&h=480");
});

test("the Windows/Android shape is rewritten the same way", () => {
  const winProxy = (url: string) => `http://img.localhost/${encodeURIComponent(url)}`;
  expect(rewriteImageSrcs('<img src="https://cdn/a.jpg">', winProxy)).toBe(
    '<img src="http://img.localhost/https%3A%2F%2Fcdn%2Fa.jpg">',
  );
});

test("no attribute is introduced and no other tag is touched", () => {
  const html = '<p>t</p><a href="https://x/y">l</a><img src="https://cdn/a.jpg">';
  const out = rewriteImageSrcs(html, toProxy);
  expect(out).toContain('<a href="https://x/y">l</a>');
  expect(out.match(/<img[^>]*>/)?.[0]).toBe('<img src="img://localhost/https%3A%2F%2Fcdn%2Fa.jpg">');
});

// Outside Tauri there is no protocol to point at, so nothing is rewritten and
// bun/dev renders the original URLs.
test("outside Tauri the html and every url come back unchanged", () => {
  expect(proxyImageUrl("https://cdn/a.jpg", "https://site/a")).toBeNull();
  expect(proxyImageUrl("data:image/png;base64,QQ")).toBeNull();
  const html = '<img src="https://cdn/a.jpg">';
  expect(articleHtmlForWebview(html, "https://site/a")).toBe(html);
});

// --- imageProxyPayload ------------------------------------------------------
// The two halves the Rust handler splits apart (src-tauri/src/image_proxy.rs).

const halves = (payload: string) => payload.split("/").map(decodeURIComponent);

test("the payload carries the image url and the page url, both recoverable", () => {
  const image = "https://cdn.example.com/图片.jpg?w=640&h=480";
  const page = "https://www.example.com/文章?id=7";
  const payload = imageProxyPayload(image, page);
  expect(payload.split("/")).toHaveLength(2);
  expect(halves(payload)).toEqual([image, page]);
});

test("the separator survives an image url that is nothing but slashes", () => {
  // The image url is markup-controlled: whatever it holds has to stay inside
  // its own half, or it would be dictating the Referer.
  const image = "https://cdn/a.jpg?next=/https%3A%2F%2Fevil/";
  const payload = imageProxyPayload(image, "https://www.example.com/a");
  expect(payload.split("/")).toHaveLength(2);
  expect(halves(payload)).toEqual([image, "https://www.example.com/a"]);
});

test("the page half is empty when there is no usable page url", () => {
  for (const page of [undefined, null, "", "about:blank", "/relative"]) {
    expect(halves(imageProxyPayload("https://cdn/a.jpg", page))).toEqual([
      "https://cdn/a.jpg",
      "",
    ]);
  }
});
