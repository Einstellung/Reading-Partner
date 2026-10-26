// The meals draft card (docs/671 对话): the plan without grams, patched in place
// when the reader asks for a change, and collapsed to its short form once
// applied. Rendering only; the words come from info/meals/screen/draft-card.ts
// and every write goes through `dispatch` to the host.

import type { MealsDraftCardData } from "../../../info/meals/cards";
import {
  draftAppliedView,
  draftCardView,
  type DraftRow,
  type PotChip,
} from "../../../info/meals/draft-card-view";
import { useT } from "../../../i18n";
import type { CardComponentProps } from "../chat/chatParts";
import { Button } from "../ui/button";

// The pots' colours, by their place in the legend. Fixed hues, not theme
// tokens: a pot is told apart by colour across the whole card.
const TONES = ["bg-[#8a5a3c]", "bg-[#3f6b80]", "bg-[#6b5a8a]", "bg-[#5a6b3f]"];

function Chip({ chip, small }: { chip: PotChip; small?: boolean }) {
  return (
    <span
      className={
        "inline-grid flex-none place-items-center whitespace-nowrap rounded-md font-semibold leading-none text-card " +
        (small ? "mt-px h-5 min-w-[22px] px-[5px] text-[11px] " : "h-[22px] min-w-[34px] px-1.5 text-[12px] ") +
        (TONES[chip.tone % TONES.length] ?? TONES[0])
      }
    >
      {small ? chip.letter : chip.label}
    </span>
  );
}

const CHANGED_ROW = "bg-[color-mix(in_srgb,var(--color-accent-line)_8%,var(--color-card))] shadow-[inset_3px_0_0_var(--color-accent-line)]";

function Row({ row }: { row: DraftRow }) {
  const label = (
    <span className={"whitespace-nowrap pt-px text-[13px] " + (row.kind === "prep" ? "font-semibold text-foreground" : "text-faint-foreground")}>
      {row.label}
    </span>
  );
  if (row.kind === "prep") {
    return (
      <div className="mx-3.5 my-1 grid grid-cols-[34px_1fr] items-start gap-2 rounded-[10px] bg-muted px-2.5 py-2">
        {label}
        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="flex flex-wrap items-center gap-1.5 text-[14px]">
            {row.lead}
            {row.pots.map((p) => (
              <Chip key={p.letter} chip={p} />
            ))}
            {row.rice && <span className="text-muted-foreground">{row.rice}</span>}
          </span>
          <span className="text-[13px] tabular-nums text-muted-foreground">{row.time}</span>
        </span>
      </div>
    );
  }
  if (row.kind === "night") {
    return (
      <div className="grid grid-cols-[34px_1fr] items-start gap-2 px-3.5 py-[7px]">
        {label}
        <span className="flex min-w-0 flex-col text-[13px] text-muted-foreground">
          {row.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </span>
      </div>
    );
  }
  const changed = row.changed ? ` ${CHANGED_ROW}` : "";
  if (row.kind === "plain") {
    return (
      <div className={"grid grid-cols-[34px_1fr] items-start gap-2 px-3.5 py-[7px]" + changed}>
        {label}
        <span className="min-w-0 text-[15px] leading-[1.45]">{row.text}</span>
      </div>
    );
  }
  const name = (
    <span className="min-w-0 text-[15px] leading-[1.45]">
      {row.name}
      {row.tags.map((tag) => (
        <span
          key={tag.text}
          className={
            "ml-1 inline-block whitespace-nowrap rounded-full px-1.5 py-[3px] align-[2px] text-[11px] leading-none " +
            (tag.changed
              ? "bg-[color-mix(in_srgb,var(--color-accent-line)_16%,transparent)] text-accent-line"
              : "bg-secondary text-muted-foreground")
          }
        >
          {tag.text}
        </span>
      ))}
    </span>
  );
  return (
    <div className={"grid grid-cols-[34px_1fr] items-start gap-2 px-3.5 py-[7px]" + changed}>
      {label}
      <span className="flex min-w-0 flex-col gap-[3px]">
        {row.pot ? (
          <span className="flex items-start gap-2">
            <Chip chip={row.pot} small />
            {name}
          </span>
        ) : (
          name
        )}
        {row.subs.map((s) => (
          <span key={s.text} className={"text-[13px] text-muted-foreground" + (s.indent ? " pl-[30px]" : "")}>
            {s.text}
          </span>
        ))}
      </span>
    </div>
  );
}

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 3 4 4-4 4" />
  </svg>
);

function Applied({ payload, dispatch }: CardComponentProps<MealsDraftCardData>) {
  const v = draftAppliedView(payload);
  const link = "gap-0.5 px-2.5 text-[14px] font-semibold text-accent-line min-h-11";
  return (
    <div className="w-full max-w-md rounded-2xl border border-border-soft bg-card">
      <div className="flex flex-col gap-0.5 px-3.5 pb-1.5 pt-3">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-none stroke-accent-line" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3.5 9.5 3.5 3.5 7.5-8" />
          </svg>
          <h2 className="m-0 font-serif text-[17px] font-medium">{v.title}</h2>
        </div>
        <p className="m-0 pl-[26px] text-[13px] tabular-nums text-muted-foreground">{v.meta}</p>
        <div className="flex gap-1 pl-4">
          <Button type="button" variant="ghost" size="lg" className={link} onClick={() => dispatch({ kind: "navigate", to: "meals" })}>
            {v.openPlan}
            <Arrow />
          </Button>
          <Button type="button" variant="ghost" size="lg" className={link} onClick={() => dispatch({ kind: "navigate", to: "meals-shopping" })}>
            {v.openShopping}
            <Arrow />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MealsDraftCard(props: CardComponentProps<MealsDraftCardData>) {
  useT();
  const { payload, dispatch } = props;
  if (payload.phase === "applied") return <Applied {...props} />;
  const v = draftCardView(payload);
  return (
    <article className="w-full max-w-md overflow-hidden rounded-2xl border border-border-soft bg-card" aria-label={v.kicker}>
      <div className="flex flex-col gap-0.5 px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-center justify-between gap-2 text-[12px] text-faint-foreground">
          <span>{v.kicker}</span>
          {v.version && <span className="text-accent-line">{v.version}</span>}
        </div>
        <h2 className="m-0 font-serif text-[19px] font-medium leading-[1.3]">{v.title}</h2>
        <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{v.note}</p>
      </div>
      {v.pots.length > 0 && (
        <div className="mx-3.5 flex flex-col border-t border-border-subtle py-1">
          {v.pots.map((p, i) => (
            <div key={p.chip.letter} className={"grid grid-cols-[auto_1fr_auto] items-center gap-2.5 py-2" + (i ? " border-t border-border-subtle" : "")}>
              <Chip chip={p.chip} />
              <span className="min-w-0">
                <b className="block text-[15px] font-medium">{p.name}</b>
                <span className="block text-[12px] text-faint-foreground">{p.how}</span>
              </span>
              <span className="whitespace-nowrap text-[13px] tabular-nums text-muted-foreground">{p.meals}</span>
            </div>
          ))}
        </div>
      )}
      {v.days.map((d) => (
        <section key={d.key} className="border-t border-border" aria-label={d.title}>
          <div className="flex items-baseline gap-2 px-3.5 pb-1 pt-3">
            <h3 className="m-0 font-serif text-[16px] font-medium tabular-nums">{d.title}</h3>
            <span className="text-[13px] text-faint-foreground">{d.weekday}</span>
          </div>
          <div className="pb-2">
            {d.rows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </div>
        </section>
      ))}
      <div className="flex flex-col gap-1.5 border-t border-border px-3.5 py-3">
        <Button
          type="button"
          variant="cta"
          size="lg"
          className="min-h-12 w-full rounded-xl text-[16px] font-semibold"
          onClick={() => dispatch({ kind: "mutate", op: "apply-meals-draft" })}
        >
          {v.confirm}
        </Button>
        <p className="m-0 text-center text-[13px] text-faint-foreground">{v.hint}</p>
      </div>
    </article>
  );
}
