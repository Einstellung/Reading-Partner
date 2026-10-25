// The recipe page's steps (docs/73 做法页): the stored recipe, which the
// background sweep has usually written already, else the call that writes it
// (the sweep's own when it is on this meal). Only this state changes while the
// page is open, so only the steps area redraws when the call lands.

import { useCallback, useEffect, useRef, useState } from "react";

import { useLocale, type Locale } from "../../../../i18n";
import type { RecipeEntry, RecipeRequest } from "../../../../info/meals/recipe/recipe";
import { recipeLanguageNow, storedRecipe, writeRecipeOnce } from "../../../../info/meals/recipe/recipe-live";

/**
 * The language the recipe is asked in, read from the answer-language setting
 * rather than taken from the UI locale, which is the default until the shell
 * has read the setting. Null until read. Read again whenever the UI locale
 * moves, since that is when the setting changed; a failed read falls back to
 * the UI locale.
 */
export function useRecipeLanguage(): Locale | null {
  const ui = useLocale();
  const [language, setLanguage] = useState<Locale | null>(null);
  useEffect(() => {
    let live = true;
    recipeLanguageNow().then(
      (l) => live && setLanguage(l),
      () => live && setLanguage(ui),
    );
    return () => {
      live = false;
    };
  }, [ui]);
  return language;
}

export type RecipeStatus =
  | { kind: "reading" }
  | { kind: "writing" }
  // `fresh` when it was written while the page was watching, so it fades in.
  | { kind: "ready"; recipe: RecipeEntry; fresh: boolean }
  | { kind: "failed" };

export function useRecipe(request: RecipeRequest | null): { status: RecipeStatus; retry: () => void } {
  const [status, setStatus] = useState<RecipeStatus>({ kind: "reading" });
  const [attempt, setAttempt] = useState(0);
  // The latest request, read when the key changes: the object is rebuilt on
  // every render of the page, the key only when the meal does.
  const latest = useRef(request);
  latest.current = request;
  const key = request?.key ?? null;

  useEffect(() => {
    const req = latest.current;
    if (!req) return;
    let live = true;
    setStatus({ kind: "reading" });
    void (async () => {
      try {
        const stored = await storedRecipe(req);
        if (!live) return;
        if (stored) {
          setStatus({ kind: "ready", recipe: stored, fresh: false });
          return;
        }
        setStatus({ kind: "writing" });
        const recipe = await writeRecipeOnce(req);
        if (live) setStatus({ kind: "ready", recipe, fresh: true });
      } catch {
        if (live) setStatus({ kind: "failed" });
      }
    })();
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, retry };
}
