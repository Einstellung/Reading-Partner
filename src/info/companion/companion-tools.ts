// The shared info-companion tool set (docs/16/17): the three add-source tools
// plus update_profile, mounted the same way on every info chat entry (briefing
// Ask, article chat, the add-source flow). update_profile only DRAFTS — it
// surfaces a confirm card with the complete proposed profile; the host saves it
// only when the user clicks Apply. Pure: the card sink is injected, so the tool
// tests without a real save. Composition over the source tools keeps the consent
// rules in one place.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import { PROFILE_SKELETON_GUIDANCE } from "../../memory/profile";
import type { ProfileUpdateCardData } from "../briefing/cards";
import { buildSourceTools, sourceToolStatusLabel, type SourceToolDeps } from "../sources/source-tools";

export type BriefingScope = "retriage" | "full";

export interface CompanionToolDeps extends SourceToolDeps {
  // Surface the profile-update confirm card in the chat. The host owns the Apply
  // write; the tool never persists.
  onProfileCard(card: ProfileUpdateCardData): void;
  // Whether a briefing run is already in progress (the pipeline running guard).
  // generate_briefing checks this and refuses to start a second run.
  briefingRunning(): boolean;
  // Kick a background briefing job and return at once: "retriage" re-sorts today's
  // cached items with the current profile (no fetch); "full" re-collects every
  // source and re-triages, overwriting today's briefing. The host owns progress,
  // the ready/failed card, and the completion note; the tool only starts it.
  startBriefing(scope: BriefingScope): void;
}

// The update_profile tool: draft a complete revised profile and show it for
// confirmation. It writes nothing — the card's Apply does, in the host.
export function buildUpdateProfileTool(deps: Pick<CompanionToolDeps, "onProfileCard">): AgentTool {
  return {
    name: "update_profile",
    description:
      "Draft a change to the user's profile — the cross-scenario identity that steers both " +
      "the daily triage and the reading companion. Call this ONLY when the user states a " +
      "standing preference (e.g. 'be harsher on vendor PR', 'keep 量子位's paper explainers'), " +
      "never on your own initiative and never from a one-off reaction to a single item. Pass " +
      "the COMPLETE revised profile text (not a fragment) and a one-line summary of what " +
      "changed. It does not save — it shows the user a confirm card with the new profile; they " +
      "Apply it.\n\n" +
      PROFILE_SKELETON_GUIDANCE,
    parameters: Type.Object({
      profile: Type.String({
        description: "The complete revised profile text to save verbatim on Apply. Not a diff or fragment.",
      }),
      summary: Type.String({
        description: "One line naming the change, shown as the card heading (e.g. 'Harsher on vendor PR').",
      }),
    }),
    execute: async (args) => {
      const profile = String(args.profile ?? "").trim();
      const summary = String(args.summary ?? "").trim();
      if (!profile) throw new Error("update_profile needs the full revised profile text.");
      if (!summary) throw new Error("update_profile needs a one-line summary of the change.");
      deps.onProfileCard({ kind: "profile-update", summary, profile, phase: "draft" });
      return (
        `Drafted a profile update ("${summary}"). A confirm card now shows the user the new ` +
        `profile. Do not treat it as saved — they Apply it themselves.`
      );
    },
  };
}

// The generate_briefing tool: regenerate today's briefing on the user's explicit
// request. It starts a background job and returns immediately — the progress card
// and a follow-up note report the outcome — so the chat never blocks for minutes.
// It writes nothing itself and never runs on its own initiative (the red line
// lives here and in the system prompt); it refuses when a run is already going.
export function buildGenerateBriefingTool(
  deps: Pick<CompanionToolDeps, "briefingRunning" | "startBriefing">,
): AgentTool {
  return {
    name: "generate_briefing",
    description:
      "Regenerate today's briefing. Call this ONLY when the user explicitly asks to redo it " +
      "('regenerate today's, drop the old one', 're-run with the new source', 'this sorting is " +
      "wrong, redo it'), never on your own initiative — not after adding a source, not to be " +
      "helpful. `scope` picks the depth: 'retriage' re-sorts today's already-collected items " +
      "with the current profile (no new fetching — use it after a profile change or a bad sort); " +
      "'full' re-collects every source (including any just added) and re-triages, replacing " +
      "today's briefing. It starts a background job and returns at once: tell the user it's " +
      "running and a progress card will show it — do NOT claim the briefing is already " +
      "regenerated. If a run is already in progress, it will say so instead of starting another.",
    parameters: Type.Object({
      scope: Type.String({
        description:
          "'retriage' to re-sort today's cached items with the current profile (no fetch), or " +
          "'full' to re-collect every source and re-triage (replaces today's briefing).",
      }),
    }),
    execute: async (args) => {
      const raw = String(args.scope ?? "").trim();
      const scope: BriefingScope | null = raw === "full" ? "full" : raw === "retriage" ? "retriage" : null;
      if (!scope) throw new Error("generate_briefing needs scope: 'retriage' or 'full'.");
      if (deps.briefingRunning()) {
        return (
          "A briefing run is already in progress — I will not start another. Its progress card " +
          "is showing; tell the user it is already running and will update when it settles."
        );
      }
      deps.startBriefing(scope);
      const what =
        scope === "full"
          ? "Started a full regeneration (re-collecting every source, then re-triaging)"
          : "Started a re-triage of today's items with the current profile";
      return (
        `${what} in the background. A progress card is now showing it. Do NOT say the briefing is ` +
        `done — it is still running; a note will report the new briefing when it settles.`
      );
    },
  };
}

// The full companion tool set: source tools + update_profile + generate_briefing.
export function buildCompanionTools(deps: CompanionToolDeps): AgentTool[] {
  return [...buildSourceTools(deps), buildUpdateProfileTool(deps), buildGenerateBriefingTool(deps)];
}

// A running/failed status line per companion tool, extending the source labels.
export function companionToolStatusLabel(name: string, args: Record<string, unknown>): string {
  if (name === "update_profile") return "Drafting a profile update";
  if (name === "generate_briefing") {
    return args.scope === "retriage" ? "Re-sorting today's briefing" : "Regenerating the briefing";
  }
  return sourceToolStatusLabel(name, args);
}
