// What a domain calls the bindery by (docs/85).

export { bind, type BindResult, type Bound, type BoundMetadata } from "./bind";
export type { Rejection, RejectionReason } from "./gate";
export type { FetchBytes, FetchedBytes } from "./images";
export type { Manuscript, ManuscriptImage, ManuscriptSection } from "./manuscript";
export {
  materialUrl,
  type Adapter,
  type BinderyDeps,
  type Material,
  type MaterialMeta,
} from "./material";
export {
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type SiteAdapter,
} from "./registry";
