// The meals conversation's role (docs/71 角色, docs/73): who sits at the meals
// desk. What lies on it — the household, the week, the list, and the tools that
// change them — is the desk item's (../desk.ts) and is bound per turn to the
// surface's card sink, so the role holds no tools of its own.

import { registerRole, roleRegistered, type Role } from "../../soul";

export const MEALS_ROLE_ID = "meals";

/** What this person is here to do. It rides ahead of everything on the desk. */
export const MEALS_DUTY =
  "Here you are helping the user plan and cook what they eat: the week's plan, the shopping " +
  "list, how each dish is made and the batch prep. Through your tools you can draft a plan and " +
  "apply it once they agree, change what they told you about their household, record a meal " +
  "that went differently and start the prep — always on the user's request, never on your own. " +
  "Answer concisely and honestly, in the user's language. If something isn't in the provided " +
  "text, say so rather than inventing it.";

const meals: Role = {
  id: MEALS_ROLE_ID,
  duty: MEALS_DUTY,
  tools: () => [],
  writes: [],
};

/**
 * Register the meals role. Called once at startup by the shell (bootDomains),
 * and by the tests that assemble a meals turn. Registering twice is a second
 * boot rather than a conflict, so the second one is left alone.
 */
export function registerMealsRole(): () => void {
  if (roleRegistered(MEALS_ROLE_ID)) return () => {};
  return registerRole(meals);
}
