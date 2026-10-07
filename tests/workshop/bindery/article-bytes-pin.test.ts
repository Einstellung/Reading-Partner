// The bytes an article was built into before the bindery took the builder over
// (docs/85). The shelf knows a document by the hash of its file, so an article
// ingested again has to come out as the same file or it lands as a second copy.
// The digests below were taken from buildArticleEpub as it stood before the
// multi-section build was added; a change that moves any of them is a change to
// every article already shelved.
// Run: bash scripts/t.sh tests/workshop/bindery/article-bytes-pin.test.ts

import { expect, test } from "bun:test";
import { contentHash } from "../../../src/platform/app/content-hash";
import { buildArticleEpub } from "../../../src/workshop/bindery/build-article";
import { typographicCover } from "../../../src/workshop/bindery/cover-svg";
import { PINNED_ARTICLES } from "./pinned-articles";

const PINNED: Record<string, string> = {
  rich: "b921bbf7b8c67465579ebaccf4155b90",
  bare: "8c2df576385c53b6e495a213d7165d8a",
  covered: "d97b44c0c3f83b54d5e16f76d4cbbfa1",
};

test("buildArticleEpub still writes the bytes it wrote before the bindery", async () => {
  const got: Record<string, string> = {};
  for (const [name, input] of Object.entries(PINNED_ARTICLES)) {
    const cover =
      name === "covered"
        ? { svg: typographicCover({ kicker: "A room", date: "2026-10-07", title: input.title, footer: [] }) }
        : undefined;
    got[name] = await contentHash(await buildArticleEpub({ ...input, ...(cover ? { cover } : {}) }));
  }
  expect(got).toEqual(PINNED);
});
