// What a domain calls the bindery by (docs/85).

export {
  bind,
  readMaterial,
  type BindResult,
  type Bound,
  type BoundMetadata,
  type PassedMetadata,
  type PassedThrough,
  type ReadManuscript,
} from "./bind";
export { rejection } from "./gate";
export type { Rejection, RejectionReason } from "./gate";
export type { FetchBytes, FetchedBytes } from "./images";
export {
  manuscriptText,
  type Manuscript,
  type ManuscriptImage,
  type ManuscriptSection,
} from "./manuscript";
export {
  materialUrl,
  type Adapter,
  type BinderyDeps,
  type Material,
  type MaterialMeta,
  type WholeDocument,
} from "./material";
export {
  markdownToHtml,
  resolveMarkdownTitle,
  type MarkdownOptions,
} from "./adapters";
export {
  contentDispositionFilename,
  isPdfBytes,
  looksLikeHtml,
  pdfDocument,
  titleFromFilename,
} from "./pdf";
export {
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type SiteAdapter,
} from "./registry";
