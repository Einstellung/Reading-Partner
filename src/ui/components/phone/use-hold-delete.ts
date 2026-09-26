// A screen's hold-to-delete, start to end: the hold (use-hold.ts), the menu's
// items (hold-menu.ts, from facts read when the hold lands), the confirmation,
// the delete (hold-delete.ts), the item leaving where it stands, and the line
// said after. The screens draw HoldMenu and a confirmation from what this
// returns, and mark their items with the key it looks them up by.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { LibraryEntry } from "../../../platform/app/library";
import type { Topic } from "../../../platform/app/topics";
import {
  choiceRemovesItem,
  hideKey,
  holdConfirm,
  holdMenuHead,
  holdMenuItems,
  restoreKey,
  settleHidden,
  type HoldChoice,
  type HoldConfirm,
  type HoldFacts,
  type HoldMenuItem,
  type HoldSubject,
} from "./hold-menu";
import {
  holdFailedLine,
  liveHoldDeleteDeps,
  lookupHoldFacts,
  runHoldChoice,
  runTopicDelete,
  type HoldDeleteDeps,
} from "./hold-delete";
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
  topics?: readonly Topic[];
  entries?: Record<string, LibraryEntry>;
  onNotice: (kind: NoticeKind, line: string) => void;
  // Reread after a delete, whether it went or not.
  onChanged: () => void | Promise<void>;
  deps?: HoldDeleteDeps;
}

export interface HoldConfirmAsk {
  choice: Exclude<HoldChoice, "delete-topic">;
  words: HoldConfirm;
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
  confirm: () => void;
  confirmTopic: (alsoDeleteFiles: string[]) => void;
  // The confirmation was put away, answered or not.
  endAsk: () => void;
  hidden: ReadonlySet<string>;
}

export function useHoldDelete(opts: HoldDeleteOptions): HoldDeleteControl {
  const deps = opts.deps ?? liveHoldDeleteDeps;
  const hold = useHold(opts.host, {
    ...(opts.attr ? { attr: opts.attr } : {}),
    ...(opts.enabled === undefined ? {} : { enabled: opts.enabled }),
  });
  const { held, closeMenu, release, heldElement } = hold;
  const [facts, setFacts] = useState<{ key: string; facts: HoldFacts } | null>(null);
  const [ask, setAsk] = useState<(HoldConfirmAsk & { subject: HoldSubject; key: string }) | null>(null);
  const [topicAsk, setTopicAsk] = useState<{ topic: Topic; key: string } | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const { subjectOf, topics, entries, onNotice, onChanged } = opts;
  const subject = held ? subjectOf(held.key) : null;

  // The facts are read when the hold lands: the menu opens once they are in.
  useEffect(() => {
    if (!held) return;
    const s = subjectOf(held.key);
    if (!s) return release();
    let live = true;
    void lookupHoldFacts(s, topics ?? [], deps).then((f) => {
      if (live) setFacts({ key: held.key, facts: f });
    });
    return () => {
      live = false;
    };
    // subjectOf changes identity on every render of the screen; the key is
    // what the read is about.
  }, [held]);

  const present = opts.presentKeys.join("\n");
  useEffect(() => {
    setHidden((h) => settleHidden(h, present === "" ? [] : present.split("\n")));
  }, [present]);

  const items = useMemo(() => {
    if (!held || !subject) return null;
    if (subject.kind === "file" && facts?.key !== held.key) return null;
    return holdMenuItems(subject, facts?.key === held.key ? facts.facts : {});
  }, [held, subject, facts]);

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
      const f = facts?.key === held.key ? facts.facts : {};
      setAsk({ choice, words: holdConfirm(choice, subject, f), subject, key: held.key });
    },
    [held, subject, facts, closeMenu],
  );

  // Fade the held element and hide it by key; answers the undo.
  const leave = useCallback((key: string) => {
    const el = heldElement();
    const cancel = fadeOut(el, () => setHidden((h) => hideKey(h, key)));
    return () => {
      cancel();
      unfade(el);
      setHidden((h) => restoreKey(h, key));
    };
  }, [heldElement]);

  const confirm = useCallback(() => {
    if (!ask) return;
    const { choice, subject: s, key } = ask;
    const undo = choiceRemovesItem(choice) ? leave(key) : () => {};
    void runHoldChoice(choice, s, deps)
      .then((line) => onNotice("info", line))
      .catch((e: unknown) => {
        console.error("the hold delete failed", choice, e);
        undo();
        onNotice("error", holdFailedLine(choice));
      })
      .finally(() => void onChanged());
  }, [ask, deps, leave, onNotice, onChanged]);

  const confirmTopic = useCallback(
    (alsoDeleteFiles: string[]) => {
      if (!topicAsk) return;
      const { topic, key } = topicAsk;
      const undo = leave(key);
      void runTopicDelete(topic, topics ?? [], alsoDeleteFiles, entries ?? {}, deps)
        .then((line) => onNotice("info", line))
        .catch((e: unknown) => {
          console.error("the topic delete failed", e);
          undo();
          onNotice("error", holdFailedLine("delete-topic"));
        })
        .finally(() => void onChanged());
    },
    [topicAsk, topics, entries, deps, leave, onNotice, onChanged],
  );

  const endAsk = useCallback(() => {
    setAsk(null);
    setTopicAsk(null);
    release();
  }, [release]);

  const onDismiss = useCallback(() => {
    if (!ask && !topicAsk) release();
  }, [ask, topicAsk, release]);

  return {
    menu: {
      held: ask || topicAsk ? null : held,
      head: subject ? holdMenuHead(subject) : "",
      items,
      onPick,
      onDismiss,
    },
    ask: ask ? { choice: ask.choice, words: ask.words } : null,
    topicAsk: topicAsk?.topic ?? null,
    confirm,
    confirmTopic,
    endAsk,
    hidden,
  };
}
