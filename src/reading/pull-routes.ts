// The pulled files the shelf is made of.
//
// Two routes and not one because the two shells want different halves: the
// desktop shelf is a topic list with books and kept articles under it, while
// the phone shows the kept articles and nothing else (docs/22). Both are
// declared here so the coverage test can see that saved-articles.json has a
// reader at all.

import { DELETED_BOOKS_FILE } from "../platform/app/deleted-books";
import { LIBRARY_FILE } from "../platform/app/library";
import { TOPICS_FILE } from "../platform/app/topics";
import type { PullMatcher } from "../platform/sync/pull-routes";
import { SAVED_ARTICLES_FILE } from "./saved-articles";

// Everything the desktop shelf draws itself from. One route rather than three,
// so a pull that wrote all of them refreshes it once.
// deleted-books.jsonl is here too: a tombstone arriving from the other device
// is what takes a book off this one, and the pass that wrote it has already
// deleted the files the book owned (platform/sync/dead-paths.ts). Nothing tells
// the shelf that but this.
export const SHELF_PULL_ROUTE: PullMatcher = {
  id: "shelf",
  matches: (path) =>
    path === LIBRARY_FILE ||
    path === TOPICS_FILE ||
    path === SAVED_ARTICLES_FILE ||
    path === DELETED_BOOKS_FILE,
};

// What the phone shows: the articles kept out of a briefing (docs/21), which
// arrive over sync and are most of that shell.
export const KEPT_ARTICLES_PULL_ROUTE: PullMatcher = {
  id: "kept-articles",
  matches: (path) => path === SAVED_ARTICLES_FILE,
};
