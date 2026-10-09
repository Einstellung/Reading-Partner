// The intake card in the door conversation (docs/68 「收链接」): which topic a
// pasted link goes into, then the receipt. Rendering and event binding only; the
// state is the intake record (watchIntake), what it means is intake-view.ts, and
// the gestures are answered in use-door-chat.ts.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { useT } from "../../../i18n";
import { listTopics, type Topic } from "../../../platform/app/topics";
import type { IntakeCard as IntakeCardPayload } from "../../../reading/ingest/intake-card";
import { watchIntake } from "../../../reading/ingest/topic-intake";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
	INTAKE_CHOOSE_OP,
	INTAKE_NEW_TOPIC_OP,
	INTAKE_OPEN_TARGET,
	chooseHeadline,
	documentMeta,
	intakeTopicRows,
	intakeView,
	progressLine,
	reasonText,
	skippedLine,
} from "./intake-view";

function Frame({ intakeId, children }: { intakeId: string; children: ReactNode }) {
	return (
		<div
			data-intake-id={intakeId}
			className="w-full max-w-md rounded-[14px] border border-border-soft bg-card px-3 pb-2.5 pt-3 text-foreground"
		>
			{children}
		</div>
	);
}

export function IntakeCard({ payload, dispatch }: CardComponentProps<IntakeCardPayload>) {
	const t = useT();
	const watch = useMemo(() => watchIntake(payload.intakeId), [payload.intakeId]);
	const intake = useSyncExternalStore(watch.subscribe, watch.snapshot);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let live = true;
		void watch.refresh().then(() => live && setLoaded(true));
		return () => {
			live = false;
		};
	}, [watch]);

	const [topics, setTopics] = useState<Topic[] | null>(null);
	const reloadTopics = useCallback(() => {
		void listTopics()
			.then(setTopics)
			.catch(() => setTopics([]));
	}, []);
	useEffect(reloadTopics, [reloadTopics]);
	// A topic made on this card is picked straight after: read the shelf again
	// once for a pick it does not list yet.
	const reloadedFor = useRef<string | null>(null);
	const pickedId = intake?.attachedTo ?? intake?.topicId ?? null;
	useEffect(() => {
		if (!pickedId || !topics || topics.some((one) => one.id === pickedId)) return;
		if (reloadedFor.current === pickedId) return;
		reloadedFor.current = pickedId;
		reloadTopics();
	}, [pickedId, topics, reloadTopics]);

	const [adding, setAdding] = useState(false);
	const [name, setName] = useState("");
	const createTopic = () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		dispatch({ kind: "mutate", op: INTAKE_NEW_TOPIC_OP, arg: trimmed });
		setAdding(false);
		setName("");
	};

	const view = intakeView(intake, loaded);
	const topicName = (id: string) => topics?.find((one) => one.id === id)?.name ?? t("shell.intake.topicFallback");

	if (view.phase === "loading" || view.phase === "elsewhere") {
		return (
			<Frame intakeId={payload.intakeId}>
				<p className="m-0 px-0.5 pb-0.5 text-[13px] text-muted-foreground">
					{view.phase === "loading" ? t("shell.intake.readingAny") : t("shell.intake.elsewhere")}
				</p>
			</Frame>
		);
	}

	if (view.phase === "failed") {
		return (
			<Frame intakeId={payload.intakeId}>
				<div className="mx-0.5 flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
					<div className="text-[12.5px] font-semibold text-muted-foreground">{t("shell.intake.failedLabel")}</div>
					<div className="text-[13.5px] leading-snug text-foreground">{reasonText(view.reason)}</div>
				</div>
			</Frame>
		);
	}

	if (view.phase === "receipt") {
		const first = view.documents[0];
		return (
			<Frame intakeId={payload.intakeId}>
				<div className="mx-0.5 flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
					<div className="text-[12.5px] font-semibold text-muted-foreground">
						{t("shell.intake.filedInto", { topic: topicName(view.topicId) })}
					</div>
					{view.documents.map((doc) => (
						<div key={doc.hash} className="mt-0.5">
							<div className="text-[15px] leading-normal">{doc.title}</div>
							{documentMeta(doc) && (
								<div className="break-all text-[12.5px] text-faint-foreground">{documentMeta(doc)}</div>
							)}
						</div>
					))}
					{view.skipped.map((skipped, i) => (
						<div key={i} className="mt-1 text-[12.5px] text-muted-foreground">
							{skippedLine(skipped)}
						</div>
					))}
					{first && (
						<Button
							type="button"
							size="lg"
							className="mt-2.5 self-start"
							onClick={() => dispatch({ kind: "navigate", to: INTAKE_OPEN_TARGET, arg: first.hash })}
						>
							{t("shell.intake.open")}
						</Button>
					)}
				</div>
			</Frame>
		);
	}

	const rows = intakeTopicRows(topics ?? [], intake ?? { url: "" }, view.picked, payload.suggestedTopicId);
	return (
		<Frame intakeId={payload.intakeId}>
			<div className="mx-0.5 mb-2 text-[14px] font-semibold">
				{chooseHeadline(view, view.picked ? topicName(view.picked) : null)}
			</div>
			<div className="flex flex-col gap-0.5">
				{rows.map((row) => (
					<Button
						key={row.id}
						type="button"
						variant="ghost"
						aria-pressed={row.picked}
						className={cn(
							"min-h-[42px] w-full justify-start gap-2.5 rounded-[9px] px-2.5 text-left text-[14px] font-normal leading-snug",
							row.picked && "bg-secondary font-semibold",
						)}
						onClick={() => dispatch({ kind: "mutate", op: INTAKE_CHOOSE_OP, arg: row.id })}
					>
						<span
							aria-hidden="true"
							className={cn(
								"grid h-4 w-4 flex-none place-items-center rounded-full border-[1.5px]",
								row.picked ? "border-foreground" : "border-secondary-border",
							)}
						>
							{row.picked && <span className="h-2 w-2 rounded-full bg-foreground" />}
						</span>
						<span className="min-w-0 flex-1 truncate">{row.name}</span>
						{row.suggested && (
							<span className="flex-none rounded-[5px] border border-accent-line px-1.5 text-[11px] leading-[17px] text-accent-line">
								{t("shell.intake.suggested")}
							</span>
						)}
					</Button>
				))}
				<Button
					type="button"
					variant="ghost"
					className="min-h-[42px] w-full justify-start gap-2.5 rounded-[9px] px-2.5 text-[14px] font-normal text-muted-foreground"
					onClick={() => setAdding(true)}
				>
					<span aria-hidden="true" className="grid h-4 w-4 flex-none place-items-center text-[17px] leading-none">
						+
					</span>
					<span className="flex-1 text-left">{t("shell.intake.newTopic")}</span>
				</Button>
				{adding && (
					<form
						className="flex gap-1.5 px-1 pb-0.5 pt-1"
						onSubmit={(event) => {
							event.preventDefault();
							createTopic();
						}}
					>
						<Input
							autoFocus
							value={name}
							enterKeyHint="done"
							placeholder={t("shell.intake.newTopicPlaceholder")}
							aria-label={t("shell.intake.newTopicPlaceholder")}
							onChange={(event) => setName(event.target.value)}
						/>
						<Button type="submit" size="lg" disabled={!name.trim()}>
							{t("shell.intake.create")}
						</Button>
					</form>
				)}
			</div>
			<div className="mx-1 mt-2 flex items-start gap-1.5 border-t border-border-subtle pt-2 text-[12px] leading-snug text-faint-foreground">
				<span
					aria-hidden="true"
					className={cn(
						"mt-[3px] h-2.5 w-2.5 flex-none rounded-full border-[1.5px]",
						view.filed
							? "scale-[0.6] border-accent-line bg-accent-line"
							: "animate-spin border-secondary-border border-t-accent-line",
					)}
				/>
				<span className="break-all">{progressLine(view)}</span>
			</div>
		</Frame>
	);
}

export const LUMEN_CARD_REGISTRY: CardRegistryFor<IntakeCardPayload["kind"]> = {
	"link-intake": IntakeCard,
};
