// Unit tests for deck assembly (src/reading/slides/template.ts): placeholders replaced,
// slides wrapped, output self-contained, host bridge present. Run: bun test.

import { expect, test } from "bun:test";
import { assembleDeck, slideTitleText, slugify } from "../../../src/reading/slides/template";

test("slugify makes a filename-safe stem", () => {
  expect(slugify("My Great Talk!")).toBe("my-great-talk");
  expect(slugify("   ")).toBe("talk");
  expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(60);
});

test("assembleDeck injects an asset into the placeholder", () => {
  const html = assembleDeck({
    title: "T",
    slides: [
      {
        kind: "content",
        fragment: '<div class="figwrap"><!--illustration--></div>',
        asset: "data:image/png;base64,AAA",
      },
    ],
  });
  expect(html).toContain('<img src="data:image/png;base64,AAA" alt="">');
  expect(html).not.toContain("<!--illustration-->");
});

test("assembleDeck removes a placeholder and its empty figwrap when no asset", () => {
  const html = assembleDeck({
    title: "T",
    slides: [{ kind: "content", fragment: '<div class="figwrap"><!--figure--></div>', asset: null }],
  });
  expect(html).not.toContain("<!--figure-->");
  expect(html).not.toContain('<div class="figwrap"></div>');
});

test("assembleDeck wraps slides, sets the counter total, and marks the title slide", () => {
  const html = assembleDeck({
    title: "Talk",
    slides: [
      { kind: "title", fragment: "<h1 class=\"deck-title\">Talk</h1>", asset: null },
      { kind: "content", fragment: "<h2>Body</h2>", asset: null },
    ],
  });
  expect(html).toContain('<section class="slide title-slide" data-slide="0"');
  expect(html).toContain('<section class="slide" data-slide="1"');
  expect(html).toContain("1 / 2");
  expect(html).toContain("<title>Talk</title>");
});

test("the assembled deck is self-contained: no external URLs", () => {
  const html = assembleDeck({
    title: "T",
    slides: [
      { kind: "content", fragment: '<ul class="pts"><li>Point<span class="pg">p.1</span></li></ul>', asset: "data:image/png;base64,ZZZ" },
    ],
  });
  // No http(s) references at all — only inline CSS/JS and data: assets.
  expect(/https?:\/\//.test(html)).toBe(false);
});

test("the shell can report a clipped slide at playback", () => {
  const html = assembleDeck({ title: "T", slides: [{ kind: "content", fragment: "<h2>x</h2>", asset: null }] });
  // The marker element, its class toggle, and the measurement that drives it.
  expect(html).toContain('id="overflow-warn"');
  expect(html).toContain("scrollHeight");
  expect(html).toContain("warn.classList.toggle('on'");
});

test("assembleDeck escapes the title", () => {
  const html = assembleDeck({ title: "A & B <x>", slides: [{ kind: "title", fragment: "", asset: null }] });
  expect(html).toContain("<title>A &amp; B &lt;x&gt;</title>");
});

test("slideTitleText reads the h2 headline", () => {
  expect(slideTitleText("<h2>Why it works</h2><ul></ul>")).toBe("Why it works");
});

test("slideTitleText drops the page badge and unwraps inline markup", () => {
  expect(slideTitleText('<h2>Why it <b>works</b><span class="pg">p.12</span></h2>')).toBe(
    "Why it works",
  );
  expect(slideTitleText('<h2><span class="pg">p.7</span>Lead</h2>')).toBe("Lead");
});

test("slideTitleText falls back to the title slide's deck-title, then to nothing", () => {
  expect(slideTitleText('<h1 class="deck-title">A &amp; B</h1>')).toBe("A & B");
  expect(slideTitleText('<div class="kicker">chapter 3</div><ul class="pts"><li>x</li></ul>')).toBe(
    "",
  );
});

test("slideTitleText prefers the h2 when a fragment carries both", () => {
  expect(slideTitleText('<h1 class="deck-title">Deck</h1><h2>Slide</h2>')).toBe("Slide");
});

test("each section carries its index, kind and escaped title for the host", () => {
  const html = assembleDeck({
    title: "Talk",
    slides: [
      { kind: "title", fragment: '<h1 class="deck-title">Talk</h1>', asset: null },
      { kind: "section", fragment: '<h2>Part <span class="pg">p.3</span></h2>', asset: null },
      { kind: "closing", fragment: '<h2>A "quoted" &amp; more</h2>', asset: null },
    ],
  });
  expect(html).toContain('data-slide="0" data-kind="title" data-title="Talk"');
  expect(html).toContain('data-slide="1" data-kind="section" data-title="Part"');
  expect(html).toContain('data-slide="2" data-kind="closing" data-title="A &quot;quoted&quot; &amp; more"');
});

test("the deck reports its position to a host and takes goto from one", () => {
  const html = assembleDeck({
    title: "T",
    slides: [{ kind: "content", fragment: "<h2>x</h2>", asset: null }],
  });
  // Silent unless embedded: no parent, no bridge.
  expect(html).toContain("const host = window.parent !== window ? window.parent : null;");
  expect(html).toContain("if (!host) return;");
  // deck -> host: one ready carrying the protocol version, then one per shown slide.
  expect(html).toContain(
    "host.postMessage({ source: 'deck', type: 'ready', protocol: 1, total: slides.length }, '*');",
  );
  expect(html).toContain("source: 'deck', type: 'slide', index: i, total: slides.length,");
  expect(html).toContain("kind: s ? s.dataset.kind : '', title: s ? s.dataset.title : ''");
  // The slide message rides inside show(), so the first one is show(0)'s.
  expect(/warn\.classList\.toggle\('on', !!over\);\s*report\(\);/.test(html)).toBe(true);
  // ready goes out before that first show(0).
  expect(html.indexOf("type: 'ready'")).toBeLessThan(html.lastIndexOf("show(0);"));
  // host -> deck: only our own protocol is obeyed.
  expect(html).toContain("if (!d || d.source !== 'deck-host') return;");
  expect(html).toContain("if (d.type === 'goto' && Number.isFinite(d.index)) show(d.index);");
  // No timestamps in the messages: the host clocks what it receives.
  expect(html).not.toContain("Date.now()");
});

test("standalone playback is unchanged: keys, click, counter and progress stay", () => {
  const html = assembleDeck({
    title: "T",
    slides: [{ kind: "content", fragment: "<h2>x</h2>", asset: null }],
  });
  expect(html).toContain("e.key === 'ArrowRight'");
  expect(html).toContain("if ((e.clientX - r.left) < r.width * 0.28) prev(); else next();");
  expect(html).toContain("counter.textContent = (i + 1) + ' / ' + slides.length;");
  expect(html).toContain("progress.style.width");
});
