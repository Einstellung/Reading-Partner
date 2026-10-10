// One day (docs/73): the four meals in eating order, each with its foods at
// their solved grams and a one-line method. A made meal's whole card opens its
// recipe (docs/73 做法页).
//
// Rendering and event binding only.

import { useState } from "react";

import { openExternal } from "../../../../platform/app/external-link";
import { useT } from "../../../../i18n";
import type { PhotoCache } from "../../../../info/meals/photos/dish-photos";
import { markDishPhotoBroken } from "../../../../info/meals/photos/photo-store";
import { hostRegion } from "../../../../info/meals/region";
import type { MealKey, MealsState } from "../../../../info/meals/plan/types";
import {
  dayViewOn,
  dishPhotoCredit,
  dishPicture,
  dishThumbnails,
  ingredientPicture,
  mealName,
  modeWord,
  weekdayName,
  type MealView,
} from "../../../../info/meals/screen/view";
import { dayMeters, guideLine, macroLine, mealHeading, proteinCell } from "../../../../info/meals/screen/screen-lines";
import {
  CardLabel,
  CardLink,
  Cells,
  DayKindTag,
  MealsColumn,
  MealsHeader,
  PhotoCredit,
} from "./MealsChrome";
import { DishImage, IngredientThumb } from "./MealsImages";
import type { DayView } from "../../../../info/meals/screen/view";

export interface MealsDayProps {
  state: MealsState | null;
  photos: PhotoCache;
  today: string;
  date: string;
  onBack: () => void;
  onAsk: () => void;
  onOpenMethod: () => void;
  onOpenRecipe: (meal: MealKey) => void;
}

function MealCard({ view, photos, onOpen }: { view: MealView; photos: PhotoCache; onOpen: () => void }) {
  const t = useT();
  const [photoFailed, setPhotoFailed] = useState(false);
  const made = view.mode === "make";
  // Only a made meal with its grams has a recipe to open.
  const opens = made && view.rows.length > 0;
  const dish = { searchName: view.searchName };
  const picture = made ? dishPicture(dish, photos) : null;
  const credit = made ? dishPhotoCredit(dish, photos) : null;
  // The photo credit inside the card is a link of its own.
  const fromInner = (target: EventTarget) => target instanceof Element && target.closest("button, a") !== null;
  const openRecipe = (
    <span className="mt-2 flex items-center gap-1 text-[13px] text-accent-line">
      {t("meals.recipe.open")}
      <span aria-hidden="true" className="text-[17px] leading-none">
        ›
      </span>
    </span>
  );

  return (
    <section
      className={
        opens
          ? "block w-full cursor-pointer rounded-2xl border border-border-soft bg-card p-5 text-left transition-colors active:bg-muted-faint can-hover:hover:border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
          : "rounded-2xl border border-border-soft bg-card p-5"
      }
      {...(opens
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": t("meals.recipe.openAria", { meal: view.label, name: view.name }),
            onClick: (e: React.MouseEvent) => {
              if (!fromInner(e.target)) onOpen();
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
              e.preventDefault();
              onOpen();
            },
          }
        : {})}
    >
      <div className="flex items-baseline gap-2">
        <CardLabel>{mealHeading(view)}</CardLabel>
        <span className="flex-1" />
        <CardLabel accent>
          {made && view.minutes !== null ? t("meals.minutes", { count: view.minutes }) : modeWord(view.mode)}
        </CardLabel>
      </div>

      {made ? (
        <>
          <DishImage
            image={picture?.url}
            imagePageUrl={picture?.pageUrl}
            thumbnails={dishThumbnails(view.meal.items, (en) => ingredientPicture(en, photos)?.url ?? null)}
            alt={view.name}
            photoClassName="mt-3 aspect-[16/9] max-h-40 w-full"
            stripClassName="mt-3"
            onPhotoFailed={() => {
              setPhotoFailed(true);
              if (view.searchName) void markDishPhotoBroken(view.searchName);
            }}
          />
          {credit && !photoFailed && (
            <button
              type="button"
              className="mt-1 block max-w-full truncate text-left text-[11px] leading-snug text-faint-foreground underline underline-offset-2 can-hover:hover:text-muted-foreground"
              onClick={() => openExternal(credit.url)}
            >
              {credit.text}
            </button>
          )}
          <div className="mt-3.5 font-display text-[17px] font-medium leading-snug text-foreground">
            {mealName(view)}
          </div>
          {view.totals && (
            <p className="m-0 mt-1.5 text-[13px] tabular-nums text-muted-foreground">
              {macroLine(view.totals)}
            </p>
          )}
          {view.cells && (
            <div className="mt-2">
              <Cells cells={view.cells} big />
            </div>
          )}
          {view.rows.length > 0 && (
            <table className="mt-3 w-full border-collapse text-[13px] tabular-nums">
              <thead>
                <tr className="text-[11px] text-faint-foreground">
                  <th className="pb-1 text-left font-normal">{t("meals.ingredient")}</th>
                  <th className="pb-1 text-right font-normal">{t("meals.unit.g")}</th>
                  <th className="pb-1 text-right font-normal">{t("meals.unit.kcal")}</th>
                  <th className="pb-1 text-right font-normal">{t("meals.protein")}</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => {
                  const pic = ingredientPicture(r.en, photos);
                  return (
                    <tr key={r.foodId} className="border-t border-border-subtle text-foreground">
                      <td className="py-1.5 pr-2">
                        <span className="flex items-center gap-2">
                          <IngredientThumb
                            size={28}
                            url={pic?.url ?? null}
                            pageUrl={pic?.pageUrl ?? null}
                            category={r.category}
                            alt={r.name}
                          />
                          <span className="min-w-0">
                            {r.name}
                            {r.units ? <span className="text-faint-foreground"> {r.units}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="w-[44px] py-1.5 text-right">{r.grams}</td>
                      <td className="w-[44px] py-1.5 text-right text-muted-foreground">{Math.round(r.kcal)}</td>
                      <td className="w-[56px] py-1.5 text-right text-muted-foreground">{proteinCell(r.protein)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {view.method && (
            <div className="mt-3 border-t border-border-subtle pt-2.5 text-[14px] leading-relaxed text-foreground">
              <span className="mb-0.5 block">
                <CardLabel>{t("meals.how")}</CardLabel>
              </span>
              {view.method}
              {opens && openRecipe}
            </div>
          )}
          {opens && !view.method && <div className="mt-3">{openRecipe}</div>}
        </>
      ) : (
        <div className="mt-3.5 font-display text-[17px] font-medium leading-snug text-foreground">
          {view.name || modeWord(view.mode)}
        </div>
      )}
      {view.note && (
        <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{view.note}</p>
      )}
    </section>
  );
}

/** The day against its targets: the kind of day, two bars, fat and carbs. */
function DaySummary({ view, onOpenMethod }: { view: DayView; onOpenMethod: () => void }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-border-soft bg-card p-5">
      <div className="flex items-center gap-2">
        <DayKindTag training={view.training} />
        <span className="flex-1" />
        <CardLink onClick={onOpenMethod}>{t("meals.howTargetsWork")}</CardLink>
      </div>
      <div className="mt-2">
        {dayMeters(view).map((m) => (
          <div key={m.label} className="flex items-center gap-2.5 py-[3px] text-[13px]">
            <span className="w-[58px] flex-none text-muted-foreground">{m.label}</span>
            <span className="relative h-[3px] flex-1 overflow-hidden rounded-sm bg-muted">
              <span className="absolute inset-y-0 left-0 bg-accent-line" style={{ width: `${m.pct}%` }} />
            </span>
            <span className="w-[112px] flex-none text-right tabular-nums text-faint-foreground">{m.value}</span>
          </div>
        ))}
      </div>
      <p className="m-0 mt-2.5 text-[13px] tabular-nums leading-relaxed text-muted-foreground">{guideLine(view)}</p>
      <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {t("meals.plannedAgainstTarget", { arrangement: view.arrangement })}
      </p>
    </section>
  );
}

export function MealsDay(props: MealsDayProps) {
  const t = useT();
  const { state, photos, today, date } = props;
  const view = state ? dayViewOn(state, date, today, hostRegion()) : null;
  const word = view?.word ?? "";
  const askLabel = date === today ? t("meals.askToday") : t("meals.askWeekday", { weekday: weekdayName(date) });

  return (
    <MealsColumn>
      <MealsHeader
        title={word || weekdayName(date)}
        weekday={word && word !== weekdayName(date) ? weekdayName(date) : null}
        askLabel={askLabel}
        onAsk={props.onAsk}
        onBack={props.onBack}
      />
      {view === null ? (
        <div className="h-24" />
      ) : (
        <div className="flex flex-col gap-4">
          {view.targets && <DaySummary view={view} onOpenMethod={props.onOpenMethod} />}
          {view.meals.map((m) => (
            <MealCard key={m.key} view={m} photos={photos} onOpen={() => props.onOpenRecipe(m.key)} />
          ))}
        </div>
      )}
      <PhotoCredit />
    </MealsColumn>
  );
}
