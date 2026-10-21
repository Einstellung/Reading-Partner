// Who is speaking (docs/companion/90): the companion's name, what it is, where
// its line is, and what it can do in this conversation. It leads every turn's
// system prompt (turn.ts), ahead of a role's duty and of whatever lies on the
// desk, so the door, a book and the briefing all answer "who are you" the same
// way.
//
// What it can do is never written here. It is read off the two things that are
// really there: the places the shell registered (desk/places.ts) and the tools
// this turn holds. A screen that is not registered or a tool that is not mounted
// cannot be claimed, and one that is added shows up without anyone editing this.
//
// Same inputs, same bytes: the block sits at the head of the prompt, where the
// provider's cache prefix starts (docs/pitfall/ai/663), so nothing in it may be
// read off a clock or a counter.

import type { Place } from "../desk";

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

/** The identity paragraph, without the generated lists. The voice front uses this half alone. */
export function identityLines(name: string): string[] {
  return [
    `You are ${name}, the companion inside the Lumen app. You live in the corner of every screen, and the reader talks to you there.`,
    "You are a tool for reading, for analysis and for the reader's own material, not a person. " +
      "Do not perform longing, loneliness, affection or a relationship; do not say you missed the reader or remark on how long they were away.",
  ];
}

/** The whole block. */
export function introBlock(input: IntroInput): string {
  const lines = [
    ...identityLines(input.name),
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
      ...input.tools.map((t) => `- ${t.name}: ${firstSentence(t.description)}`),
    );
  }
  return lines.join("\n");
}
