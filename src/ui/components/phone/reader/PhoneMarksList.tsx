// The Marks tab (docs/82): every highlight and AI underline in the book, in the
// order the text runs, with the chapter and page each is on. A tap goes to the
// mark and rings it; an underline's bubble opens its conversation. A row swiped
// left uncovers Delete, and pressing it is a second, separate act — the trace
// list's gesture (reader/sidebar/swipe-action.ts), bound here the same way.

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../../../i18n";
import type { OutlineItem } from "../../../../fulltext/types";
import type { Annotation } from "../../../../platform/app/reader-contract";
import { HIGHLIGHT_COLOR } from "../../../../platform/app/annotations";
import { AI_PEN_COLOR } from "../../../../reading/session/use-marks";
import { IconAskHere, IconUnderline } from "../../base/icons";
import { cn } from "../../lib/utils";
import {
  SWIPE_ACTION_WIDTH,
  actionVisible,
  initSwipeState,
  rowClickAction,
  stepSwipe,
  trackedOpen,
  type SwipeInput,
  type SwipeState,
} from "../../reader/sidebar/swipe-action";
import { markRows, type MarkRow } from "./reader-chrome";

export default function PhoneMarksList(props: {
  marks: readonly Annotation[];
  outline: readonly OutlineItem[];
  onGoTo: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const rows = markRows(props.marks, props.outline);
  // The one row standing open; opening another shuts it.
  const [openId, setOpenId] = useState<string | null>(null);
  const onOpenChange = useCallback((id: string, open: boolean) => {
    setOpenId((cur) => (open ? id : cur === id ? null : cur));
  }, []);

  if (rows.length === 0) {
    return (
      <div className="px-8 py-14 text-center text-[14px] leading-normal text-faint-foreground">
        <b className="mb-1.5 block text-[15px] font-semibold text-muted-foreground">{t("phone.marks.emptyTitle")}</b>
        {t("phone.marks.emptyBody")}
      </div>
    );
  }
  return (
    <div role="list">
      {rows.map((row) => (
        <MarkListRow
          key={row.id}
          row={row}
          open={openId === row.id}
          onOpenChange={onOpenChange}
          onGoTo={props.onGoTo}
          onOpenConversation={props.onOpenConversation}
          onDelete={(id) => {
            setOpenId(null);
            props.onDelete(id);
          }}
        />
      ))}
    </div>
  );
}

function MarkListRow(props: {
  row: MarkRow;
  open: boolean;
  onOpenChange: (id: string, open: boolean) => void;
  onGoTo: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const { row, onOpenChange } = props;
  const contentRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<SwipeState>(initSwipeState());
  const [swipe, setSwipe] = useState<SwipeState>(swipeRef.current);
  const draggedRef = useRef(false);

  const dispatch = useCallback(
    (input: SwipeInput, e?: React.PointerEvent) => {
      const out = stepSwipe(swipeRef.current, input);
      swipeRef.current = out.state;
      const el = contentRef.current;
      for (const c of out.commands) {
        if (c.type === "capture") el?.setPointerCapture?.(c.id);
        else if (c.type === "releaseCapture") {
          if (el?.hasPointerCapture?.(c.id)) el.releasePointerCapture(c.id);
        } else if (c.type === "preventDefault") e?.preventDefault();
        else if (c.type === "suppressClick") draggedRef.current = true;
        else onOpenChange(row.id, c.open);
      }
      setSwipe(out.state);
    },
    [row.id, onOpenChange],
  );

  useEffect(() => {
    if (!props.open && trackedOpen(swipeRef.current)) dispatch({ type: "close" });
  }, [props.open, dispatch]);

  const label = t(row.kind === "underline" ? "phone.marks.underlineRow" : "phone.marks.highlightRow", {
    text: row.text,
  });
  return (
    <div role="listitem" className="relative overflow-hidden border-b border-border-subtle">
      {actionVisible(swipe) && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 cursor-pointer border-0 bg-destructive text-[15px] font-semibold text-destructive-foreground"
          style={{ width: SWIPE_ACTION_WIDTH }}
          onClick={() => props.onDelete(row.id)}
        >
          {t("phone.marks.delete")}
        </button>
      )}
      <div
        ref={contentRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        data-mark-row={row.id}
        className={cn(
          "relative flex min-h-16 cursor-pointer touch-pan-y items-start gap-3 bg-background py-2.5 pr-1 pl-4 select-none active:bg-muted",
          swipe.phase === "dragging" ? "transition-none" : "transition-transform duration-200 ease-out",
        )}
        style={{ transform: swipe.offset ? `translateX(${swipe.offset}px)` : undefined }}
        onPointerDown={(e) => dispatch({ type: "pointerdown", id: e.pointerId, x: e.clientX, y: e.clientY }, e)}
        onPointerMove={(e) => dispatch({ type: "pointermove", id: e.pointerId, x: e.clientX, y: e.clientY }, e)}
        onPointerUp={(e) => dispatch({ type: "pointerup", id: e.pointerId }, e)}
        onPointerCancel={(e) => dispatch({ type: "pointercancel", id: e.pointerId }, e)}
        onClick={() => {
          const action = rowClickAction(trackedOpen(swipeRef.current), draggedRef.current);
          draggedRef.current = false;
          if (action === "close") dispatch({ type: "close" });
          else if (action === "select") props.onGoTo(row.id);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          props.onGoTo(row.id);
        }}
      >
        <span aria-hidden className="flex w-5 flex-none self-stretch justify-center py-0.5">
          {row.kind === "underline" ? (
            <span className="text-faint-foreground" style={{ color: AI_PEN_COLOR }}>
              <IconUnderline size={20} />
            </span>
          ) : (
            <i className="block w-1 rounded-sm" style={{ background: HIGHLIGHT_COLOR }} />
          )}
        </span>
        <span className="min-w-0 flex-1 py-px">
          <span className="line-clamp-2 font-display text-[15px] leading-snug text-foreground">{row.text}</span>
          <span className="mt-0.5 block truncate text-[12px] text-faint-foreground">
            {[row.chapter, t("phone.marks.page", { label: row.pageLabel })].filter(Boolean).join(" · ")}
          </span>
        </span>
        {row.threadId && (
          <button
            type="button"
            className="-mt-0.5 grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-accent-line active:bg-muted"
            title={t("phone.marks.openConversation")}
            aria-label={t("phone.marks.openConversation")}
            onClick={(e) => {
              e.stopPropagation();
              if (trackedOpen(swipeRef.current)) {
                dispatch({ type: "close" });
                return;
              }
              props.onOpenConversation(row.id);
            }}
          >
            <IconAskHere size={22} />
          </button>
        )}
      </div>
    </div>
  );
}
