// What the front asks of the back (docs/companion/136 "delegate"、"并行、取消、
// 改口"、"回来"、"落盒"). LOCAL STAND-IN: the back half is written on another
// branch (hv/backend) and its contract replaces this file's interface; until
// then the live call is wired to `backendNotConnected`, which refuses every
// delegation with a sentence the model can read.

export interface DelegateRequest {
  kind: string;
  /** The brief, written for someone who cannot hear the call. */
  task: string;
  /** The run id of an earlier result this one follows on from. */
  follows?: string;
}

export type DelegateAnswer = { ok: true; runId: string } | { ok: false; reason: string };

/** A run this call sent out, as the list shows it. */
export interface BackRun {
  runId: string;
  task: string;
  status: "running" | "done" | "failed" | "cancelled";
  /** The run's own one-line progress. */
  progress?: string;
  cover?: string;
}

/** A box item not yet opened. */
export interface BackBoxItem {
  id: string;
  cover: string;
}

export interface BackOutcome {
  runId: string;
  outcome: "done" | "failed";
  /** The cover when done, the reason when failed. */
  cover: string;
}

export interface VoiceBackend {
  delegate(req: DelegateRequest): Promise<DelegateAnswer>;
  cancel(runId: string): Promise<{ ok: boolean; reason?: string }>;
  /** The runs sent from this call, and the box items not yet opened. */
  runs(): BackRun[];
  unopened(): BackBoxItem[];
  /** The result's text exactly as it landed. Null while it has none. */
  original(id: string): Promise<string | null>;
  /** Read out in full, or opened on screen. */
  told(id: string): Promise<void>;
  /** A run sent from this call came back or failed. */
  subscribe(cb: (outcome: BackOutcome) => void): () => void;
}

/** The stand-in for a back that is not connected yet. */
export function backendNotConnected(): VoiceBackend {
  return {
    delegate: async () => ({ ok: false, reason: "Nothing can be handed off from a call on this build yet." }),
    cancel: async () => ({ ok: false, reason: "No run is going." }),
    runs: () => [],
    unopened: () => [],
    original: async () => null,
    told: async () => {},
    subscribe: () => () => {},
  };
}
