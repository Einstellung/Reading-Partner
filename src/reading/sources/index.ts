// Public surface of the source-reading module (docs/09 link ingestion): reading
// a pasted link and a fetched response. Everything here is pure and knows nothing
// about the pipelines that call it — deciding what to do with a source, and
// recording it, belongs to the domain that owns the source list. The article
// body itself is cut out by workshop/bindery, not here.

export {
  decodePage,
  looksLikeHttpUrl,
  provisionalTitleFromUrl,
  resolveUrlSource,
  slugBaseFromUrl,
  sniffContentType,
  type SniffedKind,
  type UrlSource,
} from "./url";
