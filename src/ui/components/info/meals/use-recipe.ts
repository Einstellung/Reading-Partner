// The recipe page's steps (docs/73 做法页): the stored recipe when there is
// one, else the call that writes it. Only this state changes while the page is
// open, so only the steps area redraws when the call lands.

import { useCallback, useEffect, useRef, useState } from "react";

import type { RecipeEntry, RecipeRequest } from "../../../../info/meals/recipe/recipe";
import { storedRecipe, writeRecipeOnce } from "../../../../info/meals/recipe/recipe-live";

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
