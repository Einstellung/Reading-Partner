// Left sidebar: a persistent icon rail plus a collapsible panel (ChatGPT-style),
// with two tabs — Outline and Annotations. Pure and controlled: App owns
// `open`/`tab` state, this component only renders and forwards clicks.
//
// The slide is a compositor-driven `transform` on a panel that floats over the
// reader, while the in-flow spacer that reserves its slot resizes in one step.
// Animating the spacer's width instead would relayout the reader iframe on every
// frame, and pdf.js re-renders its canvases on every resize — the animation then
// runs at a few frames per second. A transform keeps painting off the main thread,
// so the slide stays smooth even while the engine repaints the page once.

import { IconHighlight, IconOutline, IconSidebar } from "./icons";
import OutlineView from "./OutlineView";
import TraceList from "./TraceList";
import type { Annotation } from "./types";
import type { Fulltext } from "../fulltext/types";

export type SidebarTab = "outline" | "traces";

export const RAIL_WIDTH = 44;
export const PANEL_WIDTH = 300;

const RAIL_BTN =
	"flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent cursor-pointer text-[#555] hover:bg-black/5";
const RAIL_BTN_ACTIVE = "bg-black/[0.07] text-[#1b1b1b]";

interface SidebarProps {
	open: boolean;
	tab: SidebarTab;
	onToggle(): void;
	onSelectTab(tab: SidebarTab): void;
	fulltext: Fulltext | null;
	fulltextPending: boolean;
	onNavigatePage(page: number): void;
	annotations: Annotation[];
	selectedId?: string | null;
	onSelectAnnotation(id: string): void;
	onToggleStar(id: string, starred: boolean): void;
	onOpenThread(id: string): void;
}

export default function Sidebar({
	open,
	tab,
	onToggle,
	onSelectTab,
	fulltext,
	fulltextPending,
	onNavigatePage,
	annotations,
	selectedId,
	onSelectAnnotation,
	onToggleStar,
	onOpenThread,
}: SidebarProps) {
	// Fragment: the rail and the spacer sit in the reader row, while the panel is
	// absolutely positioned against <main> so sliding it never moves the reader.
	return (
		<>
			<div
				className="flex h-full shrink-0 flex-col items-center gap-1 border-r border-[#dcdcdc] bg-white pt-2"
				style={{ width: RAIL_WIDTH }}
			>
				<button type="button" className={RAIL_BTN} title={open ? "Collapse sidebar" : "Expand sidebar"} aria-label={open ? "Collapse sidebar" : "Expand sidebar"} onClick={onToggle}>
					<IconSidebar size={18} />
				</button>
				<div className="my-1 h-px w-6 bg-[#dcdcdc]" />
				<button
					type="button"
					className={`${RAIL_BTN} ${open && tab === "outline" ? RAIL_BTN_ACTIVE : ""}`}
					title="Outline"
					aria-label="Outline"
					aria-pressed={tab === "outline"}
					onClick={() => onSelectTab("outline")}
				>
					<IconOutline size={18} />
				</button>
				<button
					type="button"
					className={`${RAIL_BTN} ${open && tab === "traces" ? RAIL_BTN_ACTIVE : ""}`}
					title="Annotations"
					aria-label="Annotations"
					aria-pressed={tab === "traces"}
					onClick={() => onSelectTab("traces")}
				>
					<IconHighlight size={18} />
				</button>
			</div>

			{/* Holds the panel's slot in the flex row. Resizes in one step: the
			    reader relayouts (and pdf.js repaints) once per toggle, not per frame. */}
			<div className="h-full shrink-0 bg-white" style={{ width: open ? PANEL_WIDTH : 0 }} />

			{/* Clips the panel while it is parked off to the left. Transparent and
			    click-through; the panel itself takes pointer events only when open. */}
			<div
				className="pointer-events-none absolute top-0 z-10 h-full overflow-hidden"
				style={{ left: RAIL_WIDTH, width: PANEL_WIDTH }}
			>
				<div
					className={
						"h-full w-full border-r border-[#dcdcdc] bg-white [will-change:transform] transition-transform duration-200 ease-out " +
						(open ? "pointer-events-auto" : "pointer-events-none")
					}
					style={{ transform: open ? "translateX(0)" : `translateX(-${PANEL_WIDTH}px)` }}
					aria-hidden={!open}
				>
					{tab === "outline" ? (
						<OutlineView fulltext={fulltext} pending={fulltextPending} onNavigatePage={onNavigatePage} />
					) : (
						<TraceList
							annotations={annotations}
							selectedId={selectedId}
							onSelect={onSelectAnnotation}
							onToggleStar={onToggleStar}
							onOpenThread={onOpenThread}
						/>
					)}
				</div>
			</div>
		</>
	);
}
