// Reading a hidden-webview fetch as a body, a reason to try again, or a body
// that is not there (src/info/extract/webview-article.ts). Pure — the fetch
// itself is a Tauri command and does not run here. Run: bun test.

import { expect, test } from "bun:test";
import { webviewBody, type WebviewArticle } from "../../src/info/extract/webview-article";

function result(patch: Partial<WebviewArticle>): WebviewArticle {
  return {
    status: "ok",
    requestedUrl: "https://www.bloomberg.com/news/articles/2026-08-11/x",
    finalUrl: "https://www.bloomberg.com/news/articles/2026-08-11/x",
    title: "Indonesia Copper Shipments Delayed by Gresik Smelter Outage - Bloomberg",
    text: "Copper shipments from Indonesia are suffering delays after the smelter that processes ore from the giant Grasberg mine was halted because of a boiler leak over the weekend.",
    html: "<p>Copper shipments…</p>",
    selector: '[data-component="paragraph"]',
    ldJson: [],
    chars: 530,
    promosDropped: 0,
    seesSignIn: true,
    warmed: false,
    elapsedMs: 27503,
    detail: null,
    ...patch,
  };
}

test("a body is a body", () => {
  const body = webviewBody(result({}));
  expect(body.kind).toBe("body");
  if (body.kind !== "body") return;
  expect(body.text).toContain("Copper shipments");
  expect(body.title).toContain("Indonesia Copper");
});

test("a body read without a session is a preview, on a source that has one", () => {
  // Measured: the same three articles ran 584/528 characters anonymous and
  // 1959/1624 signed in. The short one is a real body and not the whole story,
  // so it is flagged the way a paywall-truncated feed body is.
  const anonymous = webviewBody(result({ seesSignIn: true }), { hasSignIn: true });
  expect(anonymous.kind === "body" && anonymous.preview).toBe(true);

  const session = webviewBody(result({ seesSignIn: false, chars: 1959 }), { hasSignIn: true });
  expect(session.kind === "body" && session.preview).toBe(false);

  // A site that gives an anonymous reader everything still shows a sign-in link
  // in its header. Without a sign-in in the descriptor, that link means nothing.
  const free = webviewBody(result({ seesSignIn: true }));
  expect(free.kind === "body" && free.preview).toBe(false);
});

test("a wall, a timeout and a dead host are all worth another try", () => {
  for (const status of ["blocked", "timeout", "network"] as const) {
    const outcome = webviewBody(result({ status, text: null, html: null, chars: 0, detail: "why" }));
    expect(outcome.kind).toBe("retry");
    expect(outcome.kind === "retry" && outcome.reason).toBe("why");
  }
});

test("a page with no article, and a platform with no webview, are not retries", () => {
  // Nothing to come back for: asking again changes nothing about either.
  expect(webviewBody(result({ status: "empty", text: null, chars: 0 })).kind).toBe("absent");
  expect(webviewBody(result({ status: "unsupported", text: null, chars: 0 })).kind).toBe("absent");
  // An `ok` with nothing in it should not happen — the Rust side calls that
  // `empty` — but it is a body that is not there either way.
  expect(webviewBody(result({ text: "   " })).kind).toBe("absent");
});
