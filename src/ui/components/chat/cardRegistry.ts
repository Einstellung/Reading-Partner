// The whole card registry, gathered from the domains that contribute cards.
// MessageBubble renders a card part by looking up its kind here.
//
// It is its own module rather than a table inside one domain's card file because
// the union in chatParts.ts is shared: an entry missing for any kind is a
// compile error here, which is where a new card kind is meant to be noticed.

import type { CardRegistry } from "./chatParts";
import { INFO_CARD_REGISTRY } from "../info/InfoCards";
import { READING_CARD_REGISTRY } from "../reader/RehearsalCard";

export const CARD_REGISTRY: CardRegistry = {
  ...INFO_CARD_REGISTRY,
  ...READING_CARD_REGISTRY,
};
