import { expect, test } from "bun:test";
import { tcoTarget } from "../../../src/info/x/outbound";
import { classifyOutbound as classifyHint } from "../../../src/info/links/hints";
import { postBodyLines } from "../../../src/info/x/permalink";
import { largePhoto, parseSyndication, syndicationToken, xPostOfUrl } from "../../../src/info/x/post";
import { readXPost, type XReading } from "../../../src/info/x/rules";
import { htmlToText } from "../../../src/workshop/extract/sanitize";
import {
  ARTICLE_BODY,
  ARTICLE_TITLE,
  articlePost,
  fakeX,
  focalText,
  LONG_FULL,
  longPost,
  page,
  syn,
} from "./fixtures";

const ID = "2106807332688580789";
const URL_ = `https://x.com/0xMovez/status/${ID}`;
const PERMALINK = `https://x.com/0xMovez/status/${ID}`;

function read(result: Awaited<ReturnType<typeof readXPost>>): XReading {
  if (!result.ok) throw new Error(`rejected: ${result.message}`);
  return result;
}

test("links to a post are recognised on every X host, and nothing else is", () => {
  expect(xPostOfUrl("https://x.com/0xMovez/status/2106807332688580789?s=20")).toEqual({
    id: "2106807332688580789",
    handle: "0xMovez",
  });
  expect(xPostOfUrl("https://mobile.twitter.com/a_b/status/123456789/photo/1")?.id).toBe("123456789");
  expect(xPostOfUrl("https://x.com/i/web/status/123456789")).toEqual({ id: "123456789" });
  expect(xPostOfUrl("https://x.com/0xMovez")).toBeNull();
  expect(xPostOfUrl("https://example.com/a/status/123456789")).toBeNull();
  expect(syndicationToken(ID)).toMatch(/^[0-9a-z]+$/);
});

test("the embed's long-post text is never taken as whole, its links and photos are", () => {
  const post = parseSyndication(
    longPost(ID, {
      text: "see https://t.co/abc and more &amp; more https://t.co/pic",
      display_text_range: [0, 40],
      entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://github.com/a/b" }] },
      mediaDetails: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/P1.jpg" }],
    }),
  );
  if (!post || post === "unavailable") throw new Error("not parsed");
  expect(post.shape).toBe("long");
  expect(post.text).toBe("see https://github.com/a/b and more & more");
  expect(post.links).toEqual(["https://github.com/a/b"]);
  expect(post.photos).toEqual(["https://pbs.twimg.com/media/P1?format=jpg&name=large"]);
  expect(parseSyndication({ __typename: "TweetTombstone" })).toBe("unavailable");
  expect(largePhoto("https://pbs.twimg.com/media/X?format=webp&name=small")).toBe(
    "https://pbs.twimg.com/media/X?format=jpg&name=large",
  );
});

test("a short post with no link is kept as a record and nothing else, without a page load", async () => {
  const x = fakeX([syn({ id_str: ID, text: "Good morning.", display_text_range: [0, 13] })], {});
  const got = read(await readXPost(URL_, x.deps));
  expect(got.documents).toEqual([]);
  expect(got.follow).toEqual([]);
  expect(got.skipped).toEqual([]);
  expect(got.record.text).toBe("Good morning.");
  expect(got.record.textComplete).toBe(true);
  expect(x.pagesRead).toEqual([]);
});

test("a short post's links are followed: entities and the card's t.co, homepages and X links not", async () => {
  const x = fakeX(
    [
      syn({
        id_str: ID,
        text: "48 pages https://t.co/d1 and https://t.co/home",
        display_text_range: [0, 46],
        entities: {
          urls: [
            { url: "https://t.co/d1", expanded_url: "https://drive.google.com/file/d/1PT/view" },
            { url: "https://t.co/home", expanded_url: "https://fly.io/" },
          ],
        },
        card: { binding_values: { card_url: { string_value: "https://t.co/card" } } },
      }),
    ],
    {},
    { "https://t.co/card": "https://github.com/amontlabs/lcu" },
  );
  const got = read(await readXPost(URL_, x.deps));
  expect(got.follow.map((f) => [f.kind, f.url])).toEqual([
    ["drive", "https://drive.google.com/file/d/1PT/view"],
    ["github", "https://github.com/amontlabs/lcu"],
  ]);
  expect(got.skipped).toEqual([{ subject: "https://fly.io/", reason: "a site's homepage" }]);
  expect(got.record.links).toContain("https://github.com/amontlabs/lcu");
  expect(x.pagesRead).toEqual([]);
});

test("a long post's text comes from the page, with the links the embed cut off and the author's own reply", async () => {
  const pdfReply = {
    handle: "0xMovez",
    id: "2106807337436495954",
    text: "\nMovez\n\n@0xMovez\nOct 5\n\n\nLocal LLM Thesis: \n\ndrive.google.com\nThesis.pdf\n\n\n\n8\n\n\n30\n\n\n5.2K\n",
    links: [{ href: "https://t.co/pdf", text: "drive.google.com Thesis.pdf" }],
  };
  const other = { handle: "someone_else", id: "2107059965479555098", text: "\nX\n\n@someone_else\nOct 5\n\nnice\n" };
  const x = fakeX(
    [longPost(ID)],
    {
      [PERMALINK]: page(
        {
          handle: "0xMovez",
          id: ID,
          text: focalText("0xMovez", `${LONG_FULL}\n[[rp-img:0]]\n🔗 https://github.com/MervinPraison/PraisonAI`),
          images: ["https://pbs.twimg.com/media/P1?format=webp&name=small"],
          links: [{ href: "https://github.com/MervinPraison/PraisonAI", text: "https://github.com/MervinPraison/PraisonAI" }],
        },
        pdfReply,
        other,
      ),
    },
    { "https://t.co/pdf": "https://drive.google.com/file/d/LOCAL/view?usp=drive_link" },
  );
  const got = read(await readXPost(URL_, x.deps));
  expect(x.pagesRead).toEqual([PERMALINK]);
  // It leads somewhere, so it is a lead: its words are the record, not a document.
  expect(got.documents).toEqual([]);
  expect(got.record.text).toContain("which of my 1000 calls ever needed the smart one");
  expect(got.record.text).not.toContain("Show translation");
  expect(got.record.text).not.toContain("Views");
  expect(got.record.textComplete).toBe(true);
  expect(got.record.selfReplies).toHaveLength(1);
  expect(got.record.selfReplies?.[0]).toContain("Local LLM Thesis:");
  expect(got.record.images).toContain("https://pbs.twimg.com/media/P1?format=jpg&name=large");
  expect(got.follow.map((f) => f.url)).toEqual([
    "https://github.com/MervinPraison/PraisonAI",
    "https://drive.google.com/file/d/LOCAL/view?usp=drive_link",
  ]);
});

test("a long post that links nowhere becomes its own document, from the page", async () => {
  const x = fakeX([longPost(ID)], {
    [PERMALINK]: page({
      handle: "0xMovez",
      id: ID,
      text: focalText("0xMovez", `${LONG_FULL}\n[[rp-img:0]]`),
      images: ["https://pbs.twimg.com/media/P1?format=webp&name=small"],
    }),
  });
  const got = read(await readXPost(URL_, x.deps));
  expect(got.follow).toEqual([]);
  expect(got.documents).toHaveLength(1);
  const doc = got.documents[0];
  const text = htmlToText(doc.html);
  expect(text).toContain("which of my 1000 calls ever needed the smart one");
  expect(text).not.toContain("Show translation");
  expect(text).not.toContain("Views");
  expect(doc.html).toContain('<img src="https://pbs.twimg.com/media/P1?format=jpg&amp;name=large"');
  expect(doc.title).toBe("Andrej Karpathy predicted the future of AI once again.");
  expect(doc.author).toBe("Movez (@0xMovez)");
});

test("an Article's body comes from the page, under its title, and its own links are not followed", async () => {
  const body = ARTICLE_BODY.join("\n\n");
  const x = fakeX([articlePost(ID)], {
    [PERMALINK]: page({
      handle: "0xMovez",
      id: ID,
      text: focalText(
        "0xMovez",
        `${ARTICLE_TITLE}\n\n142\n\n\n207\n\n\n2K\n\n\n3.3K\n\n\n${body}\n\n[[rp-img:0]]\n\nRead https://github.com/a/skill\n`,
      ),
      images: ["https://pbs.twimg.com/media/IN1?format=webp&name=medium"],
      links: [{ href: "https://github.com/a/skill", text: "https://github.com/a/skill" }],
    }),
  });
  const got = read(await readXPost(URL_, x.deps));
  expect(got.documents).toHaveLength(1);
  const doc = got.documents[0];
  expect(doc.shape).toBe("article");
  expect(doc.title).toBe(ARTICLE_TITLE);
  const text = htmlToText(doc.html);
  expect(text.startsWith(ARTICLE_BODY[0])).toBe(true);
  expect(text).not.toContain("3.3K");
  expect(doc.html).toContain("IN1?format=jpg");
  expect(got.follow).toEqual([]);
  expect(got.record.articleTitle).toBe(ARTICLE_TITLE);
  expect(got.record.textComplete).toBe(false);
});

test("a quoted Article goes through the same decision and becomes its own document", async () => {
  const QID = "2106761689123139973";
  const quoting = syn({
    id_str: ID,
    text: "this is the full course https://t.co/q",
    display_text_range: [0, 23],
    quoted_tweet: articlePost(QID),
  });
  const x = fakeX([quoting], {
    [`https://x.com/0xMovez/status/${QID}`]: page({
      handle: "0xMovez",
      id: QID,
      text: focalText("0xMovez", `${ARTICLE_TITLE}\n\n${ARTICLE_BODY.join("\n\n")}`),
    }),
  });
  const got = read(await readXPost(URL_, x.deps));
  expect(got.documents.map((d) => [d.postId, d.title])).toEqual([[QID, ARTICLE_TITLE]]);
  expect(got.record.quoted?.id).toBe(QID);
  expect(got.record.quoted?.shape).toBe("article");
});

test("a quoted short post is put under the long post that quotes it", async () => {
  const QID = "2106761689123139973";
  const x = fakeX(
    [longPost(ID, { quoted_tweet: syn({ id_str: QID, text: "the original claim", display_text_range: [0, 18] }) })],
    {
      [PERMALINK]: page({
        handle: "0xMovez",
        id: ID,
        quotes: [QID],
        text: focalText("0xMovez", `${LONG_FULL}\n\n\nMovez\n\n@0xMovez\nOct 4\n\nthe original claim`),
      }),
    },
  );
  const got = read(await readXPost(URL_, x.deps));
  expect(got.documents).toHaveLength(1);
  const text = htmlToText(got.documents[0].html);
  // Once, as the blockquote, not again as the page's copy of the quote card.
  expect(text.split("the original claim")).toHaveLength(2);
  expect(got.documents[0].html).toContain("<blockquote>");
});

test("with no hidden webview a long post is not filed from the embed's opening; its links still are", async () => {
  const x = fakeX(
    [longPost(ID, { entities: { urls: [{ url: "https://t.co/g", expanded_url: "https://github.com/robotbird/pi-durable-book" }] } })],
    null,
  );
  const got = read(await readXPost(URL_, x.deps));
  expect(got.documents).toEqual([]);
  expect(got.record.textComplete).toBe(false);
  expect(got.skipped).toHaveLength(1);
  expect(got.skipped[0].needsDesktop).toBe(true);
  expect(got.skipped[0].reason).toContain("this device cannot read");
  expect(got.follow.map((f) => f.url)).toEqual(["https://github.com/robotbird/pi-durable-book"]);
});

test("a page that shows no post, or less than the embed, files nothing and says why", async () => {
  const empty = fakeX([longPost(ID)], {});
  const none = read(await readXPost(URL_, empty.deps));
  expect(none.documents).toEqual([]);
  expect(empty.pagesRead).toEqual([PERMALINK, PERMALINK]);
  expect(none.skipped[0].reason).toContain("could not be read");

  const short = fakeX([longPost(ID)], {
    [PERMALINK]: page({ handle: "0xMovez", id: ID, text: focalText("0xMovez", "Andrej Karpathy") }),
  });
  const cut = read(await readXPost(URL_, short.deps));
  expect(cut.documents).toEqual([]);
  expect(cut.skipped[0].reason).toContain("less text");
});

test("a post that is gone is a rejection, not a record", async () => {
  const x = fakeX([], {});
  const got = await readXPost(URL_, x.deps);
  expect(got.ok).toBe(false);
});

test("only the kinds of thing a post recommends are followed", () => {
  const followed = new Set(["site", "drive", "pdf", "github", "page"]);
  const classifyOutbound = (url: string, claimed: (u: string) => boolean) => {
    const h = classifyHint(url, (u) => (claimed(u) ? "site" : null));
    return followed.has(h.kind) ? { follow: true, kind: h.kind } : { follow: false, reason: h.reason };
  };
  const none = () => false;
  const verdict = (url: string) => {
    const v = classifyOutbound(url, none);
    return v.follow ? v.kind : v.reason;
  };
  expect(verdict("https://drive.google.com/file/d/1PT/view")).toBe("drive");
  expect(verdict("https://example.com/paper.pdf")).toBe("pdf");
  expect(verdict("https://github.com/amontlabs/lcu")).toBe("github");
  expect(verdict("https://github.com/features/copilot")).toBe("a GitHub page that is not a repository");
  expect(verdict("https://ai.meta.com/blog/introducing-muse/")).toBe("page");
  expect(verdict("https://fly.io/")).toBe("a site's homepage");
  expect(verdict("https://claude.ai/login")).toBe("a sign-in page");
  expect(verdict("https://example.com/pricing")).toBe("a product page");
  expect(verdict("https://www.youtube.com/watch?v=x")).toBe("a video, kept as a link only");
  expect(verdict("https://x.com/a/status/1")).toBe("a link to another page on X");
  expect(classifyOutbound("https://arxiv.org/", (u) => u.includes("arxiv"))).toEqual({ follow: true, kind: "site" });
  expect(tcoTarget(301, "https://a.example/x", "")).toBe("https://a.example/x");
  expect(tcoTarget(200, null, '<META http-equiv="refresh" content="0;URL=https://b.example/y">')).toBe(
    "https://b.example/y",
  );
});

test("a reply's lines drop its name, date and counts", () => {
  const lines = postBodyLines("\nMovez\n\n@0xMovez\nOct 5\n\n\nPart two of it.\n\nAnd more.\n\n\n8\n\n\n30\n", {
    handle: "0xMovez",
    reply: true,
  });
  expect(lines).toEqual(["Part two of it.", "", "And more."]);
});

test("a link card's title and source line are not the author's words", () => {
  const lines = postBodyLines(
    focalText("a", "The survey.\n\nhttps://github.com/robotbird/pi-durable-book\n\nGitHub - robotbird/pi-durable-book\nFrom github.com"),
    { handle: "a" },
  );
  expect(lines).toEqual(["The survey.", "", "https://github.com/robotbird/pi-durable-book"]);
});
