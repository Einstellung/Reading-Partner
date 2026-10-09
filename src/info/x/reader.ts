// X as a reader of the link agent (docs/86 「读法登记表」): a post read into its
// record, what the model is told about it, and its candidates — its own whole
// text as HTML when it was read whole and is content, the quoted post's the
// same way, and every link out with where it was found. Whether the post is a
// lead or the content is the model's to weigh; a cut-short text is never a
// candidate, so it cannot be filed whatever the model says.

import type { Material } from "../../workshop/bindery";
import { htmlToText } from "../../workshop/extract/sanitize";
import type { CandidateSeed, LinkReader, LinkReading } from "../links/readers";
import { xPostOfUrl } from "./post";
import { readPost, type XOwnDocument, type XPostRead, type XPostRecord, type XReadDeps } from "./read-post";

/** What the model is shown of a post's words. */
export const POST_TEXT_CHARS = 2000;

function shapeWords(record: XPostRecord): string {
  if (record.shape === "article") return `an X Article ("${record.articleTitle ?? ""}")`;
  if (record.shape === "long") return "a long post";
  return "a post";
}

function receiptPhrase(record: XPostRecord): string {
  const date = record.postedAt.slice(0, 10);
  return `${shapeWords(record)} by @${record.author.handle}${date ? ` (${date})` : ""}`;
}

function material(d: XOwnDocument): Material {
  return { kind: "html", html: d.html, title: d.title, author: d.author, publishedAt: d.publishedAt, sourceUrl: d.sourceUrl };
}

function selfNote(read: XPostRead): string {
  const { record } = read;
  if (record.shape === "short") return "a short post is not a document of its own";
  const own = read.skipped.find((s) => s.subject === record.url);
  if (own?.needsDesktop) return "its full text is only on the post's page, which this device cannot read (the desktop app can)";
  if (own) return own.reason;
  return "its full text was not read";
}

function modelLines(read: XPostRead, self: XOwnDocument | undefined): string[] {
  const { record } = read;
  const who = record.author.name ? `${record.author.name} (@${record.author.handle})` : `@${record.author.handle}`;
  const body = self ? htmlToText(self.html) : record.text;
  const whole = self ? true : record.textComplete;
  const shown = body.slice(0, POST_TEXT_CHARS);
  const label = !whole ? "only the opening" : body.length > shown.length ? `the first ${POST_TEXT_CHARS} of ${body.length} characters` : `whole, ${body.length} characters`;
  const lines = [
    `Author: ${who}, posted ${record.postedAt}`,
    `Form: ${shapeWords(record).replace(/^an? /, "")}`,
    `Text (${label}):`,
    shown,
    `Images: ${record.images.length}; videos: ${record.videos}`,
  ];
  if (record.selfReplies?.length) lines.push(`The author's own replies under it: ${record.selfReplies.length} (their links are listed)`);
  if (record.quoted) lines.push(`Quotes ${shapeWords(record.quoted)} by @${record.quoted.author.handle}`);
  return lines;
}

/** The X reader on these deps: the embed, the hidden webview where there is one. */
export function xLinkReader(deps: XReadDeps): LinkReader {
  return {
    name: "x",
    claims: (url) => xPostOfUrl(url) !== null,
    async read(url): Promise<LinkReading | import("../../workshop/bindery").Rejection> {
      const read = await readPost(url, deps);
      if (!read.ok) return read;
      const { record } = read;
      const self = read.own.find((d) => d.postId === record.id);
      const seeds: CandidateSeed[] = [];
      if (self) seeds.push({ url: record.url, material: material(self), origin: "body", self: true });
      for (const d of read.own) {
        if (d === self) continue;
        const what = d.shape === "article" ? "X Article" : d.shape === "long" ? "long post" : "post";
        seeds.push({
          url: d.sourceUrl,
          material: material(d),
          anchor: d.title,
          origin: "quoted",
          about: `${what} by ${d.author}, ${d.chars} characters, read whole`,
        });
      }
      for (const l of read.links) seeds.push({ url: l.url, anchor: l.anchor, origin: l.origin });
      return {
        ok: true,
        receipt: receiptPhrase(record),
        lines: modelLines(read, self),
        record: { key: `x:${record.id}`, source: "x", data: record },
        candidates: seeds,
        notes: read.skipped.map((s) => `${s.subject}: ${s.reason}${s.needsDesktop ? " (the desktop app can read it)" : ""}`),
        ...(self ? {} : { selfNote: selfNote(read) }),
      };
    },
  };
}
