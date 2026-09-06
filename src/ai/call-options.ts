// The invoke contract a long AI call receives: an abort signal it must honor,
// and a progress callback fired with the cumulative received character count as
// deltas arrive.
//
// Declared here rather than beside the watchdog that supplies it
// (src/legion/execute/watchdog.ts). callModel takes these options and lives in
// src/ai, and src/ai may not import src/legion — legion runs agents on top of
// ai, never the other way round (tests/layering.test.ts). So the contract sits
// under both halves, and the watchdog re-exports it under the name every
// existing caller already imports.
export interface AiCallOptions {
  signal: AbortSignal;
  onProgress(chars: number): void;
}
