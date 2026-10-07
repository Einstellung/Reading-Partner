// The reader's top bar: navigation on the left, the annotation rack and page
// indicator in the middle, the AI entry and the "More" overflow on the right.
// The bar owns the overflow menu's contents; every other control reports up to
// App.

import { useMemo, type RefObject } from "react";
import type { ViewInstance, ViewStats } from "../../../platform/app/reader-contract";
import type { LevelGate } from "../../../reading/turn/call-state";
import { useT } from "../../../i18n";
import type { ToolType } from "./types";
import {
  IconBookSparkle,
  IconFitWidth,
  IconGear,
  IconPagedLayout,
  IconSidebar,
  IconZoomIn,
  IconZoomOut,
} from "../base/icons";
import MoreMenu, { type MoreItem } from "./MoreMenu";
import { readerPageText } from "./reader-page-text";
import { zoomResetLabel } from "./reader-zoom-keys";
import PenToolbar from "./PenToolbar";
import { hasTouchInput, rackOmits } from "./reader-tool";
import { Button } from "../ui/button";
import lumenIcon from "../lumen/lumen-icon.webp";
import { Separator } from "../ui/separator";

// Lumen's row in the overflow menu wears Lumen's own face: the hand-drawn
// water drop on a transparent ground, strokes thickened so they hold up at
// menu size. Every other row there carries a line glyph.
function IconLumen({ size = 20 }: { size?: number }) {
  return (
    <img
      src={lumenIcon}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

export default function ReaderTopBar(props: {
  view: RefObject<ViewInstance | null>;
  stats: ViewStats | null;
  viewReady: boolean;
  sidebarOpen: boolean;
  // Prep/notes generating while the drawer is shut: the toggle carries a dot.
  sidebarBusy: boolean;
  onToggleSidebar: () => void;
  onCloseReader: () => void;
  status: string;
  tool: { type: ToolType; color: string };
  onToolChange: (tool: { type: ToolType; color: string }) => void;
  onOpenBookThread: () => void;
  // Which of the two controls that open a level are dim right now, and why
  // (reading/call-state.ts). Null on a field means that one is live.
  gate: LevelGate;
  onOpenSettings: () => void;
  // Something in Settings needs attention (today: sync is not running).
  settingsAlert: boolean;
  // The corner companion's switch (docs/68). In the reader it is a row in the
  // "More" menu, not a control in the bar: it is the one thing here that is not
  // about the open book.
  lumenShown: boolean;
  onToggleLumen: () => void;
}) {
  const t = useT();
  const { view, stats, sidebarOpen, gate } = props;
  // Read once: the pointers a device has do not change under a reading session.
  const omit = useMemo(() => rackOmits(hasTouchInput(typeof window === "undefined" ? undefined : window)), []);
  const BOOK_THREAD = t("reader.top.learnBook");

  const pageText = readerPageText(stats, t);
  const paged = stats?.layout === "paged";

  // The "More" overflow: low-frequency view controls collapsed out of the main
  // bar (zoom, fit, the paged-flip opt-in, Lumen's switch).
  const moreItems: MoreItem[] = [
    {
      kind: "action",
      label: zoomResetLabel(stats?.layout, t),
      icon: IconFitWidth,
      disabled: !stats?.canZoomReset,
      onClick: () => view.current?.zoomReset(),
    },
    {
      kind: "action",
      label: t("reader.top.zoomIn"),
      icon: IconZoomIn,
      disabled: !stats?.canZoomIn,
      onClick: () => view.current?.zoomIn(),
    },
    {
      kind: "action",
      label: t("reader.top.zoomOut"),
      icon: IconZoomOut,
      disabled: !stats?.canZoomOut,
      onClick: () => view.current?.zoomOut(),
    },
    { kind: "divider" },
    {
      kind: "toggle",
      label: t("reader.top.pagedFlip"),
      icon: IconPagedLayout,
      on: paged,
      disabled: !props.viewReady,
      onClick: () => view.current?.setLayout(paged ? "vertical" : "paged"),
    },
    {
      // "Lumen", not lumenToggleTitle's "Hide Lumen": the row names the thing
      // and the On/Off on its right says which way it stands.
      kind: "toggle",
      label: t("reader.top.lumen"),
      icon: IconLumen,
      on: props.lumenShown,
      onClick: props.onToggleLumen,
    },
    { kind: "divider" },
    {
      kind: "action",
      label: t("reader.top.settings"),
      icon: IconGear,
      onClick: props.onOpenSettings,
    },
  ];

  return (
    <>
      {/* LEFT: navigation */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="relative flex-none text-muted-foreground"
          title={sidebarOpen ? t("reader.top.closePanel") : t("reader.top.openPanel")}
          aria-label={sidebarOpen ? t("reader.top.closePanel") : t("reader.top.openPanel")}
          aria-pressed={sidebarOpen}
          onClick={props.onToggleSidebar}
        >
          <IconSidebar size={18} />
          {/* Background-work dot: prep/notes generating while the drawer is
              shut (docs: iPad adaptation). */}
          {props.sidebarBusy && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent-line ring-2 ring-background" />
          )}
        </Button>
        {/* Library: full label from sm up, back-chevron only on a phone,
            where every pixel of center width counts. */}
        <Button
          variant="ghost"
          size="icon"
          className="w-auto flex-none gap-0 px-1 text-[13px] text-muted-foreground coarse:w-auto coarse:min-w-[44px] sm:px-2"
          title={t("reader.top.backToLibrary")}
          aria-label={t("reader.top.backToLibrary")}
          onClick={props.onCloseReader}
        >
          <span aria-hidden className="sm:hidden">‹</span>
          <span className="hidden sm:inline">‹ {t("reader.top.library")}</span>
        </Button>
        {/* No title breadcrumb: the book is open in front of the reader, so
            its name carries no information and the width is better spent on
            the tool group (tight on a phone). */}
        {props.status && (
          <span className="ml-1 flex-none text-xs text-[#b45309] sm:ml-3">{props.status}</span>
        )}
      </div>

      {/* CENTER: tool group — annotation rack + page indicator. flex-1 grows
          to center the tools (justify-center) from iPad up; on a phone it
          left-aligns and the min-w-0 + overflow-x-auto band scrolls the
          tools rather than pushing the page wider. */}
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-x-auto sm:justify-center sm:gap-2">
        <PenToolbar
          orientation="horizontal"
          tool={props.tool}
          onToolChange={props.onToolChange}
          disabled={gate.aiPen === null ? undefined : { ai: gate.aiPen }}
          omit={omit}
        />
        <Separator orientation="vertical" className="flex-none data-[orientation=vertical]:h-5" />
        <span className="flex-none [font-variant-numeric:tabular-nums] text-[13px] text-muted-foreground whitespace-nowrap px-0.5">
          {pageText.blocks}
          {pageText.printed && (
            <span className="ml-1.5 text-faint-foreground">{pageText.printed}</span>
          )}
        </span>
      </div>

      {/* RIGHT: AI entry + overflow */}
      <div className="flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-muted-foreground"
          disabled={gate.bookThread !== null}
          title={gate.bookThread ?? BOOK_THREAD}
          aria-label={gate.bookThread === null ? BOOK_THREAD : `${BOOK_THREAD}: ${gate.bookThread}`}
          onClick={props.onOpenBookThread}
        >
          <IconBookSparkle size={20} />
        </Button>
        <MoreMenu items={moreItems} alert={props.settingsAlert} />
      </div>
    </>
  );
}
