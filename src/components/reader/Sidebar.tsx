// Left sidebar as an overlay drawer (docs: touch/iPad adaptation). Default
// closed on every surface (PC too); the reader top-bar button toggles it. It
// slides in from the left over the reader, dims the page behind it, and closes
// on a backdrop tap, Esc, or the toggle button. Five tabs live along its top:
// Outline, Marks (annotations), Prep (docs/09), Notes (docs/14), Memory (docs/02).
//
// Pure and controlled: App owns `open`/`tab` state and the toggle; this renders
// the backdrop, the sliding panel, and the tab row, and forwards clicks. The
// slide is a compositor-driven transform (the reader never relayouts, so pdf.js
// does not repaint on every frame); the panel floats over the reader rather than
// reserving an in-flow column, so opening it costs the reader nothing.

import type { ReactNode } from "react";
import { IconHighlight, IconMemory, IconNotes, IconOutline, IconSparkle } from "../common/icons";
import OutlineView from "./OutlineView";
import TraceList from "../chat/TraceList";
import type { Annotation } from "../common/types";
import type { Fulltext } from "../../fulltext/types";

export type SidebarTab = "outline" | "traces" | "prep" | "notes" | "memory";

// Drawer width: the old panel width, capped so a narrow window (portrait iPad,
// Split View) never gives it more than a reasonable slice of the viewport.
export const PANEL_WIDTH = 300;

const TABS: { id: SidebarTab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
	{ id: "outline", label: "Outline", Icon: IconOutline },
	{ id: "traces", label: "Marks", Icon: IconHighlight },
	{ id: "prep", label: "Prep", Icon: IconSparkle },
	{ id: "notes", label: "Notes", Icon: IconNotes },
	{ id: "memory", label: "Memory", Icon: IconMemory },
];

// A tab button. The active tab shows its label beside the icon so the panel is
// self-describing without hover tooltips (which never fire on touch); inactive
// tabs are icon-only. h-11 keeps every tab a 44px touch target.
const TAB_BTN =
	"flex h-11 items-center justify-center gap-1.5 rounded-md border-0 bg-transparent px-2 cursor-pointer text-[#555] can-hover:hover:bg-black/5 coarse:min-w-[44px]";
const TAB_BTN_ACTIVE = "bg-black/[0.06] text-[#1b1b1b]";

interface SidebarProps {
	open: boolean;
	tab: SidebarTab;
	onSelectTab(tab: SidebarTab): void;
	// Dismiss the drawer (backdrop tap). The toggle button and Esc live in App.
	onClose(): void;
	fulltext: Fulltext | null;
	fulltextPending: boolean;
	onNavigatePage(page: number): void;
	annotations: Annotation[];
	selectedId?: string | null;
	onSelectAnnotation(id: string): void;
	onToggleStar(id: string, starred: boolean): void;
	onOpenThread(id: string): void;
	// The prep tab's content, owned by App (state, callbacks, note loading).
	prepPanel: ReactNode;
	// The notes tab's content, owned by App (docs/14).
	notesPanel: ReactNode;
	// The memory tab's content, owned by App (entry loading, refresh).
	memoryPanel: ReactNode;
}

export default function Sidebar({
	open,
	tab,
	onSelectTab,
	onClose,
	fulltext,
	fulltextPending,
	onNavigatePage,
	annotations,
	selectedId,
	onSelectAnnotation,
	onToggleStar,
	onOpenThread,
	prepPanel,
	notesPanel,
	memoryPanel,
}: SidebarProps) {
	return (
		<>
			{/* Backdrop: dims the reader and catches the outside tap. Transparent and
			    click-through while closed so it never blocks the reader. */}
			<div
				className={
					"absolute inset-0 z-20 bg-black/20 transition-opacity duration-200 " +
					(open ? "opacity-100" : "pointer-events-none opacity-0")
				}
				onClick={onClose}
				aria-hidden="true"
			/>

			{/* The sliding panel. Parked off to the left when closed; a transform
			    keeps the slide off the main thread. */}
			<aside
				className={
					"absolute left-0 top-0 z-30 flex h-full flex-col border-r border-[#dcdcdc] bg-white shadow-xl [will-change:transform] transition-transform duration-200 ease-out " +
					(open ? "translate-x-0" : "pointer-events-none -translate-x-full")
				}
				style={{ width: `min(${PANEL_WIDTH}px, 85vw)` }}
				aria-hidden={!open}
			>
				<div className="flex flex-none items-center gap-0.5 border-b border-[#dcdcdc] px-1.5 py-1">
					{TABS.map(({ id, label, Icon }) => {
						const active = tab === id;
						return (
							<button
								key={id}
								type="button"
								className={`${TAB_BTN} ${active ? TAB_BTN_ACTIVE : ""}`}
								title={label}
								aria-label={label}
								aria-pressed={active}
								onClick={() => onSelectTab(id)}
							>
								<Icon size={18} />
								{active && <span className="text-[13px] font-medium">{label}</span>}
							</button>
						);
					})}
				</div>

				<div className="min-h-0 flex-1">
					{tab === "outline" ? (
						<OutlineView fulltext={fulltext} pending={fulltextPending} onNavigatePage={onNavigatePage} />
					) : tab === "traces" ? (
						<TraceList
							annotations={annotations}
							selectedId={selectedId}
							onSelect={onSelectAnnotation}
							onToggleStar={onToggleStar}
							onOpenThread={onOpenThread}
						/>
					) : tab === "prep" ? (
						prepPanel
					) : tab === "notes" ? (
						notesPanel
					) : (
						memoryPanel
					)}
				</div>
			</aside>
		</>
	);
}
