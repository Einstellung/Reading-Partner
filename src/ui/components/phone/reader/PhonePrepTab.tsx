// The Prep tab (docs/82): what the AI prepared about this book, read as it
// synced. The chapter spines are made on the iPad or the desktop (docs/09);
// the phone runs no pipeline, so the tab only reads the files: the chapter
// graph, then each chapter's spine in reading order, the ones not made yet
// named and left empty.

import { useEffect, useState } from "react";
import { useT } from "../../../../i18n";
import {
  loadChapterSpineState,
  readChapterSpine,
  readSpineOverview,
  type ChapterSpineState,
} from "../../../../reading/prep/chapters";
import { Markdown } from "../../markdown/Markdown";

interface Prepared {
  state: ChapterSpineState | null;
  overview: string | null;
  bodies: Map<number, string | null>;
}

export default function PhonePrepTab(props: { bookId: string }) {
  const t = useT();
  const [prepared, setPrepared] = useState<Prepared | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    setPrepared("loading");
    void (async () => {
      try {
        const state = await loadChapterSpineState(props.bookId);
        const overviewShown = state?.overviewStatus === "done" || state?.overviewStatus === "stale";
        const overview = overviewShown ? await readSpineOverview(props.bookId) : null;
        const done = state?.chapters.filter((c) => c.status === "done") ?? [];
        const pairs = await Promise.all(
          done.map(async (c) => [c.index, await readChapterSpine(props.bookId, c.index)] as const),
        );
        if (!cancelled) setPrepared({ state, overview, bodies: new Map(pairs) });
      } catch (e) {
        console.warn("the prep files could not be read", e);
        if (!cancelled) setPrepared({ state: null, overview: null, bodies: new Map() });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.bookId]);

  if (prepared === "loading") {
    return <p className="m-0 px-4 py-6 text-[14px] text-faint-foreground">{t("phone.prep.loading")}</p>;
  }
  const { state, overview, bodies } = prepared;
  if (!state || state.chapters.length === 0) {
    return <p className="m-0 px-8 py-14 text-center text-[14px] leading-normal text-faint-foreground">{t("phone.prep.empty")}</p>;
  }
  const doneCount = state.chapters.filter((c) => c.status === "done").length;
  return (
    <div className="px-4 pt-3 pb-5 text-[14px] leading-normal text-muted-foreground">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-foreground">{t("phone.prep.title")}</span>
        <span className="text-[12px] text-faint-foreground [font-variant-numeric:tabular-nums]">
          {t("phone.prep.ready", { done: doneCount, total: state.chapters.length })}
        </span>
      </div>
      {overview && (
        <div className="mt-3.5 mb-1.5 rounded-lg bg-muted px-3 py-2.5">
          <h4 className="m-0 mb-1 text-[13px] font-semibold text-foreground">{t("phone.prep.graph")}</h4>
          <Markdown text={overview} />
        </div>
      )}
      {state.chapters.map((c) => {
        const body = bodies.get(c.index) ?? null;
        return (
          <section key={c.index} className="border-b border-border-subtle py-3 last:border-b-0">
            <h4 className="m-0 mb-1 text-[13px] font-semibold text-foreground">{c.title}</h4>
            {body ? <Markdown text={body} /> : <p className="m-0 text-[13px] text-faint-foreground">{t("phone.prep.notReady")}</p>}
          </section>
        );
      })}
    </div>
  );
}
