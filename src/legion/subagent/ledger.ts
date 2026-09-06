// How many model turns a caller's turn is willing to spend on sub-agents, all
// of them together.
//
// This is not in src/budget, and the reason is worth stating: that module prices
// one assembled call against one model's context window. It has no notion of
// spend accumulating across calls, so it cannot express "this whole turn may
// cost at most N model turns, and a nested run draws from the same pot". The
// sizing of each individual sub-agent round does go through src/budget — the
// agent loop measures every round it sends and refuses one that would be clamped
// — but the pot is counted here.
//
// What it stops: a parent model that calls the same sub-agent nine times, each
// one legal on its own, and spends the reader's whole turn on lookups the reader
// never asked for. Without a shared ledger every call is another six turns and
// nothing says no.

export interface SubagentLedger {
  // Reserve up to `want` turns and return what was actually granted, which may
  // be 0. A run granted 0 must not be sent.
  grant(want: number): number;
  // Report what the run actually spent, releasing the rest of the reservation.
  settle(reserved: number, used: number): void;
  remaining(): number;
}

// A ledger for one caller turn. Sequential by construction: the agent loop
// awaits each tool call before the next, so grant/settle never interleave.
export function createSubagentLedger(totalRounds: number): SubagentLedger {
  let left = Math.max(0, Math.floor(totalRounds));
  return {
    grant(want) {
      const granted = Math.max(0, Math.min(Math.floor(want), left));
      left -= granted;
      return granted;
    },
    settle(reserved, used) {
      const spent = Math.max(0, Math.min(reserved, used));
      left += reserved - spent;
    },
    remaining() {
      return left;
    },
  };
}
