// The bindery's quality gate (src/workshop/bindery/gate.ts): what is turned
// back instead of becoming a document, and why.
// Run: bash scripts/t.sh tests/workshop/bindery/gate.test.ts

import { expect, test } from "bun:test";
import { gateManuscript, WALL_MAX_CHARS, WALL_PATTERNS } from "../../../src/workshop/bindery/gate";
import type { Manuscript } from "../../../src/workshop/bindery/manuscript";
import { MIN_BODY_CHARS } from "../../../src/workshop/extract/readable-select";

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(20);

function ms(...bodies: string[]): Manuscript {
  return { title: "T", sections: bodies.map((html) => ({ html })), images: [] };
}

test("a body with text in it passes", () => {
  expect(gateManuscript(ms(`<p>${PROSE}</p>`))).toBeNull();
});

test("an empty body is turned back as empty, markup and whitespace included", () => {
  for (const html of ["", "   ", "<div><p> </p><img src='a.png'></div>", "<script>x()</script>"]) {
    expect(gateManuscript(ms(html))?.reason).toBe("empty");
  }
});

test("a body under the threshold is too short, and says how short", () => {
  const got = gateManuscript(ms(`<p>${"word ".repeat(30)}</p>`));
  expect(got?.reason).toBe("too-short");
  expect(got?.message).toContain(`fewer than the ${MIN_BODY_CHARS}`);
});

test("the threshold is the adapter's when it names one", () => {
  const short = ms("<p>a short note that is still the whole note</p>");
  expect(gateManuscript(short)?.reason).toBe("too-short");
  expect(gateManuscript(short, { minChars: 10 })).toBeNull();
});

test("the threshold counts every section's text together", () => {
  const half = `<p>${"x".repeat(Math.ceil(MIN_BODY_CHARS / 2))}</p>`;
  expect(gateManuscript(ms(half))?.reason).toBe("too-short");
  expect(gateManuscript(ms(half, half))).toBeNull();
});

test("X's no-script page is a wall, not a short article", () => {
  const got = gateManuscript(
    ms(
      "<p>JavaScript is not available.</p><p>We’ve detected that JavaScript is disabled in this " +
        "browser. Please enable JavaScript or switch to a supported browser to continue using " +
        "x.com. You can see a list of supported browsers in our Help Center.</p>",
    ),
  );
  expect(got?.reason).toBe("login-wall");
  expect(got?.message).toContain("JavaScript is not available");
});

test("each wall pattern catches the shell it was written for", () => {
  const shells = [
    "JavaScript is not available.",
    "Enable JavaScript and cookies to continue",
    "You need to enable JavaScript to run this app.",
    "Please enable JavaScript to view this page.",
    "Sign in to continue to the site.",
    "Log in to see this post.",
  ];
  for (const shell of shells) {
    expect(gateManuscript(ms(`<p>${shell}</p>`))?.reason).toBe("login-wall");
  }
  // Every pattern is exercised by at least one shell above.
  for (const { pattern } of WALL_PATTERNS) {
    expect(shells.some((s) => pattern.test(s))).toBe(true);
  }
});

test("a long article that quotes a wall sentence is still an article", () => {
  const body = `<p>The site said "JavaScript is not available" and we wrote about it.</p><p>${PROSE.repeat(
    Math.ceil(WALL_MAX_CHARS / PROSE.length) + 1,
  )}</p>`;
  expect(gateManuscript(ms(body))).toBeNull();
});

test("a wall is reported as a wall even when the threshold would also refuse it", () => {
  expect(gateManuscript(ms("<p>Sign in to continue</p>"))?.reason).toBe("login-wall");
});
