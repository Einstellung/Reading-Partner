// Article image inliner (src/info/inline-images.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  bytesToDataUrl,
  extractImageSrcs,
  inlineArticleImages,
  mergeInlinedHtml,
  removeImage,
  rewriteImageSrc,
  type ImageBytes,
} from "../../src/info/inline-images";

const IMG = (src: string) => `<img src="${src}" referrerpolicy="no-referrer" loading="lazy">`;

test("extractImageSrcs keeps external http(s), drops data/relative, dedupes", () => {
  const html = `${IMG("https://cdn/a.jpg")}${IMG("http://cdn/b.png")}${IMG(
    "data:image/png;base64,AAAA",
  )}${IMG("/rel.jpg")}${IMG("https://cdn/a.jpg")}`;
  expect(extractImageSrcs(html)).toEqual(["https://cdn/a.jpg", "http://cdn/b.png"]);
});

test("extractImageSrcs respects the cap", () => {
  const html = Array.from({ length: 5 }, (_, i) => IMG(`https://cdn/${i}.jpg`)).join("");
  expect(extractImageSrcs(html, 2)).toEqual(["https://cdn/0.jpg", "https://cdn/1.jpg"]);
});

test("rewriteImageSrc swaps only the src, keeps other attributes", () => {
  const out = rewriteImageSrc(IMG("https://cdn/a.jpg"), "https://cdn/a.jpg", "data:image/jpeg;base64,ZZ");
  expect(out).toBe(`<img src="data:image/jpeg;base64,ZZ" referrerpolicy="no-referrer" loading="lazy">`);
});

test("rewriteImageSrc handles regex-special characters in the URL", () => {
  const url = "https://cdn/a.jpg?w=1&h=2+3(x)";
  const out = rewriteImageSrc(IMG(url), url, "data:image/png;base64,QQ");
  expect(out).toContain('src="data:image/png;base64,QQ"');
  expect(out).not.toContain("cdn/a.jpg");
});

test("removeImage drops the matching img tag", () => {
  const html = `<p>x</p>${IMG("https://cdn/a.jpg")}<p>y</p>`;
  expect(removeImage(html, "https://cdn/a.jpg")).toBe("<p>x</p><p>y</p>");
});

test("bytesToDataUrl uses the response content-type, defaults to image/jpeg", () => {
  const bytes = new Uint8Array([104, 105]); // "hi" -> btoa "aGk="
  expect(bytesToDataUrl(bytes, "image/png")).toBe("data:image/png;base64,aGk=");
  expect(bytesToDataUrl(bytes, "image/webp; charset=binary")).toBe("data:image/webp;base64,aGk=");
  expect(bytesToDataUrl(bytes, null)).toBe("data:image/jpeg;base64,aGk=");
  expect(bytesToDataUrl(bytes, "text/html")).toBe("data:image/jpeg;base64,aGk=");
});

test("inlineArticleImages swaps successful fetches to data URLs and fires progress", async () => {
  const html = `${IMG("https://cdn/a.jpg")}${IMG("https://cdn/b.jpg")}`;
  const fetchImage = async (): Promise<ImageBytes> => ({
    bytes: new Uint8Array([104, 105]),
    contentType: "image/png",
  });
  const progress: string[] = [];
  const out = await inlineArticleImages(html, fetchImage, { onProgress: (h) => progress.push(h) });
  expect(out).not.toContain("https://cdn/a.jpg");
  expect(out).not.toContain("https://cdn/b.jpg");
  expect(out.match(/data:image\/png;base64,aGk=/g)?.length).toBe(2);
  expect(progress.length).toBe(2);
});

test("inlineArticleImages removes an image whose fetch fails", async () => {
  const html = `<p>keep</p>${IMG("https://cdn/a.jpg")}`;
  const fetchImage = async (): Promise<ImageBytes> => {
    throw new Error("network");
  };
  const out = await inlineArticleImages(html, fetchImage);
  expect(out).toBe("<p>keep</p>");
});

test("inlineArticleImages removes an image over the byte cap", async () => {
  const html = IMG("https://cdn/big.jpg");
  const fetchImage = async (): Promise<ImageBytes> => ({
    bytes: new Uint8Array(11),
    contentType: "image/jpeg",
  });
  const out = await inlineArticleImages(html, fetchImage, { maxBytes: 10 });
  expect(out).toBe("");
});

test("inlineArticleImages honors the image cap", async () => {
  const html = Array.from({ length: 3 }, (_, i) => IMG(`https://cdn/${i}.jpg`)).join("");
  let calls = 0;
  const fetchImage = async (): Promise<ImageBytes> => {
    calls++;
    return { bytes: new Uint8Array([104, 105]), contentType: "image/png" };
  };
  const out = await inlineArticleImages(html, fetchImage, { maxImages: 2 });
  expect(calls).toBe(2);
  expect(out).toContain("https://cdn/2.jpg"); // beyond cap, left external (CSS hides it)
});

test("mergeInlinedHtml swaps contentHtml, preserves textContent", () => {
  const articles = { x: { contentHtml: "<p>old</p>", textContent: "old text" } };
  const merged = mergeInlinedHtml(articles, "x", "<p>new</p>");
  expect(merged.x).toEqual({ contentHtml: "<p>new</p>", textContent: "old text" });
  expect(articles.x.contentHtml).toBe("<p>old</p>"); // input not mutated
});

test("mergeInlinedHtml is a no-op (same reference) for an unknown item", () => {
  const articles = { x: { contentHtml: "<p>a</p>" } };
  expect(mergeInlinedHtml(articles, "y", "<p>b</p>")).toBe(articles);
});
