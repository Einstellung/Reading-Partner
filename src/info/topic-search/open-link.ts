// 86's open route for one link, as verify reads an original through it
// (docs/info/88 「看原文」): readers, site adapters, the generic page and PDF
// read, flattened to an OpenedLink. Nothing is filed. Apart from build-live.ts
// so that it can be tested with fake readers and a fake fetch.

import type { FetchBytes } from "../../workshop/bindery";
import { manuscriptText } from "../../workshop/bindery/manuscript";
import type { ExtractReadable } from "../../workshop/extract/readable-select";
import type { LinkReader } from "../links/readers";
import { LinkSession } from "../links/session";
import { codeOfRejection } from "./read-failure";
import { linksOut, type OpenedLink } from "./verify";

export interface OpenOriginalDeps {
  fetch: FetchBytes;
  /** Cuts the article out of a generic web page; without it no plain page can be read. */
  extractReadable: ExtractReadable;
  /** The readers to route by; the registered ones when absent. */
  readers?: readonly LinkReader[];
}

/**
 * Open one link; a failure says why in the route's own words (a rejection's
 * message) and with its code (read-failure.ts). A PDF the site serves, known
 * by its bytes whatever its address says, comes back whole with those bytes.
 */
export async function openOriginal(url: string, deps: OpenOriginalDeps): Promise<OpenedLink> {
  const session = new LinkSession<never>(url, {
    fetch: deps.fetch,
    extractReadable: deps.extractReadable,
    ...(deps.readers ? { readers: deps.readers } : {}),
    file: async () => {
      throw new Error("a topic search reads originals and files nothing");
    },
  });
  await session.open(1);
  const opened = session.get(1)?.opened;
  const content = opened?.content ?? null;
  if (!opened || content === null) return { ok: false, code: "unsupported", reason: opened?.why ?? "nothing readable at the link" };
  if (!content.ok) return { ok: false, code: codeOfRejection(content), reason: content.message };
  const links = linksOut(session.candidates, url);
  if ("passedThrough" in content) {
    const meta = content.metadata;
    return {
      ok: true,
      via: opened.via,
      title: meta.title || null,
      author: meta.author ?? null,
      publishedAt: meta.publishedAt ?? null,
      sections: [],
      whole: { format: content.format, abstract: meta.abstract ?? null, bytes: content.bytes },
      links,
    };
  }
  const m = content.manuscript;
  if (!manuscriptText(m).trim()) return { ok: false, code: "too_short", reason: "the page had no text" };
  return {
    ok: true,
    via: opened.via,
    title: m.title || null,
    author: m.author ?? null,
    publishedAt: m.publishedAt ?? null,
    sections: m.sections.map((s) => ({ heading: s.heading ?? null, html: s.html })),
    whole: null,
    links,
  };
}
