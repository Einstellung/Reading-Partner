// What a topic's delete confirmation says, on both shells (docs/50): which of
// its files are in no other topic, the box that deletes those too, and the
// action and the receipt that follow the box. The files come from
// reading/delete/delete-book.ts listFilesOnlyInTopic; the delete is
// deleteTopic's alsoDeleteFiles.

import { isArticleEntry, type LibraryEntry } from "../../../platform/app/library";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { plural } from "../../../platform/std/text";
import { displayFileTitle } from "./file-title";

export type FileKindLabel = "PDF" | "EPUB" | "Article";

// A PDF counts as a book, as the menus call it.
function isArticle(file: FileRef, entries: Record<string, LibraryEntry>): boolean {
  return isArticleEntry(file.hash ? entries[file.hash] : undefined);
}

export function fileKindLabel(file: FileRef, entries: Record<string, LibraryEntry>): FileKindLabel {
  const entry = file.hash ? entries[file.hash] : undefined;
  if (isArticleEntry(entry)) return "Article";
  return entry?.format === "epub" ? "EPUB" : "PDF";
}

function noun(file: FileRef, entries: Record<string, LibraryEntry>): string {
  return isArticle(file, entries) ? "article" : "book";
}

/** "2 books and 1 article". */
export function fileTally(files: readonly FileRef[], entries: Record<string, LibraryEntry>): string {
  const articles = files.filter((f) => isArticle(f, entries)).length;
  const books = files.length - articles;
  const parts: string[] = [];
  if (books) parts.push(plural(books, "book"));
  if (articles) parts.push(plural(articles, "article"));
  return parts.join(" and ");
}

export interface TopicDeleteRow {
  file: FileRef;
  title: string;
  kind: FileKindLabel;
}

export interface TopicDeleteWords {
  title: string;
  description: string;
  /** The files only in this topic, for the list over the box. Empty: no list, no box. */
  rows: TopicDeleteRow[];
  /** The list's caption. */
  onlyCaption: string;
  /** The box's label; null when there is nothing to offer. */
  checkLabel: string | null;
  /** The action button, which says what the box added. */
  action(alsoFiles: boolean): string;
  /** The line after it went. */
  done(alsoFiles: boolean): string;
}

export function topicDeleteWords(input: {
  topic: Topic;
  topics: readonly Topic[];
  only: readonly FileRef[];
  entries: Record<string, LibraryEntry>;
  /** Articles saved into this topic out of a briefing: they move to Brief. */
  savedArticles?: number;
}): TopicDeleteWords {
  const { topic, topics, only, entries } = input;
  const n = only.length;
  const onlyHashes = new Set(only.map((f) => f.hash));
  // Said only of the files it is true of: filed under another topic too. A file
  // kept because a book lists it, or one never opened, is not mentioned.
  const elsewhere = new Set<string>();
  for (const t of topics) {
    if (t.id === topic.id) continue;
    for (const f of t.files) if (f.hash) elsewhere.add(f.hash);
  }
  const shared = topic.files.filter(
    (f, i, all) =>
      f.hash &&
      !onlyHashes.has(f.hash) &&
      elsewhere.has(f.hash) &&
      all.findIndex((g) => g.hash === f.hash) === i,
  );
  let description = "The topic goes, on every device, with the retells, talks and rehearsals made in it.";
  if ((input.savedArticles ?? 0) > 0) description += " Articles saved here move to Brief.";
  if (shared.length === 1) {
    description += ` One ${noun(shared[0], entries)} is also filed under another topic and stays there.`;
  } else if (shared.length > 1) {
    description += ` ${fileTally(shared, entries)} are also filed under other topics and stay there.`;
  }
  const tally = fileTally(only, entries);
  const name = `“${topic.name}”`;
  return {
    title: `Delete ${name}?`,
    description,
    rows: only.map((file) => ({
      file,
      title: displayFileTitle(file.name),
      kind: fileKindLabel(file, entries),
    })),
    onlyCaption: "Only in this topic",
    checkLabel:
      n === 0 ? null : n === 1 ? `Also delete this ${noun(only[0], entries)}` : `Also delete these ${tally}`,
    action: (alsoFiles) =>
      !alsoFiles || n === 0
        ? "Delete"
        : n === 1
          ? `Delete topic and ${noun(only[0], entries)}`
          : `Delete topic and all ${n}`,
    done: (alsoFiles) =>
      !alsoFiles || n === 0
        ? `Deleted ${name}`
        : `Deleted ${name}${n === 1 ? " and " : ", "}${tally}`,
  };
}
