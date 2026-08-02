import { describe, expect, test } from "bun:test";
import { classifyLink, handleDelegatedLinkClick } from "./external-link";

// The release origin and the dev server, the two bases the app ever runs on.
const RELEASE = "tauri://localhost/";
const DEV = "http://localhost:1420/";

describe("classifyLink", () => {
  test("a web link goes to the system browser", () => {
    for (const base of [RELEASE, DEV]) {
      expect(classifyLink("https://arxiv.org/abs/1705.08439", base)).toEqual({
        kind: "external",
        url: "https://arxiv.org/abs/1705.08439",
      });
      expect(classifyLink("http://example.com/a?b=c#d", base)).toEqual({
        kind: "external",
        url: "http://example.com/a?b=c#d",
      });
    }
  });

  test("surrounding whitespace does not hide a link", () => {
    expect(classifyLink("  https://example.com/  ", RELEASE)).toEqual({
      kind: "external",
      url: "https://example.com/",
    });
  });

  test("a fragment stays in the page", () => {
    expect(classifyLink("#rp-p12", RELEASE)).toEqual({ kind: "pass" });
    expect(classifyLink("", RELEASE)).toEqual({ kind: "pass" });
    expect(classifyLink(null, RELEASE)).toEqual({ kind: "pass" });
    expect(classifyLink(undefined, RELEASE)).toEqual({ kind: "pass" });
  });

  test("a link to our own origin is swallowed: it would reload the app", () => {
    expect(classifyLink("/library", RELEASE)).toEqual({ kind: "block" });
    expect(classifyLink("index.html", RELEASE)).toEqual({ kind: "block" });
    expect(classifyLink("?shell=phone", RELEASE)).toEqual({ kind: "block" });
    expect(classifyLink("tauri://localhost/x", RELEASE)).toEqual({ kind: "block" });
    expect(classifyLink("/library", DEV)).toEqual({ kind: "block" });
    expect(classifyLink("http://localhost:1420/x", DEV)).toEqual({ kind: "block" });
  });

  test("the dev server is a foreign origin to a release build and the other way round", () => {
    expect(classifyLink("http://localhost:1420/x", RELEASE)).toEqual({
      kind: "external",
      url: "http://localhost:1420/x",
    });
    expect(classifyLink("http://localhost:3000/x", DEV)).toEqual({
      kind: "external",
      url: "http://localhost:3000/x",
    });
  });

  test("other schemes are left to the webview and to the Rust guard", () => {
    for (const href of [
      "mailto:someone@example.com",
      "tel:+1234567890",
      "img://localhost/https%3A%2F%2Fcdn%2Fa.jpg",
      "data:text/plain,hi",
      "com.googleusercontent.apps.379091688229-esc:/callback",
    ]) {
      expect(classifyLink(href, RELEASE)).toEqual({ kind: "pass" });
    }
  });

  test("an unparseable href goes nowhere", () => {
    expect(classifyLink("http://[", RELEASE)).toEqual({ kind: "pass" });
  });
});

// A stand-in for the click on injected article HTML: `closest` is the only DOM
// call the handler makes.
function clickOn(anchorHref: string | null | undefined) {
  let prevented = false;
  const anchor =
    anchorHref === undefined ? null : { getAttribute: (_name: string) => anchorHref };
  handleDelegatedLinkClick({
    target: { closest: (_selector: string) => anchor },
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

describe("handleDelegatedLinkClick", () => {
  test("a click that is not on a link is left alone", () => {
    expect(clickOn(undefined)).toBe(false);
    let prevented = false;
    handleDelegatedLinkClick({
      target: { nodeName: "P" },
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
  });

  test("an anchor with no href is left alone", () => {
    // sanitizeArticleHtml rewrites a non-http(s) link to a bare <a>.
    expect(clickOn(null)).toBe(false);
  });

  test("an in-page anchor is left alone", () => {
    expect(clickOn("#section-2")).toBe(false);
  });

  test("a link that would navigate is taken over", () => {
    expect(clickOn("https://example.com/a")).toBe(true);
    expect(clickOn("/relative")).toBe(true);
  });

  test("an already handled click is not handled twice", () => {
    let prevented = false;
    handleDelegatedLinkClick({
      target: { closest: () => ({ getAttribute: () => "https://example.com/" }) },
      defaultPrevented: true,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false);
  });
});
