# Handoff: meals recipe page

Stopped near the tool-call budget. Code, tests, docs are committed on this branch; `scripts/t.sh` (rc 0, 7316 pass) and `bun run typecheck` (rc 0) pass.

## Done

- `src/info/meals/recipe/recipe.ts`: key, request, prompt, parse, cook-ahead amounts. `recipe-store.ts`: `info-meals-recipes.json`, records map under `recipes`, `saveRecipe` prunes (60 days, 150 entries). `recipe-live.ts`: one `callModel("chat", "plan", ...)`, `reportParse` site `meals-recipe`, in-flight dedupe per key.
- UI: `MealsRecipe.tsx` + `use-recipe.ts`; `MealsDay.tsx` cards clickable with the "Full recipe ›" hint; screen `meals-recipe` in shell-nav, nav-stack (`{kind, date, meal}`), PhoneApp, InfoHome. InfoHome draws the recipe as an overlay sibling over the still-mounted day page, so the day keeps its scroll.
- Registered: palace row `info-meals-recipes` (kinds.ts), layer `info/meals/recipe`, pull-coverage reason, ParseSite.
- i18n in all nine meals catalogs (`recipe.*` keys).
- docs/info/73 new section 做法页.
- Tests: `tests/info/meals/recipe/recipe.test.ts`.

## Left

- Headless visual check not finished. Harness is in the scratchpad (`.../scratchpad/recipe-agent/harness`, Vite on 127.0.0.1:5193 with a fake `recipe-live`; `shots.sh` takes headless Chrome screenshots). It failed to resolve `react/jsx-dev-runtime` from `src/` files when root is outside the repo; the fix is probably exact-file regex aliases, or put the harness root under the worktree (uncommitted). Not checked on the simulator either.
- No real model call has been made; prompt quality untested.
