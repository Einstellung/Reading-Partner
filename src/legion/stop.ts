// The sentinel that says a run ended because someone stopped it, as opposed to
// failing. Thrown by the watchdog when a Stop signal fires, by the pacing
// limiter while a group waits out a cooldown, and by the sub-agent turn settler
// when the agent loop returns silently on abort; caught by the domains, which
// must never report a hangup as a broken call.
//
// At the root of src/legion rather than in the watchdog that raises it most,
// because both halves of the directory need it: legion/subagent imports the
// turn out of legion/execute, so anything legion/execute would have to import
// back closes a cycle.
export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

// A failure another attempt cannot change: the worker looked and will not do
// this. The runner stops the run at `failed` on the first one instead of
// spending the remaining attempts, with the message as the run's last line.
export class GiveUpError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GiveUpError";
  }
}
