// The card an edit_data change waits on (docs/platform/687 确认): what it
// changes, and Confirm / Don't. State and the writes are in housekeeper-confirm.ts.

import type { HousekeeperConfirmCard as Payload } from "../../../housekeeper/write";
import { useT } from "../../../i18n";
import { Button } from "../ui/button";
import type { CardComponentProps, CardRegistryFor } from "./chatParts";
import { showsQuestion, useHousekeeperConfirm, type ConfirmPhase } from "./housekeeper-confirm";

const KICKER = {
	replace: "chat.housekeeperConfirm.replace",
	delete: "chat.housekeeperConfirm.delete",
	send: "chat.housekeeperConfirm.send",
} as const;

const SETTLED = {
	applied: "chat.housekeeperConfirm.applied",
	declined: "chat.housekeeperConfirm.declined",
	stale: "chat.housekeeperConfirm.stale",
	gone: "chat.housekeeperConfirm.gone",
} as const;

export function HousekeeperConfirmCard({ payload }: CardComponentProps<Payload>) {
	const t = useT();
	const control = useHousekeeperConfirm(payload.pendingId);
	const waiting: readonly ConfirmPhase[] = ["open", "working"];
	return (
		<div
			className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5"
			data-housekeeper-pending={payload.pendingId}
		>
			{showsQuestion(control.phase) && (
				<span className="text-[11px] font-medium tracking-wider text-accent-line">
					{t(KICKER[payload.gate] ?? "chat.housekeeperConfirm.title")}
				</span>
			)}
			<ul className="flex flex-col gap-0.5 break-words text-[14px] leading-snug text-foreground [overflow-wrap:anywhere]">
				{payload.lines.map((line, i) => (
					<li key={i}>{line}</li>
				))}
			</ul>
			{waiting.includes(control.phase) && (
				<div className="flex flex-wrap items-center gap-1.5">
					<Button size="chip" disabled={control.phase === "working"} onClick={control.confirm}>
						{t("chat.housekeeperConfirm.confirm")}
					</Button>
					<Button variant="ghost" size="chip" disabled={control.phase === "working"} onClick={control.decline}>
						{t("chat.housekeeperConfirm.decline")}
					</Button>
					{control.phase === "working" && (
						<span className="text-[13px] text-muted-foreground">{t("chat.housekeeperConfirm.working")}</span>
					)}
				</div>
			)}
			{control.phase === "failed" && (
				<p className="break-words text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
					{t("chat.housekeeperConfirm.failed", { reason: control.reason ?? "" })}
				</p>
			)}
			{control.phase in SETTLED && (
				<p className="break-words text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
					{t(SETTLED[control.phase as keyof typeof SETTLED])}
				</p>
			)}
		</div>
	);
}

export const HOUSEKEEPER_CARD_REGISTRY: CardRegistryFor<"housekeeper-confirm"> = {
	"housekeeper-confirm": HousekeeperConfirmCard,
};
