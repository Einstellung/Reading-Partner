// Public surface of the full-text module.

export type {
  Fulltext,
  FulltextStatus,
  OutlineItem,
  SearchDoc,
  SearchHit,
} from "./types";
export { FULLTEXT_VERSION } from "./types";
export { ensureFulltext, getFulltext } from "./store";
export { textAround, chapterAt, readPages, searchTopic } from "./query";
export {
  formatPages,
  formatSearch,
  toAnnotationLite,
  type AnnotationLite,
  type TopicMaterial,
} from "./format";
export { extractFulltext } from "./extract";
