// The prep page (docs/671 备餐页): one batch cook, top to bottom in the order it
// is done: what is cooked, what to have ready and the containers, how it is
// packed, where everything goes, and what the evenings and breakfasts need.
// No checkboxes: the hands doing this are busy. Done at the bottom.
//
// The timeline and the voice (section 3) are not here yet. Rendering and event
// binding only: every line comes from info/meals/screen/prep-view.ts.

import { useMemo } from "react";
import { useT } from "../../../../i18n";
import type { PhotoCache } from "../../../../info/meals/photos/dish-photos";
import type { MealsState } from "../../../../info/meals/plan/types";
import { hostRegion } from "../../../../info/meals/region";
import { prepView, type PrepPotView } from "../../../../info/meals/screen/prep-view";
import { dishPicture, dishThumbnails, ingredientPicture } from "../../../../info/meals/screen/view";
import { Button } from "../../ui/button";
import { MealsColumn, MealsHeader, PhotoCredit } from "./MealsChrome";
import { DishImage, IngredientThumb } from "./MealsImages";

export interface MealsPrepProps {
  state: MealsState | null;
  photos: PhotoCache;
  today: string;
  // The prep session the page is for, or null for the plan's own.
  session: string | null;
  onBack: () => void;
  onAsk: () => void;
  onDone: () => void;
}

const SECTION = "mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wider text-faint-foreground";
const CARD = "rounded-2xl border border-border-soft bg-card";

function PotCard({ pot, photos }: { pot: PrepPotView; photos: PhotoCache }) {
  const t = useT();
  const picture = dishPicture(pot.meal, photos);
  const thumbnails = dishThumbnails(pot.items, (en) => ingredientPicture(en, photos)?.url ?? null);
  return (
    <li className={`${CARD} p-4`}>
      <DishImage
        image={picture?.url}
        imagePageUrl={picture?.pageUrl}
        thumbnails={thumbnails}
        alt={pot.name}
        photoClassName="mb-3 aspect-[16/9] max-h-40 w-full"
        stripClassName="mb-3"
      />
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-display text-[17px] font-medium leading-snug text-foreground">{pot.name}</span>
        {pot.cuisine && (
          <span className="flex-none rounded-full bg-muted-soft px-2 py-0.5 text-[11px] text-muted-foreground">{pot.cuisine}</span>
        )}
      </div>
      {pot.how && <div className="mt-1 text-[13px] text-faint-foreground">{pot.how}</div>}
      {pot.method && <p className="m-0 mt-2 text-[14px] leading-snug text-foreground">{pot.method}</p>}
      <div className="mt-3 text-[12px] text-faint-foreground">{t("meals.prep.eats")}</div>
      <ul className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
        {pot.meals.map((m) => (
          <li key={m.text} className="rounded-md border border-border-subtle px-2 py-0.5 text-[13px] text-foreground">
            {m.text}
            {m.now && <span className="ml-1.5 text-[12px] text-accent-line">{t("meals.draft.now")}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 text-[12px] tabular-nums text-faint-foreground">{pot.portion}</div>
    </li>
  );
}

export function MealsPrep(props: MealsPrepProps) {
  const t = useT();
  const { state, today, session, photos } = props;
  const view = useMemo(() => (state ? prepView(state, session, today, hostRegion()) : null), [state, session, today]);
  const header = (
    <MealsHeader title={view?.title ?? t("meals.entry.kicker")} askLabel={t("meals.askPlan")} onAsk={props.onAsk} onBack={props.onBack} />
  );
  if (state === null) return <MealsColumn>{header}<div className="h-24" /></MealsColumn>;
  if (!view) {
    return (
      <MealsColumn>
        {header}
        <p className="m-0 text-[15px] text-muted-foreground">{t("meals.prep.missing")}</p>
      </MealsColumn>
    );
  }
  return (
    <MealsColumn>
      {header}
      <div className="-mt-2 text-[14px] tabular-nums text-muted-foreground">{view.minutes}</div>

      <h2 className={SECTION}>{t("meals.prep.cooked")}</h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {view.pots.map((pot) => (
          <PotCard key={pot.batch} pot={pot} photos={photos} />
        ))}
        {view.rice && (
          <li className={`${CARD} px-4 py-3`}>
            <div className="text-[15px] text-foreground">{view.rice.name}</div>
            <div className="mt-0.5 text-[13px] leading-snug text-faint-foreground">{view.rice.detail}</div>
          </li>
        )}
      </ul>

      <h2 className={SECTION}>{t("meals.prep.shop")}</h2>
      <div className={`${CARD} px-4 py-2`}>
        {view.shop.map((g) => (
          <section key={g.group} className="border-t border-border-subtle py-2 first:border-t-0">
            <h3 className="m-0 mb-1.5 text-[12px] font-medium text-faint-foreground">{g.label}</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {g.rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2.5">
                  <IngredientThumb
                    size={28}
                    url={ingredientPicture(r.en, photos)?.url ?? null}
                    pageUrl={ingredientPicture(r.en, photos)?.pageUrl ?? null}
                    category={r.category}
                    alt={r.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug text-foreground">{r.name}</span>
                    <span className="block text-[12px] leading-snug text-faint-foreground">
                      {r.dishes}
                      {r.note && ` · ${r.note}`}
                    </span>
                  </span>
                  <span className="flex-none text-right text-[13px] tabular-nums text-muted-foreground">{r.qty}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {view.containers.length > 0 && (
        <>
          <h3 className="mb-1.5 mt-4 text-[12px] font-medium text-faint-foreground">{t("meals.prep.containers")}</h3>
          <ul className={`${CARD} m-0 flex list-none flex-col p-0`}>
            {view.containers.map((c) => (
              <li key={c.name} className="flex items-start gap-3 border-t border-border-subtle px-4 py-2 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-foreground">{c.name}</span>
                  <span className="block text-[12px] leading-snug text-faint-foreground">{c.detail}</span>
                </span>
                <span className="flex-none text-[15px] tabular-nums text-foreground">{c.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Section 3, the timeline, comes with the voice (docs/671 时间线与语音). */}

      {view.boxes.length > 0 && (
        <>
          <h2 className={SECTION}>{t("meals.prep.packing")}</h2>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
            {view.boxes.map((b) => (
              <li key={b.meal} className={`${CARD} p-3`}>
                <div className="text-[14px] font-medium text-foreground">{b.meal}</div>
                <div className="mt-1 text-[13px] leading-snug text-foreground">{b.what}</div>
                {b.with && <div className="mt-1 text-[12px] leading-snug text-faint-foreground">{b.with}</div>}
                <div className="mt-1.5 text-[12px] leading-snug text-accent-line">{b.keep}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className={SECTION}>{t("meals.prep.fridge")}</h2>
      <p className="m-0 mb-3 text-[14px] leading-snug text-foreground">{view.fridgeLede}</p>
      <div className="flex flex-col gap-3">
        {view.places.map((p) => (
          <section key={p.place} className={`${CARD} px-4 py-2`}>
            <h3 className="m-0 py-1 text-[12px] font-medium text-faint-foreground">{p.label}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {p.rows.map((r) => (
                <li key={`${r.name}:${r.detail}`} className="border-t border-border-subtle py-2 first:border-t-0">
                  <div className="text-[15px] leading-snug text-foreground">{r.name}</div>
                  <div className="text-[12px] leading-snug text-faint-foreground">
                    {r.detail}
                    {r.until && <span className="text-accent-line"> · {r.until}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {view.nights.length > 0 && (
        <>
          <h2 className={SECTION}>{t("meals.prep.evenings")}</h2>
          <div className="flex flex-col gap-3">
            {view.nights.map((n) => (
              <section key={n.title} className={`${CARD} px-4 py-3`}>
                <h3 className="m-0 text-[14px] font-medium text-foreground">{n.title}</h3>
                <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                  {n.lines.map((line) => (
                    <li key={line} className="text-[14px] leading-snug text-muted-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <div className="mt-8">
        {view.done ? (
          <p role="status" className="m-0 text-[14px] leading-snug text-muted-foreground">
            {t("meals.prep.doneAlready")}
          </p>
        ) : (
          <>
            <Button variant="cta" size="lg" className="w-full" onClick={props.onDone}>
              {t("meals.prep.done")}
            </Button>
            <p className="m-0 mt-2 text-[13px] leading-snug text-faint-foreground">{t("meals.prep.doneHint")}</p>
          </>
        )}
      </div>
      <PhotoCredit />
    </MealsColumn>
  );
}
