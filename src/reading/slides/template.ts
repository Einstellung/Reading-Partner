// The slide-deck shell (docs/14): a self-contained HTML file with inline CSS/JS,
// a 16:9 stage centered on a dark surround, keyboard/click navigation, a slide
// counter and a progress bar. The design is lifted from the hand-made prototype
// the consensus was validated against. assembleDeck injects the per-slide
// fragments and base64 assets into this shell; the result opens in any browser
// with no network. It also carries a host bridge (protocol 1): embedded in an
// iframe it reports the slide it is showing and takes goto from the host, so the
// app can follow a rehearsal without owning the playback. Pure and testable.

import type { SlideKind } from "./types";

// One slide ready to assemble: its (already sanitized) HTML fragment, its kind,
// and an optional resolved asset (a data: URL) to drop into the placeholder.
export interface AssembledSlide {
  kind: SlideKind;
  fragment: string;
  asset?: string | null;
}

// A URL-and-filename-safe slug for the retell title (used in the deck filename).
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "deck";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The entity names a slide title is likely to carry. Deliberately a table and
// not an implementation: HTML5 defines over two thousand names, and a deck's
// title is a line of prose written by a model, so the ones worth carrying are
// the typographic marks, the maths and arrows, and the accented letters and
// symbols that turn up in book and paper titles. A name outside the table is
// left as written — the deck page itself still shows it correctly, because the
// browser parses it; only the recorded title keeps the raw `&name;`.
// Case matters, as it does in HTML (`&prime;` and `&Prime;` are different
// marks); the six below that predate that rule are also read in any case,
// because the decoder they replace did.
const NAMED = new Map<string, string>(
  Object.entries({
    // The original six.
    nbsp: " ",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    amp: "&",
    // Typography.
    mdash: "—",
    ndash: "–",
    hellip: "…",
    bull: "•",
    middot: "·",
    prime: "′",
    Prime: "″",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    laquo: "«",
    raquo: "»",
    // Maths and arrows.
    times: "×",
    divide: "÷",
    ne: "≠",
    le: "≤",
    ge: "≥",
    asymp: "≈",
    infin: "∞",
    plusmn: "±",
    deg: "°",
    minus: "−",
    larr: "←",
    rarr: "→",
    harr: "↔",
    rArr: "⇒",
    // Letters and symbols. The capitals are here too: a title is title-cased,
    // and "École" is exactly where an accented capital shows up.
    eacute: "é",
    Eacute: "É",
    egrave: "è",
    Egrave: "È",
    agrave: "à",
    Agrave: "À",
    uuml: "ü",
    Uuml: "Ü",
    ouml: "ö",
    Ouml: "Ö",
    auml: "ä",
    Auml: "Ä",
    ccedil: "ç",
    Ccedil: "Ç",
    ntilde: "ñ",
    Ntilde: "Ñ",
    copy: "©",
    reg: "®",
    trade: "™",
    sect: "§",
    para: "¶",
    dagger: "†",
    permil: "‰",
    euro: "€",
    pound: "£",
    yen: "¥",
  }),
);

const ANY_CASE = new Set(["nbsp", "lt", "gt", "quot", "apos", "amp"]);

// Whether a numeric reference names a character we are willing to write into a
// title. Out of Unicode's range, and the lone surrogates, are left as the text
// they were: the title is about to be JSON on disk, and half a surrogate pair
// would not survive the trip.
function decodable(cp: number): boolean {
  if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return false;
  return cp < 0xd800 || cp > 0xdfff;
}

const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

// Decode the entities our fragments carry, so a title reads as text rather than
// as markup (it is re-escaped into the attribute by the caller). One pass, on
// purpose: `&amp;lt;` is a title that says "&lt;", not one that says "<".
function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const cp = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return decodable(cp) ? String.fromCodePoint(cp) : whole;
    }
    const exact = NAMED.get(body);
    if (exact !== undefined) return exact;
    const lower = body.toLowerCase();
    return ANY_CASE.has(lower) ? (NAMED.get(lower) as string) : whole;
  });
}

// The plain-text title of a slide, for the host bridge's data-title: the <h2>
// headline, else the title slide's <h1>, else nothing. A page badge is chrome,
// not title, so it is dropped with its text; other inline markup (<b>, plain
// <span>) is unwrapped and its text kept.
export function slideTitleText(fragment: string): string {
  const inner =
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(fragment)?.[1] ??
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(fragment)?.[1];
  if (!inner) return "";
  const text = inner
    .replace(/<span\b[^>]*\bpg\b[^>]*>[\s\S]*?<\/span>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

const SLIDE_CLASS: Record<SlideKind, string> = {
  title: "slide title-slide",
  section: "slide",
  content: "slide",
  closing: "slide",
};

// Replace the asset placeholder comment with the resolved image, or remove it
// (and any now-empty figwrap) when no asset was produced — a dropped figure or a
// skipped illustration must not leave a blank box.
function injectAsset(fragment: string, asset?: string | null): string {
  const placeholder = /<!--\s*(illustration|figure)\s*-->/gi;
  if (asset) {
    return fragment.replace(placeholder, `<img src="${asset}" alt="">`);
  }
  return fragment
    .replace(placeholder, "")
    .replace(/<div class="figwrap">\s*<\/div>/gi, "");
}

const STYLE = `
  :root{
    --accent:#4f46e5;
    --accent-soft:#eef2ff;
    --ink:#181a20;
    --muted:#6b7280;
    --line:#e6e8ee;
    --card:#ffffff;
    --surround:#0d0f14;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    background:var(--surround);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink);
    display:flex;align-items:center;justify-content:center;
    overflow:hidden;
    -webkit-font-smoothing:antialiased;
  }
  .stage{
    position:relative;
    width:min(94vw, calc(94vh * 16 / 9));
    height:min(94vh, calc(94vw * 9 / 16));
    background:var(--card);
    border-radius:14px;
    box-shadow:0 24px 70px rgba(0,0,0,.55);
    overflow:hidden;
    container-type:size;
    cursor:pointer;
    user-select:none;
  }
  .slide{
    position:absolute;inset:0;
    display:none;
    flex-direction:column;
    padding:7cqh 8cqw 6.5cqh;
  }
  .slide.active{display:flex}
  .slide img{max-width:100%;max-height:100%;object-fit:contain}

  .kicker{
    font-size:2.4cqh;font-weight:700;letter-spacing:.16em;
    text-transform:uppercase;color:var(--accent);
    margin-bottom:2.4cqh;
  }
  h1.deck-title{font-size:4.9cqh;font-weight:800;line-height:1.12;letter-spacing:-.01em}
  h2{font-size:5.2cqh;font-weight:800;line-height:1.1;letter-spacing:-.01em;margin-bottom:0.4cqh}
  .lede{font-size:3.05cqh;color:var(--muted);font-weight:500;margin-top:1.6cqh;line-height:1.4}

  .pg{
    display:inline-block;
    font-size:1.85cqh;font-weight:700;
    color:var(--accent);
    background:var(--accent-soft);
    border-radius:6px;
    padding:.15em .5em;
    margin-left:.5em;
    vertical-align:.18em;
    letter-spacing:.02em;
    white-space:nowrap;
  }

  ul.pts{list-style:none;margin-top:3.4cqh;display:flex;flex-direction:column;gap:2.5cqh}
  ul.pts li{
    position:relative;
    font-size:3.15cqh;line-height:1.42;font-weight:450;
    padding-left:3.4cqh;
  }
  ul.pts li::before{
    content:"";position:absolute;left:0;top:.62em;
    width:1.15cqh;height:1.15cqh;border-radius:50%;
    background:var(--accent);
  }
  ul.pts li b{font-weight:700}
  ul.pts.tight{gap:1.9cqh}
  ul.pts.tight li{font-size:2.9cqh}

  .cols{display:grid;gap:4cqw;margin-top:3.2cqh;flex:1;min-height:0}
  .cols.two{grid-template-columns:1fr 1fr}
  .cols.three{grid-template-columns:1fr 1fr 1fr;gap:3cqw}
  .col{display:flex;flex-direction:column}
  .col-head{
    font-size:2.9cqh;font-weight:800;color:var(--accent);
    padding-bottom:1.4cqh;margin-bottom:2cqh;
    border-bottom:2px solid var(--line);
  }
  .col-head small{display:block;font-size:1.9cqh;font-weight:600;color:var(--muted);letter-spacing:.02em;margin-top:.3em;text-transform:none}
  .col ul{list-style:none;display:flex;flex-direction:column;gap:1.7cqh}
  .col ul li{
    position:relative;padding-left:2.6cqh;
    font-size:2.55cqh;line-height:1.38;font-weight:450;
  }
  .col ul li::before{
    content:"";position:absolute;left:0;top:.6em;
    width:.9cqh;height:.9cqh;border-radius:50%;background:var(--accent);opacity:.55;
  }
  .col ul li b{font-weight:700}
  .col.three-c ul li{font-size:2.35cqh}
  .col.three-c .col-head{font-size:2.6cqh}

  .bottomline{
    margin-top:auto;
    font-size:2.75cqh;line-height:1.4;font-weight:500;
    background:var(--accent-soft);
    border-left:4px solid var(--accent);
    border-radius:0 10px 10px 0;
    padding:2.2cqh 2.6cqw;
  }
  .bottomline b{font-weight:800;color:var(--accent)}

  .figwrap{
    flex:1;min-height:0;margin-top:2.6cqh;
    display:flex;align-items:center;justify-content:center;
  }
  .figwrap img{
    max-width:100%;max-height:100%;
    object-fit:contain;
    border:1px solid var(--line);
    border-radius:10px;
    box-shadow:0 6px 22px rgba(20,22,40,.08);
    background:#fff;
  }
  .takeaway{
    margin-top:2.6cqh;
    font-size:2.75cqh;line-height:1.4;font-weight:500;color:var(--ink);
  }
  .takeaway b{color:var(--accent);font-weight:800}

  .title-slide{justify-content:center}
  .title-slide .rule{width:12cqw;height:.7cqh;background:var(--accent);border-radius:2px;margin:3.2cqh 0}
  .title-slide .meta{margin-top:5cqh;font-size:2.3cqh;color:var(--muted);font-weight:600;letter-spacing:.03em}

  .foot-note{
    margin-top:auto;font-size:2.35cqh;color:var(--muted);font-weight:500;
    border-top:1px solid var(--line);padding-top:2.2cqh;line-height:1.4;
  }
  .foot-note b{color:var(--ink);font-weight:700}

  .progress{position:absolute;left:0;bottom:0;height:.55cqh;background:var(--accent);transition:width .28s ease}
  .counter{
    position:fixed;right:20px;bottom:16px;
    color:#9aa3b2;font-size:14px;font-weight:600;
    letter-spacing:.06em;font-variant-numeric:tabular-nums;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  }
  .hint{
    position:fixed;left:20px;bottom:16px;
    color:#5b6270;font-size:12.5px;font-weight:500;letter-spacing:.04em;
  }
  /* Shown only while the active slide is taller than the stage. The stage clips
     overflow, so without this the last bullets are simply not there and nobody
     finds out until the retell. It sits in the dark surround, outside the 16:9
     frame, so it marks the problem without landing on the slide itself. */
  .overflow-warn{
    position:fixed;right:20px;bottom:38px;
    display:none;
    color:#f0a24a;font-size:12.5px;font-weight:600;letter-spacing:.04em;
  }
  .overflow-warn.on{display:block}
`;

const SCRIPT = `
  const slides = Array.from(document.querySelectorAll('.slide'));
  const counter = document.getElementById('counter');
  const progress = document.getElementById('progress');
  const warn = document.getElementById('overflow-warn');
  // Host bridge (protocol 1). Only when the deck runs inside somebody's frame:
  // opened on its own there is no parent and none of this speaks up.
  const host = window.parent !== window ? window.parent : null;
  let i = 0;
  function report(){
    if (!host) return;
    const s = slides[i];
    host.postMessage({
      source: 'deck', type: 'slide', index: i, total: slides.length,
      kind: s ? s.dataset.kind : '', title: s ? s.dataset.title : ''
    }, '*');
  }
  function show(n){
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    counter.textContent = (i + 1) + ' / ' + slides.length;
    progress.style.width = ((i + 1) / slides.length * 100) + '%';
    // The stage clips what does not fit; measure the slide now that it is laid
    // out and say so, rather than letting the last points vanish quietly.
    const active = slides[i];
    const over = active && active.scrollHeight > active.clientHeight + 2;
    warn.classList.toggle('on', !!over);
    report();
  }
  addEventListener('resize', () => show(i));
  function next(){ show(i + 1); }
  function prev(){ show(i - 1); }
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { next(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { prev(); e.preventDefault(); }
    else if (e.key === ' ') { next(); e.preventDefault(); }
    else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(slides.length - 1); }
  });
  document.getElementById('stage').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    if ((e.clientX - r.left) < r.width * 0.28) prev(); else next();
  });
  if (host) {
    addEventListener('message', e => {
      const d = e.data;
      if (!d || d.source !== 'deck-host') return;
      // show() clamps a number, but a missing or non-numeric index would leave
      // it NaN and blank the stage, so a malformed goto is dropped.
      if (d.type === 'goto' && Number.isFinite(d.index)) show(d.index);
    });
    host.postMessage({ source: 'deck', type: 'ready', protocol: 1, total: slides.length }, '*');
  }
  show(0);
`;

// Build the full deck HTML from a title and the assembled slides. Self-contained:
// all CSS/JS inline, every asset a data: URL, no external references.
export function assembleDeck(deck: { title: string; slides: AssembledSlide[] }): string {
  const sections = deck.slides
    .map((s, index) => {
      const title = escapeHtml(slideTitleText(s.fragment));
      const attrs = `class="${SLIDE_CLASS[s.kind]}" data-slide="${index}" data-kind="${s.kind}" data-title="${title}"`;
      return `  <section ${attrs}>\n${injectAsset(s.fragment, s.asset)}\n  </section>`;
    })
    .join("\n\n");

  const total = deck.slides.length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(deck.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="stage" id="stage">

${sections}

  <div class="progress" id="progress"></div>
</div>

<div class="counter" id="counter">1 / ${total}</div>
<div class="hint">&larr; &rarr; / space / click</div>
<div class="overflow-warn" id="overflow-warn">this slide is clipped &mdash; content runs past the bottom</div>

<script>${SCRIPT}</script>
</body>
</html>
`;
}
