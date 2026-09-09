// The 态势 of one lab (docs/63): what normal looks like there, what is being
// watched, what has been judged, and what is still open. It is the only thing on
// the info side that accumulates — a briefing is a day, a picture is the room's
// memory of every day it has read.
//
// The model never edits this file. An analyst run hands back a PictureDelta and
// the program applies it, so a bad reply costs a warning rather than a picture.

// The seven-step word ladder, weakest first. Rank is the index, which is what
// makes "the cover claims more than any judgment does" a comparison rather than
// a matter of taste.
export const LIKELIHOODS = [
  "almost-no-chance",
  "very-unlikely",
  "unlikely",
  "roughly-even",
  "likely",
  "very-likely",
  "almost-certain",
] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

// How much weight the evidence behind the judgment carries — separate from how
// likely the thing is, so "very likely on thin evidence" can be said.
export const CONFIDENCES = ["low", "moderate", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export interface Observable {
  // "o-" + 6 hex, unique within the picture.
  id: string;
  // What to watch for.
  text: string;
  // What normal looks like for it, so a hit can be read as a departure.
  baseline?: string;
  // Local date.
  addedOn: string;
  lastHitOn?: string;
  // The most recent cable ids that hit it, newest first, at most 5.
  lastHitCables?: string[];
  retiredOn?: string;
}

export interface Judgment {
  // "j-" + 6 hex.
  id: string;
  text: string;
  likelihood: Likelihood;
  confidence: Confidence;
  date: string;
  // Evidence cable ids.
  cables: string[];
  // The earlier judgment this one updates. A chain of these is how the room's
  // reading of one thing moves over time.
  supersedes?: string;
  rationale?: string;
}

export interface OpenQuestion {
  id: string;
  text: string;
  askedOn: string;
  answeredOn?: string;
}

export const PICTURE_VERSION = 1 as const;

export interface Picture {
  version: typeof PICTURE_VERSION;
  labId: string;
  // 常态模型 prose. "" until the analyst drafts it on the cold start.
  baseline: string;
  observables: Observable[];
  judgments: Judgment[];
  openQuestions: OpenQuestion[];
  updatedAt: number;
  lastRunDate?: string;
}

// What an analyst run hands back. Every id in it names something already in the
// picture; applyDelta warns and drops the ones that do not.
export interface PictureDelta {
  baseline?: string;
  observables: {
    add: { text: string; baseline?: string }[];
    hit: { id: string; cables: string[] }[];
    retire: string[];
  };
  judgments: {
    text: string;
    likelihood: Likelihood;
    confidence: Confidence;
    cables: string[];
    supersedes?: string;
    rationale?: string;
  }[];
  openQuestions: { add: string[]; answered: string[] };
}
