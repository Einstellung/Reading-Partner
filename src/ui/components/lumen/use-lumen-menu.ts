// The binding half of lumen-menu.ts: the menu's state, held where the pointer
// handlers can step it synchronously (a late fire and the release that follows
// it arrive in one event), one render per change, and the two ways out of a
// menu that are not the body: a press anywhere else, and Escape.

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MENU_REST,
  lumenMenuStep,
  menuItemAt,
  type LumenMenuEffect,
  type LumenMenuInput,
  type LumenMenuItem,
  type LumenMenuState,
  type MenuRow,
} from "./lumen-menu";

export interface LumenMenuBinding {
  state: LumenMenuState;
  /** Step the menu; the effect, if any, has already been handed on. */
  feed(input: LumenMenuInput): void;
  /** Whether the press on the body has fired, so its moves are slides. */
  sliding(): boolean;
  /** The row under a screen point, read off the rows as drawn now. */
  itemAt(x: number, y: number): LumenMenuItem | null;
  /** Goes on each row, so a sliding finger can be hit-tested against it. */
  rowRef(item: LumenMenuItem): (el: HTMLElement | null) => void;
  /** Goes on the menu's own box: a press inside it is not a press outside. */
  menuRef(el: HTMLElement | null): void;
  /** Goes on the body: a press on it is the machine's, not a dismissal. */
  bodyRef(el: HTMLElement | null): void;
}

export function useLumenMenu(onEffect: (effect: Exclude<LumenMenuEffect, null>) => void): LumenMenuBinding {
  const stateRef = useRef<LumenMenuState>(MENU_REST);
  const [state, setState] = useState<LumenMenuState>(MENU_REST);
  const effectRef = useRef(onEffect);
  effectRef.current = onEffect;
  const rows = useRef(new Map<LumenMenuItem, HTMLElement>());
  const rowRefs = useRef(new Map<LumenMenuItem, (el: HTMLElement | null) => void>());
  const menuEl = useRef<HTMLElement | null>(null);
  const bodyEl = useRef<HTMLElement | null>(null);

  const feed = useCallback((input: LumenMenuInput) => {
    const step = lumenMenuStep(stateRef.current, input);
    if (step.state !== stateRef.current) {
      stateRef.current = step.state;
      setState(step.state);
    }
    if (step.effect) effectRef.current(step.effect);
  }, []);

  const sliding = useCallback(() => stateRef.current.press?.fired === true, []);

  const itemAt = useCallback((x: number, y: number) => {
    const drawn: MenuRow[] = [];
    for (const [item, el] of rows.current) drawn.push({ item, rect: el.getBoundingClientRect() });
    return menuItemAt(x, y, drawn);
  }, []);

  const rowRef = useCallback((item: LumenMenuItem) => {
    let ref = rowRefs.current.get(item);
    if (!ref) {
      ref = (el: HTMLElement | null) => {
        if (el) rows.current.set(item, el);
        else rows.current.delete(item);
      };
      rowRefs.current.set(item, ref);
    }
    return ref;
  }, []);

  const menuRef = useCallback((el: HTMLElement | null) => {
    menuEl.current = el;
  }, []);
  const bodyRef = useCallback((el: HTMLElement | null) => {
    bodyEl.current = el;
  }, []);

  const open = state.open;
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menuEl.current?.contains(target) || bodyEl.current?.contains(target))) return;
      feed({ kind: "dismiss" });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") feed({ kind: "dismiss" });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, feed]);

  return { state, feed, sliding, itemAt, rowRef, menuRef, bodyRef };
}
