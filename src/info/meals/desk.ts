// What the meals conversation puts on the desk (docs/73): the household, the
// week as it stands, and the three tools that change them.
//
// One item, unlike the briefing's two. A meals chat is about one thing, and
// the guidance is the whole of what the model is told — the week, the charter
// and the rules are assembled in mealsGuidance, which is already a pure
// function of the state and the date, so this file only decides when it is
// read and hands the tools their card sink.

import {
  registerDeskItemKind,
  type DeskEnv,
  type DeskItem,
  type DeskItemKind,
  type DeskRef,
} from "../../desk";
import type { AgentTool } from "../../legion/execute/turn";
import { mealsGuidance } from "./tools";
import type { MealsState } from "./types";

/** The dinner room, as the palace row and the desk both name it. */
export const INFO_MEALS_KIND = "info-meals";

/**
 * The tools for this turn, injected the way the briefing's are (briefer/desk.ts):
 * they take the chat's card sink and the host's ports, and an anchor has to stay
 * decidable from what is already read off disk.
 */
export type MealsTools = () => Promise<AgentTool[]>;

export interface MealsDeskRef {
  // Read when the anchor was made, which is when the screen last loaded it. The
  // tools re-read it themselves, so a week applied three turns ago is the one a
  // proposal is checked against.
  state: MealsState;
  // The host's local date. Never the model's (docs/73 事实不经模型).
  today: string;
  tools?: MealsTools;
}

const mealsKind: DeskItemKind<MealsDeskRef> = {
  kind: INFO_MEALS_KIND,
  open: openMeals,
};

/** Register what meals can put on the desk. Called at startup with the rest. */
export function registerMealsDesk(): () => void {
  return registerDeskItemKind(mealsKind);
}

/**
 * Bind this turn's tools to the meals item on a desk an anchor described. The
 * mirror of withCompanionTools, and applied after it, so a desk that carries
 * both keeps each one's.
 */
export function withMealsTools(refs: readonly DeskRef[], tools: MealsTools): DeskRef[] {
  return refs.map((r) =>
    r.kind === INFO_MEALS_KIND
      ? { kind: r.kind, ref: { ...(r.ref as MealsDeskRef), tools } }
      : { kind: r.kind, ref: r.ref },
  );
}

// The dinner desk's own duty, ahead of the state. Short on purpose: everything
// that depends on what is actually planned is in mealsGuidance.
const DUTY = [
  "You plan this household's dinners and keep the week honest.",
  "Talk like someone who cooks: name the dish, say what it is, stop. Do not read the shopping",
  "list back — it is on their screen, derived by the program, and reciting it is the one thing",
  "that makes this feel like homework.",
  "Never call any of this a lab, a research room or a bureau. It is dinner.",
].join("\n");

async function openMeals(ref: MealsDeskRef, env: DeskEnv): Promise<DeskItem | null> {
  const tools = ref.tools ? await ref.tools() : [];
  if (env.signal?.aborted) return null;
  const prompt = `${DUTY}\n\n${mealsGuidance(ref.state, ref.today)}`;
  return {
    kind: INFO_MEALS_KIND,
    label: "Meals",
    // Mounted by the item rather than held for the role: these three are this
    // desk's, and no other surface in the app has them.
    tools,
    toolPrompts: [],
    rungs: [],
    prompt: () => prompt,
  };
}
