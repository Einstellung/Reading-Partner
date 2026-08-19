// The reader's top bar: navigation on the left, the annotation rack and page
// indicator in the middle, the AI entry and the "More" overflow on the right.
// The bar owns the overflow menu's contents and the touch-probe toggle; every
// other control reports up to App.

import { useState, type RefObject } from "react";
import type { ViewInstance, ViewStats } from "../../../platform/app/reader-contract";
import { ANNOTATION_COLORS } from "../../../platform/app/annotations";
import { setTouchDebugEnabled } from "../../../reading/engine/gesture/touch-debug";
import type { ToolType } from "./types";
import {
  IconBlackboard,
  IconFitWidth,
  IconGear,
  IconPagedLayout,
  IconSidebar,
  IconTouchProbe,
  IconZoomIn,
  IconZoomOut,
} from "../base/icons";
import MoreMenu, { type MoreItem } from "./MoreMenu";
import PenToolbar from "./PenToolbar";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";

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
  onOpenSettings: () => void;
  // Something in Settings needs attention (today: sync is not running).
  settingsAlert: boolean;
}) {
  const { view, stats, sidebarOpen } = props;
  // On-device touch probe. Off by default, never persisted.
  const [touchDebug, setTouchDebug] = useState(false);

  const pageText = stats ? `${stats.pageIndex + 1} / ${stats.pagesCount}` : "— / —";
  const paged = stats?.layout === "paged";

  // The "More" overflow: low-frequency view controls collapsed out of the main
  // bar (zoom, fit, the paged-flip opt-in, the touch probe).
  const moreItems: MoreItem[] = [
    {
      kind: "action",
      label: "Fit page width",
      icon: IconFitWidth,
      disabled: !stats?.canZoomReset,
      onClick: () => view.current?.zoomReset(),
    },
    {
      kind: "action",
      label: "Zoom in",
      icon: IconZoomIn,
      disabled: !stats?.canZoomIn,
      onClick: () => view.current?.zoomIn(),
    },
    {
      kind: "action",
      label: "Zoom out",
      icon: IconZoomOut,
      disabled: !stats?.canZoomOut,
      onClick: () => view.current?.zoomOut(),
    },
    { kind: "divider" },
    {
      kind: "toggle",
      label: "Paged flip",
      icon: IconPagedLayout,
      on: paged,
      disabled: !props.viewReady,
      onClick: () => view.current?.setLayout(paged ? "vertical" : "paged"),
    },
    {
      kind: "toggle",
      label: "Touch debug",
      icon: IconTouchProbe,
      on: touchDebug,
      onClick: () => {
        const next = !touchDebug;
        setTouchDebug(next);
        setTouchDebugEnabled(next);
      },
    },
    { kind: "divider" },
    {
      kind: "action",
      label: "Settings",
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
          className="relative flex-none text-[#555]"
          title={sidebarOpen ? "Close panel" : "Open panel"}
          aria-label={sidebarOpen ? "Close panel" : "Open panel"}
          aria-pressed={sidebarOpen}
          onClick={props.onToggleSidebar}
        >
          <IconSidebar size={18} />
          {/* Background-work dot: prep/notes generating while the drawer is
              shut (docs: iPad adaptation). */}
          {props.sidebarBusy && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-[#fafafa]" />
          )}
        </Button>
        {/* Library: full label from sm up, back-chevron only on a phone,
            where every pixel of center width counts. */}
        <Button
          variant="ghost"
          size="icon"
          className="w-auto flex-none gap-0 px-1 text-[13px] text-[#555] coarse:w-auto coarse:min-w-[44px] sm:px-2"
          title="Back to library"
          aria-label="Back to library"
          onClick={props.onCloseReader}
        >
          <span aria-hidden className="sm:hidden">‹</span>
          <span className="hidden sm:inline">‹ Library</span>
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
          colors={ANNOTATION_COLORS}
          onToolChange={props.onToolChange}
        />
        <Separator orientation="vertical" className="flex-none data-[orientation=vertical]:h-5" />
        <span className="flex-none [font-variant-numeric:tabular-nums] text-[13px] text-[#555] whitespace-nowrap px-0.5">
          {pageText}
        </span>
      </div>

      {/* RIGHT: AI entry + overflow */}
      <div className="flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="flex-none text-[#555]"
          title="Learn this book with AI"
          aria-label="Learn this book with AI"
          onClick={props.onOpenBookThread}
        >
          <IconBlackboard size={18} />
        </Button>
        <MoreMenu items={moreItems} alert={props.settingsAlert} />
      </div>
    </>
  );
}
