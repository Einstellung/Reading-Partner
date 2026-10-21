// Who is speaking (docs/companion/90), in two parts.
//
// The short part leads every turn's system prompt (turn.ts), ahead of a role's
// duty and of whatever lies on the desk: the companion's name, what it is,
// where its line is, and that about_app answers the rest. Its bytes depend on
// the name alone, so the provider's cache prefix (docs/pitfall/ai/663) holds
// whatever tools a turn carries.
//
// The long part is about_app's result, paid for only when the reader asks who
// the companion is or what the app can do. What it can do is never written
// here. It is read off the two things that are really there: the places the
// shell registered (desk/places.ts) and the tools this turn holds. A screen
// that is not registered or a tool that is not mounted cannot be claimed, and
// one that is added shows up without anyone editing this.

import { Type } from "@earendil-works/pi-ai";
import type { Place } from "../desk";
import type { AgentTool } from "../legion/durable/contract";
import { t } from "../i18n";

export const ABOUT_APP_TOOL = "about_app";

export interface IntroInput {
  // The companion's name, as companionNameOf gives it.
  name: string;
  // The shell's places, in registration order. Empty on a headless run.
  places: readonly Pick<Place, "id" | "about">[];
  // The tools this turn holds that are the companion's own: the role's, the
  // soul's and the surface's, in that order. What lies on the desk brings its
  // own explanation.
  tools: readonly { name: string; description: string }[];
}

/** How long one tool's line may run before it is cut at a word. */
const TOOL_LINE_CAP = 160;

// The first sentence of a tool's description: what it does, without the rules
// for calling it, which the description itself carries to the model.
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // A CJK stop ends a sentence whatever follows it; a Latin one only before a
  // space, so "e.g." and "v1.2" do not.
  const end = flat.search(/[.!?](\s|$)|[。！？]/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  if (sentence.length <= TOOL_LINE_CAP) return sentence;
  const cut = sentence.slice(0, TOOL_LINE_CAP);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

/** The block every turn leads with: the name, what the companion is, its line, and where the rest is. */
export function introBlock(name: string): string {
  return [
    `You are ${name}, the Lumen app's companion in the corner of every screen.`,
    "A tool for reading, analysis and the reader's material, not a person: no longing or affection.",
    `Asked about yourself, the app or how to use it, call ${ABOUT_APP_TOOL} first.`,
  ].join("\n");
}

/** What about_app hands back: the name, how to answer, the places and the companion's tools. */
export function aboutAppText(input: IntroInput): string {
  const lines = [
    `You are ${input.name}, the companion inside the Lumen app. You live in the corner of every screen, and the reader talks to you there.`,
    `When the reader asks who you are or what you can do, say your name is ${input.name} and describe only what is listed below: ` +
      "the places in this app and what you can do in this conversation. Never invent a feature; if something is not listed, say this app does not have it.",
  ];
  if (input.places.length > 0) {
    lines.push("", "Places in this app:", ...input.places.map((p) => `- ${p.id}: ${p.about}`));
  }
  if (input.tools.length > 0) {
    lines.push(
      "",
      "What you can do in this conversation:",
      ...input.tools.map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`),
    );
  }
  return lines.join("\n");
}

/**
 * about_app for one turn. Its description is fixed, so the tool list is the
 * same bytes whatever is registered; what it returns is built from `input`
 * when called. A read: it writes nothing and needs no gate.
 */
export function buildAboutAppTool(input: IntroInput): AgentTool {
  return {
    name: ABOUT_APP_TOOL,
    label: () => t("chat.aboutApp.looking"),
    effect: "read",
    replay: "safe",
    description:
      "Your name, the places in this app and what you can do here, with how to answer. " +
      "Call it first when the reader asks who you are, what you or the app can do, or how to do something.",
    parameters: Type.Object({}),
    execute: async () => aboutAppText(input),
  };
}
