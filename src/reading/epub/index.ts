// Reading an EPUB (docs/39, docs/64). Two halves that meet at the sanitized
// tree: the headless ingestion (zip, sanitize, paginate, full text), and the
// reading area that lays those same documents out on fixed sheets of paper.

export { isEpub, looksLikeZip } from "./sniff";
export { openZip, resolveZipPath, hrefFragment, type EpubZip, type ZipEntry } from "./zip";
export { sanitize, sanitizeDocument, type ResourceRefs, type SanitizedDocument } from "./sanitize";
export { sanitizeCss, sanitizeDeclarations, rewriteCssUrls } from "./css-sanitize";
export { extractDocumentText, indexRuns, offsetOfPoint, runAt, type DocumentText } from "./text";
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
} from "./cfi";
export { parseEpub, spineIndexOf, EpubParseError, type EpubBook, type SpineDocument } from "./parse";
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
  getPagination,
  paginationFile,
  parsePagination,
  putPagination,
} from "./pagination-store";
export { fulltextFrom, outlineFor, readEpub, type EpubFulltext } from "./fulltext";
export { extractEpubFulltext } from "./live";
export { acquireEpub, ensurePagination, heldEpub, releaseEpub } from "./book-cache";
export { remapEpubAnnotations } from "./migrate";
export { renderEpubCover } from "./epub-cover";
export { default as EpubReaderPane } from "./EpubReaderPane";
