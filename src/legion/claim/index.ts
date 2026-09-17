// Which devices are here and what each of them can do (docs/55).

export {
  WEBVIEW_FETCH,
  capabilitiesFor,
  registerKindCapabilities,
} from "./capabilities";
export {
  electAmong,
  electFor,
  hasCapabilities,
  isCandidate,
  isElectedFor,
  mayClaim,
} from "./elect";
export {
  CLAIM_DIR,
  appClaimIo,
  appClaims,
  createClaimStore,
  type ClaimIo,
  type ClaimStore,
} from "./store";
export {
  CLAIM_SYNC_GRACE_MS,
  FORFEIT_MS,
  HEARTBEAT_MS,
  type DeviceClaim,
} from "./types";
export {
  ELECTION_TTL_MS,
  createClaimWriter,
  type ClaimExtras,
  type ClaimSyncStatus,
  type ClaimWriter,
  type ClaimWriterDeps,
} from "./writer";
