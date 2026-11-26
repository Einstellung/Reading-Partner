// AI-driven link intake (docs/86): what a domain calls it by.

export { takeLinkIn, type LinkIntake, type LinkIntakeDeps } from "./take";
export { LINK_AGENT_NAME, LINK_SYSTEM_PROMPT, linkAgent, linkTask, linkTools } from "./agent";
export {
  addressKey,
  LinkSession,
  MAX_DOCUMENTS,
  MAX_ROUNDS,
  MAX_TOOL_CALLS,
  shortAddress,
  type Candidate,
  type Filed,
  type FiledInfo,
  type Opened,
  type TrailStep,
} from "./session";
export { classifyOutbound, ORIGIN_LABEL, type HintKind, type LinkHint, type LinkOrigin } from "./hints";
export {
  readerFor,
  registerLinkReader,
  registeredLinkReaders,
  type CandidateSeed,
  type LinkReader,
  type LinkReading,
  type SourceRecord,
} from "./readers";
export { composeReceipt, notTakenOf, type LinkStop, type NotTaken } from "./receipt";
export {
  LINK_RECORDS_FILE,
  loadLinkRecords,
  saveLinkRecord,
  type LinkRecordEntry,
  type LinkRecordsFile,
} from "./store";
