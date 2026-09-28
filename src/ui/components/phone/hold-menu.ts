// What a hold on the phone's shelves offers, and what each choice says (docs/50).
// A hold on a topic card, a book card, an article row, a kept article or a
// lesson's aside row opens a small menu next to it; every item in it deletes
// something, so every item goes through a confirmation. The menu, the
// confirmation and the line after it are all worked out here, from facts the
// screen has already read; the screens only draw them.

import { t } from "../../../i18n";
import type { FileRef, Topic } from "../../../platform/app/topics";

/** What the finger is on. */
export type HoldSubject =
  | { kind: "topic"; topic: Topic }
  | {
      kind: "file";
      topicId: string;
      topicName: string;
      file: FileRef;
      title: string;
      // A PDF is taught as a lesson; an EPUB is read with a conversation.
      format: "pdf" | "epub" | "other";
      // An EPUB the app made out of a web article, drawn as a row.
      article: boolean;
      bookId: string | null;
    }
  | { kind: "saved"; id: string; title: string }
  | { kind: "aside"; bookId: string; topicId: string; asideId: string; question: string };

/** The facts only a read can give, looked up when the hold lands. */
export interface HoldFacts {
  // Whether taking the file off this topic deletes it (delete-book.ts isLastReference).
  last?: boolean;
  // Whether the book has a book-level conversation: an EPUB's, or a PDF's lesson.
  hasConversation?: boolean;
  // The other topics the file is filed under, by name.
  otherTopics?: readonly string[];
}

export type HoldChoice =
  | "delete-topic"
  | "delete-file"
  | "remove-from-topic"
  | "delete-lesson"
  | "delete-conversation"
  | "remove-saved"
  | "delete-aside";

export interface HoldMenuItem {
  choice: HoldChoice;
  label: string;
}

/** The line at the top of the menu: which one was held. */
export function holdMenuHead(subject: HoldSubject): string {
  switch (subject.kind) {
    case "topic":
      return subject.topic.name;
    case "file":
    case "saved":
      return subject.title;
    case "aside":
      return subject.question;
  }
}

/** The menu for one held thing. Never empty. */
export function holdMenuItems(subject: HoldSubject, facts: HoldFacts = {}): HoldMenuItem[] {
  switch (subject.kind) {
    case "topic":
      return [{ choice: "delete-topic", label: t("phone.holdMenu.deleteTopic") }];
    case "saved":
      return [{ choice: "remove-saved", label: t("phone.holdMenu.removeFromSaved") }];
    case "aside":
      return [{ choice: "delete-aside", label: t("phone.holdMenu.deleteAside") }];
    case "file": {
      const items: HoldMenuItem[] = [];
      // An article has no conversation of its own on the shelf, and a file not
      // on the device has no book id to hold one under.
      if (facts.hasConversation && subject.bookId && !subject.article) {
        if (subject.format === "pdf") {
          items.push({ choice: "delete-lesson", label: t("phone.holdMenu.deleteLesson") });
        } else if (subject.format === "epub") {
          items.push({ choice: "delete-conversation", label: t("phone.holdMenu.deleteConversation") });
        }
      }
      // Unknown counts as last: the stronger claim is the one to confirm.
      if (facts.last === false) {
        items.push({ choice: "remove-from-topic", label: t("phone.holdMenu.removeFromTopic") });
      } else {
        items.push({
          choice: "delete-file",
          label: subject.article ? t("phone.holdMenu.deleteArticle") : t("phone.holdMenu.deleteBook"),
        });
      }
      return items;
    }
  }
}

export interface HoldConfirm {
  title: string;
  description: string;
  action: string;
}

/**
 * The confirmation for a choice. The topic's is TopicDeleteDialog's own
 * (shelf/topic-delete.ts), so it has none here.
 */
export function holdConfirm(
  choice: Exclude<HoldChoice, "delete-topic">,
  subject: HoldSubject,
  facts: HoldFacts = {},
): HoldConfirm {
  switch (choice) {
    case "delete-file": {
      const s = subject as Extract<HoldSubject, { kind: "file" }>;
      return {
        title: t("phone.holdMenu.confirmDeleteFileTitle", { title: s.title }),
        description: s.article
          ? t("phone.holdMenu.confirmDeleteArticleDescription")
          : t("phone.holdMenu.confirmDeleteBookDescription"),
        action: t("phone.holdMenu.delete"),
      };
    }
    case "remove-from-topic": {
      const s = subject as Extract<HoldSubject, { kind: "file" }>;
      const others = facts.otherTopics ?? [];
      const where =
        others.length > 0
          ? t("phone.holdMenu.removeOthers", { names: others.map((n) => `“${n}”`).join(", ") })
          : t("phone.holdMenu.removeNoOthers");
      return {
        title: t("phone.holdMenu.confirmRemoveTitle", { title: s.title }),
        description: s.article
          ? t("phone.holdMenu.removeArticleDescription", { where })
          : t("phone.holdMenu.removeBookDescription", { where }),
        action: t("phone.holdMenu.remove"),
      };
    }
    case "delete-lesson":
      return {
        title: t("phone.holdMenu.confirmConversationTitle"),
        description: t("phone.holdMenu.confirmLessonDescription"),
        action: t("phone.holdMenu.delete"),
      };
    case "delete-conversation":
      return {
        title: t("phone.holdMenu.confirmConversationTitle"),
        description: t("phone.holdMenu.confirmConversationDescription"),
        action: t("phone.holdMenu.delete"),
      };
    case "remove-saved": {
      const s = subject as Extract<HoldSubject, { kind: "saved" }>;
      return {
        title: t("phone.holdMenu.confirmRemoveTitle", { title: s.title }),
        description: t("phone.holdMenu.confirmRemoveSavedDescription"),
        action: t("phone.holdMenu.remove"),
      };
    }
    case "delete-aside":
      return {
        title: t("phone.holdMenu.confirmConversationTitle"),
        description: t("phone.holdMenu.confirmDeleteAsideDescription"),
        action: t("phone.holdMenu.delete"),
      };
  }
}

/** The line said after a choice went through. The topic's is TopicDeleteWords.done. */
export function holdDoneLine(
  choice: Exclude<HoldChoice, "delete-topic">,
  subject: HoldSubject,
): string {
  switch (choice) {
    case "delete-file":
      return t("phone.holdMenu.doneDeleted", {
        title: (subject as Extract<HoldSubject, { kind: "file" }>).title,
      });
    case "remove-from-topic":
      return t("phone.holdMenu.doneRemovedFromTopic", {
        topicName: (subject as Extract<HoldSubject, { kind: "file" }>).topicName,
      });
    case "delete-lesson":
      return t("phone.holdMenu.doneLessonDeleted");
    case "delete-conversation":
      return t("phone.holdMenu.doneConversationDeleted");
    case "remove-saved":
      return t("phone.holdMenu.doneRemovedFromSaved");
    case "delete-aside":
      return t("phone.holdMenu.doneAsideDeleted");
  }
}

/** Whether a choice takes the held thing off the screen, rather than changing it. */
export function choiceRemovesItem(choice: HoldChoice): boolean {
  return choice !== "delete-lesson" && choice !== "delete-conversation";
}

/** The names of the other topics a file is filed under, for "Remove from topic". */
export function otherTopicNames(
  topics: readonly Topic[],
  topicId: string,
  file: FileRef,
): string[] {
  const same = (f: FileRef) => (file.hash ? f.hash === file.hash : f.path === file.path);
  return topics.filter((t) => t.id !== topicId && t.files.some(same)).map((t) => t.name);
}

// ---- the click a hold ends in ------------------------------------------------
//
// A hold ends with the finger coming off, and the browser turns that into a
// click on whatever it rested on: the card the menu is about would open under
// it. Also a hold that started just beside a card (no menu, the watch was never
// armed) has iOS snap the click on release onto the card; a hold is not an
// open either way. And a tap that puts a menu away (on the scrim, or anywhere
// else while it is up) lands its click on whatever was under the scrim once the
// scrim is gone: iOS sends the click even though the down was prevented.

export interface ClickGuard {
  // When the last finger went down, anywhere on the surface; null before one has.
  downAt: number | null;
  // Whether a hold fired since.
  fired: boolean;
  // When that down put a menu away; null when it did not.
  dismissedAt: number | null;
}

export const NO_CLICK_GUARD: ClickGuard = { downAt: null, fired: false, dismissedAt: null };

// How long after a down that put a menu away its click may come. A click that
// late with no down between is not that tap's.
export const DISMISS_CLICK_MS = 1000;

export type ClickGuardEvent =
  | { type: "down"; at: number }
  // The down just stepped found a menu up: it closes the menu and does nothing else.
  | { type: "dismiss"; at: number }
  | { type: "fire" }
  // onHoldable: whether the click is on something a hold would open a menu for.
  | { type: "click"; at: number; onHoldable: boolean };

export interface ClickGuardStep {
  guard: ClickGuard;
  swallow: boolean;
}

/** One event against the guard. Pure. `holdMs` is how long a hold takes. */
export function stepClickGuard(
  guard: ClickGuard,
  event: ClickGuardEvent,
  holdMs: number,
): ClickGuardStep {
  switch (event.type) {
    case "down":
      return { guard: { downAt: event.at, fired: false, dismissedAt: null }, swallow: false };
    case "dismiss":
      return { guard: { ...guard, dismissedAt: event.at }, swallow: false };
    case "fire":
      return { guard: { ...guard, fired: true }, swallow: false };
    case "click": {
      const next = { ...guard, fired: false, dismissedAt: null };
      if (guard.fired) return { guard: next, swallow: true };
      // Whatever it landed on: the tap was for the menu.
      if (guard.dismissedAt !== null && event.at - guard.dismissedAt <= DISMISS_CLICK_MS) {
        return { guard: next, swallow: true };
      }
      const held = guard.downAt !== null && event.at - guard.downAt >= holdMs;
      return { guard: next, swallow: held && event.onHoldable };
    }
  }
}

// ---- in-place removal ----------------------------------------------------------
//
// A deleted item leaves where it stands: it is hidden by key the moment the
// delete is confirmed, and the reread that follows takes it out of the data for
// good. Nothing else in the list is rebuilt or moved under the finger.

/** Hide one key. */
export function hideKey(hidden: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (hidden.has(key)) return hidden;
  return new Set([...hidden, key]);
}

/** Show one again: its delete failed. */
export function restoreKey(hidden: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!hidden.has(key)) return hidden;
  const next = new Set(hidden);
  next.delete(key);
  return next;
}

/**
 * Forget the keys the data no longer has: the reread took them out, so a
 * later item under the same key (a book filed again) is not born hidden.
 */
export function settleHidden(
  hidden: ReadonlySet<string>,
  present: Iterable<string>,
): ReadonlySet<string> {
  if (hidden.size === 0) return hidden;
  const here = new Set(present);
  const next = new Set([...hidden].filter((k) => here.has(k)));
  return next.size === hidden.size ? hidden : next;
}

/** The items still to draw. */
export function visibleItems<T>(
  items: readonly T[],
  hidden: ReadonlySet<string>,
  keyOf: (item: T) => string,
): T[] {
  return hidden.size === 0 ? [...items] : items.filter((item) => !hidden.has(keyOf(item)));
}
