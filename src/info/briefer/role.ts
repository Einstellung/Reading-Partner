// The secretary (docs/60, docs/67 角色): the soul with the boxes on the desk.
//
// The duty is who this person is and what they are here to do for the reader.
// What lies in the boxes — today's briefing, the source roster, the reading
// profile, where each lab stands — is the desk item's (desk.ts), and stays
// there: the role is the same person on a day with no briefing as on a day with
// one.
//
// The tools are the companion set (companion-tools.ts, lab-tool.ts). They are
// bound per turn, to the host's card sinks and its briefing controller, so they
// arrive on the briefing ref the way they always did and the item hands them
// over as the desk is laid (holdSecretaryTools). The role then gives them to the
// soul when the turn is assembled. They are held against the turn's own DeskEnv
// rather than in a slot, so two surfaces assembling at once — the chat and the
// voice call — cannot take each other's card sinks.

import { registerRole, roleRegistered, type Role } from "../../soul";
import type { DeskEnv } from "../../desk";
import type { AgentTool } from "../../ai/agent";

export const SECRETARY_ROLE_ID = "secretary";

/**
 * What the secretary is here to do. It rides ahead of everything on the desk.
 *
 * The sentence about the tools stays with the duty rather than with the tool
 * guidance below it: what this person may do on the reader's behalf, and the
 * standing rule that none of it happens unasked, is the job itself.
 */
export const SECRETARY_DUTY =
  "You are the reading companion for the user's daily briefing. You do more than answer " +
  "questions about the material below: through your tools you can refine the reading profile " +
  "the analysts read, set up and archive labs, add new sources, and regenerate today's briefing — " +
  "always on the user's " +
  "request, never on your own. Answer concisely and honestly, in the user's language. If " +
  "something isn't in the provided text, say so rather than inventing it.";

// The tools this turn's secretary is holding. Keyed by the DeskEnv the turn is
// being assembled against: the desk is laid with it and the soul is opened with
// the same object, so the handoff is per turn and needs no clearing — the entry
// goes when the env does.
const HELD = new WeakMap<DeskEnv, readonly AgentTool[]>();

/**
 * Hand this turn's companion tools to the secretary. Called by the briefing desk
 * item as the desk is laid; a turn assembled without the role simply mounts none
 * of them.
 */
export function holdSecretaryTools(env: DeskEnv, tools: readonly AgentTool[]): void {
  HELD.set(env, tools);
}

/**
 * Which of the secretary's tools write, and through which of the three gates the
 * write lands (docs "AI harness"). A declaration, not an interceptor: the gate
 * is built into the tool itself, and this is the one place the roster can be
 * read off.
 *
 * probe_source and read_page are not here — they only fetch and report, and
 * queries flow (docs/17).
 */
export const SECRETARY_WRITES: Role["writes"] = [
  // Really fetches three articles so the reader can see the source works. The
  // proof is the gate, and the confirm card it draws is what add_source is a
  // yes to.
  { tool: "trial_source", gate: "trial" },
  // Subscribes the source. It writes on the spot, so what stands in front of it
  // is the user's explicit yes to that exact descriptor, after a trial of it.
  { tool: "add_source", gate: "instruction" },
  // Draft a profile, draft a lab, propose closing one: all three write nothing.
  // The card's Apply does, in the host.
  { tool: "update_profile", gate: "card" },
  { tool: "propose_lab", gate: "card" },
  { tool: "archive_lab", gate: "card" },
  // Starts a background run that replaces today's briefing, or leaves the
  // request for the machine that collects. Only on a request to redo it.
  { tool: "generate_briefing", gate: "instruction" },
  // Puts a real window on the reader's screen. Drafting is free; a window is
  // not, so it opens only when they ask to sign in.
  { tool: "open_site_sign_in", gate: "instruction" },
];

const secretary: Role = {
  id: SECRETARY_ROLE_ID,
  duty: SECRETARY_DUTY,
  tools: (env) => HELD.get(env) ?? [],
  writes: SECRETARY_WRITES,
};

/**
 * Register the secretary. Called once at startup by the shell (bootDomains),
 * and by the tests that assemble an info turn. Registering twice is a second
 * boot rather than a conflict, so the second one is left alone.
 */
export function registerSecretaryRole(): () => void {
  if (roleRegistered(SECRETARY_ROLE_ID)) return () => {};
  return registerRole(secretary);
}
