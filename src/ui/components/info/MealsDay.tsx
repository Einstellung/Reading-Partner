// One day (docs/73): the four meals in eating order, each with its foods at
// their solved grams and a one-line method.
//
// Rendering and event binding only.

import { useState } from "react";

import { openExternal } from "../../../platform/app/external-link";
import type { PhotoCache } from "../../../info/meals/dish-photos";
import { markDishPhotoBroken } from "../../../info/meals/photo-store";
import { hostRegion } from "../../../info/meals/region";
import type { MealsState } from "../../../info/meals/types";
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
} from "../../../info/meals/view";
import { MealsColumn, MealsHeader, PhotoCredit } from "./MealsChrome";
import { DishImage } from "./MealsImages";

export interface MealsDayProps {
  state: MealsState | null;
  photos: PhotoCache;
  today: string;
  date: string;
  onBack: () => void;
  onAsk: () => void;
}

function MealCard({ view, photos }: { view: MealView; photos: PhotoCache }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const made = view.mode === "make";
  const dish = { searchName: view.searchName };
  const picture = made ? dishPicture(dish, photos) : null;
  const credit = made ? dishPhotoCredit(dish, photos) : null;

  return (
    <section className="rounded-2xl border border-border-soft bg-card p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-faint-foreground">
          {view.label}
          {view.postWorkout ? " · after training" : ""}
        </span>
        <span className="flex-1" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-accent-line">
          {made && view.minutes !== null ? `${view.minutes} min` : modeWord(view.mode)}
        </span>
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
              {Math.round(view.totals.kcal)} kcal · P {Math.round(view.totals.protein)} g · F{" "}
              {Math.round(view.totals.fat)} g · C {Math.round(view.totals.carbs)} g
            </p>
          )}
          {view.rows.length > 0 && (
            <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
              {view.rows.map((r) => (
                <li key={r.foodId} className="flex gap-3 text-[13px] tabular-nums text-foreground">
                  <span className="min-w-0 flex-1">
                    {r.name}
                    {r.units ? <span className="text-faint-foreground"> {r.units}</span> : null}
                  </span>
                  <span className="w-[52px] text-right">{r.grams} g</span>
                  <span className="w-[64px] text-right text-muted-foreground">{Math.round(r.kcal)} kcal</span>
                  <span className="w-[52px] text-right text-muted-foreground">{r.protein.toFixed(1)} g</span>
                </li>
              ))}
            </ul>
          )}
          {view.method && (
            <p className="m-0 mt-3 border-t border-border-subtle pt-3 text-[14px] leading-relaxed text-foreground">
              {view.method}
            </p>
          )}
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

export function MealsDay(props: MealsDayProps) {
  const { state, photos, today, date } = props;
  const view = state ? dayViewOn(state, date, today, hostRegion()) : null;
  const word = view?.word ?? "";
  const askLabel = word === "Today" ? "Ask about today" : `Ask about ${weekdayName(date)}`;

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
          <p className="m-0 text-[13px] text-muted-foreground">
            {view.kindLabel}
            {view.targets
              ? ` · ${Math.round(view.totals.kcal)} / ${view.targets.kcal} kcal · P ${Math.round(view.totals.protein)} / ${view.targets.protein} g`
              : ""}
          </p>
          {view.meals.map((m) => (
            <MealCard key={m.key} view={m} photos={photos} />
          ))}
        </div>
      )}
      <PhotoCredit />
    </MealsColumn>
  );
}

export default MealsDay;
