// Posts out of the GraphQL answers the X page receives, against handwritten
// answers of the public shape (graphql-fixtures.ts).

import { describe, expect, test } from "bun:test";
import { operationOfUrl, parseCreatedAt, postsOfAnswer } from "../../../src/info/x/graphql-post";
import { entry, searchTimeline, tweet, tweetDetail } from "./graphql-fixtures";

const LONG = `Long thread opener about protein design. ${"More words about the method and the data. ".repeat(10)}Paper: https://t.co/paper1 and code https://t.co/code1`;

describe("a search answer", () => {
  test("a long post: the whole note text, links expanded, counts exact", () => {
    const answer = searchTimeline([
      entry(
        tweet({
          id: "1900000000000000001",
          handle: "lab",
          name: "The Lab",
          note: LONG,
          urls: [
            { tco: "https://t.co/paper1", url: "https://arxiv.org/abs/2605.24043", inNote: true },
            { tco: "https://t.co/code1", url: "https://github.com/lab/design", inNote: true },
          ],
          counts: { likes: 1234, reposts: 56, replies: 7, quotes: 8, bookmarks: 90, views: "45678" },
        }),
      ),
    ]);
    const post = postsOfAnswer(answer).get("1900000000000000001")!;
    expect(post.long).toBe(true);
    expect(post.text.length).toBeGreaterThan(400);
    expect(post.text).toContain("Paper: https://arxiv.org/abs/2605.24043 and code https://github.com/lab/design");
    expect(post.text).not.toContain("t.co");
    expect(post.links.map((l) => l.url)).toEqual(["https://arxiv.org/abs/2605.24043", "https://github.com/lab/design"]);
    expect(post.counts).toEqual({ replies: 7, reposts: 56, likes: 1234, bookmarks: 90, views: 45678, quotes: 8 });
    expect(post.handle).toBe("lab");
    expect(post.name).toBe("The Lab");
    expect(post.createdAt).toBe(Date.parse("2026-10-14T01:58:00Z"));
  });

  test("a short post: the display range, entities unescaped, the trailing media link left out", () => {
    const raw = tweet({ id: "1900000000000000002", text: "Q&amp;A on folding https://t.co/aaa https://t.co/media", urls: [{ tco: "https://t.co/aaa", url: "https://example.org/qa" }], media: true });
    const legacy = raw.legacy as { display_text_range: number[]; full_text: string };
    legacy.display_text_range = [0, Array.from(legacy.full_text).length - " https://t.co/media".length];
    const post = postsOfAnswer(searchTimeline([entry(raw)])).get("1900000000000000002")!;
    expect(post.text).toBe("Q&A on folding https://example.org/qa");
    expect(post.long).toBe(false);
    expect(post.media).toBe(true);
  });

  test("a reply's leading mentions are outside its display range", () => {
    const raw = tweet({ id: "1900000000000000003", text: "@other @third Agreed, see the paper", replyTo: { id: "1800000000000000000", handle: "other" } });
    (raw.legacy as { display_text_range: number[] }).display_text_range = [14, 35];
    const post = postsOfAnswer(searchTimeline([entry(raw)])).get("1900000000000000003")!;
    expect(post.text).toBe("Agreed, see the paper");
    expect(post.replyTo).toEqual({ id: "1800000000000000000", handle: "other" });
  });

  test("the quoted post is whole and keeps its own links; the quoting post does not get them", () => {
    const quoted = tweet({ id: "1800000000000000010", handle: "author", note: LONG, urls: [{ tco: "https://t.co/paper1", url: "https://arxiv.org/abs/2605.24043", inNote: true }] });
    const answer = searchTimeline([entry(tweet({ id: "1900000000000000004", text: "Worth reading", quoted }))]);
    const posts = postsOfAnswer(answer);
    const post = posts.get("1900000000000000004")!;
    expect(post.links).toEqual([]);
    expect(post.quoted?.id).toBe("1800000000000000010");
    expect(post.quoted?.handle).toBe("author");
    expect(post.quoted?.links.map((l) => l.url)).toEqual(["https://arxiv.org/abs/2605.24043"]);
    expect(post.quotedId).toBe("1800000000000000010");
    // The quoted post is also a post of the answer under its own id.
    expect(posts.get("1800000000000000010")?.long).toBe(true);
  });

  test("an X Article: id, title and preview, its own article link left out of text and links", () => {
    const raw = tweet({
      id: "1900000000000000005",
      text: "https://t.co/art",
      urls: [{ tco: "https://t.co/art", url: "https://x.com/i/article/1900000000000000099" }],
      article: { id: "1900000000000000099", title: "How we built it" },
    });
    const post = postsOfAnswer(searchTimeline([entry(raw)])).get("1900000000000000005")!;
    expect(post.article).toEqual({ id: "1900000000000000099", title: "How we built it", preview: "A preview." });
    expect(post.text).toBe("");
    expect(post.links).toEqual([]);
  });

  test("a card's t.co that the text does not carry is kept as a card link to expand", () => {
    const raw = tweet({ id: "1900000000000000006", text: "New post on the blog", card: "https://t.co/card9" });
    const post = postsOfAnswer(searchTimeline([entry(raw)])).get("1900000000000000006")!;
    expect(post.links).toEqual([{ tco: "https://t.co/card9", url: null, card: true }]);
  });

  test("a repost names what it reposts; a wrapped post and the newer user shape read the same", () => {
    const original = tweet({ id: "1800000000000000020", handle: "orig", text: "original words" });
    const answer = searchTimeline([
      entry(tweet({ id: "1900000000000000007", text: "RT @orig: original words", retweeted: original })),
      entry(tweet({ id: "1900000000000000008", handle: "newer", name: "New Shape", coreNames: true, text: "hello" }), true),
    ]);
    const posts = postsOfAnswer(answer);
    expect(posts.get("1900000000000000007")?.retweetOf).toBe("1800000000000000020");
    expect(posts.get("1800000000000000020")?.text).toBe("original words");
    expect(posts.get("1900000000000000008")).toMatchObject({ handle: "newer", name: "New Shape", text: "hello" });
  });

  test("a post page's answer reads the same way", () => {
    const focal = tweet({ id: "1900000000000000009", note: LONG });
    const reply = tweet({ id: "1900000000000000010", text: "nice" });
    const posts = postsOfAnswer(tweetDetail(focal, reply));
    expect(posts.get("1900000000000000009")?.long).toBe(true);
    expect(posts.get("1900000000000000010")?.text).toBe("nice");
  });

  test("anything else is no posts, not an error", () => {
    expect(postsOfAnswer(null).size).toBe(0);
    expect(postsOfAnswer({ errors: [{ message: "Rate limit exceeded" }] }).size).toBe(0);
    expect(postsOfAnswer({ data: { user: { result: { rest_id: "42", legacy: { screen_name: "x" } } } } }).size).toBe(0);
    // A post whose fields moved: the text is gone, so it is not taken as a post.
    expect(postsOfAnswer(searchTimeline([entry({ __typename: "Tweet", rest_id: "1", legacy: {} })])).size).toBe(0);
  });
});

describe("helpers", () => {
  test("operations by URL", () => {
    expect(operationOfUrl("https://x.com/i/api/graphql/AbC-12_x/SearchTimeline?variables=%7B%7D")).toBe("SearchTimeline");
    expect(operationOfUrl("https://x.com/i/api/graphql/q1/TweetDetail?variables=")).toBe("TweetDetail");
    expect(operationOfUrl("https://api.x.com/graphql/q1/TweetResultByRestId")).toBe("TweetResultByRestId");
    expect(operationOfUrl("https://x.com/i/api/graphql/q1/UserByScreenName?v=1")).toBeNull();
    expect(operationOfUrl("https://x.com/search?q=SearchTimeline")).toBeNull();
  });

  test("created_at", () => {
    expect(parseCreatedAt("Wed Oct 14 01:58:00 +0000 2026")).toBe(Date.parse("2026-10-14T01:58:00Z"));
    expect(parseCreatedAt("Wed Oct 14 01:58:00 +0130 2026")).toBe(Date.parse("2026-10-14T00:28:00Z"));
    expect(parseCreatedAt("yesterday")).toBeNull();
  });
});
