// What the shell draws over a selection (docs/82): a handle at each end, and
// Highlight / Ask above the words. The selection itself is painted by the view
// in the book's overlay; this is only what can be pressed.
//
// A handle drag is handed to the view point by point (moveSelectionEnd) with
// the finger's offset from the line kept, so the end follows the knob rather
// than jumping under the fingertip. The popup steps aside while a handle moves.

import { useRef, useState } from "react";
import { useT } from "../../../../i18n";
import type { FlowSelection } from "../../../../reading/epub/flow/flow-contract";
import { HANDLE_KNOB_PX, handleSpots, type HandleSpot } from "./reader-chrome";
import { PhonePopup, PopupItem, PopupSep, type ScreenFrame } from "./PhonePopup";

export default function PhoneSelection(props: {
  selection: FlowSelection;
  frame: ScreenFrame;
  onMoveEnd: (end: "start" | "end", clientX: number, clientY: number) => void;
  onHighlight: () => void;
  onAsk: () => void;
}) {
  const t = useT();
  const [moving, setMoving] = useState(false);
  const spots = handleSpots(props.selection.rects, props.frame);
  return (
    <>
      {spots.start && (
        <Handle end="start" spot={spots.start} frame={props.frame} onMove={props.onMoveEnd} onMoving={setMoving} />
      )}
      {spots.end && (
        <Handle end="end" spot={spots.end} frame={props.frame} onMove={props.onMoveEnd} onMoving={setMoving} />
      )}
      {!moving && (
        <PhonePopup rects={props.selection.rects} frame={props.frame} gap={28} label={t("phone.selection.label")}>
          <PopupItem onClick={props.onHighlight}>{t("phone.selection.highlight")}</PopupItem>
          <PopupSep />
          <PopupItem onClick={props.onAsk}>{t("phone.selection.ask")}</PopupItem>
        </PhonePopup>
      )}
    </>
  );
}

function Handle(props: {
  end: "start" | "end";
  spot: HandleSpot;
  frame: ScreenFrame;
  onMove: (end: "start" | "end", clientX: number, clientY: number) => void;
  onMoving: (moving: boolean) => void;
}) {
  const { end, spot, frame } = props;
  // The finger's offset from the point the end stands on: the line's edge, at
  // the middle of the line.
  const grab = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const start = end === "start";
  const height = spot.height + (start ? HANDLE_KNOB_PX : HANDLE_KNOB_PX + 4);
  return (
    <div
      data-selection-handle={end}
      aria-hidden
      className="absolute z-6 w-11 cursor-grab touch-none"
      style={{
        left: spot.x - frame.left - 22,
        top: spot.top - frame.top - (start ? HANDLE_KNOB_PX : 0),
        height,
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        grab.current = { id: e.pointerId, dx: spot.x + (start ? 2 : -2) - e.clientX, dy: spot.top + spot.height / 2 - e.clientY };
        props.onMoving(true);
      }}
      onPointerMove={(e) => {
        const g = grab.current;
        if (!g || g.id !== e.pointerId) return;
        const y = Math.min(Math.max(e.clientY + g.dy, frame.top + 4), frame.bottom - 4);
        props.onMove(end, e.clientX + g.dx, y);
      }}
      onPointerUp={(e) => {
        if (grab.current?.id !== e.pointerId) return;
        grab.current = null;
        props.onMoving(false);
      }}
      onPointerCancel={() => {
        grab.current = null;
        props.onMoving(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <b
        className="absolute left-1/2 -ml-px w-0.5 rounded-[1px] bg-[#2f6fe0]"
        style={start ? { top: HANDLE_KNOB_PX, bottom: 0 } : { top: 0, bottom: HANDLE_KNOB_PX + 4 }}
      />
      <i
        className="absolute left-1/2 -ml-1.5 h-3 w-3 rounded-full bg-[#2f6fe0]"
        style={start ? { top: 11 } : { bottom: 15 }}
      />
    </div>
  );
}
