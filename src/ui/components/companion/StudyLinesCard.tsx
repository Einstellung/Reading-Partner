// The confirm-lines card in the door conversation (docs/info/91 对话里改): what
// Lumen would record from the conversation, each line with the reader's words
// and where it goes, marked 对 / 改一下 / 别记; 「按这几条更新简报」 once every
// line is decided. Presentational: presses raise intent, and use-door-chat.ts
// keeps the marks, writes the lines and asks for the update
// (info/topic-search/study-lines.ts).

import { useState } from "react";

import { useT } from "../../../i18n";
import {
  STUDY_LINE_EDIT_OP,
  STUDY_LINE_VERDICT_OP,
  STUDY_LINES_SEND_OP,
  type StudyLinesCardData,
} from "../../../info/topic-search/cards";
import type { StudyLineKind } from "../../../info/topic-search/study";
import { studyRunStatus, undecidedLines, type StudyRunStatus } from "../../../info/topic-search/study-lines";
import type { CardComponentProps } from "../chat/chatParts";
import { Button } from "../ui/button";
import { useStudyRun } from "./use-study-run";

const KIND = {
  avoid: "info.cards.studyLineKindAvoid",
  judgment: "info.cards.studyLineKindJudgment",
  pin: "info.cards.studyLineKindPin",
  demote: "info.cards.studyLineKindDemote",
  rewrite: "info.cards.studyLineKindRewrite",
} as const satisfies Record<StudyLineKind, string>;

const WHERE = {
  avoid: "info.cards.studyLineWhereAvoid",
  judgment: "info.cards.studyLineWhereJudgment",
  pin: "info.cards.studyLineWherePin",
  demote: "info.cards.studyLineWhereDemote",
  rewrite: "info.cards.studyLineWhereRewrite",
} as const satisfies Record<StudyLineKind, string>;

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-0.5 flex-none text-accent-line">
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StudyLinesCard({ payload, dispatch }: CardComponentProps<StudyLinesCardData>) {
  const t = useT();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const open = payload.phase === "open";
  const left = undecidedLines(payload).length;
  const run = useStudyRun(payload.ask?.status === "asked" ? payload.ask.runId : null);

  const runLine = (status: StudyRunStatus | null): string => {
    if (!status) return t("info.cards.studyLinesSent");
    if (status.kind === "waiting") return t("info.cards.studyRunWaiting");
    if (status.kind === "cooling") return t("info.cards.studyRunCooling", { minutes: status.minutes });
    if (status.kind === "done") return t("info.cards.studyRunDone");
    if (status.kind === "failed") return t("info.cards.studyRunFailed");
    return t("info.cards.studyRunRunning");
  };
  const footer = open
    ? left
      ? t("info.cards.studyLinesLeft", { count: left })
      : t("info.cards.studyLinesReady")
    : payload.phase === "asked"
      ? runLine(studyRunStatus(run))
      : payload.ask?.status === "refused"
        ? t("info.cards.studyLinesRefused")
        : t("info.cards.studyLinesBusy");

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-background">
      <div className="px-3.5 pt-2.5 text-[11px] font-semibold tracking-wider text-accent-line">{t("info.cards.studyLinesTitle")}</div>
      {payload.lines.map((line, i) => (
        <div key={i} className="flex flex-col gap-1.5 border-t border-border px-3.5 py-2.5 first-of-type:border-t-0">
          <div className="text-[11px] font-bold tracking-wide text-muted-foreground">{t(KIND[line.kind])}</div>
          <div
            className={
              line.verdict === "drop"
                ? "text-[15px] leading-normal text-faint-foreground line-through"
                : "text-[15px] leading-normal text-foreground"
            }
          >
            {line.text}
          </div>
          <div className="text-[12.5px] leading-snug text-muted-foreground">{t("info.cards.studyLineSaid", { said: line.said })}</div>
          {editing === i && open ? (
            <>
              <textarea
                aria-label={t("info.cards.studyLineEditLabel")}
                className="min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm coarse:text-base"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex justify-end gap-1.5">
                <Button type="button" variant="ghost" size="chip" onClick={() => setEditing(null)}>
                  {t("info.cards.studyLineCancel")}
                </Button>
                <Button
                  type="button"
                  variant="cta"
                  size="chip"
                  disabled={!draft.trim()}
                  onClick={() => {
                    dispatch({ kind: "mutate", op: STUDY_LINE_EDIT_OP, arg: `${i}:${draft}` });
                    setEditing(null);
                  }}
                >
                  {t("info.cards.studyLineSave")}
                </Button>
              </div>
            </>
          ) : open ? (
            <>
              <div className="text-[12px] text-faint-foreground">{t(WHERE[line.kind])}</div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant={line.verdict === "ok" ? "secondary" : "outline"}
                  size="chip"
                  aria-pressed={line.verdict === "ok"}
                  onClick={() => dispatch({ kind: "mutate", op: STUDY_LINE_VERDICT_OP, arg: `${i}:ok` })}
                >
                  {t("info.cards.studyLineOk")}
                </Button>
                <Button
                  type="button"
                  variant={line.verdict === "edit" ? "secondary" : "outline"}
                  size="chip"
                  aria-pressed={line.verdict === "edit"}
                  onClick={() => {
                    setDraft(line.text);
                    setEditing(i);
                  }}
                >
                  {t("info.cards.studyLineEdit")}
                </Button>
                <Button
                  type="button"
                  variant={line.verdict === "drop" ? "secondary" : "outline"}
                  size="chip"
                  aria-pressed={line.verdict === "drop"}
                  onClick={() => dispatch({ kind: "mutate", op: STUDY_LINE_VERDICT_OP, arg: `${i}:drop` })}
                >
                  {t("info.cards.studyLineDrop")}
                </Button>
              </div>
            </>
          ) : line.verdict === "drop" ? (
            <div className="text-[12px] text-faint-foreground">{t("info.cards.studyLineNotNoted")}</div>
          ) : (
            <div className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
              <CheckIcon />
              <span className="font-semibold">{t(WHERE[line.kind])}</span>
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2.5 rounded-b-xl border-t border-border bg-secondary-faint px-3.5 py-2.5">
        <p className="m-0 flex-1 text-[12.5px] leading-snug text-muted-foreground" aria-live="polite">
          {footer}
        </p>
        {payload.phase !== "asked" && (
          <Button
            type="button"
            variant="cta"
            size="chip"
            className="px-3.5 py-1.5"
            disabled={open && left > 0}
            onClick={() => dispatch({ kind: "mutate", op: STUDY_LINES_SEND_OP })}
          >
            {t("info.cards.studyLinesSend")}
          </Button>
        )}
      </div>
    </div>
  );
}
