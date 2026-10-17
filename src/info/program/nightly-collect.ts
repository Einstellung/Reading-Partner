// The switch for the briefing's automatic collection (docs/info/35).
//
// Off since 2026-10-17: the briefing is being redesigned, so the collection that
// feeds it on its own — the 05:00 round, the first-open-of-the-day generate and
// the background source polling — is spending requests (arXiv among them) on a
// briefing nobody is reading. The redesign decides whether this comes back;
// turning it on again is this one line.
//
// What it does not touch: a briefing the reader asks for (generate_briefing, a
// reader's ask), the collector election, the topic searches and their nightly
// run, and the brief issues they feed. Those ride the same five-minute tick
// (program/live.ts), which keeps running either way.
export const NIGHTLY_COLLECT_ENABLED = false;

/** The two gates every automatic collection passes: the generate and the polling. */
export interface AutoCollectGates {
  /** Whether a briefing may generate itself (the 05:00 round, the day's first open). */
  canAutoGenerate(): Promise<boolean>;
  /** Whether the background collector polls the sources. */
  backgroundOn(): Promise<boolean>;
}

const no = async (): Promise<boolean> => false;

/** The gates as the switch leaves them: unchanged when on, both closed when off. */
export function switchedGates(
  gates: AutoCollectGates,
  enabled: boolean = NIGHTLY_COLLECT_ENABLED,
): AutoCollectGates {
  return enabled ? gates : { canAutoGenerate: no, backgroundOn: no };
}
