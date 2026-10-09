// take_link, the door's tool for a link the reader pastes to Lumen (docs/68
// 「收链接」): start a topic intake for it and put the intake card up, then end.
// The fetch runs on as an ingest-url run; the reader picks the topic on the card.
//
// The model never types a URL. The links are read off the reader's own message
// here, numbered, and the model names one by its number or says "all". The
// numbers and the topic list reach it as an app note on that message
// (linkTurnNote), which leaves the tool's own definition the same every turn.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import type { BoxOrigin } from "../../box";
import { t } from "../../i18n";
import { hostOf } from "../../platform/std/url";
import type { IntakeCard } from "./intake-card";

// A link runs to the first space, quote or angle bracket, or to CJK punctuation
// or a CJK character typed straight after it: a pasted link is percent-encoded,
// and Chinese written against it is the sentence, not the address.
const LINK = /https?:\/\/[^\s<>"'`　-〿一-鿿！-／：-＠]+/giu;
// What a sentence puts after a link without meaning it as part of the address.
const TRAILING = /[.,;:!?)\]}]+$/u;

/** The links in a message, in the order they appear, each once. */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(LINK)) {
    let url = match[0].replace(TRAILING, "");
    // A closing parenthesis the address itself opened stays (Wikipedia-style).
    if (match[0].length > url.length && match[0][url.length] === ")" && url.includes("(")) url += ")";
    if (url.length > "https://".length && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The links the tool numbers: the reader's latest message that has any. The
 * latest one, so "take the link I sent earlier" still finds it when nothing
 * newer carries one.
 */
export function linksToTake(history: readonly { role: string; text: string }[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const row = history[i];
    if (row.role !== "user") continue;
    const links = extractLinks(row.text);
    if (links.length > 0) return links;
  }
  return [];
}

/**
 * The app note added to the reader's message, as the model is sent it, when the
 * message carries links: the links by number and the topics by number (the
 * topic menu, shelf order). Never shown to the reader and never stored.
 */
export function linkTurnNote(links: readonly string[], topics: readonly { name: string }[]): string {
  if (links.length === 0) return "";
  const linkLines = links.map((url, i) => `${i + 1}. ${url}`).join("\n");
  const topicLines = topics.length > 0 ? topics.map((topic, i) => `${i + 1}. ${topic.name}`).join("\n") : "(none yet)";
  return (
    `\n\n[App note, not the reader's words. Links in this message:\n${linkLines}\n` +
    `The reader's topics:\n${topicLines}\n` +
    `To take links in, call take_link with the link's number or "all", and a topic number only when one clearly fits.]`
  );
}

export interface TakeLinkDeps {
  /** The numbered links of this turn (linksToTake), read when the tool runs. */
  links(): readonly string[];
  /** Where the conversation is held; the intake's box item and the run's answer go back to it. */
  origin: BoxOrigin;
  /** Start the intake (startTopicIntake). */
  start(url: string, origin: BoxOrigin): Promise<{ intakeId: string }>;
  /** The topics in shelf order, the order the note numbers them in. */
  topics(): Promise<readonly { id: string }[]>;
  /** Put the intake card in the conversation. */
  raiseCard(card: IntakeCard): void;
}

function which(arg: unknown, count: number): number[] | string {
  const said = String(arg ?? "").trim().toLowerCase();
  if (said === "" || said === "all") return Array.from({ length: count }, (_, i) => i);
  const n = Number(said);
  if (Number.isInteger(n) && n >= 1 && n <= count) return [n - 1];
  return count === 1
    ? `There is one link; pass 1 or "all".`
    : `There are ${count} links; pass a number from 1 to ${count}, or "all".`;
}

export function buildTakeLinkTool(deps: TakeLinkDeps): AgentTool {
  return {
    name: "take_link",
    label: () => t("reader.intake.toolLabel"),
    effect: "write",
    gate: "card",
    description:
      "Take a link the reader pasted into their library. Call it when their message carries a " +
      "link, or when they ask you to take one in. Name the link by its number from the app note " +
      'on their message, or "all"; never type a URL. A card goes up at once: it shows the fetch, ' +
      "and the reader picks the topic on it. The tool does not wait for the fetch.",
    parameters: Type.Object({
      link: Type.String({ description: 'The link\'s number in the app note (1-based), or "all".' }),
      topic: Type.Optional(
        Type.Number({
          description:
            "The number of the topic that clearly fits, from the app note's topic list. Leave it out when unsure.",
        }),
      ),
    }),
    execute: async (args) => {
      const links = deps.links();
      if (links.length === 0) return "There is no link in the reader's recent messages. Ask them to paste it.";
      const picked = which(args.link, links.length);
      if (typeof picked === "string") return picked;

      let suggestedTopicId: string | undefined;
      if (typeof args.topic === "number" && Number.isFinite(args.topic)) {
        const topics = await deps.topics().catch(() => []);
        suggestedTopicId = topics[Math.round(args.topic) - 1]?.id;
      }

      const taken: string[] = [];
      const refused: string[] = [];
      for (const i of picked) {
        const url = links[i];
        try {
          const { intakeId } = await deps.start(url, deps.origin);
          deps.raiseCard({ kind: "link-intake", intakeId, ...(suggestedTopicId ? { suggestedTopicId } : {}) });
          taken.push(hostOf(url));
        } catch (e) {
          refused.push(`link ${i + 1} (${hostOf(url)}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (taken.length === 0) throw new Error(`Could not start taking the link in. ${refused.join(" ")}`);

      const cards = taken.length === 1 ? "The card is" : `${taken.length} cards are`;
      const lines = [
        `${cards} up in the conversation; the reader picks the topic there. Don't ask which topic, and don't wait for the fetch.`,
      ];
      if (refused.length > 0) lines.push(`Not started: ${refused.join(" ")}`);
      return {
        text: lines.join(" "),
        receipt: { label: t("reader.intake.receiptLabel"), summary: taken.join(", ") },
      };
    },
  };
}
