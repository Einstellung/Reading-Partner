// The two models the app runs on, and the one table that says which work runs
// on which (docs/75).
//
//   talk      calls the reader is waiting on, watching the reply come in —
//             reading chat, Lumen, the info companion. settings.defaultModelId.
//   everyday  background calls nobody is waiting on. settings.everydayModelId,
//             which follows the talk model until the reader picks one.
//
// Both tiers are always the default provider's: credentials are single-active
// (ai/auth/credentials.ts), so a model id under a second provider would have no key
// to call with. A tier names a model, never a provider.
//
// Classification lives here and nowhere else. There is no model picker per
// screen and no setting that says which tasks are everyday: a new task that
// should run cheap is one line in the table below. Every headless kind in use
// today is background work and runs everyday: lesson prep, the sub-agent
// runs, the observation distillation passes, the nightly dream, the two
// briefing stages, and the meals line's headless write-the-recipe pass.
// "chat" is the talk kind, for a headless call the reader is waiting on.
// Conversations are always talk: the reader is watching the reply come in,
// meals thread included.

import type { Settings } from "../platform/app/settings";

export type ModelTier = "talk" | "everyday";

// Which effort setting a headless call reads, and — through the table below —
// which model it runs on.
export type ThinkingKind =
	| "chat"
	| "prep"
	| "distill"
	| "briefing"
	| "briefing-screen"
	| "meals";

// Purpose to tier, for the headless calls (ai/model-call.ts).
const TIER_FOR_KIND: Record<ThinkingKind, ModelTier> = {
	chat: "talk",
	prep: "everyday",
	distill: "everyday",
	briefing: "everyday",
	"briefing-screen": "everyday",
	meals: "everyday",
};

export function tierForKind(kind: ThinkingKind): ModelTier {
	return TIER_FOR_KIND[kind];
}

// Which model a tier runs on. Null only when no default model is set at all,
// which is an app that has no provider configured yet.
export function modelIdFor(s: Settings, tier: ModelTier): string | null {
	return (tier === "everyday" ? s.everydayModelId : null) ?? s.defaultModelId;
}
