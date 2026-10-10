// One made meal's recipe (docs/73 做法页), pushed over its day: the dish, its
// ingredients at their solved grams, the steps, and for a dish that keeps, how
// to cook it ahead.
//
// Rendering and event binding only. The request, the parse and the cook-ahead
// amounts are in info/meals/recipe; the call and the stored copy in use-recipe.

import { useLocale, useT } from "../../../../i18n";
import type { PhotoCache } from "../../../../info/meals/photos/dish-photos";
import type { MealKey, MealsState } from "../../../../info/meals/plan/types";
import { batchMakeLine, recipeRequest, type RecipeEntry } from "../../../../info/meals/recipe/recipe";
import { hostRegion } from "../../../../info/meals/region";
import { dayViewOn, ingredientPicture, weekdayName, type MealView } from "../../../../info/meals/screen/view";
import { IconSparkle } from "../../base/icons";
import { Button } from "../../ui/button";
import { cn } from "../../lib/utils";
import { CardLabel, MealsColumn, MealsHeader } from "./MealsChrome";
import { IngredientThumb } from "./MealsImages";
import { useRecipe } from "./use-recipe";

export interface MealsRecipeProps {
  state: MealsState | null;
  photos: PhotoCache;
  today: string;
  date: string;
  meal: MealKey;
  onBack: () => void;
}

const CARD = "rounded-2xl border border-border-soft bg-card p-5";

/** The dish and its ingredients. The steps keep their state in RecipeBody, so their landing does not redraw this. */
function RecipeHead({ view, photos }: { view: MealView; photos: PhotoCache }) {
  const t = useT();
  const meta = [view.minutes !== null ? t("meals.minutes", { count: view.minutes }) : "", view.flavourLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className={CARD}>
      <div className="font-display text-[21px] font-medium leading-[1.35] text-foreground">{view.name}</div>
      {meta && <p className="m-0 mt-1 text-[13px] text-muted-foreground">{meta}</p>}
      <table className="mt-3 w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="text-[11px] text-faint-foreground">
            <th className="pb-1 text-left font-normal">{t("meals.ingredient")}</th>
            <th className="pb-1 text-right font-normal">{t("meals.unit.g")}</th>
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
                <td className="w-[64px] py-1.5 text-right">{r.grams}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const SKELETON_WIDTHS = [[92, 60], [100, 74], [86], [96, 52]];

function StepsSkeleton({ writing }: { writing: boolean }) {
  const t = useT();
  return (
    <section className={CARD} aria-busy="true">
      <CardLabel>{t("meals.how")}</CardLabel>
      {writing && (
        <div className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="animate-pulse text-accent-line">
            <IconSparkle size={14} />
          </span>
          <span>{t("meals.recipe.writing")}</span>
        </div>
      )}
      <div className="mt-3.5 flex flex-col gap-3.5" aria-hidden="true">
        {SKELETON_WIDTHS.map((widths, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="size-6 flex-none rounded-full bg-muted-soft" />
            <span className="flex flex-1 flex-col gap-[7px] pt-1">
              {widths.map((w, j) => (
                <span key={j} className="h-2.5 animate-pulse rounded bg-muted-strong" style={{ width: `${w}%` }} />
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecipeSteps({ view, recipe, fresh }: { view: MealView; recipe: RecipeEntry; fresh: boolean }) {
  const t = useT();
  const enter = fresh ? "animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" : "";
  const batch = recipe.batch;
  const batchRows: Array<[string, string]> = batch
    ? [
        [t("meals.recipe.batchServings"), batchMakeLine(view.rows, batch)],
        [t("meals.recipe.batchPack"), batch.pack],
        [t("meals.recipe.batchKeep"), batch.keep],
        [t("meals.recipe.batchReheat"), batch.reheat],
      ]
    : [];
  return (
    <>
      <section className={cn(CARD, enter)}>
        <CardLabel>{t("meals.how")}</CardLabel>
        <ol className="m-0 mt-2 list-none p-0">
          {recipe.steps.map((step, i) => (
            <li
              key={i}
              className="flex gap-3 border-t border-border-subtle py-2.5 text-[15px] leading-[1.65] text-foreground first:border-t-0"
            >
              <span className="mt-px size-6 flex-none rounded-full border border-accent-line text-center text-[12px] leading-[22px] tabular-nums text-accent-line">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      </section>
      {batch && (
        <section className={cn(CARD, enter)}>
          <CardLabel>{t("meals.recipe.batch")}</CardLabel>
          <dl className="m-0 mt-2">
            {batchRows.map(([label, text]) => (
              <div
                key={label}
                className="flex gap-3 border-t border-border-subtle py-2 text-[14px] leading-relaxed text-foreground first:border-t-0"
              >
                <dt className="w-[3.5em] flex-none pt-px text-[13px] text-faint-foreground">{label}</dt>
                <dd className="m-0 min-w-0">{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

function RecipeBody({ view, request }: { view: MealView; request: ReturnType<typeof recipeRequest> }) {
  const t = useT();
  const { status, retry } = useRecipe(request);
  if (status.kind === "ready") return <RecipeSteps view={view} recipe={status.recipe} fresh={status.fresh} />;
  if (status.kind === "failed") {
    return (
      <section className={CARD}>
        <CardLabel>{t("meals.how")}</CardLabel>
        <p className="m-0 mt-2.5 text-[14px] leading-relaxed text-muted-foreground">{t("meals.recipe.failed")}</p>
        <div className="mt-3">
          <Button variant="outline" size="chip" onClick={retry}>
            {t("meals.recipe.retry")}
          </Button>
        </div>
      </section>
    );
  }
  return <StepsSkeleton writing={status.kind === "writing"} />;
}

export function MealsRecipe(props: MealsRecipeProps) {
  const locale = useLocale();
  const { state, photos, today, date, meal } = props;
  const day = state ? dayViewOn(state, date, today, hostRegion()) : null;
  const view = day?.meals.find((m) => m.key === meal) ?? null;
  const profile = state?.charter?.profile ?? null;
  const request = view && profile ? recipeRequest(view, profile, locale) : null;

  return (
    <MealsColumn>
      <MealsHeader title={view?.label ?? ""} weekday={weekdayName(date)} onBack={props.onBack} />
      {view && request ? (
        <div className="flex flex-col gap-4">
          <RecipeHead view={view} photos={photos} />
          <div className="flex flex-col gap-4">
            <RecipeBody view={view} request={request} />
          </div>
        </div>
      ) : (
        <div className="h-24" />
      )}
    </MealsColumn>
  );
}
