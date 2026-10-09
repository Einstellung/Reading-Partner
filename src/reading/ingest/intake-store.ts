// The record of a link taken in with no book (topic-intake.ts): the card the
// reader sees in the door conversation reads it, the ingest-url run writes it,
// and the reader's topic pick lands on it.
//
// Two things happen at once and either may finish first: the run fetches and
// files the documents into the library attached nowhere, and the reader picks a
// topic on the card. Whichever comes second attaches the documents to the topic.
// Every change is a read-modify-write of the one record behind a serial queue,
// so the two never both see "the other has not happened yet" and never both
// attach.
//
// One file per intake, machine-local: the run is a `local` run on the device the
// link was pasted on, and the card is that device's conversation. The documents
// themselves are in the library and the topic row is in topics.json, and both of
// those travel; this record is only the card's state.

import { appData } from "../../platform/app/appdata";
import { addFileToTopic } from "../../platform/app/topics";
import { createSerialQueue } from "../../platform/app/serial-queue";
import { isObject } from "../../platform/std/json";
import { hostOf } from "../../platform/std/url";

/** Where intake records are kept. Registered in palace as `link-intake`. */
export const INTAKES_DIR = "link-intakes";

export function intakePath(id: string): string {
  return `${INTAKES_DIR}/${id}.json`;
}

/**
 * Where the run has got to. `reading` until it ends; `filed` when at least one
 * document is in the library; `failed` when nothing could be filed, with why.
 */
export type IntakeState = "reading" | "filed" | "failed";

/** One document the run filed, as the card's receipt lists it. */
export interface IntakeDocument {
  /** The library hash, which is the book id the reader opens. */
  hash: string;
  title: string;
  /** A built article, or a document fetched whole. */
  format: "article" | "pdf" | "epub";
  /** Sections of a built article; absent for a document fetched whole. */
  sections?: number;
  /** Pages of its text as the reader will see them; 0 when the text was not cut. */
  pages: number;
  /** Body characters. */
  chars: number;
  /** The reference a topic lists it under. */
  path: string;
  sourceUrl?: string;
}

/** Something the run looked at and left out. */
export interface IntakeSkipped {
  url: string;
  reason: string;
}

export interface TopicIntake {
  id: string;
  /** The link as it was pasted. */
  url: string;
  /** Why the reader shared it, in their companion's words. */
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** The ingest-url run doing the work, once it has been handed over. */
  runId?: string;
  state: IntakeState;
  /** The host being read right now; null once the run has ended. */
  host: string | null;
  documents: IntakeDocument[];
  skipped: IntakeSkipped[];
  /** The link agent's closing note, when it left one (the AI's words). */
  aiNote?: string;
  /** Why nothing was filed. Only on `failed`. */
  reason?: string;
  /** The topic the reader picked; null until they pick one. */
  topicId: string | null;
  /** The topic the documents were attached to. Once set, the intake is settled. */
  attachedTo: string | null;
}

/** What the run hands over when it has finished filing. */
export interface IntakeFiling {
  documents: IntakeDocument[];
  skipped: IntakeSkipped[];
  aiNote?: string;
  /** Why nothing was filed, said when `documents` is empty. */
  emptyReason?: string;
}

export interface IntakeIo {
  /** The record's text, or null when there is none. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  /** List a library document in a topic. Idempotent by hash. */
  attachToTopic(topicId: string, path: string, hash: string): Promise<void>;
  newId(): string;
  now(): number;
}

export interface IntakeStore {
  create(link: { url: string; note?: string }): Promise<TopicIntake>;
  get(id: string): Promise<TopicIntake | null>;
  setRun(id: string, runId: string): Promise<TopicIntake>;
  /** The host the run is reading now. */
  progress(id: string, host: string): Promise<TopicIntake>;
  /** The run filed what it filed; attaches it when a topic is already picked. */
  filed(id: string, filing: IntakeFiling): Promise<TopicIntake>;
  /** The run ended with nothing filed. A no-op once the intake is past `reading`. */
  failed(id: string, reason: string): Promise<TopicIntake>;
  /**
   * The reader picked a topic. Attaches the documents when they are already
   * filed; before that, replaces any earlier pick. Once attached, the intake is
   * settled and a further pick changes nothing.
   */
  choose(id: string, topicId: string): Promise<TopicIntake>;
  /** Hear about every write, by intake id. Returns the undo. */
  subscribe(fn: (id: string) => void): () => void;
}

const FORMATS = new Set(["article", "pdf", "epub"]);
const STATES = new Set(["reading", "filed", "failed"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseDocument(raw: unknown): IntakeDocument | null {
  if (!isObject(raw)) return null;
  const hash = str(raw.hash);
  const path = str(raw.path);
  const format = str(raw.format);
  if (!hash || !path || !format || !FORMATS.has(format)) return null;
  const sourceUrl = str(raw.sourceUrl);
  return {
    hash,
    title: str(raw.title) ?? "",
    format: format as IntakeDocument["format"],
    ...(typeof raw.sections === "number" ? { sections: raw.sections } : {}),
    pages: num(raw.pages),
    chars: num(raw.chars),
    path,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

/** Read a record back. Anything that is not one is null. */
export function parseIntake(text: string): TopicIntake | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const url = str(raw.url);
  const state = str(raw.state);
  if (!id || !url || !state || !STATES.has(state)) return null;
  const documents = Array.isArray(raw.documents)
    ? raw.documents.map(parseDocument).filter((d): d is IntakeDocument => d !== null)
    : [];
  const skipped = Array.isArray(raw.skipped)
    ? raw.skipped
        .filter(isObject)
        .map((s) => ({ url: str(s.url) ?? "", reason: str(s.reason) ?? "" }))
        .filter((s) => s.url || s.reason)
    : [];
  const note = str(raw.note);
  const runId = str(raw.runId);
  const aiNote = str(raw.aiNote);
  const reason = str(raw.reason);
  return {
    id,
    url,
    ...(note ? { note } : {}),
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
    ...(runId ? { runId } : {}),
    state: state as IntakeState,
    host: str(raw.host) ?? null,
    documents,
    skipped,
    ...(aiNote ? { aiNote } : {}),
    ...(reason ? { reason } : {}),
    topicId: str(raw.topicId) ?? null,
    attachedTo: str(raw.attachedTo) ?? null,
  };
}

export function createIntakeStore(io: IntakeIo): IntakeStore {
  const queue = createSerialQueue();
  const listeners = new Set<(id: string) => void>();

  function announce(id: string): void {
    for (const fn of [...listeners]) {
      try {
        fn(id);
      } catch (e) {
        console.warn("an intake listener failed", e);
      }
    }
  }

  async function load(id: string): Promise<TopicIntake | null> {
    const text = await io.read(intakePath(id));
    return text === null ? null : parseIntake(text);
  }

  async function save(intake: TopicIntake): Promise<TopicIntake> {
    const next = { ...intake, updatedAt: io.now() };
    await io.write(intakePath(next.id), JSON.stringify(next, null, 2));
    announce(next.id);
    return next;
  }

  async function attach(intake: TopicIntake, topicId: string): Promise<TopicIntake> {
    for (const doc of intake.documents) await io.attachToTopic(topicId, doc.path, doc.hash);
    return save({ ...intake, attachedTo: topicId });
  }

  // One change of one record, after every change already queued.
  function change(id: string, edit: (intake: TopicIntake) => Promise<TopicIntake>): Promise<TopicIntake> {
    return queue.run(async () => {
      const intake = await load(id);
      if (!intake) throw new Error(`no link intake ${id}`);
      return edit(intake);
    });
  }

  return {
    create: (link) =>
      queue.run(() => {
        const now = io.now();
        return save({
          id: io.newId(),
          url: link.url,
          ...(link.note ? { note: link.note } : {}),
          createdAt: now,
          updatedAt: now,
          state: "reading",
          host: hostOf(link.url),
          documents: [],
          skipped: [],
          topicId: null,
          attachedTo: null,
        });
      }),

    get: (id) => queue.run(() => load(id)),

    setRun: (id, runId) => change(id, (intake) => save({ ...intake, runId })),

    progress: (id, host) =>
      change(id, async (intake) => (intake.state === "reading" ? save({ ...intake, host }) : intake)),

    filed: (id, filing) =>
      change(id, async (intake) => {
        const any = filing.documents.length > 0;
        const rest = { ...intake };
        delete rest.reason;
        delete rest.aiNote;
        const ended = await save({
          ...rest,
          state: any ? "filed" : "failed",
          host: null,
          documents: filing.documents,
          skipped: filing.skipped,
          ...(filing.aiNote ? { aiNote: filing.aiNote } : {}),
          ...(any ? {} : { reason: filing.emptyReason ?? "Nothing became a document." }),
        });
        // The pick came first: the run attaches what it filed.
        return any && ended.topicId && !ended.attachedTo ? attach(ended, ended.topicId) : ended;
      }),

    failed: (id, reason) =>
      change(id, async (intake) =>
        intake.state === "reading" ? save({ ...intake, state: "failed", host: null, reason }) : intake,
      ),

    choose: (id, topicId) =>
      change(id, async (intake) => {
        if (intake.attachedTo) return intake;
        const picked = await save({ ...intake, topicId });
        // The run came first: the pick attaches what it filed.
        return picked.state === "filed" ? attach(picked, topicId) : picked;
      }),

    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The store over AppData and the real topic shelf. */
export const intakeStore: IntakeStore = createIntakeStore({
  read: async (path) => ((await appData.exists(path)) ? appData.readText(path) : null),
  write: async (path, text) => {
    await appData.mkdirp(INTAKES_DIR);
    await appData.writeAtomic(path, text);
  },
  attachToTopic: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
});
