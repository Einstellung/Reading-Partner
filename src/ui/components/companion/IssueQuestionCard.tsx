// A question the companion asks when a brief opens (info/issue/question-card.ts): the
// question, its quick answers, and "in my own words". A study's label question
// also shows the item's title and its one line, then where the answer went.
// Presentational: a press only raises intent, and the door chat says the
// answer (use-door-chat.ts).

import {
	ISSUE_ANSWER_OP,
	ISSUE_LABEL_OP,
	ISSUE_OWN_OP,
	ISSUE_SKIP_OP,
	LABEL_ANSWERS,
	labelReceipt,
	labelWords,
	type IssueQuestionCard as Payload,
} from "../../../info/issue/question-card";
import { useT } from "../../../i18n";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";

export function IssueQuestionCard({ payload, dispatch }: CardComponentProps<Payload>) {
	const t = useT();
	if (payload.label) return <LabelQuestionCard payload={payload} dispatch={dispatch} />;
	const answered = payload.phase === "answered";
	return (
		<div
			className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5"
			data-issue-question={payload.questionId}
		>
			<span className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
				{t("info.issue.cardKicker", { topic: payload.topic })}
			</span>
			<p className="text-[14px] leading-snug text-foreground">{payload.text}</p>
			{answered ? (
				<p className="text-[13px] text-muted-foreground">{t("info.issue.answered", { answer: payload.answer ?? "" })}</p>
			) : (
				<div className="flex flex-wrap gap-1.5">
					{payload.quick.map((answer) => (
						<Button
							key={answer}
							variant="outline"
							size="chip"
							className="whitespace-normal text-left"
							onClick={() => dispatch({ kind: "mutate", op: ISSUE_ANSWER_OP, arg: answer })}
						>
							{answer}
						</Button>
					))}
					<Button
						variant={payload.phase === "own" ? "secondary" : "ghost"}
						size="chip"
						onClick={() => dispatch({ kind: "mutate", op: ISSUE_OWN_OP })}
					>
						{t("info.issue.ownWords")}
					</Button>
				</div>
			)}
			{payload.phase === "own" && <p className="text-[12px] text-muted-foreground">{t("info.issue.ownHint")}</p>}
		</div>
	);
}

function LabelQuestionCard({ payload, dispatch }: Pick<CardComponentProps<Payload>, "payload" | "dispatch">) {
	const t = useT();
	const label = payload.label!;
	const receipt = labelReceipt(payload);
	const filing = payload.phase === "open" || payload.phase === "file";
	return (
		<div
			className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5"
			data-issue-question={payload.questionId}
		>
			<span className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
				{t("info.issue.cardKicker", { topic: payload.topic })}
			</span>
			<p className="text-[14px] leading-snug text-foreground">{payload.text}</p>
			<div className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
				<p className="text-[13px] font-medium leading-snug text-foreground">{label.title}</p>
				{label.line && <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{label.line}</p>}
			</div>
			{payload.answer !== undefined && (
				<p className="text-[13px] text-muted-foreground">{t("info.issue.answered", { answer: payload.answer })}</p>
			)}
			{payload.phase === "file" && <p className="text-[12px] text-muted-foreground">{t("info.issue.labelFileAs")}</p>}
			{filing && (
				<div className="flex flex-wrap gap-1.5">
					{LABEL_ANSWERS.map((answer) => (
						<Button
							key={answer}
							variant="outline"
							size="chip"
							onClick={() => dispatch({ kind: "mutate", op: ISSUE_LABEL_OP, arg: answer })}
						>
							{labelWords(answer)}
						</Button>
					))}
					{payload.phase === "open" && (
						<Button variant="ghost" size="chip" onClick={() => dispatch({ kind: "mutate", op: ISSUE_OWN_OP })}>
							{t("info.issue.ownWords")}
						</Button>
					)}
				</div>
			)}
			{payload.phase === "own" && <p className="text-[12px] text-muted-foreground">{t("info.issue.ownHint")}</p>}
			{payload.phase === "reason" && (
				<div className="flex flex-wrap items-center gap-1.5">
					<p className="text-[12px] text-muted-foreground">{t("info.issue.labelReasonHint")}</p>
					<Button variant="ghost" size="chip" onClick={() => dispatch({ kind: "mutate", op: ISSUE_SKIP_OP })}>
						{t("info.issue.labelSkip")}
					</Button>
				</div>
			)}
			{receipt && <p className="text-[12px] text-accent-line">{receipt}</p>}
		</div>
	);
}

export const ISSUE_QUESTION_CARD_REGISTRY: CardRegistryFor<"issue-question"> = {
	"issue-question": IssueQuestionCard,
};
