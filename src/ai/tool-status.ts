// A tool call an agent turn makes, and the transient trace of them a streaming
// reply carries (M6). Both the reading companion and the info companion keep the
// same list: a status goes on when a tool starts and comes off when it succeeds,
// and a failure stays visible. Never persisted.
//
// This describes what the agent did, not how a row is drawn, which is why it
// sits in the capability every caller already depends on rather than in a
// components directory the chat rows would have to import back.

// A tool call surfaced in the chat flow while the AI turn runs (M6). 'running'
// shows a subdued status line; 'error' reuses the soft-error style. Successful
// tools are dropped from the list once their result is folded into the answer.
export interface ToolStatus {
  name: string;
  label: string;
  state: "running" | "error";
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

// A tool finished: resolve the last running status of that name — dropped on
// success, marked failed on error (soft-error style, left visible). Returns null
// when nothing matches, so the caller can leave its message untouched.
export function resolveToolStatus(
  tools: ToolStatus[] | undefined,
  name: string,
  isError: boolean,
): ToolStatus[] | null {
  const next = [...(tools ?? [])];
  let idx = -1;
  for (let i = 0; i < next.length; i++) {
    if (next[i].state === "running" && next[i].name === name) idx = i;
  }
  if (idx < 0) return null;
  if (isError) next[idx] = { ...next[idx], state: "error" };
  else next.splice(idx, 1);
  return next;
}
