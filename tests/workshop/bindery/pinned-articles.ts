// Article inputs whose built bytes are pinned (article-bytes-pin.test.ts) and
// whose single-section manuscripts must build to the same bytes
// (bind.test.ts). Shared so the two cannot drift apart.

import type { ArticleEpubInput } from "../../../src/workshop/bindery/build-article";
import { PNG } from "../../reading/epub/fixture";

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

const RICH_BODY = `<div id="readability-page-1">
  <p>${PROSE}</p>
  <h2 id="first-section">The first section</h2>
  <p>${PROSE}</p>
  <figure>
    <img src="https://cdn.example.com/a.png" alt="a diagram"/>
    <figcaption>Figure 1</figcaption>
  </figure>
  <h3>A sub-heading</h3>
  <p>${PROSE}</p>
  <p><img src="https://cdn.example.com/gone.jpg" alt="the one that failed"/></p>
  <h2>The second section</h2>
  <p>Read <a href="https://example.com/other">the other one</a> too.</p>
  <script>alert(1)</script>
  <p onclick="steal()">${PROSE}</p>
</div>`;

export const PINNED_ARTICLES: Record<"rich" | "bare" | "covered", ArticleEpubInput> = {
  rich: {
    title: "How a web page becomes a book",
    byline: "A Writer",
    sourceUrl: "https://example.com/posts/how-a-web-page-becomes-a-book",
    publishedAt: "2026-09-12T08:30:00Z",
    language: "en",
    html: RICH_BODY,
    images: [{ src: "https://cdn.example.com/a.png", bytes: PNG, mediaType: "image/png" }],
  },
  bare: {
    title: "无标题的一页",
    sourceUrl: "https://example.cn/p/1",
    language: "zh-CN",
    html: `<p>${"一段没有小标题的正文。".repeat(40)}</p>`,
    images: [],
  },
  covered: {
    title: "A composed document",
    sourceUrl: "https://example.com/composed",
    html: `<h1>Part one</h1><p>${PROSE}</p><h1>Part two</h1><p>${PROSE}</p>`,
    images: [],
  },
};
