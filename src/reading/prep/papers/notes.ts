// Prep-note frontmatter, pure. One markdown file per paper under
// prep-<surveyHash>/<slug>.md: a small "key: value" frontmatter block (YAML-lite
// — flat scalars only, authors joined with "; ") and an English body carrying
// [p.N] page anchors. Parsing is tolerant: unknown keys are ignored, a missing
// or malformed frontmatter yields empty meta and the whole text as body.

export interface NoteMeta {
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  status: string; // done | abstract-only
  source: string | null; // arxiv | openalex | semantic-scholar | url
  sourcePages: number | null; // page count of the digested PDF
  citedInChapters: number[];
  // Link-ingestion provenance (docs/09): the URL a user-pasted source came from
  // and whether it resolved to a PDF or a web article. Null for plan-nominated
  // papers.
  sourceUrl: string | null;
  kind: string | null; // pdf | article
}

export interface PrepNote {
  meta: NoteMeta;
  body: string;
}

const EMPTY_META: NoteMeta = {
  title: "",
  authors: [],
  year: null,
  arxivId: null,
  status: "",
  source: null,
  sourcePages: null,
  citedInChapters: [],
  sourceUrl: null,
  kind: null,
};

function line(key: string, value: string | null): string | null {
  return value === null || value === "" ? null : `${key}: ${value}`;
}

export function serializeNote(meta: NoteMeta, body: string): string {
  const lines = [
    line("title", meta.title),
    line("authors", meta.authors.join("; ")),
    line("year", meta.year === null ? null : String(meta.year)),
    line("arxivId", meta.arxivId),
    line("status", meta.status),
    line("source", meta.source),
    line("sourcePages", meta.sourcePages === null ? null : String(meta.sourcePages)),
    line("citedInChapters", meta.citedInChapters.length ? meta.citedInChapters.join(", ") : null),
    line("sourceUrl", meta.sourceUrl),
    line("kind", meta.kind),
  ].filter((l): l is string => l !== null);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

// The thin note body for a paper whose full text couldn't be fetched or read.
export function abstractNoteBody(abstract: string | undefined): string {
  const abs = (abstract ?? "").trim();
  return abs
    ? `Full text unavailable; abstract only.\n\n${abs}`
    : "Full text unavailable and no abstract was found.";
}

// The note writer sometimes leaves its own stage directions in the body — "I
// have everything I need to write the note.", "Here is the prep note:" — and 17
// of 17 notes on one survey carry at least one. They are noise wherever the body
// goes: the panel, and every classroom prompt the note is inlined into.
//
// Dropped on the way out of storage, never on disk: the file stays as written,
// so a bad judgement here costs a rendering, not the note.
//
// Deliberately narrow, because a wrong deletion loses content silently. A block
// is dropped only when all of these hold:
//   - it stands alone between blank lines and is a single line;
//   - it is at most 160 characters;
//   - it carries no markdown structure (heading, list, quote, table, fence);
//   - it carries no citation anchor — real body prose is dense with [p.N];
//   - it opens in the writer's own voice ("I …", "Let me …", "Here is …");
//   - and it names the act of writing the note, not the paper's contents.
const ASIDE_OPENER =
  /^(?:I\b|I'|Let me\b|Let's\b|Now I\b|Now let\b|OK[,!.\s]|Okay[,!.\s]|Sure[,!.\s]|Alright[,!.\s]|Here (?:is|are|'s)\b|Here's\b|好的|明白|收到|我(?:来|先|现在|要)|让我|以下是)/i;
// Naming the act of writing, not the paper. "summary" is not on the list on its
// own: "Here is the summary table the authors give." is about the paper and
// meets every other condition. It still counts alongside write/note, which is
// the shape an actual aside takes ("Let me write the summary.").
const ASIDE_SUBJECT = /\b(?:notes?|write|writing|wrote)\b|笔记|总结|梳理|整理/i;
const ASIDE_STRUCTURE = /^(?:#|>|\||[-*+]\s|\d+[.)]\s|```|~~~)/;
const ASIDE_ANCHOR = /\[(?:pp?\.\s*\d|fig\s*:)/i;

function isModelAside(block: string): boolean {
  const s = block.trim();
  return (
    s.length <= 160 &&
    !s.includes("\n") &&
    !ASIDE_STRUCTURE.test(s) &&
    !ASIDE_ANCHOR.test(s) &&
    ASIDE_OPENER.test(s) &&
    ASIDE_SUBJECT.test(s)
  );
}

export function stripModelAsides(body: string): string {
  const blocks = body.split(/\n{2,}/);
  const kept: string[] = [];
  let inFence = false;
  let dropped = false;
  for (const block of blocks) {
    const fences = block.match(/^ {0,3}(?:`{3,}|~{3,})/gm)?.length ?? 0;
    const wasInFence = inFence;
    if (fences % 2 === 1) inFence = !inFence;
    if (!wasInFence && !inFence && isModelAside(block)) {
      dropped = true;
      continue;
    }
    kept.push(block);
  }
  return dropped ? kept.join("\n\n").trim() : body;
}

export function parseNote(text: string): PrepNote {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: { ...EMPTY_META }, body: text.trim() };

  const meta: NoteMeta = { ...EMPTY_META, authors: [], citedInChapters: [] };
  for (const raw of m[1].split("\n")) {
    const idx = raw.indexOf(":");
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    switch (key) {
      case "title":
        meta.title = value;
        break;
      case "authors":
        meta.authors = value ? value.split(";").map((a) => a.trim()).filter(Boolean) : [];
        break;
      case "year": {
        const n = Number(value);
        meta.year = Number.isFinite(n) ? n : null;
        break;
      }
      case "arxivId":
        meta.arxivId = value || null;
        break;
      case "status":
        meta.status = value;
        break;
      case "source":
        meta.source = value || null;
        break;
      case "sourcePages": {
        const n = Number(value);
        meta.sourcePages = Number.isFinite(n) ? n : null;
        break;
      }
      case "citedInChapters":
        meta.citedInChapters = value
          ? value.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
          : [];
        break;
      case "sourceUrl":
        meta.sourceUrl = value || null;
        break;
      case "kind":
        meta.kind = value || null;
        break;
    }
  }
  return { meta, body: text.slice(m[0].length).trim() };
}
