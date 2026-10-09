// A screen's hold menu, start to end: the hold (use-hold.ts), the menu's items
// (hold-menu.ts), the confirmation or the topic sheet, the delete or the move
// (hold-delete.ts), the item leaving where it stands, and the line said after.
// The screens draw HoldMenu, a confirmation and the topic sheet from what this
// returns, and mark their items with the key it looks them up by.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { LibraryEntry } from "../../../platform/app/library";
import type { Topic } from "../../../platform/app/topics";
import { moveTargets, type MoveTarget } from "../shelf/move-to";
import {
  hideKey,
  holdConfirm,
  holdMenuHead,
  holdMenuItems,
  restoreKey,
  settleHidden,
  type ConfirmedChoice,
  type HoldChoice,
  type HoldConfirm,
  type HoldMenuItem,
  type HoldSubject,
} from "./hold-menu";
import {
  holdFailedLine,
  liveHoldDeleteDeps,
  runHoldChoice,
  runHoldMove,
  runTopicDelete,
  type HoldDeleteDeps,
} from "./hold-delete";
import { slideWhenGone } from "./slide-into-place";
import { fadeOut, unfade, useHold, type Held } from "./use-hold";

export type NoticeKind = "info" | "error";

export interface HoldDeleteOptions {
  host: RefObject<HTMLElement | null>;
  attr?: string;
  enabled?: boolean;
  // The subject a key stands for, or null when it no longer stands for one.
  subjectOf: (key: string) => HoldSubject | null;
  // Every key still in the data, so a hidden one the reread took is forgotten.
  presentKeys: readonly string[];
  // Every topic: what a file's Move to… offers, and whether it is offered.
  topics?: readonly Topic[];
  entries?: Record<string, LibraryEntry>;
  onNotice: (kind: NoticeKind, line: string) => void;
  // Reread after a delete or a move, whether it went or not.
  onChanged: () => void | Promise<void>;
  deps?: HoldDeleteDeps;
}

export interface HoldConfirmAsk {
  choice: ConfirmedChoice;
  words: HoldConfirm;
}

export interface HoldMoveAsk {
  fileName: string;
  targets: MoveTarget[];
}

export interface HoldDeleteControl {
  menu: {
    held: Held | null;
    head: string;
    items: HoldMenuItem[] | null;
    onPick: (choice: HoldChoice) => void;
    onDismiss: () => void;
  };
  // The confirmation up, or null.
  ask: HoldConfirmAsk | null;
  // The topic whose own confirmation (TopicDeleteDialog) is up, or null.
  topicAsk: Topic | null;
  // The topic sheet for a file's Move to…, or null.
  moveAsk: HoldMoveAsk | null;
  confirm: () => void;
  confirmTopic: (alsoDeleteFiles: string[]) => void;
  confirmMove: (to: MoveTarget) => void;
  // The confirmation or the sheet was put away, answered or not.
  endAsk: () => void;
  hidden: ReadonlySet<string>;
}

type FileSubject = Extract<HoldSubject, { kind: "file" }>;

export function useHoldDelete(opts: HoldDeleteOptions): HoldDeleteControl {
  const deps = opts.deps ?? liveHoldDeleteDeps;
  const hold = useHold(opts.host, {
    ...(opts.attr ? { attr: opts.attr } : {}),
    ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
  });
  const { held, closeMenu, release, heldElement } = hold;
  const [ask, setAsk] = useState<(HoldConfirmAsk & { subject: HoldSubject; key: string }) | null>(null);
  const [topicAsk, setTopicAsk] = useState<{ topic: Topic; key: string } | null>(null);
  const [moveAsk, setMoveAsk] = useState<{ subject: FileSubject; key: string } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const { subjectOf, topics, entries, onNotice, onChanged } = opts;
  const subject = held ? subjectOf(held.key) : null;

  // A hold on something the data no longer has opens nothing.
  useEffect(() => {
    if (held && !subjectOf(held.key)) release();
    // subjectOf changes identity on every render of the screen; the key is
    // what the check is about.
  }, [held]);

  const present = opts.presentKeys.join("\n");
  useEffect(() => {
    setHidden((h) => settleHidden(h, present === "" ? [] : present.split("\n")));
  }, [present]);

  const items = useMemo(
    () => (held && subject ? holdMenuItems(subject, topics ?? []) : null),
    [held, subject, topics],
  );

  const onPick = useCallback(
    (choice: HoldChoice) => {
      if (!held || !subject) return;
      // The menu goes first, so the confirmation is the only layer up and
      // nothing covers its Cancel (docs/pitfall/211).
      closeMenu();
      if (choice === "delete-topic") {
        if (subject.kind === "topic") setTopicAsk({ topic: subject.topic, key: held.key });
        return;
      }
      if (choice === "move-file") {
        if (subject.kind === "file") setMoveAsk({ subject, key: held.key });
        return;
      }
      setAsk({ choice, words: holdConfirm(choice, subject), subject, key: held.key });
    },
    [held, subject, closeMenu],
  );

  // Fade the held element and hide it by key, and slide what follows it into
  // the space once it is gone. The slide is measured before anything moves: a
  // reread that lands mid-fade (the lesson's) takes the item out early.
  // Answers the undo, and when the fade is over.
  const leave = useCallback((key: string) => {
    const el = heldElement();
    const stopSlide = slideWhenGone(el);
    let settle = () => {};
    const faded = new Promise<void>((resolve) => (settle = resolve));
    const cancel = fadeOut(el, () => {
      setHidden((h) => hideKey(h, key));
      settle();
    });
    const undo = () => {
      cancel();
      stopSlide();
      unfade(el);
      setHidden((h) => restoreKey(h, key));
      settle();
    };
    return { undo, faded };
  }, [heldElement]);

  // The item leaves, the work runs, and the line is said; a failure puts the
  // item back. The reread waits for the fade, so the item fades before it is
  // taken out.
  const settleLeaving = useCallback(
    (key: string, work: Promise<string>, choice: HoldChoice, what: string) => {
      const { undo, faded } = leave(key);
      void work
        .then((line) => onNotice("info", line))
        .catch((e: unknown) => {
          console.error(what, choice, e);
          undo();
          onNotice("error", holdFailedLine(choice));
        })
        .finally(() => void faded.then(() => onChanged()));
    },
    [leave, onNotice, onChanged],
  );

  const confirm = useCallback(() => {
    if (!ask) return;
    const { choice, subject: s, key } = ask;
    settleLeaving(key, runHoldChoice(choice, s, deps), choice, "the hold delete failed");
  }, [ask, deps, settleLeaving]);

  const confirmTopic = useCallback(
    (alsoDeleteFiles: string[]) => {
      if (!topicAsk) return;
      const { topic, key } = topicAsk;
      settleLeaving(
        key,
        runTopicDelete(topic, topics ?? [], alsoDeleteFiles, entries ?? {}, deps),
        "delete-topic",
        "the topic delete failed",
      );
    },
    [topicAsk, topics, entries, deps, settleLeaving],
  );

  const confirmMove = useCallback(
    (to: MoveTarget) => {
      if (!moveAsk || to.here) return;
      const { subject: s, key } = moveAsk;
      settleLeaving(key, runHoldMove(s, to, deps), "move-file", "the hold move failed");
    },
    [moveAsk, deps, settleLeaving],
  );

  const endAsk = useCallback(() => {
    setAsk(null);
    setTopicAsk(null);
    setMoveAsk(null);
    release();
  }, [release]);

  const onDismiss = useCallback(() => {
    if (!ask && !topicAsk && !moveAsk) release();
  }, [ask, topicAsk, moveAsk, release]);

  const moveSheet = useMemo(
    () =>
      moveAsk
        ? { fileName: moveAsk.subject.title, targets: moveTargets(topics ?? [], moveAsk.subject.topicId) }
        : null,
    [moveAsk, topics],
  );

  return {
    menu: {
      held: ask || topicAsk || moveAsk ? null : held,
      head: subject ? holdMenuHead(subject) : "",
      items,
      onPick,
      onDismiss,
    },
    ask: ask ? { choice: ask.choice, words: ask.words } : null,
    topicAsk: topicAsk?.topic ?? null,
    moveAsk: moveSheet,
    confirm,
    confirmTopic,
    confirmMove,
    endAsk,
    hidden,
  };
}
