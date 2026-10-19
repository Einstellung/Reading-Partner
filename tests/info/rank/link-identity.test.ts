// One document, one key (docs/info/88 「看原文」): redirect wrappers, short
// links, DOIs, arXiv's mirrors and the paper sites. Every URL invented in shape.

import { expect, test } from "bun:test";
import { canonicalizeUrl } from "../../../src/info/rank/canonical-url";
import { currentEventKey, eventKeyOfUrl } from "../../../src/info/rank/events";
import {
  arxivIdOfDoi,
  arxivIdOfPageMeta,
  doiOfUrl,
  isShortLink,
  normalizeDoi,
  paperKeyOfUrl,
  unwrapLink,
} from "../../../src/info/rank/link-identity";

test("redirect wrappers unwrap to their target, nested ones too; other links stay as they are", () => {
  const target = "https://blog.example.com/post?id=7";
  const q = encodeURIComponent(target);
  expect(unwrapLink(`https://www.google.com/url?sa=t&q=${q}&usg=x`)).toBe(target);
  expect(unwrapLink(`https://www.google.co.uk/url?url=${q}`)).toBe(target);
  expect(unwrapLink(`https://l.facebook.com/l.php?u=${q}&h=AT0`)).toBe(target);
  expect(unwrapLink(`https://www.youtube.com/redirect?event=video_description&q=${q}`)).toBe(target);
  expect(unwrapLink(`https://www.linkedin.com/redir/redirect?url=${q}`)).toBe(target);
  expect(unwrapLink(`https://out.reddit.com/t3_abc?url=${q}&token=z`)).toBe(target);
  expect(unwrapLink(`https://nam02.safelinks.protection.outlook.com/?url=${q}&data=1`)).toBe(target);
  expect(unwrapLink(`https://www.google.com/url?q=${encodeURIComponent(`https://l.facebook.com/l.php?u=${q}`)}`)).toBe(target);
  // Not a wrapper: a search, a wrapper with no URL in it, anything else.
  expect(unwrapLink("https://www.google.com/search?q=https://a.example")).toBe("https://www.google.com/search?q=https://a.example");
  expect(unwrapLink("https://www.google.com/url?q=not-a-url")).toBe("https://www.google.com/url?q=not-a-url");
  expect(unwrapLink(target)).toBe(target);
});

test("short links are recognised, not resolved", () => {
  expect(isShortLink("https://goo.gle/3xYz")).toBe(true);
  expect(isShortLink("https://bit.ly/abc")).toBe(true);
  expect(isShortLink("https://goo.gle/")).toBe(false);
  expect(isShortLink("https://blog.example.com/abc")).toBe(false);
});

test("DOIs: a resolver link, publisher pages with the DOI in the path, a ?doi= parameter", () => {
  expect(normalizeDoi("doi:10.1126/Science.ABC1234.")).toBe("10.1126/science.abc1234");
  expect(normalizeDoi("10.1016/S0140-6736(20)30183-5")).toBe("10.1016/s0140-6736(20)30183-5");
  expect(normalizeDoi("10.1000/xyz)")).toBe("10.1000/xyz");
  expect(normalizeDoi("11.1000/xyz")).toBeNull();
  expect(doiOfUrl("https://doi.org/10.1038/s41586-024-07421-0")).toBe("10.1038/s41586-024-07421-0");
  expect(doiOfUrl("http://dx.doi.org/10.1145%2F3292500.3330701")).toBe("10.1145/3292500.3330701");
  expect(doiOfUrl("https://www.nature.com/articles/s41586-024-07421-0")).toBe("10.1038/s41586-024-07421-0");
  expect(doiOfUrl("https://www.nature.com/articles/s41586-024-07421-0.pdf")).toBe("10.1038/s41586-024-07421-0");
  expect(doiOfUrl("https://www.science.org/doi/10.1126/science.adk1234")).toBe("10.1126/science.adk1234");
  expect(doiOfUrl("https://www.science.org/doi/pdf/10.1126/science.adk1234")).toBe("10.1126/science.adk1234");
  expect(doiOfUrl("https://dl.acm.org/doi/abs/10.1145/3292500.3330701")).toBe("10.1145/3292500.3330701");
  expect(doiOfUrl("https://onlinelibrary.wiley.com/doi/epdf/10.1002/anie.202400001")).toBe("10.1002/anie.202400001");
  expect(doiOfUrl("https://link.springer.com/article/10.1007/s11263-024-02001-1")).toBe("10.1007/s11263-024-02001-1");
  expect(doiOfUrl("https://link.springer.com/content/pdf/10.1007/s11263-024-02001-1.pdf")).toBe("10.1007/s11263-024-02001-1");
  expect(doiOfUrl("https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.132.010001")).toBe("10.1103/physrevlett.132.010001");
  expect(doiOfUrl("https://www.biorxiv.org/content/10.1101/2024.01.15.575001v2.full.pdf")).toBe("10.1101/2024.01.15.575001");
  expect(doiOfUrl("https://www.frontiersin.org/articles/10.3389/fnins.2024.00001/full")).toBe("10.3389/fnins.2024.00001");
  expect(doiOfUrl("https://papers.example.org/view?doi=10.5555/12345")).toBe("10.5555/12345");
  expect(doiOfUrl("https://www.nature.com/")).toBeNull();
  expect(doiOfUrl("https://blog.example.com/post")).toBeNull();
});

test("an arXiv-issued DOI is the arXiv paper", () => {
  expect(arxivIdOfDoi("10.48550/arXiv.2505.06708")).toBe("2505.06708");
  expect(arxivIdOfDoi("10.1038/s41586-024-07421-0")).toBeNull();
});

test("paper keys: arXiv by every spelling and mirror, DOIs, OpenReview, ACL Anthology, IEEE Xplore", () => {
  for (const url of [
    "https://arxiv.org/abs/2505.06708",
    "http://www.arxiv.org/abs/2505.06708v3/",
    "https://arxiv.org/pdf/2505.06708v2.pdf",
    "https://arxiv.org/html/2505.06708v1#S2",
    "https://export.arxiv.org/abs/2505.06708",
    "https://www.alphaxiv.org/overview/2505.06708",
    "https://huggingface.co/papers/2505.06708",
    "https://hf.co/papers/2505.06708",
    "https://doi.org/10.48550/arXiv.2505.06708",
    "https://scirate.com/arxiv/2505.06708",
    `https://www.google.com/url?q=${encodeURIComponent("https://arxiv.org/abs/2505.06708")}`,
  ]) {
    expect(paperKeyOfUrl(url)).toBe("arxiv:2505.06708");
  }
  expect(paperKeyOfUrl("https://doi.org/10.1038/S41586-024-07421-0")).toBe("doi:10.1038/s41586-024-07421-0");
  expect(paperKeyOfUrl("https://www.nature.com/articles/s41586-024-07421-0")).toBe("doi:10.1038/s41586-024-07421-0");
  expect(paperKeyOfUrl("https://openreview.net/forum?id=AbC_12-x")).toBe("openreview:AbC_12-x");
  expect(paperKeyOfUrl("https://openreview.net/pdf?id=AbC_12-x")).toBe("openreview:AbC_12-x");
  expect(paperKeyOfUrl("https://aclanthology.org/2024.acl-long.123/")).toBe("acl:2024.acl-long.123");
  expect(paperKeyOfUrl("https://aclanthology.org/2024.acl-long.123.pdf")).toBe("acl:2024.acl-long.123");
  expect(paperKeyOfUrl("https://www.aclweb.org/anthology/P19-1001.pdf")).toBe("acl:p19-1001");
  expect(paperKeyOfUrl("https://ieeexplore.ieee.org/document/10123456/")).toBe("ieee:10123456");
  expect(paperKeyOfUrl("https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=10123456")).toBe("ieee:10123456");
  expect(paperKeyOfUrl("https://huggingface.co/papers")).toBeNull();
  expect(paperKeyOfUrl("https://openreview.net/group?id=ICLR.cc")).toBeNull();
  expect(paperKeyOfUrl("https://blog.example.com/post")).toBeNull();
});

test("a page's head that names its arXiv version", () => {
  expect(arxivIdOfPageMeta(new Map([["citation_arxiv_id", "2505.06708v2"]]))).toBe("2505.06708");
  expect(arxivIdOfPageMeta(new Map([["citation_pdf_url", "https://arxiv.org/pdf/2505.06708"]]))).toBe("2505.06708");
  expect(arxivIdOfPageMeta(new Map([["citation_doi", "10.48550/arXiv.2505.06708"]]))).toBe("2505.06708");
  expect(arxivIdOfPageMeta(new Map([["dc.identifier", "arXiv:2505.06708"]]))).toBe("2505.06708");
  expect(arxivIdOfPageMeta(new Map([["citation_doi", "10.1038/s41586-024-07421-0"], ["og:url", "https://www.nature.com/articles/x"]]))).toBeNull();
});

test("canonical URLs: one scheme, no www., tracking and share parameters out, wrappers unwrapped", () => {
  expect(canonicalizeUrl("http://www.example.com/a/")).toBe("https://example.com/a");
  expect(canonicalizeUrl("https://example.com/a?ref=hn&ref_src=twsrc&_ga=1&id=3")).toBe("https://example.com/a?id=3");
  expect(canonicalizeUrl("https://www.youtube.com/watch?v=abc&si=share&feature=shared")).toBe("https://youtube.com/watch?v=abc");
  expect(canonicalizeUrl("https://www.twitter.com/a/status/1?s=20")).toBe("https://twitter.com/a/status/1");
  expect(canonicalizeUrl(`https://l.facebook.com/l.php?u=${encodeURIComponent("http://www.example.com/a?utm_source=fb")}`)).toBe("https://example.com/a");
});

test("event keys: the same document under any spelling is one key; stored keys are keyed again", () => {
  expect(eventKeyOfUrl("http://www.blog.example.com/post/?utm_medium=x#top")).toBe(eventKeyOfUrl("https://blog.example.com/post"));
  expect(eventKeyOfUrl("https://www.nature.com/articles/s41586-024-07421-0")).toBe(eventKeyOfUrl("https://doi.org/10.1038/s41586-024-07421-0"));
  expect(eventKeyOfUrl("https://huggingface.co/papers/2505.06708")).toBe("arxiv:2505.06708");
  expect(currentEventKey("url:https://www.example.com/a")).toBe("url:https://example.com/a");
  expect(currentEventKey("url:https://doi.org/10.1126/science.adk1234")).toBe("doi:10.1126/science.adk1234");
  expect(currentEventKey("arxiv:2505.06708")).toBe("arxiv:2505.06708");
});
