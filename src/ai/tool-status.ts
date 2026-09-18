import type { PersistedToolStatus } from "../platform/app/threads";

// A tool call an agent turn makes, and the trace of them a reply carries. Both
// the reading companion and the info companion keep the same list: a status goes
// on when a tool starts and is settled where it stands when the call ends, so
// what the turn did is still there under the answer.
//
// This describes what the agent did, not how a row is drawn, which is why it
// sits in the capability every caller already depends on rather than in a
// components directory the chat rows would have to import back.

// Where the thing a write left behind now lives, so the receipt can be walked
// back to. One case per kind of destination the app can already navigate to;
// nothing here invents a target a surface cannot open.
export type ReceiptLink =
  | { kind: "observation"; id: string }
  | { kind: "book"; id: string }
  | { kind: "thread"; bookId: string; threadId: string }
  | { kind: "run"; id: string };

// What a write did, for the reader. A tool that changes anything comes back with
// one (legion/execute/contract.ts): the write is otherwise invisible, since the
// tool's text goes to the model and nowhere else. Declared here rather than in
// the tool contract because a receipt outlives the call — it is persisted with
// the row — and because ai may not import legion.
export interface Receipt {
  // What was done: "Added an observation". One short clause, no trailing period.
  label: string;
  // The substance, one or two lines: the observation text, the document title.
  summary: string;
  // Where the thing now lives, when there is somewhere to go.
  link?: ReceiptLink;
}

// A tool call surfaced in the chat flow. 'running' shows a subdued status line
// while the turn is in flight; 'done' is what it becomes when the call returns,
// and the finished rows collapse into one grey line under the answer; 'error'
// reuses the soft-error style and carries the sentence the tool threw.
export interface ToolStatus {
  name: string;
  label: string;
  state: "running" | "done" | "error";
  // What the call did, when it was a write that reported one. Stored and
  // persisted; nothing draws it yet.
  receipt?: Receipt;
  // Why it failed, on an 'error' row: the message the tool threw.
  error?: string;
}

// Project a settled trace into the durable shape the thread store writes
// (platform/app/threads.ts). A call still running belongs to a turn that never
// landed, and is dropped on the way to disk; null when nothing is left to keep.
export function persistedTrace(tools: readonly ToolStatus[]): PersistedToolStatus[] | null {
  const settled = tools
    .filter((t): t is ToolStatus & { state: "done" | "error" } => t.state !== "running")
    .map((t) => ({
      name: t.name,
      label: t.label,
      state: t.state,
      ...(t.receipt ? { receipt: t.receipt } : {}),
      ...(t.error ? { error: t.error } : {}),
    }));
  return settled.length ? settled : null;
}

// A tool started: append its running status.
export function appendRunningTool(
  tools: ToolStatus[] | undefined,
  name: string,
  label: string,
): ToolStatus[] {
  return [...(tools ?? []), { name, label, state: "running" }];
}

// A running tool said something new about itself: rewrite its label in place. The
// one row a research sub-agent gets, kept alive as its run goes on — a second row
// per update would be the trace the sub-agent exists to keep out of the chat.
// Returns null when nothing of that name is running, so the caller can leave its
// message untouched.
export function relabelRunningTool(
  tools: ToolStatus[] | undefined,
  name: string,
  label: string,
): ToolStatus[] | null {
  const next = [...(tools ?? [])];
  let idx = -1;
  for (let i = 0; i < next.length; i++) {
    if (next[i].state === "running" && next[i].name === name) idx = i;
  }
  if (idx < 0) return null;
  if (next[idx].label === label) return null;
  next[idx] = { ...next[idx], label };
  return next;
}

// A tool finished: settle the last running status of that name in place — 'done'
// on success, 'error' on failure, with whatever the call reported about itself.
// Nothing is dropped: a call that ran is part of what the turn did, and a trace
// that deletes its successes can only ever show failures. Returns null when
// nothing matches, so the caller can leave its message untouched.
export function resolveToolStatus(
  tools: ToolStatus[] | undefined,
  name: string,
  isError: boolean,
  info: { receipt?: Receipt; error?: string } = {},
): ToolStatus[] | null {
  const next = [...(tools ?? [])];
  let idx = -1;
  for (let i = 0; i < next.length; i++) {
    if (next[i].state === "running" && next[i].name === name) idx = i;
  }
  if (idx < 0) return null;
  next[idx] = {
    ...next[idx],
    state: isError ? "error" : "done",
    ...(info.receipt ? { receipt: info.receipt } : {}),
    ...(info.error ? { error: info.error } : {}),
  };
  return next;
}
