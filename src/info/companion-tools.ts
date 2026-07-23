// The shared info-companion tool set (docs/16/17): the three add-source tools
// plus update_profile, mounted the same way on every info chat entry (briefing
// Ask, article chat, the add-source flow). update_profile only DRAFTS — it
// surfaces a confirm card with the complete proposed profile; the host saves it
// only when the user clicks Apply. Pure: the card sink is injected, so the tool
// tests without a real save. Composition over the source tools keeps the consent
// rules in one place.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import type { ProfileUpdateCardData } from "./cards";
import { buildSourceTools, sourceToolStatusLabel, type SourceToolDeps } from "./source-tools";

export interface CompanionToolDeps extends SourceToolDeps {
  // Surface the profile-update confirm card in the chat. The host owns the Apply
  // write; the tool never persists.
  onProfileCard(card: ProfileUpdateCardData): void;
}

// The update_profile tool: draft a complete revised profile and show it for
// confirmation. It writes nothing — the card's Apply does, in the host.
export function buildUpdateProfileTool(deps: Pick<CompanionToolDeps, "onProfileCard">): AgentTool {
  return {
    name: "update_profile",
    description:
      "Draft a change to the user's reading profile, which steers what the daily triage " +
      "keeps or filters. Call this ONLY when the user states a standing preference (e.g. " +
      "'be harsher on vendor PR', 'keep 量子位's paper explainers'), never on your own " +
      "initiative and never from a one-off reaction to a single item. Pass the COMPLETE " +
      "revised profile text (not a fragment) and a one-line summary of what changed. It " +
      "does not save — it shows the user a confirm card with the new profile; they Apply it.",
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

// The full companion tool set: source tools + update_profile.
export function buildCompanionTools(deps: CompanionToolDeps): AgentTool[] {
  return [...buildSourceTools(deps), buildUpdateProfileTool(deps)];
}

// A running/failed status line per companion tool, extending the source labels.
export function companionToolStatusLabel(name: string, args: Record<string, unknown>): string {
  if (name === "update_profile") return "Drafting a profile update";
  return sourceToolStatusLabel(name, args);
}
