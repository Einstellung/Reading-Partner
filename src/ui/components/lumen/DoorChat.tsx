// Typing to Lumen (docs/68): the day's conversation at the door, drawn with the
// chat every other conversation uses (CallView, its cards included).
//
// Rendering and event binding only; the conversation is use-door-chat.ts.
//
// Two forms, by shell. On the phone it is the whole screen, and Lumen stands
// down while it is up: the sheet registers as one (BottomSheetLayer), which is
// what the corner already gets out of the way for. On the iPad and the desktop
// it is a panel standing on top of Lumen in the corner's own column, so it
// follows the corner to whichever edge it was dragged to and Lumen stays where
// it was, under it.

import type { CSSProperties } from "react";

import { useT } from "../../../i18n";
import { IconClose } from "../base/icons";
import CallView from "../chat/call/CallView";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { BottomSheetLayer, OVERLAY_Z, OverlaySurface } from "../ui/overlay";
import lumenIcon from "./lumen-icon.webp";
import { useDoorChat } from "./use-door-chat";

// What the panel leaves below itself: the body (72px), the column's gap and the
// corner's own margin from the bottom edge (LumenCorner, pb-safe-6).
const PANEL_RESERVE_PX = 72 + 8 + 24 + 16;

export function DoorChat({
	form,
	liftPx = 0,
	onClose,
}: {
	form: "sheet" | "panel";
	/** How far the corner stands above its usual place (use-corner-drag.ts). */
	liftPx?: number;
	onClose: () => void;
}) {
	const t = useT();
	const chat = useDoorChat();

	const header = (
		<div className="flex flex-none items-center gap-2 border-b border-border-subtle bg-background py-1.5 pl-3.5 pr-1.5">
			<img src={lumenIcon} alt="" draggable={false} className="h-6.5 w-6.5 select-none" />
			<span className="flex-1 text-[15px] font-semibold text-foreground">{t("shell.door.title")}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label={t("shell.door.close")}
				title={t("shell.door.close")}
				onClick={onClose}
				className="text-muted-foreground"
			>
				<IconClose size={18} />
			</Button>
		</div>
	);

	const view = (
		<CallView
			messages={chat.messages}
			onSend={(text) => void chat.send(text)}
			onHangUp={onClose}
			streaming={chat.streaming}
			onStop={chat.stop}
			emptyTitle={t("shell.door.empty")}
			placeholder={t("shell.door.placeholder")}
			// Dictation waits for voice to be designed across every surface.
			voice={false}
			onCardAction={chat.onCardAction}
			scalable={false}
			stickKey={chat.stickKey}
			header={header}
		/>
	);

	if (form === "sheet") {
		return (
			<OverlaySurface layer="floating">
				<div
					role="dialog"
					aria-label={t("shell.door.title")}
					className={cn("fixed inset-0 flex flex-col bg-chat-surface p-safe", OVERLAY_Z.floating)}
				>
					<BottomSheetLayer />
					{view}
				</div>
			</OverlaySurface>
		);
	}

	const height: CSSProperties = {
		height: `min(36rem, calc(100dvh - ${PANEL_RESERVE_PX + liftPx}px - env(safe-area-inset-top)))`,
	};
	return (
		<OverlaySurface layer="floating">
			<div
				role="dialog"
				aria-label={t("shell.door.title")}
				className="pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-chat-surface shadow-lg"
				style={height}
				onKeyDown={(event) => {
					if (event.key === "Escape") onClose();
				}}
			>
				{view}
			</div>
		</OverlaySurface>
	);
}
