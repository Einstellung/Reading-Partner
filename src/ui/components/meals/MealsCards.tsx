// The meals conversation's cards (meals/cards.ts), registered for the render
// layer in ui/components/cardRegistry.ts. Presentational: a card only declares
// intent via `dispatch`; the call's onCardAction owns the writes.

import type { MealsAppliedCardData, MealsCard } from "../../../meals/cards";
import { appliedLine } from "../../../meals/screen/view";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { useT } from "../../../i18n";
import { MealsDraftCard } from "./MealsDraftCard";
import { MealsPrepCard } from "./MealsPrepCard";

// The row an Apply leaves: one quiet line in the reader's language for a week
// applied from the old weekly card, nothing for a draft (its card above has
// collapsed to say it). The row's text is the model's note and is not drawn
// (meals/cards.ts).
export function MealsAppliedCard({ payload }: CardComponentProps<MealsAppliedCardData>) {
  useT();
  if (payload.draft) return null;
  return <div className="text-[12px] leading-snug text-faint-foreground">{appliedLine(payload)}</div>;
}

export const MEALS_CARD_REGISTRY: CardRegistryFor<MealsCard["kind"]> = {
  "meals-draft": MealsDraftCard,
  "meals-applied": MealsAppliedCard,
  "meals-prep": MealsPrepCard,
};
