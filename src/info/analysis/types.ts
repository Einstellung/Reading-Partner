// What one analyst run and one synthesis run are made of (docs/63 加工).
//
// Two model calls per lab per day. The analyst reads the picture and the day's
// cables and hands back an increment; the program applies it. The synthesis
// reads the picture before and after and writes the cover the reader sees.
// Neither model ever edits a file: the analyst's reach ends at a PictureDelta
// and the synthesis's ends at a cover plus two lists of cable ids.

import type { AiCallOptions } from "../../ai/call-options";
import type { AiLanguage } from "../../platform/app/settings";
import type { Cable } from "../cable/types";
import type { Lab } from "../labs/types";
import type { Picture, PictureDelta } from "../picture/types";

// A cable with as much of its body as the analyst is allowed to read. The body
// lives in the article cache; the pipeline joins the two before calling in.
export type AnalystCable = Cable & { text?: string };

export interface AnalystInput {
  lab: Lab;
  picture: Picture;
  /** Local date of the run. Everything the delta adds is stamped with it. */
  date: string;
  aiLanguage?: AiLanguage;
  /** Today's cables for this lab, each body already cut to ANALYST_TEXT_CHARS. */
  cables: AnalystCable[];
  /**
   * What is known about the reader, not about the world. It decides who the
   * room is writing for; it is never evidence for a judgment.
   */
  memory: { profile: string; observations: string };
}

export interface AnalystOutput {
  delta: PictureDelta;
  /** The analyst's working note on the day. Not shown to the reader. */
  notes: string;
}

export interface SynthesisInput {
  lab: Lab;
  before: Picture;
  after: Picture;
  delta: PictureDelta;
  cables: Cable[];
  date: string;
  aiLanguage?: AiLanguage;
}

export interface SynthesisOutput {
  /** False when the day moved nothing in this room; the cover is then empty. */
  changed: boolean;
  cover: string;
  mustRead: { itemId: string; reason: string }[];
  oneLiners: { itemId: string; line: string }[];
}

// The three briefing shapes a lab run produces. Declared here rather than
// imported from collect/types.ts, which holds the identical ones: collect drives
// analysis, so analysis importing collect would close a loop. Structurally the
// same on purpose — the integrator assigns one to the other.
export interface LabCover {
  labId: string;
  name: string;
  cover: string;
  /** Judgment ids added today. */
  judgments: string[];
}
export interface MustRead {
  itemId: string;
  reason: string;
  labId?: string;
}
export interface OneLiner {
  itemId: string;
  line: string;
  labId?: string;
}

export interface LabRunResult {
  /** The picture with the day folded in. Saved by the caller. */
  picture: Picture;
  /** Null when the room had nothing to report. */
  cover: LabCover | null;
  mustRead: MustRead[];
  oneLiners: OneLiner[];
  /**
   * Everything the run noticed but could not act on: ids the delta named that
   * the picture does not have, a cover claiming more than the body, a judgment
   * chain that has been climbing. Reported, never thrown.
   */
  warnings: string[];
}

export interface AnalysisDeps {
  callModel(system: string, user: string, opts: AiCallOptions): Promise<string>;
  now(): number;
  random?: () => number;
}

// The outcome of reading a model's reply. Same shape for both calls, because
// run.ts treats them the same way: one corrective retry, then give up and let
// the caller's watchdog decide.
export type ParseOutcome<T> = { ok: true; output: T } | { ok: false; error: string };
