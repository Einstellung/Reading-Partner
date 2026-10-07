// Fetching a manuscript's pictures (src/workshop/bindery/images.ts): document
// order, the caps, and what is left for a placeholder.
// Run: bash scripts/t.sh tests/workshop/bindery/images.test.ts

import { expect, test } from "bun:test";
import {
  fetchImages,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  type FetchedBytes,
} from "../../../src/workshop/bindery/images";
import { PNG } from "../../reading/epub/fixture";

const png = (bytes: Uint8Array = PNG): FetchedBytes => ({
  ok: true,
  status: 200,
  bytes,
  contentType: "image/png; charset=binary",
});

test("pictures come back keyed by the src as spelled, relative ones resolved for the fetch", async () => {
  const asked: string[] = [];
  const got = await fetchImages(
    `<img src="/a.png"><img src="https://cdn.e.com/b.png"><img src="/a.png">`,
    "https://e.com/post",
    async (url) => {
      asked.push(url);
      return png();
    },
  );
  expect(asked).toEqual(["https://e.com/a.png", "https://cdn.e.com/b.png"]);
  expect(got.requested).toBe(2);
  expect(got.images.map((i) => [i.src, i.mediaType])).toEqual([
    ["/a.png", "image/png"],
    ["https://cdn.e.com/b.png", "image/png"],
  ]);
});

test("a failed, empty, thrown or oversized fetch is left out", async () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  const answers: Record<string, () => Promise<FetchedBytes>> = {
    "https://e.com/404.png": async () => ({ ok: false, status: 404, bytes: new Uint8Array(), contentType: null }),
    "https://e.com/empty.png": async () => png(new Uint8Array()),
    "https://e.com/throws.png": async () => {
      throw new Error("offline");
    },
    "https://e.com/big.png": async () => png(big),
    "https://e.com/ok.png": async () => png(),
  };
  const html = Object.keys(answers).map((u) => `<img src="${u}">`).join("");
  const got = await fetchImages(html, "https://e.com/", (url) => answers[url]());
  expect(got.requested).toBe(5);
  expect(got.images.map((i) => i.src)).toEqual(["https://e.com/ok.png"]);
});

test("an inline data image needs no fetch", async () => {
  const b64 = btoa(String.fromCharCode(...PNG));
  const got = await fetchImages(`<img src="data:image/png;base64,${b64}">`, "https://e.com/", async () => {
    throw new Error("no fetch expected");
  });
  expect(got.images).toHaveLength(1);
  expect(got.images[0].bytes).toEqual(PNG);
});

test("past the count cap nothing more is fetched, but every src is counted", async () => {
  let calls = 0;
  const html = Array.from({ length: MAX_IMAGES + 5 }, (_, i) => `<img src="https://e.com/${i}.png">`).join("");
  const got = await fetchImages(html, "https://e.com/", async () => {
    calls++;
    return png();
  });
  expect(calls).toBe(MAX_IMAGES);
  expect(got.images).toHaveLength(MAX_IMAGES);
  expect(got.requested).toBe(MAX_IMAGES + 5);
});
