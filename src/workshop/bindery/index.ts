// What a domain calls the bindery by (docs/85).

export {
  bind,
  readMaterial,
  type BindResult,
  type Bound,
  type BoundMetadata,
  type ReadManuscript,
} from "./bind";
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
} from "./material";
export {
  registerSiteAdapter,
  registeredSiteAdapters,
  siteAdapterFor,
  type SiteAdapter,
} from "./registry";
