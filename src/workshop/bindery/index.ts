// What a domain calls the bindery by (docs/85).

export {
  bind,
  type BindResult,
  type Bound,
  type BoundMetadata,
  type PassedMetadata,
  type PassedThrough,
} from "./bind";
export { rejection } from "./gate";
export type { Rejection, RejectionReason } from "./gate";
export type { FetchBytes, FetchedBytes } from "./images";
export type { Manuscript, ManuscriptImage, ManuscriptSection } from "./manuscript";
export {
  materialUrl,
  type Adapter,
  type BinderyDeps,
  type Material,
  type MaterialMeta,
  type WholeDocument,
} from "./material";
export {
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type SiteAdapter,
} from "./registry";
