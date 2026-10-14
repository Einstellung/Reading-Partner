// confirm_topic_search (docs/info/88 起草：来回问): the reader said yes to the
// drafting card in words. It does what the card's Follow button does: the
// newest card in this conversation is applied (apply.ts) and drawn as applied.
// The door chat finds the card and marks it (ui/components/lumen/use-door-chat.ts);
// this file only decides what to tell the model.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import { asString } from "../../platform/std/json";
import { t } from "../../i18n";
import type { ApplyResult } from "./apply";
import type { TopicSearchProposalCardData } from "./cards";

export interface ConfirmToolDeps {
  /** The newest drafting card in this conversation, or null when it has none. */
  latestCard(): { cardId: string; card: TopicSearchProposalCardData } | null;
  /** The card's Apply, with the card then marked applied in the conversation. */
  apply(cardId: string): Promise<ApplyResult>;
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function buildConfirmTopicSearchTool(deps: ConfirmToolDeps): AgentTool {
  return {
    name: "confirm_topic_search",
    label: (args) => t("info.tool.confirmingTopicSearch", { name: String(args.name ?? "") }),
    effect: "write",
    gate: "instruction",
    description:
      "Apply the topic-search card you drew last, when the reader agrees to it in words ('ok', " +
      "'好', 'go ahead'). Same as the card's Follow button: the search is filed and its first run " +
      "is sent. Only for the card as drawn; when they changed something, propose again first.",
    parameters: Type.Object({
      name: Type.String({ description: "The name on the card being confirmed." }),
    }),
    execute: async (args) => {
      const latest = deps.latestCard();
      if (!latest) {
        return { text: "There is no topic-search card in this conversation to confirm. Propose one first.", receipt: null };
      }
      const { cardId, card } = latest;
      const name = asString(args.name).trim();
      if (name && fold(name) !== fold(card.name)) {
        return {
          text:
            `The latest card is "${card.name}", not "${name}", so nothing was applied. ` +
            `Propose "${name}" first, or confirm "${card.name}".`,
          receipt: null,
        };
      }
      if (card.phase === "applied") {
        return { text: `"${card.name}" is already applied; the reader follows it.`, receipt: null };
      }
      const result = await deps.apply(cardId);
      if (!result.ok) {
        return {
          text: `"${card.name}" could not be applied; nothing was filed. Ask the reader to press Follow on the card.`,
          receipt: null,
        };
      }
      return {
        text:
          `Applied "${result.search.name}" (id: ${result.search.id}); its first run is sent.` +
          `${result.search.once ? " Just this once: it stops after the first result." : ""} ` +
          "Tell the reader in one line.",
        receipt: { label: t("info.tool.confirmedTopicSearch"), summary: result.search.name },
      };
    },
  };
}
