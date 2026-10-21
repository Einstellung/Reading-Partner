// The move-into-reading card (docs/info/91 结束): end_study's offer to file the
// study's current version into a reading topic and end the study. The reader
// picks a topic (Lumen's suggestion marked and picked first) or names a new
// one. Presentational: use-door-chat.ts does the move (study-end.ts).

import { useState } from "react";

import { useT } from "../../../i18n";
import { STUDY_MOVE_LATER_OP, STUDY_MOVE_OP, type StudyMoveCardData } from "../../../info/topic-search/cards";
import type { CardComponentProps } from "../chat/chatParts";
import { Button } from "../ui/button";

const NEW = "";

export function StudyMoveCard({ payload, dispatch }: CardComponentProps<StudyMoveCardData>) {
  const t = useT();
  const [picked, setPicked] = useState<string>(payload.suggested ?? payload.topics[0]?.id ?? NEW);
  const [newName, setNewName] = useState(payload.name);
  const title = t("info.cards.studyMoveTitle", { name: payload.name, version: payload.version });

  if (payload.phase === "moved" && payload.moved) {
    return (
      <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-background px-3.5 py-3">
        <div className="text-[11px] font-semibold tracking-wider text-accent-line">{t("info.cards.studyMovedKicker")}</div>
        <div className="text-[15px] font-semibold leading-snug">{`${title} → ${payload.moved.topic}`}</div>
        <p className="m-0 text-[12.5px] text-muted-foreground">{t("info.cards.studyMovedEnded")}</p>
        <p className="m-0 text-[12.5px] leading-snug text-faint-foreground">
          {t("info.cards.studyMovedKept", { pins: payload.moved.pins, marks: payload.moved.marks })}
        </p>
      </div>
    );
  }

  const option = (id: string, label: string, hint: boolean) => (
    <button
      key={id || "new"}
      type="button"
      role="radio"
      aria-checked={picked === id}
      onClick={() => setPicked(id)}
      className={
        "flex min-h-[44px] items-center gap-2.5 rounded-lg border px-2.5 py-1 text-left text-sm " +
        (picked === id ? "border-secondary-border bg-secondary-faint" : "border-border bg-background")
      }
    >
      <span
        className={
          "h-[18px] w-[18px] flex-none rounded-full " +
          (picked === id ? "border-[5px] border-accent-line" : "border-2 border-border")
        }
      />
      <span className="min-w-0 flex-1">{label}</span>
      {hint && <span className="text-[12px] text-accent-line">{t("info.cards.studyMoveSuggested")}</span>}
    </button>
  );

  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-background px-3.5 py-3">
      <div className="text-[11px] font-semibold tracking-wider text-accent-line">{t("info.cards.studyMoveKicker")}</div>
      <div className="text-[15px] font-semibold leading-snug">{title}</div>
      <div role="radiogroup" aria-label={t("info.cards.studyMoveKicker")} className="flex flex-col gap-1.5">
        {payload.topics.map((tp) => option(tp.id, tp.name, tp.id === payload.suggested))}
        {option(NEW, t("info.cards.studyMoveNewTopic"), false)}
      </div>
      {picked === NEW && (
        <input
          aria-label={t("info.cards.studyMoveTopicName")}
          className="min-w-0 rounded-md border border-input bg-background px-2.5 py-2 text-sm coarse:min-h-[44px] coarse:text-base"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      )}
      <p className="m-0 text-[12.5px] text-muted-foreground">{t("info.cards.studyMoveNote")}</p>
      {payload.failed && <p className="m-0 text-[12.5px] text-destructive">{t("info.cards.studyMoveFailed")}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="chip" onClick={() => dispatch({ kind: "mutate", op: STUDY_MOVE_LATER_OP })}>
          {t("info.cards.studyMoveLater")}
        </Button>
        <Button
          type="button"
          variant="cta"
          size="chip"
          className="px-3.5 py-1.5"
          disabled={picked === NEW && !newName.trim()}
          onClick={() =>
            dispatch({
              kind: "mutate",
              op: STUDY_MOVE_OP,
              arg: JSON.stringify(picked === NEW ? { newName: newName.trim() } : { topicId: picked }),
            })
          }
        >
          {t("info.cards.studyMoveGo")}
        </Button>
      </div>
    </div>
  );
}
