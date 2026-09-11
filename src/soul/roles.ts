// What the soul is here to do (docs/67 角色). A role is put on the soul the way
// a kind is put on the desk: registered at startup by the domain that owns the
// work, loaded by name when a turn is assembled.
//
// A role carries three things and nothing else — a duty paragraph, the tools the
// duty is carried out with, and a declaration of which of those tools have a
// side effect. No private data and no private memory: the statements, the
// observations and the conversations are the soul's, one set, whichever role is
// on. The secretary of docs/60 is this soul with the secretary role and boxes on
// the desk; the analyst of docs/63 is the same soul with the analyst role and a
// lab on the desk.
//
// The analyst is the second role docs/63 expects and it is not here yet: there
// is no distinct analyst duty or tool set in the code today (the labs run their
// own passes; the conversation side of a lab is still the secretary's), so
// nothing is registered for it rather than a shape being invented.

import type { AgentTool } from "../ai/agent";
import type { DeskEnv } from "../desk";

/** One of the three gates a side effect lands through (docs "AI harness"). */
export type WriteGate =
  // The tool writes nothing; it draws a card and the reader's Apply writes.
  | "card"
  // The tool really does the thing to prove it works, before anything is kept.
  | "trial"
  // The tool acts because the reader said to act, in so many words.
  | "instruction";

/**
 * One of a role's tools that has a side effect, and the gate it lands through.
 *
 * This is a declaration, read by the tests and by anyone auditing the roster.
 * Nothing intercepts a call at runtime — the gate is built into the tool itself
 * (a card sink, a trial fetch, a red line in its description), and this says
 * which one, in one place, so the roster can be read without reading every tool.
 */
export interface RoleWrite {
  tool: string;
  gate: WriteGate;
}

export interface Role {
  id: string;
  // What this person is here to do, in the second person. It rides the prompt
  // ahead of everything on the desk (turn.ts): who is at the desk is read before
  // what they are looking at.
  duty: string;
  // The tools the duty is carried out with, built for the turn being assembled.
  // The env is the turn's, so a role whose tools are bound per turn (the info
  // secretary's are bound to the host's card sinks) has something to find them
  // by.
  tools: (env: DeskEnv) => readonly AgentTool[];
  // Which of those tools write, and through which gate. Queries are not listed.
  writes: readonly RoleWrite[];
}

const ROLES = new Map<string, Role>();

/**
 * Register a role. Returns a function that removes it again.
 *
 * Throws on a second role with the same id. Unlike a desk kind, where a second
 * registration is a second boot and the opener is simply replaced, two roles
 * answering to one name is a conflict: the name is what a turn asks for, and
 * silently taking the later one would swap the person at the desk.
 */
export function registerRole(role: Role): () => void {
  const existing = ROLES.get(role.id);
  if (existing) {
    throw new Error(`soul: a role called "${role.id}" is already registered`);
  }
  ROLES.set(role.id, role);
  return () => {
    if (ROLES.get(role.id) === role) ROLES.delete(role.id);
  };
}

/** The role by that name. Throws when nothing registered it — a wiring mistake. */
export function roleOf(id: string): Role {
  const role = ROLES.get(id);
  if (!role) {
    throw new Error(
      `soul: no role called "${id}" — the domain that owns it has to register one at startup`,
    );
  }
  return role;
}

/** Whether a role answers to that name. */
export function roleRegistered(id: string): boolean {
  return ROLES.has(id);
}

/** Every registered role, in registration order. */
export function listRoles(): readonly Role[] {
  return [...ROLES.values()];
}
