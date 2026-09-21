// The web image search behind the dish photographs (docs/73 图片).
//
// Every body here is the documented Custom Search JSON API shape
// (developers.google.com/custom-search/v1/reference/rest/v1/Search): items[]
// with link, title, displayLink and an image object carrying contextLink,
// thumbnailLink, width and height. Nothing calls Google: the key is the
// reader's and there is none here.

import { expect, test } from "bun:test";
import {
  composeDishPhotoLookup,
  googleImageQuery,
  googleSearchCreds,
  lookupGoogleImage,
  type GoogleSearchCreds,
} from "../../../src/info/dinner/google-images";
import type { DishPhotoLookup } from "../../../src/info/dinner/dish-photos";
import type { DishPhoto } from "../../../src/info/dinner/types";

const CREDS: GoogleSearchCreds = { apiKey: "k-1", engineId: "cx-1" };

function item(over: Record<string, unknown> = {}, image: Record<string, unknown> = {}) {
  return {
    title: "Mapo tofu",
    link: "https://cdn.example/mapo.jpg",
    displayLink: "example.com",
    image: {
      contextLink: "https://example.com/recipes/mapo-tofu",
      thumbnailLink: "https://encrypted.example/thumb.jpg",
      width: 1200,
      height: 800,
      ...image,
    },
    ...over,
  };
}

function reply(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status });
}

test("credentials need both halves, trimmed", () => {
  expect(googleSearchCreds(null)).toBe(null);
  expect(googleSearchCreds({ googleSearchApiKey: "k", googleSearchEngineId: null })).toBe(null);
  expect(googleSearchCreds({ googleSearchApiKey: null, googleSearchEngineId: "cx" })).toBe(null);
  expect(googleSearchCreds({ googleSearchApiKey: "  k ", googleSearchEngineId: " cx " })).toEqual({
    apiKey: "k",
    engineId: "cx",
  });
});

test("the query asks for five large landscape-ish images, safe search on", () => {
  const url = new URL(googleImageQuery("tomato egg stir fry", CREDS));
  expect(url.origin + url.pathname).toBe("https://www.googleapis.com/customsearch/v1");
  const p = url.searchParams;
  expect(p.get("key")).toBe("k-1");
  expect(p.get("cx")).toBe("cx-1");
  expect(p.get("q")).toBe("tomato egg stir fry");
  expect(p.get("searchType")).toBe("image");
  expect(p.get("num")).toBe("5");
  expect(p.get("safe")).toBe("active");
  expect(p.get("imgSize")).toBe("large");
});

test("a hit becomes a photo record crediting the site and pointing at the page", async () => {
  const answer = await lookupGoogleImage("mapo tofu", CREDS, reply({ items: [item()] }));
  expect(answer.ok).toBe(true);
  const photo = (answer as { ok: true; photo: DishPhoto }).photo;
  expect(photo.url).toBe("https://cdn.example/mapo.jpg");
  expect(photo.thumb).toBe("https://encrypted.example/thumb.jpg");
  expect(photo.title).toBe("Mapo tofu");
  expect(photo.creator).toBe("example.com");
  expect(photo.license).toBe("");
  expect(photo.foreignLandingUrl).toBe("https://example.com/recipes/mapo-tofu");
  // The Referer the proxy sends (docs/pitfall/30).
  expect(photo.pageUrl).toBe("https://example.com/recipes/mapo-tofu");
});

test("the first landscape result wins over an earlier portrait one", async () => {
  const body = {
    items: [
      item({ link: "https://cdn.example/tall.jpg" }, { width: 600, height: 900 }),
      item({ link: "https://cdn.example/wide.jpg" }),
    ],
  };
  const answer = await lookupGoogleImage("dal tadka", CREDS, reply(body));
  expect((answer as { ok: true; photo: DishPhoto }).photo.url).toBe("https://cdn.example/wide.jpg");
});

test("a portrait-only page still answers with its first result", async () => {
  const body = { items: [item({ link: "https://cdn.example/tall.jpg" }, { width: 600, height: 900 })] };
  const answer = await lookupGoogleImage("farro salad", CREDS, reply(body));
  expect((answer as { ok: true; photo: DishPhoto }).photo.url).toBe("https://cdn.example/tall.jpg");
});

test("results without a usable link or image object are skipped", async () => {
  const body = {
    items: [
      { title: "no link", displayLink: "a.example", image: { contextLink: "https://a.example" } },
      item({ link: "ftp://cdn.example/x.jpg" }),
      { ...item(), image: undefined },
      item({ link: "https://cdn.example/good.jpg" }),
    ],
  };
  const answer = await lookupGoogleImage("minestrone", CREDS, reply(body));
  expect((answer as { ok: true; photo: DishPhoto }).photo.url).toBe("https://cdn.example/good.jpg");
});

test("an empty answer is an answer", async () => {
  expect(await lookupGoogleImage("nothing at all", CREDS, reply({ searchInformation: {} }))).toEqual({
    ok: true,
    photo: null,
  });
  expect(await lookupGoogleImage("nothing at all", CREDS, reply({ items: [] }))).toEqual({
    ok: true,
    photo: null,
  });
});

test("a rejected key, a spent quota and a dead network are not answers", async () => {
  expect(await lookupGoogleImage("mapo tofu", CREDS, reply({ error: {} }, 403))).toEqual({ ok: false });
  expect(await lookupGoogleImage("mapo tofu", CREDS, reply({ error: {} }, 429))).toEqual({ ok: false });
  expect(
    await lookupGoogleImage("mapo tofu", CREDS, async () => {
      throw new Error("offline");
    }),
  ).toEqual({ ok: false });
  expect(
    await lookupGoogleImage("mapo tofu", CREDS, async () => new Response("<html>", { status: 200 })),
  ).toEqual({ ok: false });
});

test("an empty name is never asked", async () => {
  let called = 0;
  const answer = await lookupGoogleImage("  ", CREDS, async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  });
  expect(answer).toEqual({ ok: false });
  expect(called).toBe(0);
});

// The composition: what the live ports hand to Apply.

const PHOTO: DishPhoto = {
  url: "https://cdn.example/g.jpg",
  thumb: "",
  title: "",
  creator: "example.com",
  license: "",
  licenseUrl: "",
  foreignLandingUrl: "https://example.com/p",
  pageUrl: "https://example.com/p",
};

const OPENVERSE_PHOTO: DishPhoto = { ...PHOTO, url: "https://live.example/o.jpg", creator: "someone" };

function spy(answer: DishPhotoLookup) {
  const names: string[] = [];
  const fn = async (name: string) => {
    names.push(name);
    return answer;
  };
  return { fn, names };
}

test("with no key the free index is the whole story", async () => {
  const openverse = spy({ ok: true, photo: OPENVERSE_PHOTO });
  const lookup = composeDishPhotoLookup(null, openverse.fn);
  expect(await lookup("mapo tofu")).toEqual({ ok: true, photo: OPENVERSE_PHOTO });
  expect(openverse.names).toEqual(["mapo tofu"]);
});

test("a search hit is used and the free index is not asked", async () => {
  const google = spy({ ok: true, photo: PHOTO });
  const openverse = spy({ ok: true, photo: OPENVERSE_PHOTO });
  const lookup = composeDishPhotoLookup(google.fn, openverse.fn);
  expect(await lookup("mapo tofu")).toEqual({ ok: true, photo: PHOTO });
  expect(openverse.names).toEqual([]);
});

test("a search that found nothing falls through to the free index", async () => {
  const openverse = spy({ ok: true, photo: OPENVERSE_PHOTO });
  const lookup = composeDishPhotoLookup(spy({ ok: true, photo: null }).fn, openverse.fn);
  expect(await lookup("sheet pan salmon")).toEqual({ ok: true, photo: OPENVERSE_PHOTO });
  expect(openverse.names).toEqual(["sheet pan salmon"]);
});

test("a rejected key does not silence the free index", async () => {
  const openverse = spy({ ok: true, photo: OPENVERSE_PHOTO });
  const lookup = composeDishPhotoLookup(spy({ ok: false }).fn, openverse.fn);
  expect(await lookup("shakshuka")).toEqual({ ok: true, photo: OPENVERSE_PHOTO });
  expect(openverse.names).toEqual(["shakshuka"]);
});

test("both failing is still one unanswered lookup, not a throw", async () => {
  const lookup = composeDishPhotoLookup(spy({ ok: false }).fn, spy({ ok: false }).fn);
  expect(await lookup("shakshuka")).toEqual({ ok: false });
});
