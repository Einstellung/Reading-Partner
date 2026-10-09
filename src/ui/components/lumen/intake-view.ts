// What the intake card in the door conversation shows (IntakeCard.tsx), read off
// the intake record (reading/ingest/topic-intake.ts). Here and not in the card
// because all of it is decisions and strings.

import { t } from "../../../i18n";
import type { Topic } from "../../../platform/app/topics";
import { topicChoicesOf } from "../../../reading/ingest/topic-choice";
import type { IntakeDocument, IntakeSkipped, TopicIntake } from "../../../reading/ingest/topic-intake";

/** The card's ops (use-door-chat.ts onCardAction). `arg` is the topic id, or the new topic's name. */
export const INTAKE_CHOOSE_OP = "intake-choose";
export const INTAKE_NEW_TOPIC_OP = "intake-new-topic";
/** The navigate target "打开阅读" raises; `arg` is the document's hash. */
export const INTAKE_OPEN_TARGET = "intake-document";

/** A document the receipt opens, in the terms a shell opens a topic file in. */
export interface IntakeOpenDocument {
  hash: string;
  title: string;
  topicId: string;
  path: string;
}

export type IntakeView =
  /** The record has not been read yet. */
  | { phase: "loading" }
  /** There is no record on this device: the link was taken in on another one. */
  | { phase: "elsewhere" }
  /** No topic attached yet: the list is live. `filed` once the run has filed. */
  | { phase: "choose"; picked: string | null; filed: boolean; host: string | null; documents: IntakeDocument[] }
  | { phase: "receipt"; topicId: string; documents: IntakeDocument[]; skipped: IntakeSkipped[] }
  | { phase: "failed"; reason: string };

/**
 * The card's state. A receipt once both a topic is picked and the run filed
 * (the store attaches in the same write as the second of the two, so a filed
 * record with a pick is read as settled); a failure only says why; everything
 * else is the list.
 */
export function intakeView(intake: TopicIntake | null, loaded: boolean): IntakeView {
  if (!intake) return loaded ? { phase: "elsewhere" } : { phase: "loading" };
  if (intake.state === "failed") return { phase: "failed", reason: intake.reason ?? "" };
  const topicId = intake.attachedTo ?? (intake.state === "filed" ? intake.topicId : null);
  if (topicId) return { phase: "receipt", topicId, documents: intake.documents, skipped: intake.skipped };
  return {
    phase: "choose",
    picked: intake.topicId,
    filed: intake.state === "filed",
    host: intake.host,
    documents: intake.documents,
  };
}

export interface IntakeTopicRow {
  id: string;
  name: string;
  suggested: boolean;
  picked: boolean;
}

/**
 * The list: the shelf's topics in order, Lumen's suggestion marked (the one it
 * named when it raised the card, while that topic still exists, else the
 * program's), and the reader's pick.
 */
export function intakeTopicRows(
  topics: readonly Topic[],
  intake: Pick<TopicIntake, "url" | "note">,
  picked: string | null,
  suggestedTopicId?: string,
): IntakeTopicRow[] {
  const choices = topicChoicesOf(topics, { url: intake.url, ...(intake.note ? { note: intake.note } : {}) });
  const named = suggestedTopicId && choices.topics.some((row) => row.id === suggestedTopicId) ? suggestedTopicId : null;
  const suggested = named ?? choices.suggested;
  return choices.topics.map((row) => ({
    id: row.id,
    name: row.name,
    suggested: row.id === suggested,
    picked: row.id === picked,
  }));
}

// The address without its scheme, a leading www or a trailing slash, cut short.
function shortSource(url: string): string {
  let shown = url;
  try {
    const u = new URL(url);
    shown = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    shown = url.replace(/^https?:\/\//, "");
  }
  return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
}

/** The line under a document's title: its size, and where it came from. */
export function documentMeta(doc: IntakeDocument): string {
  const parts: string[] = [];
  if (doc.sections !== undefined && doc.sections > 1) parts.push(t("shell.intake.sections", { count: doc.sections }));
  else if (doc.pages > 0) parts.push(t("shell.intake.pages", { count: doc.pages }));
  if (doc.sourceUrl) parts.push(shortSource(doc.sourceUrl));
  return parts.join(" · ");
}

// The backend's reasons are the program's English sentences (info/links
// receipt.ts, info/x/read-post.ts, intake-store.ts). The ones whose kind is
// known are said in the reader's language; anything else is shown as written.
type ReasonKey =
  | "shell.intake.reason.noContent"
  | "shell.intake.reason.notChosen"
  | "shell.intake.reason.onlyOnPage"
  | "shell.intake.reason.shortLink"
  | "shell.intake.reason.unreadable"
  | "shell.intake.reason.nothingFiled";
const REASONS: readonly [RegExp, ReasonKey][] = [
  [/has no content of its own/i, "shell.intake.reason.noContent"],
  [/the AI did not choose it/i, "shell.intake.reason.notChosen"],
  [/only on the post's page/i, "shell.intake.reason.onlyOnPage"],
  [/t\.co link did not resolve/i, "shell.intake.reason.shortLink"],
  [/could not be read/i, "shell.intake.reason.unreadable"],
  [/Nothing became a document/i, "shell.intake.reason.nothingFiled"],
];

/** A backend reason in the reader's language where its kind is known, else as written. */
export function reasonText(reason: string): string {
  const known = REASONS.find(([pattern]) => pattern.test(reason));
  return known ? t(known[1]) : reason;
}

/** One 「没收：…」 line. */
export function skippedLine(skipped: IntakeSkipped): string {
  const reason = skipped.reason ? reasonText(skipped.reason) : t("shell.intake.reason.unknown");
  return skipped.url
    ? t("shell.intake.skippedAt", { reason, address: shortSource(skipped.url) })
    : t("shell.intake.skipped", { reason });
}

/** The card's question, over the list. */
export function chooseHeadline(view: Extract<IntakeView, { phase: "choose" }>, pickedName: string | null): string {
  return pickedName && !view.filed ? t("shell.intake.pickedWaiting", { topic: pickedName }) : t("shell.intake.question");
}

/** The quiet line under the list: the host being read, or that it is ready. */
export function progressLine(view: Extract<IntakeView, { phase: "choose" }>): string {
  if (view.filed) {
    const only = view.documents.length === 1 ? view.documents[0].title.trim() : "";
    return only ? t("shell.intake.readyOne", { title: only }) : t("shell.intake.ready");
  }
  return view.host ? t("shell.intake.reading", { host: view.host }) : t("shell.intake.readingAny");
}

/** What "打开阅读" opens: the receipt's first document, in its topic. */
export function documentToOpen(intake: TopicIntake | null, hash: string): IntakeOpenDocument | null {
  const topicId = intake?.attachedTo;
  const doc = intake?.documents.find((one) => one.hash === hash);
  if (!topicId || !doc) return null;
  return { hash: doc.hash, title: doc.title, topicId, path: doc.path };
}
