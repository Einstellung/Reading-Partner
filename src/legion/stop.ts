// The sentinel that says a run ended because someone stopped it, as opposed to
// failing. Thrown by the watchdog when a Stop signal fires, by the pacing
// limiter while a group waits out a cooldown, and by the sub-agent turn settler
// when the agent loop returns silently on abort; caught by the domains, which
// must never report a hangup as a broken call.
//
// At the root of src/legion rather than in the watchdog that raises it most,
// because both halves of the directory need it and legion/execute has to be
// free to import legion/subagent (agent-turn.ts composes a brief). With the
// class in the watchdog, that import would close a cycle.
export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}
