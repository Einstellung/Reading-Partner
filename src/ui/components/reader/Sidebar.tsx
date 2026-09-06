// The reader's left panel (docs/54, and docs: touch/iPad adaptation). It has two
// forms and one implementation: below `lg` it is a drawer that slides in over
// the reader and dims the page behind it, at `lg` and up a column standing in
// the flow beside the page, with no backdrop and nothing to dismiss. Which one
// is showing is decided entirely by the variants below — sidebar-column.ts says
// why 1024px, and carries the two behaviours CSS cannot express (whether a jump
// shuts the panel, and whether its open state is remembered).
//
// The toggle in the top bar opens both. Three tabs live along its top:
// Outline, Marks (annotations) and Prep (docs/09) — one Prep tab, because a
// document gets one kind of prep material and the panel shows whichever it is.
// AI observations are not among them: they are per topic (docs/02, docs/31) and
// live in the topic's own sidebar, which is now the only place they are.
//
// Pure and controlled: App owns `open`/`tab` state and the toggle; this renders
// the backdrop, the panel, and the tab row, and forwards clicks.
//
// The drawer's slide is a compositor-driven transform, so the reader never
// relayouts while it moves. The column deliberately has no animation: every
// frame of a width transition is a viewport resize, the engine answers each one
// with a re-fit and the zoom plugin answers it again 150ms later
// (docs/pitfall/57), so the page would be re-laid-out a dozen times to arrive
// where one step puts it.

import type { ReactNode } from "react";
import { IconHighlight, IconOutline, IconSparkle } from "../base/icons";
import { Button } from "../ui/button";
import OutlineView from "./OutlineView";
import TraceList from "./TraceList";
import type { Annotation } from "./types";
import type { Fulltext } from "../../../fulltext/types";

export type SidebarTab = "outline" | "traces" | "prep";

// Drawer width: capped so a narrow window (portrait iPad, Split View) never
// gives it more than a reasonable slice of the viewport. The column is narrower
// — it is taken out of the page rather than laid over it, and 280px is the
// width at which an outline entry still fits on one line.
//
// Class strings and not a number in a style attribute: only a class can carry
// the breakpoint. `lg:` here is COLUMN_MIN_WIDTH_PX in sidebar-column.ts.
export const PANEL_WIDTH_CLASS = "w-[min(300px,85vw)] lg:w-[280px]";

const TABS: { id: SidebarTab; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
	{ id: "outline", label: "Outline", Icon: IconOutline },
	{ id: "traces", label: "Marks", Icon: IconHighlight },
	{ id: "prep", label: "Prep", Icon: IconSparkle },
];

// A tab button. The active tab shows its label beside the icon so the panel is
// self-describing without hover tooltips (which never fire on touch); inactive
// tabs are icon-only. h-11 keeps every tab a 44px touch target. Geometry only:
// the fill, the hover and the label colour come from the ghost variant.
const TAB_BTN = "h-11 rounded-md px-2 text-muted-foreground coarse:min-w-[44px]";
const TAB_BTN_ACTIVE = "bg-accent text-accent-foreground can-hover:hover:bg-accent";

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
	// Passed to the trace list, which asks it per row whether the mark's
	// conversation is still on this device.
	hasThread(threadId: string): boolean;
	onSelectAnnotation(id: string): void;
	onDeleteAnnotation(id: string): void;
	onOpenThread(id: string): void;
	// The prep tab's content, owned by App (state, callbacks, note loading).
	prepPanel: ReactNode;
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
	hasThread,
	onSelectAnnotation,
	onDeleteAnnotation,
	onOpenThread,
	prepPanel,
}: SidebarProps) {
	return (
		<>
			{/* Backdrop: dims the reader and catches the outside tap. Transparent and
			    click-through while closed so it never blocks the reader. Gone at
			    `lg`, where the column takes nothing from the reader — nothing to dim
			    and no outside tap to catch. */}
			<div
				className={
					"absolute inset-0 z-20 bg-black/20 transition-opacity duration-200 lg:hidden " +
					(open ? "opacity-100" : "pointer-events-none opacity-0")
				}
				onClick={onClose}
				aria-hidden="true"
			/>

			{/* The panel. As a drawer it is parked off to the left when closed and a
			    transform brings it back, which keeps the slide off the main thread;
			    as a column it is an ordinary flex item, and a shut column is out of
			    the flow entirely so the page gets the width back. */}
			<aside
				className={
					`absolute left-0 top-0 z-30 flex h-full flex-col border-r border-border bg-background shadow-xl [will-change:transform] transition-transform duration-200 ease-out ${PANEL_WIDTH_CLASS} lg:static lg:z-0 lg:flex-none lg:shadow-none lg:transition-none lg:[will-change:auto] ` +
					(open ? "translate-x-0" : "pointer-events-none -translate-x-full lg:hidden")
				}
				aria-hidden={!open}
			>
				<div className="flex flex-none items-center gap-0.5 border-b border-border px-1.5 py-1">
					{TABS.map(({ id, label, Icon }) => {
						const active = tab === id;
						return (
							<Button
								key={id}
								type="button"
								variant="ghost"
								size={null}
								className={`${TAB_BTN} ${active ? TAB_BTN_ACTIVE : ""}`}
								title={label}
								aria-label={label}
								aria-pressed={active}
								onClick={() => onSelectTab(id)}
							>
								<Icon size={18} />
								{active && <span className="text-[13px] font-medium">{label}</span>}
							</Button>
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
							hasThread={hasThread}
							onSelect={onSelectAnnotation}
							onDelete={onDeleteAnnotation}
							onOpenThread={onOpenThread}
						/>
					) : (
						prepPanel
					)}
				</div>
			</aside>
		</>
	);
}
