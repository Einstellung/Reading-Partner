// What can be handed to the bindery (docs/85), and the shape of an adapter that
// turns one kind of it into a manuscript.

import type { ExtractReadable } from "../extract/readable-select";
import type { Rejection } from "./gate";
import type { FetchBytes } from "./images";
import type { Manuscript } from "./manuscript";

/** What the caller already knows about material that does not say it itself. */
export interface MaterialMeta {
  title?: string;
  author?: string;
  publishedAt?: string;
  sourceUrl?: string;
  language?: string;
}

export type Material =
  /** Only a link. Nothing built in reads one: a site adapter has to claim it. */
  | { kind: "url"; url: string }
  /** A fetched web page and the URL it was fetched from. */
  | { kind: "web"; url: string; html: string; fallbackTitle?: string }
  /** HTML that already is the body, a whole page or a fragment. */
  | ({ kind: "html"; html: string } & MaterialMeta)
  | ({ kind: "text"; text: string } & MaterialMeta)
  | ({ kind: "markdown"; markdown: string } & MaterialMeta);

export type MaterialKind = Material["kind"];

/** The host, injected, so the bindery runs in a test with no network or DOM. */
export interface BinderyDeps {
  /**
   * Fetch bytes: the pictures a manuscript references, and whatever a site
   * adapter reads. Without it no picture is fetched and each becomes a
   * placeholder.
   */
  fetch?: FetchBytes;
  /**
   * Readability with the defuddle fallback (workshop/extract/readable-lazy).
   * Injected because it needs a DOM and comes in a chunk of its own; the web
   * adapter cannot run without it.
   */
  extractReadable?: ExtractReadable;
}

/**
 * A document a site already serves whole, such as a paper's PDF. There is
 * nothing to build, so a site adapter may hand one back instead of a manuscript,
 * and the bindery passes its bytes through with what the adapter read about it.
 */
export interface WholeDocument {
  kind: "whole";
  format: "pdf" | "epub";
  bytes: Uint8Array;
  title: string;
  author?: string;
  publishedAt?: string;
  sourceUrl?: string;
  /** The document's own summary, where the site gives one (a paper's abstract). */
  abstract?: string;
}

export function isWholeDocument(value: unknown): value is WholeDocument {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "whole"
  );
}

/** Turns one kind of material into a manuscript, or says why it cannot. */
export interface Adapter<M extends Material = Material> {
  name: string;
  /**
   * The shortest body that counts as content for what this adapter reads.
   * MIN_BODY_CHARS when absent.
   */
  minChars?: number;
  toManuscript(material: M, deps: BinderyDeps): Promise<Manuscript | Rejection>;
}

/** The URL the material is about, when it has one that parses. */
export function materialUrl(material: Material): URL | null {
  const raw =
    material.kind === "url" || material.kind === "web" ? material.url : material.sourceUrl;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
