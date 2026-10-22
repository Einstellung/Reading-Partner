// The study chrome's state in a reader (docs/info/91 「版本」「更新」): the open
// version and the current one, the update in flight, a version that landed,
// and the sheet a tapped section reference opens. The decisions are in
// info/issue/study-reader.ts; this binds them to the reader that hosts it, in
// either shell.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Fulltext } from "../../../../fulltext/types";
import { useT } from "../../../../i18n";
import { anchorOfHref, splitAnchor } from "../../../../info/issue/study-cites";
import {
  citeSheet,
  itemAtPage,
  landedAction,
  sameItemIn,
  studyStrip,
  versionItems,
  versionRows,
  type CiteSheet,
  type StudyStrip,
  type VersionRow,
} from "../../../../info/issue/study-reader";
import { setBookLinkTaker } from "../../../../reading/epub/reader-logic";
import { headingPage } from "../../../../reading/issue";
import { loadStudyReader, prepareStudyBook, readBookExcerpt, readMaterialBody, rollBackStudy, type StudyReaderData } from "./study-live";

/** How often the shelf, the record and the runs are read again while a study's book is open. */
const POLL_MS = 15_000;

/** Where a switch should land in the book it opens: the item's title, by book id. */
const landing = new Map<string, string>();

export interface StudyReaderHost {
  bookId: string;
  /** Only an issue can be a study's version. */
  isIssue: boolean;
  /** The view has drawn the book and can be moved. */
  ready: boolean;
  /** Open another book in this reader, in place of this one. */
  openBook(bookId: string, name: string): void;
  /** The page open, 1-based; null before the view reports. */
  page(): number | null;
  fulltext(): Promise<Fulltext | null>;
  /** Go to a page, 0-based. */
  goToPage(pageIndex: number): void;
  /** When the reader last turned or scrolled, epoch ms. */
  lastMovedAt(): number;
  toast(text: string): void;
}

export interface StudyReader {
  viewing: number;
  current: number;
  rows: VersionRow[];
  strip: StudyStrip;
  sheet: CiteSheet | null;
  closeSheet(): void;
  openVersion(n: number): void;
  rollBack(n: number): Promise<void>;
  viewCurrent(): void;
  switchToLanded(): void;
}

export function useStudyReader(host: StudyReaderHost): StudyReader | null {
  const t = useT();
  const [data, setData] = useState<StudyReaderData | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [sheet, setSheet] = useState<CiteSheet | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const dataRef = useRef<StudyReaderData | null>(null);
  dataRef.current = data;

  // The version `n`'s book, opened in place of this one, landing on the item the reader is on now.
  const switchTo = useCallback(
    async (n: number) => {
      const d = dataRef.current;
      const target = d?.ctx.versions.find((v) => v.n === n);
      if (!d || !target) return;
      const h = hostRef.current;
      if (d.result) {
        const items = versionItems(d.result, d.ctx.viewing.n);
        const text = await h.fulltext().catch(() => null);
        const here = itemAtPage(items, (title) => headingPage(text, title), h.page());
        const there = here ? sameItemIn(d.result, here.id, n) : null;
        if (there) landing.set(target.bookId, there.title);
      }
      const report = await prepareStudyBook(target.bookId).catch(() => null);
      if (report?.unmatched) h.toast(t("info.study.marksLeft", { count: report.unmatched, n: report.from }));
      h.openBook(target.bookId, `${d.ctx.issue.topics[0]?.name ?? ""} · ${t("info.study.versionButton", { n })}`);
    },
    [t],
  );

  // Read, then read again every so often; a newer version that lands while the
  // current one is open replaces it, or is offered when the reader is on the page.
  useEffect(() => {
    if (!host.isIssue) return;
    let alive = true;
    let newest: number | null = null;
    const read = async () => {
      const next = await loadStudyReader(host.bookId).catch(() => null);
      if (!alive) return;
      setData(next);
      if (!next) return;
      if (newest !== null && next.ctx.newest > newest) {
        const wasCurrent = next.ctx.viewing.n === newest;
        const action = landedAction({
          wasCurrent,
          hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
          lastMovedAt: hostRef.current.lastMovedAt(),
          now: Date.now(),
        });
        if (action === "switch") void switchTo(next.ctx.newest);
        else if (action === "chip") setLanded(next.ctx.newest);
      }
      newest = next.ctx.newest;
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [host.isIssue, host.bookId, switchTo]);

  // A switch asked to land on an item: go to its page once the view can move.
  useEffect(() => {
    if (!host.ready) return;
    const title = landing.get(host.bookId);
    if (!title) return;
    landing.delete(host.bookId);
    void hostRef.current.fulltext().then((text) => {
      const page = headingPage(text, title);
      if (page !== null) hostRef.current.goToPage(page - 1);
    });
  }, [host.ready, host.bookId]);

  // Section references open the sheet instead of going anywhere in the book.
  const isStudy = data !== null;
  useEffect(() => {
    if (!isStudy) return;
    return setBookLinkTaker((tap) => {
      const result = dataRef.current?.result;
      const anchor = anchorOfHref(tap.href);
      if (!result || !anchor) return false;
      const material = splitAnchor(anchor)?.material ?? "";
      setSheet(citeSheet(result, tap, null));
      // The book's own excerpt first; the run directory's cache only on the computer that ran the study.
      void (async () => {
        const body = (await readBookExcerpt(hostRef.current.bookId, anchor).catch(() => null)) ?? (await readMaterialBody(result, material));
        if (body) setSheet((was) => (was && was.anchor === anchor ? citeSheet(result, tap, body) : was));
      })();
      return true;
    });
  }, [isStudy]);

  const openVersion = useCallback((n: number) => void switchTo(n), [switchTo]);
  const viewCurrent = useCallback(() => {
    const d = dataRef.current;
    if (d) void switchTo(d.ctx.current);
  }, [switchTo]);
  const switchToLanded = useCallback(() => {
    if (landed !== null) void switchTo(landed);
    setLanded(null);
  }, [landed, switchTo]);
  const rollBack = useCallback(
    async (n: number) => {
      const d = dataRef.current;
      if (!d) return;
      await rollBackStudy(d.ctx.searchId, n);
      hostRef.current.toast(t("info.study.rolledBack", { n }));
      if (n !== d.ctx.viewing.n) await switchTo(n);
      else setData(await loadStudyReader(hostRef.current.bookId).catch(() => d));
    },
    [switchTo, t],
  );

  if (!data) return null;
  const { ctx } = data;
  return {
    viewing: ctx.viewing.n,
    current: ctx.current,
    rows: versionRows(ctx),
    strip: studyStrip({ viewing: ctx.viewing.n, current: ctx.current, updating: data.updating, landed }),
    sheet,
    closeSheet: () => setSheet(null),
    openVersion,
    rollBack,
    viewCurrent,
    switchToLanded,
  };
}
