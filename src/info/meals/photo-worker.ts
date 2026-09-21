// The meals-photos kind, as a legion worker (docs/55, docs/73 图片).
//
// A program worker — there is no model in it — on the `local` tier, needing a
// hidden webview: it opens one Bing Images page per query in it, reads the
// result anchors out of the page with a script and writes what it found into
// info-meals-photos.json. Nothing about the run reaches the synced folder; the
// photographs do, which is how the phone gets them.
//
// Written one at a time, as each lands, rather than in one write at the end: a
// run of twenty queries takes a couple of minutes and the reader is looking at
// the screen now. A run that dies halfway has still bought its first ten
// pictures.
//
// A page that does not come back stops the run. Bing refusing the app, or the
// machine being offline, is not a fact about the dish: the queries after it
// would all get the same nothing, and remembering "no photograph" for twenty
// names would take them off the screen for a month. They wait for the next run.

import { registerWorker, type WorkerContext, type WorkerHandle } from "../../legion/execute/worker";
import { writeRunOutput } from "../../legion/execute/outputs";
import { WEBVIEW_FETCH } from "../../legion/claim";
import { StoppedError } from "../../legion/stop";
import { appData } from "../../platform/app/appdata";
import { fetchPageViaWebview, type WebviewPage } from "../extract/webview-page";
import { BING_RESULTS_SCRIPT, bingImageQuery, parseBingImages, pickPhoto } from "./photo-search";
import { savePhotoEntries } from "./photo-store";
import { MEALS_PHOTOS_KIND, parsePhotoAsk, photoOutputLine, type PhotoQuery } from "./photo-run";
import type { DishPhotoEntry } from "./types";

export { MEALS_PHOTOS_KIND };

// A page load in a real browser, with its scripts. Longer than a fetch would
// need and shorter than the reader's patience for the whole week.
const PAGE_TIMEOUT_MS = 20_000;

// Between two searches. A second and a half is a person clicking, not a script
// scraping, and twenty of them is half a minute of waiting in total.
const BETWEEN_MS = 1_500;

/** Everything that reaches the host, so the worker itself is testable. */
export interface MealsPhotosWorkerDeps {
  /** The ask, read back off its path. */
  readAsk?: (path: string) => Promise<string>;
  /** One page in the hidden webview. */
  fetchPage?: (url: string, opts: { script?: string; timeoutMs?: number }) => Promise<WebviewPage>;
  /** Write what one search found. */
  savePhotos?: (entries: Record<string, DishPhotoEntry>) => Promise<unknown>;
  /** Where the run's one line is put, answering the path. */
  writeOutput?: (runId: string, text: string) => Promise<string>;
  now?: () => number;
  /** The pause between two searches. A test makes it nothing. */
  wait?: (ms: number) => Promise<void>;
}

/** The words of one query, for the progress line. */
function said(query: PhotoQuery): string {
  return query.q;
}

/** Build the worker legion runs for one meals-photos run. */
export function mealsPhotosWorker(deps: MealsPhotosWorkerDeps = {}) {
  const readAsk = deps.readAsk ?? ((path: string) => appData.readText(path));
  const fetchPage = deps.fetchPage ?? fetchPageViaWebview;
  const savePhotos = deps.savePhotos ?? ((entries: Record<string, DishPhotoEntry>) => savePhotoEntries(entries));
  const writeOutput = deps.writeOutput ?? writeRunOutput;
  const now = deps.now ?? (() => Date.now());
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return (brief: string, ctx: WorkerContext): WorkerHandle => {
    let cancelled = false;
    // Nothing in here takes a signal: a page load is the host's. So cancelling
    // is read between the queries, which is where the run can stop without
    // leaving a half-written cache behind.
    const stopped = () => {
      if (cancelled) throw new StoppedError();
    };
    const done = (async () => {
      const ask = parsePhotoAsk(await readAsk(brief));
      let found = 0;
      for (let i = 0; i < ask.queries.length; i++) {
        const query = ask.queries[i];
        if (!query) continue;
        stopped();
        if (i > 0) await wait(BETWEEN_MS);
        stopped();
        await ctx.report(`Looking for a photograph of ${said(query)} …`);
        const page = await fetchPage(bingImageQuery(query.q), {
          script: BING_RESULTS_SCRIPT,
          timeoutMs: PAGE_TIMEOUT_MS,
        });
        if (page.status !== "ok") {
          throw new Error(`the image search did not answer (${page.status})`);
        }
        const photo = pickPhoto(parseBingImages(page.result ?? page.html));
        const entry: DishPhotoEntry = photo
          ? {
              url: photo.url,
              thumb: photo.thumb,
              pageUrl: photo.pageUrl,
              site: photo.site,
              foundAt: now(),
            }
          : { none: true, checkedAt: now() };
        if (photo) found++;
        await savePhotos({ [query.key]: entry });
      }
      const line = photoOutputLine(found, ask.queries.length);
      const output = await writeOutput(ctx.run.id, line);
      return { output, progress: line };
    })();

    return {
      cancel: () => {
        cancelled = true;
      },
      done,
    };
  };
}

/**
 * Hand legion the meals-photos kind. Called once at startup; deps are for tests.
 *
 * `local`, so the run never reaches the synced folder, and `webview-fetch`,
 * which is what picks the machine: the phone has no hidden webview to search in
 * and would claim a run it cannot do. Not `delegable` — the ask is a plan and a
 * list of queries, which is not something the model could write as a brief; the
 * Apply and the refresh tool write it themselves.
 */
export function registerMealsPhotosWorker(deps: MealsPhotosWorkerDeps = {}): void {
  registerWorker({
    kind: MEALS_PHOTOS_KIND,
    tier: "local",
    requires: [WEBVIEW_FETCH],
    run: mealsPhotosWorker(deps),
  });
}
