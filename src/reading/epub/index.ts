// Reading an EPUB (docs/39). Two halves that meet at the sanitized tree: the
// headless ingestion (zip, sanitize, paginate, full text), and the reading area
// that renders those same documents through foliate-js.

export { isEpub, looksLikeZip } from "./sniff";
export { openZip, resolveZipPath, hrefFragment, type EpubZip, type ZipEntry } from "./zip";
export { sanitize, sanitizeDocument, type ResourceRefs, type SanitizedDocument } from "./sanitize";
export { extractDocumentText, runAt, type DocumentText } from "./text";
export { elementSteps, epubCfi, parseEpubCfi, textSteps, type ParsedCfi } from "./cfi";
export { parseEpub, spineIndexOf, EpubParseError, type EpubBook, type SpineDocument } from "./parse";
export {
  BLOCK_CHARS,
  PAGINATION_VERSION,
  blockNumberAt,
  blockTexts,
  paginate,
  syntheticCuts,
  type Pagination,
  type PositionBlock,
} from "./paginate";
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
export { createRenderBook, mimeOf, renderLoader, type RenderLoader } from "./render-book";
export { default as EpubReaderPane } from "./EpubReaderPane";
