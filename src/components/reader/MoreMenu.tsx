// MoreMenu: the reader top bar's overflow ("More") control. A neutral chevron
// button that opens a small dropdown holding low-frequency controls (fit width,
// zoom, spread, paged flip, settings). Owns only the popover mechanics —
// open/close, outside-tap, Escape; the caller supplies the rows. Touch-friendly:
// 44px targets, tap-to-open, tap-outside / re-tap to close.

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "../common/icons";

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

const ROW =
	"flex w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-[#333] " +
	"min-h-[36px] coarse:min-h-[44px] cursor-pointer bg-transparent border-0 " +
	"enabled:hover:bg-[#f0f0f0] disabled:opacity-40 disabled:cursor-default";

export default function MoreMenu({ items }: { items: MoreItem[] }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onDown(e: PointerEvent) {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div className="relative flex" ref={rootRef}>
			<button
				type="button"
				className={
					"flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-[#555] " +
					"cursor-pointer can-hover:hover:bg-black/5 coarse:h-11 coarse:w-11 " +
					(open ? "bg-black/5 text-[#1b1b1b]" : "")
				}
				title="More"
				aria-label="More"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<IconChevronDown size={18} />
			</button>

			{open && (
				<div
					className="absolute right-0 top-full z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-lg border border-black/10 bg-white p-1 shadow-lg"
					role="menu"
				>
					{items.map((item, i) => {
						if (item.kind === "divider") {
							return <div key={`d${i}`} className="my-1 h-px bg-black/10" />;
						}
						const Icon = item.icon;
						const on = item.kind === "toggle" && item.on;
						return (
							<button
								key={item.label}
								type="button"
								role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
								aria-checked={item.kind === "toggle" ? item.on : undefined}
								className={ROW + (on ? " text-[#4a3a9e]" : "")}
								disabled={item.disabled}
								onClick={() => {
									item.onClick();
									// Toggles stay open so the user can flip several; actions close.
									if (item.kind === "action") setOpen(false);
								}}
							>
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
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
