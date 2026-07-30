// Public surface of the source-reading module (docs/09 link ingestion): fetching
// and extracting only. Everything here is pure and knows nothing about the
// pipelines that call it — deciding what to do with a source, and recording it,
// belongs to the domain that owns the source list.

export {
  isHttpsUrl,
  looksLikeHttpUrl,
  provisionalTitleFromUrl,
  resolveUrlSource,
  slugBaseFromUrl,
  sniffContentType,
  type SniffedKind,
  type UrlSource,
} from "./url";
export {
  extractArticle,
  extractArticleTitle,
  ARTICLE_MAX_CHARS,
  TRUNCATION_MARKER,
  type ExtractedArticle,
} from "./article";
