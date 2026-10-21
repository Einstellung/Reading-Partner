// The seed card in the door conversation (docs/info/91 起草与种子): the papers
// find_seed_paper found for a name the reader gave, each with 「是这篇」 and
// 「不是」. Presentational: a press raises intent; use-door-chat.ts keeps the
// verdict on the card and says it in the conversation.

import { useT } from "../../../i18n";
import { STUDY_SEED_VERDICT_OP, type StudySeedsCardData } from "../../../info/topic-search/cards";
import type { CardComponentProps } from "../chat/chatParts";
import { Button } from "../ui/button";

function byline(authors: readonly string[], date: string, handle: string): string {
  const who = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
  return [who, date, handle].filter(Boolean).join(" · ");
}

export function StudySeedsCard({ payload, dispatch }: CardComponentProps<StudySeedsCardData>) {
  const t = useT();
  return (
    <div className="w-full max-w-md rounded-xl border border-secondary-border bg-secondary-faint p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-accent-line">{t("info.cards.studySeedsTitle")}</div>
      <div className="mt-1 text-[13px] leading-snug text-muted-foreground">{t("info.cards.studySeedsSaid", { said: payload.said })}</div>
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-3 p-0">
        {payload.candidates.map((c, i) => (
          <li key={c.key} className="flex flex-col gap-1.5">
            <div
              className={
                c.verdict === "no"
                  ? "text-[14px] leading-snug text-faint-foreground line-through"
                  : "text-[14px] font-medium leading-snug text-foreground"
              }
            >
              {c.title}
            </div>
            <div className="text-[12px] leading-snug text-faint-foreground">{byline(c.authors, c.date, c.handle)}</div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={c.verdict === "yes" ? "secondary" : "outline"}
                size="chip"
                aria-pressed={c.verdict === "yes"}
                onClick={() => dispatch({ kind: "mutate", op: STUDY_SEED_VERDICT_OP, arg: `${i}:yes` })}
              >
                {t("info.cards.studySeedYes")}
              </Button>
              <Button
                type="button"
                variant={c.verdict === "no" ? "secondary" : "ghost"}
                size="chip"
                aria-pressed={c.verdict === "no"}
                onClick={() => dispatch({ kind: "mutate", op: STUDY_SEED_VERDICT_OP, arg: `${i}:no` })}
              >
                {t("info.cards.studySeedNo")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
