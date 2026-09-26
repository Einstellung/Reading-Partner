// Reading an EPUB (docs/39, docs/64): the headless ingestion (zip, sanitize,
// paginate, full text) that both reading areas — the paged desk and the
// reflow column — build on.

export { isEpub, looksLikeZip } from "./file/sniff";
export { openZip, resolveZipPath, hrefFragment, type EpubZip, type ZipEntry } from "./file/zip";
export { sanitize, sanitizeDocument, type ResourceRefs, type SanitizedDocument } from "./file/sanitize";
export { sanitizeCss, sanitizeDeclarations, rewriteCssUrls } from "./file/css-sanitize";
export { extractDocumentText, indexRuns, offsetOfPoint, runAt, type DocumentText } from "./file/text";
export {
  elementSteps,
  epubCfi,
  epubRangeCfi,
  parseEpubCfi,
  parseEpubRangeCfi,
  rangeToCfi,
  resolvePoint,
  resolveRange,
  textSteps,
  type ParsedCfi,
} from "./file/cfi";
export { parseEpub, EpubParseError, type EpubBook, type SpineDocument } from "./file/parse";
export {
  buildArticleEpub,
  MISSING_IMAGE_HEIGHT,
  type ArticleEpubInput,
  type ArticleImage,
} from "./file/build-article";
export {
  PAGINATION_VERSION,
  blockNumberAt,
  blockTexts,
  characterRuler,
  paginate,
  type PageRuler,
  type Pagination,
  type PositionBlock,
} from "./paginate";
export { PAGE_GEOMETRY, PAGE_WIDTH, PAGE_HEIGHT } from "./page-geometry";
export {
  createPaginationStore,
  paginationFile,
  parsePagination,
  putPagination,
} from "./pagination-store";
export { fulltextFrom, outlineFor, type EpubFulltext } from "./fulltext";
export { extractEpubFulltext } from "./live";
export { acquireEpub, ensurePagination, heldEpub, preparePagination, releaseEpub } from "./book-cache";
export { remapEpubAnnotations } from "./migrate";
export { renderEpubCover } from "./file/epub-cover";
