// The hold that opens a delete menu on the phone's shelves (hold-menu.ts). The
// same watch the lesson's "Ask about this" uses (long-press.ts), bound to every
// element under the host that carries the selector, plus the two things a menu
// on a card needs that a menu on prose does not: the click the finger's lift
// turns into is swallowed (hold-menu.ts stepClickGuard), and a right click or
// Android's own long-press (`contextmenu`) opens the same menu.
//
// The press and the held highlight are data attributes set on the element
// itself (`data-pressing`, `data-held`), styled by the call site: a press is
// not a render, and the list under the finger is never redrawn for one.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { longPressFeedback } from "../../../platform/app/haptics";
import { NO_CLICK_GUARD, stepClickGuard, type ClickGuard } from "./hold-menu";
import { bindLongPress, LONG_PRESS_MS } from "./long-press";

/** The element a hold landed on, by the key it carries, and where it is. */
export interface Held {
  key: string;
  rect: { left: number; top: number; width: number; height: number };
}

export interface HoldOptions {
  // What a holdable element is marked with. Its value is the key.
  attr?: string;
  // Off: nothing is bound (the aside's own screen has no rows to hold).
  enabled?: boolean;
}

export interface HoldControl {
  held: Held | null;
  // The menu goes; the highlight stays while a confirmation is up about it.
  closeMenu: () => void;
  // The highlight goes too: the confirmation was answered.
  release: () => void;
  // The held element, for the fade out of one that is being deleted.
  heldElement: () => HTMLElement | null;
}

export function useHold(host: RefObject<HTMLElement | null>, opts: HoldOptions = {}): HoldControl {
  const attr = opts.attr ?? "data-hold";
  const enabled = opts.enabled ?? true;
  const [held, setHeld] = useState<Held | null>(null);
  const heldEl = useRef<HTMLElement | null>(null);

  const release = useCallback(() => {
    heldEl.current?.removeAttribute("data-held");
    heldEl.current = null;
    setHeld(null);
  }, []);
  const closeMenu = useCallback(() => setHeld(null), []);

  useEffect(() => {
    const el = host.current;
    if (!el || !enabled) return;
    const selector = `[${attr}]`;
    const holdable = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>(selector) : null;

    let guard: ClickGuard = NO_CLICK_GUARD;
    let pressing: HTMLElement | null = null;

    const open = (target: HTMLElement) => {
      heldEl.current?.removeAttribute("data-held");
      heldEl.current = target;
      target.setAttribute("data-held", "");
      const r = target.getBoundingClientRect();
      setHeld({
        key: target.getAttribute(attr) ?? "",
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    };

    const unbind = bindLongPress(el, {
      accepts: (target) => holdable(target) !== null,
      feedback: () => void longPressFeedback(),
      onArm: (target) => {
        pressing = holdable(target);
        pressing?.setAttribute("data-pressing", "");
      },
      onDisarm: () => {
        pressing?.removeAttribute("data-pressing");
        pressing = null;
      },
      onLongPress: (press) => {
        const target = holdable(press.target);
        if (!target) return;
        guard = stepClickGuard(guard, { type: "fire" }, LONG_PRESS_MS).guard;
        open(target);
      },
    });

    const onDown = () => {
      guard = stepClickGuard(guard, { type: "down", at: performance.now() }, LONG_PRESS_MS).guard;
    };
    const onClick = (e: MouseEvent) => {
      const step = stepClickGuard(
        guard,
        { type: "click", at: performance.now(), onHoldable: holdable(e.target) !== null },
        LONG_PRESS_MS,
      );
      guard = step.guard;
      if (!step.swallow) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: MouseEvent) => {
      const target = holdable(e.target);
      if (!target) return;
      e.preventDefault();
      // Android raises this and the watch fires as well: one menu.
      if (heldEl.current === target) return;
      open(target);
    };

    el.addEventListener("pointerdown", onDown, { capture: true });
    el.addEventListener("click", onClick, { capture: true });
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      unbind();
      pressing?.removeAttribute("data-pressing");
      el.removeEventListener("pointerdown", onDown, { capture: true });
      el.removeEventListener("click", onClick, { capture: true });
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [host, attr, enabled]);

  const heldElement = useCallback(() => heldEl.current, []);
  return { held, closeMenu, release, heldElement };
}

// How long a deleted item takes to fade before it is taken out of the list.
export const LEAVE_MS = 180;

/**
 * Fade an element out where it stands, then call `done`. The fade is the
 * element's own attribute (`data-leaving`), styled by the call site; `done` is
 * what hides it by key (hold-menu.ts hideKey). Answers the cancel.
 */
export function fadeOut(el: HTMLElement | null, done: () => void): () => void {
  if (!el) {
    done();
    return () => {};
  }
  el.removeAttribute("data-held");
  el.setAttribute("data-leaving", "");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const timer = setTimeout(done, reduced ? 0 : LEAVE_MS);
  // A delete that failed before the fade ended: it is not hidden after all.
  return () => clearTimeout(timer);
}

/** Undo a fade: the delete failed and the item stays. */
export function unfade(el: HTMLElement | null): void {
  el?.removeAttribute("data-leaving");
}
