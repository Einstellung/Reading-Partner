// A question the companion asks when a brief opens (info/issue/question-card.ts): the
// question, its quick answers, and "in my own words". Presentational: a press
// only raises intent, and the door chat says the answer (use-door-chat.ts).

import { ISSUE_ANSWER_OP, ISSUE_OWN_OP, type IssueQuestionCard as Payload } from "../../../info/issue/question-card";
import { useT } from "../../../i18n";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";

export function IssueQuestionCard({ payload, dispatch }: CardComponentProps<Payload>) {
	const t = useT();
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

export const ISSUE_QUESTION_CARD_REGISTRY: CardRegistryFor<"issue-question"> = {
	"issue-question": IssueQuestionCard,
};
