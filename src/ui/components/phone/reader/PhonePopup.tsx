// The dark bubble the phone reader raises over the words (docs/82): Highlight /
// Ask over a selection, and the actions of a mark that was tapped. Placed above
// the words when there is room under the top edge, else below them (popupSpot
// in reader-chrome.ts), which needs its own size, so it is measured once before
// it is shown.
//
// Rects arrive in viewport coordinates and the bubble is drawn inside the
// reading screen, which can itself be sliding: `frame` is that screen's box,
// read when the rects were.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { FlowRect } from "../../../../reading/epub/flow/flow-contract";
import { cn } from "../../lib/utils";
import { popupSpot } from "./reader-chrome";

export interface ScreenFrame {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function PhonePopup(props: {
  rects: readonly FlowRect[];
  frame: ScreenFrame;
  gap: number;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const { rects, frame, gap } = props;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSpot(popupSpot(rects, frame, { width: el.offsetWidth, height: el.offsetHeight }, gap));
  }, [rects, frame, gap]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={props.label}
      className={cn(
        "absolute z-7 flex items-center rounded-xl bg-neutral-800 px-1 text-neutral-50 shadow-[0_6px_22px_rgba(0,0,0,0.22)]",
        !spot && "invisible",
      )}
      style={spot ? { left: spot.left - frame.left, top: spot.top - frame.top } : { left: 0, top: 0 }}
    >
      {props.children}
    </div>
  );
}

export function PopupItem(props: { children: ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "h-11 cursor-pointer rounded-lg border-0 bg-transparent px-3.5 text-[15px] whitespace-nowrap text-inherit active:bg-current/20",
        props.destructive && "text-red-300",
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function PopupSep() {
  return <span aria-hidden className="h-5.5 w-px flex-none bg-current/20" />;
}
