// AI preparation for a document (docs/09). Two kinds of material, one per
// document, chosen by the inline-citation density of its text
// (fulltext/citations.ts): a paper reaches outwards, so ./papers prepares the
// works it leans on; a book reaches inwards, so ./chapters prepares what each
// chapter does and how the chapters depend on each other. No document gets both.
//
// This file is also the parts neither half owns: which kind a document gets
// (./kind.ts), what starts a run (./trigger.ts), how far one has got
// (./progress.ts), and the anchor grammar prepared
// material is written in (./anchors.ts). Both kinds of note carry [p.N] anchors,
// and a chat reply that quotes one has to be rendered with the same grammar, so
// the grammar cannot live in either subdirectory without the other importing it.
// Both subdirectories and the markdown renderer read it from here.
//
// The two pipelines share nothing else: their scaffolding — the stall watchdog,
// the pacing limiter, the observable run — is in src/ai, where the slides
// pipeline reads it too.

export {
  linkifyCitations,
  parseCitationHref,
  pageCitationHref,
  paperCitationHref,
  figureCitationHref,
  type Citation,
} from "./anchors";
export { locateQuote, normalizeForMatch } from "./quote-locate";
export { prepKind, type PrepKind, type PrepPresence } from "./kind";
export { prepProgress, type PrepProgress } from "./progress";
export {
  prepTriggerDecision,
  type PrepTrigger,
  type PrepTriggerDecision,
  type PrepTriggerInput,
} from "./trigger";
