// A talk's materials, assembled from disk.
//
// This is the difference between a rehearsal and every other conversation in the
// app: it happens in the topic, with no book open, no reader mounted and no
// engine running. Everything it needs is already on disk under the book's
// content hash — fulltext-<hash>.json, annotations-<hash>.json,
// figures-<hash>.json, notes-<hash>/ — so the path is a set of reads, not an
// engine. The book's bytes are only read when a figure actually has to be
// rasterized, which is the one thing that needs them (figures/render.ts crops
// with pdf.js, no reader and no PDFium).

import { loadAnnotations } from "../../platform/app/annotations";
import { annotationPage, type Annotation } from "../../platform/app/reader-contract";
import { getLibraryEntry, readLibraryBook } from "../../platform/app/library";
import { getFulltext } from "../../fulltext/store";
import type { Fulltext } from "../../fulltext/types";
import type { AnnotationLite } from "../../fulltext/format";
import { buildSkeleton, type Skeleton } from "../rehearsal";
import { getFigures } from "../figures/store";
import type { Figure } from "../figures/types";
import { loadNotesState } from "../notes/store";
import type { TalkMaterial } from "./types";

// One material of a talk with everything the rehearsal reads about it.
export interface LoadedMaterial {
  bookId: string;
  // The library's title, falling back to the one stored on the talk.
  title: string;
  fulltext: Fulltext | null;
  annotations: AnnotationLite[];
  skeleton: Skeleton;
  figures: Figure[];
}

// An annotation flattened for the prompt and the read_annotations tool. Skips
// annotations with neither text nor comment (legacy image regions), which are
// evidence of nothing.
export function toAnnotationLite(ann: Annotation): AnnotationLite | null {
  const text = typeof ann.text === "string" ? ann.text.trim() : "";
  const comment = typeof ann.comment === "string" ? ann.comment.trim() : "";
  if (!text && !comment) return null;
  return { page: annotationPage(ann as { position?: { pageIndex?: number } }), text, comment };
}

// Everything a talk needs about one book, read from disk. Every read is
// optional: a book with no text layer, no marks, no notes and no figures still
// produces a material (a one-chapter skeleton), because the reader put it in the
// talk and being told "this book contributes nothing" is more use than an error.
export async function loadMaterial(material: TalkMaterial): Promise<LoadedMaterial> {
  const { bookId } = material;
  const [entry, fulltext, anns, notesState, figures] = await Promise.all([
    getLibraryEntry(bookId).catch(() => null),
    getFulltext(bookId).catch(() => null),
    loadAnnotations(bookId).catch((): Annotation[] => []),
    loadNotesState(bookId).catch(() => null),
    getFigures(bookId).catch(() => null),
  ]);
  const skeleton = buildSkeleton({
    notesChapters: notesState?.chapters ?? null,
    outline: fulltext?.outline ?? [],
    pageCount: fulltext?.pages.length ?? 0,
  });
  return {
    bookId,
    title: entry?.title || material.title || bookId,
    fulltext,
    annotations: anns
      .map(toAnnotationLite)
      .filter((a): a is AnnotationLite => a !== null),
    skeleton,
    figures: figures?.figures ?? [],
  };
}

export function loadMaterials(materials: readonly TalkMaterial[]): Promise<LoadedMaterial[]> {
  return Promise.all(materials.map(loadMaterial));
}

// The book's bytes from the library, for rasterizing a figure. Kept behind a
// function so nothing reads a hundred megabytes to assemble a prompt: only
// view_figure and a [fig:N] card in the conversation ever call it, and only for
// the book the figure is in.
export async function readMaterialBytes(bookId: string): Promise<ArrayBuffer | null> {
  try {
    const bytes = await readLibraryBook(bookId);
    return bytes.slice().buffer as ArrayBuffer;
  } catch (e) {
    console.warn("failed to read a talk material from the library", bookId, e);
    return null;
  }
}
