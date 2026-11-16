// The chat cards a line whose experiment is off does not draw
// (platform/experiments). A card already in a conversation stays on disk and
// renders nothing until the switch is back on, the same way the old briefing's
// cards do (info/InfoCards.tsx).

import type { CardKind, CardRegistry } from "./chat/chatParts";
import type { ExperimentGates } from "./base/experiment-gates";

export const MEALS_CARD_KINDS = ["meals-draft", "meals-applied", "meals-prep"] as const satisfies readonly CardKind[];

// Topic search and studies, and a question asked over a brief (docs/info/88, 91).
export const INTEL_CARD_KINDS = [
  "topic-search-proposal",
  "study-seeds",
  "study-lines",
  "study-move",
  "issue-question",
] as const satisfies readonly CardKind[];

export function hiddenCardKinds(gates: Pick<ExperimentGates, "meals" | "intel">): CardKind[] {
  return [...(gates.meals ? [] : MEALS_CARD_KINDS), ...(gates.intel ? [] : INTEL_CARD_KINDS)];
}

const NoCard = () => null;

export function gatedRegistry(registry: CardRegistry, hidden: readonly CardKind[]): CardRegistry {
  if (hidden.length === 0) return registry;
  const out: Record<string, unknown> = { ...registry };
  for (const kind of hidden) out[kind] = NoCard;
  return out as CardRegistry;
}
