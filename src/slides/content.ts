// Per-slide content generation (docs/14), pure parts: prompt the model to write
// one slide's body as a constrained HTML fragment in the deck's vocabulary, and
// sanitize whatever comes back so the assembled deck stays self-contained (no
// scripts, no external URLs). The AI call is wired in live.ts. Distill the notes
// into talk-style points — never paste note paragraphs.

import type { SlideRun } from "./types";

// The class vocabulary the shell template styles (see template.ts). Given to the
// model so its fragment lands in the deck's look without inventing markup.
const VOCAB = [
  'Wrap emphasis in <b>. Use these building blocks only:',
  '- <div class="kicker">SECTION LABEL</div> — a small uppercase label at the top.',
  '- <h2>Slide headline</h2> — the slide title (use <h1 class="deck-title"> only on the title slide).',
  '- <ul class="pts"><li>Short talk point.<span class="pg">p.12</span></li></ul> — bullets;',
  '  the optional <span class="pg"> shows a source page. Use "pts tight" for many bullets.',
  '- <div class="cols two"> or <div class="cols three"> with <div class="col"> children,',
  '  each holding a <div class="col-head">Head<small>subhead</small></div> then a <ul><li>… — for comparisons.',
  '- <div class="bottomline"><b>Takeaway:</b> one line.</div> — a highlighted conclusion.',
  '- <div class="lede">One-sentence framing.</div> and <div class="meta">subtitle</div> — for title/section slides.',
  '- <div class="takeaway">One line under a figure/illustration.</div>',
  '- <div class="rule"></div> — a short accent bar (title slides).',
  '- An inline <svg>…</svg> is allowed for a simple structural diagram (no external refs).',
];

export function contentSystemPrompt(): string {
  return [
    "You are the slide-writing stage of a reading companion. You write ONE slide's",
    "body as an HTML fragment — talk-ready, spoken-style, distilled. This is a slide",
    "for a live talk, not a page of notes: short phrases, not sentences copied from",
    "the notes; a few points, not a wall of text.",
    "",
    "Output only the fragment (no <html>, <head>, <section>, or <body> wrapper; the",
    "shell adds those). Do not add a <script>, <style>, <link>, <img>, or any",
    "external URL. Images come only through placeholders (see below).",
    "",
    ...VOCAB,
    "",
    "Asset placeholders: if the slide has an illustration slot, put the exact",
    "comment <!--illustration--> where the image should go (usually inside a",
    "<div class=\"figwrap\"></div>). If it has a figure slot, use <!--figure-->",
    "likewise. Never both. The shell replaces the placeholder with the asset, or",
    "drops it if the asset is unavailable — so still write a slide that reads",
    "without the image.",
    "",
    "Keep it tight: a content slide is 3-5 bullets or one comparison; a section or",
    "title slide is a headline plus at most a line. Output the fragment only.",
  ].join("\n");
}

// The kickoff for one slide: its title/kind, asset slot, and the relevant notes.
export function contentUserMessage(slide: SlideRun, notes: string): string {
  const parts: string[] = [
    `Slide ${slide.index} of the deck. Kind: ${slide.kind}. Title: "${slide.title}".`,
  ];
  if (slide.illustration) {
    parts.push(
      `This slide has an illustration slot (place <!--illustration-->). Intended image: ${slide.illustration.prompt}`,
    );
  }
  if (slide.figure) {
    parts.push(`This slide has a figure slot (place <!--figure-->), citing figure ${slide.figure.figId}.`);
  }
  if (notes.trim()) {
    parts.push("Source notes to distill from:", notes.trim());
  } else {
    parts.push(
      "No source notes for this slide — write it from the title and the deck's arc (typical for title/section/closing slides).",
    );
  }
  parts.push("Write the slide fragment now.");
  return parts.join("\n\n");
}

// Sanitize a model-produced fragment into safe, self-contained HTML. Strips
// dangerous / external constructs while preserving the asset placeholders. Pure
// (regex-based, no DOM) so it runs in bun tests. Not a general HTML sanitizer —
// the input is our own constrained fragment; this is defense in depth so a
// stray <script> or remote <img> can never reach the deck file.
export function sanitizeFragment(html: string): string {
  let out = html.trim();

  // Drop markdown code fences the model may wrap the fragment in.
  out = out.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");

  // Remove whole dangerous elements (with their content where they have any),
  // then sweep any stray opening/closing tags of the same set.
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<(iframe|object|embed|video|audio)\b[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<\/?(iframe|object|embed|video|audio|link|meta|base)\b[^>]*>/gi, "");

  // Remove inline event handlers (on*=...).
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");

  // Remove any src/href/xlink:href/url() pointing off-device. Keep data: URLs
  // (the assets inject as data: URLs after sanitization). Anything external is
  // stripped attribute-and-all so no remote resource can be requested.
  out = out.replace(/\s(?:src|href|xlink:href)\s*=\s*"(?!data:)[^"]*"/gi, "");
  out = out.replace(/\s(?:src|href|xlink:href)\s*=\s*'(?!data:)[^']*'/gi, "");
  out = out.replace(/url\(\s*['"]?(?!data:)https?:[^)]*\)/gi, "none");

  // <img> without a data: src is useless and may re-add a remote ref; drop bare
  // <img> tags entirely (assets arrive via placeholder replacement, not <img>).
  out = out.replace(/<img\b(?![^>]*\bsrc\s*=\s*["']data:)[^>]*>/gi, "");

  return out.trim();
}
