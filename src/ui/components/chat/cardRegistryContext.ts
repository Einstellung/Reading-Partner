// Where a chat row finds the component for a card kind.
//
// The table itself is assembled one level up (ui/components/cardRegistry.ts)
// from the domains that contribute cards. If chat/ imported it, chat would
// import info/ and reader/, which both import chat/ back for the card protocol —
// so the table arrives through a provider instead, and the only files that name
// it are the two shells that mount a chat.
//
// Null rather than an empty table by default: a chat rendered outside a provider
// has no cards at all, and a card part reaching it is a wiring bug rather than a
// missing kind.

import { createContext, useContext } from "react";
import type { CardRegistry } from "./chatParts";

export const CardRegistryContext = createContext<CardRegistry | null>(null);

export function useCardRegistry(): CardRegistry | null {
  return useContext(CardRegistryContext);
}
