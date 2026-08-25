// Unit tests for deck assembly (src/reading/slides/template.ts): placeholders replaced,
// slides wrapped, output self-contained, host bridge present. Run: bun test.

import { expect, test } from "bun:test";
import { assembleDeck, slideTitleText, slugify } from "../../../src/reading/slides/template";

test("slugify makes a filename-safe stem", () => {
  expect(slugify("My Great Retell!")).toBe("my-great-retell");
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
    title: "Retell",
    slides: [
      { kind: "title", fragment: "<h1 class=\"deck-title\">Retell</h1>", asset: null },
      { kind: "content", fragment: "<h2>Body</h2>", asset: null },
    ],
  });
  expect(html).toContain('<section class="slide title-slide" data-slide="0"');
  expect(html).toContain('<section class="slide" data-slide="1"');
  expect(html).toContain("1 / 2");
  expect(html).toContain("<title>Retell</title>");
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

test("slideTitleText falls back to any h1, then to nothing", () => {
  expect(slideTitleText('<h1 class="deck-title">A &amp; B</h1>')).toBe("A & B");
  // A fragment that forgot the deck-title class still names its slide.
  expect(slideTitleText("<h1>Bare heading</h1>")).toBe("Bare heading");
  expect(slideTitleText('<div class="kicker">chapter 3</div><ul class="pts"><li>x</li></ul>')).toBe(
    "",
  );
});

test("slideTitleText prefers the h2 when a fragment carries both", () => {
  expect(slideTitleText('<h1 class="deck-title">Deck</h1><h2>Slide</h2>')).toBe("Slide");
});

test("each section carries its index, kind and escaped title for the host", () => {
  const html = assembleDeck({
    title: "Retell",
    slides: [
      { kind: "title", fragment: '<h1 class="deck-title">Retell</h1>', asset: null },
      { kind: "section", fragment: '<h2>Part <span class="pg">p.3</span></h2>', asset: null },
      { kind: "closing", fragment: '<h2>A "quoted" &amp; more</h2>', asset: null },
    ],
  });
  expect(html).toContain('data-slide="0" data-kind="title" data-title="Retell"');
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

test("slideTitleText decodes numeric references, decimal and hex", () => {
  expect(slideTitleText("<h2>Symbols &#38; statistics &#8212; the long argument</h2>")).toBe(
    "Symbols & statistics — the long argument",
  );
  expect(slideTitleText("<h2>Symbols &#x26; statistics &#x2014; the long argument</h2>")).toBe(
    "Symbols & statistics — the long argument",
  );
  expect(slideTitleText("<h2>&#X2014; and &#x2014;</h2>")).toBe("— and —");
  expect(slideTitleText("<h2>Leading zeros &#0038;</h2>")).toBe("Leading zeros &");
});

test("slideTitleText decodes references above the basic plane", () => {
  expect(slideTitleText("<h2>Ancient scripts &#x10330; and emoji &#128218;</h2>")).toBe(
    "Ancient scripts \u{10330} and emoji \u{1f4da}",
  );
});

test("slideTitleText leaves a code point outside Unicode as it was written", () => {
  // Out of range, and the lone surrogates: decoding these would put a character
  // in the run record that cannot round-trip, so the raw reference stays.
  expect(slideTitleText("<h2>&#x110000; &#1114112; &#xD800; &#0;</h2>")).toBe(
    "&#x110000; &#1114112; &#xD800; &#0;",
  );
});

test("slideTitleText decodes the named entities a model writes in a title", () => {
  expect(slideTitleText("<h2>Symbols &amp; statistics &mdash; the long argument</h2>")).toBe(
    "Symbols & statistics — the long argument",
  );
  expect(slideTitleText("<h2>Turing 1936&ndash;1950 &hellip; and after</h2>")).toBe(
    "Turing 1936–1950 … and after",
  );
  expect(slideTitleText("<h2>P &ne; NP when n &ge; 3 &times; 10</h2>")).toBe(
    "P ≠ NP when n ≥ 3 × 10",
  );
  expect(slideTitleText("<h2>Cause &rarr; effect &rArr; theory</h2>")).toBe(
    "Cause → effect ⇒ theory",
  );
  expect(slideTitleText("<h2>Poincar&eacute;, G&ouml;del, &Eacute;cole normale</h2>")).toBe(
    "Poincaré, Gödel, École normale",
  );
  expect(slideTitleText("<h2>&ldquo;Attention&rdquo; &copy; 2017 &mdash; 30&deg;</h2>")).toBe(
    "“Attention” © 2017 — 30°",
  );
  expect(slideTitleText("<h2>&prime; and &Prime; are not the same mark</h2>")).toBe(
    "′ and ″ are not the same mark",
  );
});

test("slideTitleText leaves a name outside the table as it was written", () => {
  // The known edge of the table (the deck page still renders these correctly;
  // only the recorded title keeps the raw name). Add a name here when a real
  // title needs it.
  expect(slideTitleText("<h2>&thinsp;&oelig;&Sigma;&hearts;&notaname;</h2>")).toBe(
    "&thinsp;&oelig;&Sigma;&hearts;&notaname;",
  );
});

test("slideTitleText decodes once, so an escaped entity stays an entity", () => {
  expect(slideTitleText("<h2>Write &amp;lt; for a less-than</h2>")).toBe(
    "Write &lt; for a less-than",
  );
  expect(slideTitleText("<h2>&amp;#8212; is how you write an em dash</h2>")).toBe(
    "&#8212; is how you write an em dash",
  );
  expect(slideTitleText("<h2>&amp;amp;</h2>")).toBe("&amp;");
});

test("slideTitleText still reads the six original entities in any case", () => {
  expect(slideTitleText("<h2>a &AMP; b &NBSP;&QUOT;c&QUOT;</h2>")).toBe('a & b "c"');
});
