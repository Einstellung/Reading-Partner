// MoreMenu: the reader top bar's overflow ("More") control. A neutral chevron
// button that opens a small dropdown holding low-frequency controls (fit width,
// zoom, paged flip, settings). The caller supplies the rows; Radix owns the
// mechanics — outside press, Escape, focus, arrow keys and typeahead.

import { useRef, useState } from "react";
import { IconChevronDown } from "../common/icons";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";

// A menu entry: a plain action, or a toggle that shows a lit state when on.
export type MoreItem =
	| {
			kind: "action";
			label: string;
			icon: (p: { size?: number }) => JSX.Element;
			onClick: () => void;
			disabled?: boolean;
	  }
	| {
			kind: "toggle";
			label: string;
			icon: (p: { size?: number }) => JSX.Element;
			on: boolean;
			onClick: () => void;
			disabled?: boolean;
	  }
	| { kind: "divider" };

// What this menu's rows want on top of the primitive's row: its geometry —
// 13px, a 36px minimum that grows to 44px under a coarse pointer — is
// DropdownMenuItem's own now. The highlight is left to the menu's
// `focus:bg-accent`, which is the same grey the hand-written `hover:` used and,
// unlike it, never sticks to a finger.
//
// The two [&_svg] rules undo a default drawn for lucide icons, which carry no
// size or colour; this project's do. Identical modifier chains or tailwind-merge
// keeps both (docs/pitfall/78).
const ROW =
	"gap-2.5 text-[#333] data-[disabled]:cursor-default data-[disabled]:opacity-40 " +
	"[&_svg:not([class*='size-'])]:size-auto [&_svg:not([class*='text-'])]:text-current";

export default function MoreMenu({ items, alert }: { items: MoreItem[]; alert?: boolean }) {
	const [open, setOpen] = useState(false);
	// Whether the menu was up when the press started. Radix opens on pointerdown
	// and an item clicks itself on a pointerup it never saw a pointerdown for, so
	// one tap can both open the menu and pick a row (docs/pitfall/83). Opening on
	// click keeps the tap that opened the menu out of the menu. Closing still goes
	// through the dismiss layer, which fires on pointerdown and so has already run
	// by the time the click arrives — hence the state from before it.
	const wasOpen = useRef(false);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className={
						"relative flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-[#555] " +
						"cursor-pointer can-hover:hover:bg-black/5 coarse:h-11 coarse:w-11 " +
						"data-[state=open]:bg-black/5 data-[state=open]:text-[#1b1b1b]"
					}
					title={alert ? "More — sync needs attention" : "More"}
					aria-label={alert ? "More — sync needs attention" : "More"}
					onPointerDown={(e) => {
						wasOpen.current = open;
						e.preventDefault();
					}}
					onClick={() => setOpen(!wasOpen.current)}
				>
					<IconChevronDown size={18} />
					{/* Settings lives in here, so a Settings-level warning rides the
					    trigger the same way it rides the gear on the home headers. */}
					{alert && (
						<span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#b45309] ring-2 ring-[#fafafa]" />
					)}
				</button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align="end"
				sideOffset={4}
				className="flex w-56 flex-col gap-0.5 rounded-lg border-black/10 p-1 shadow-lg"
			>
				{items.map((item, i) => {
					if (item.kind === "divider") {
						return <DropdownMenuSeparator key={`d${i}`} className="mx-0 my-1 bg-black/10" />;
					}
					const Icon = item.icon;
					const on = item.kind === "toggle" && item.on;
					const row = (
						<>
							<span
								className={
									"flex h-6 w-6 flex-none items-center justify-center rounded-md " +
									(on ? "bg-[#efecfb] text-[#4a3a9e]" : "text-[#666]")
								}
							>
								<Icon size={18} />
							</span>
							<span className="flex-1">{item.label}</span>
							{item.kind === "toggle" && (
								<span
									className={
										"flex-none text-[11px] font-medium " +
										(item.on ? "text-[#4a3a9e]" : "text-[#aaa]")
									}
								>
									{item.on ? "On" : "Off"}
								</span>
							)}
						</>
					);
					// Toggles stay open so the user can flip several; actions close,
					// which is what an unprevented select does.
					return item.kind === "toggle" ? (
						<DropdownMenuCheckboxItem
							key={item.label}
							checked={item.on}
							disabled={item.disabled}
							className={ROW + (on ? " text-[#4a3a9e]" : "")}
							onSelect={(e) => {
								e.preventDefault();
								item.onClick();
							}}
						>
							{row}
						</DropdownMenuCheckboxItem>
					) : (
						<DropdownMenuItem
							key={item.label}
							disabled={item.disabled}
							className={ROW}
							onSelect={item.onClick}
						>
							{row}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
