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
  source: string | null; // arxiv | openalex | semantic-scholar
  sourcePages: number | null; // page count of the digested PDF
  citedInChapters: number[];
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
    }
  }
  return { meta, body: text.slice(m[0].length).trim() };
}
