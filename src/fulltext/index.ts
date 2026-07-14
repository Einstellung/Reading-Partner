// Public surface of the full-text module.

export type {
  Fulltext,
  FulltextStatus,
  OutlineItem,
  SearchDoc,
  SearchHit,
} from "./types";
export { FULLTEXT_VERSION } from "./types";
export { ensureFulltext, getFulltext, onFulltextError } from "./store";
export { textAround, chapterAt, readPages, searchTopic } from "./query";
export { extractFulltext } from "./extract";
