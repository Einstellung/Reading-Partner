// A study's brief in the reader (docs/info/91 「版本」): the version button for
// the top bar with its list, the strip at the top of the book, and the sheet a
// tapped section reference opens. Rendering and event binding only; the state is
// use-study-reader.ts.

import { useState } from "react";
import { useT } from "../../../../i18n";
import { openExternal } from "../../../../platform/app/external-link";
import { useCompanionName } from "../../base/use-companion-name";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "../../ui/dialog";
import type { StudyReader } from "./use-study-reader";

function timeOf(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** 「Version 2 ▾」 in the top bar, and the version list it opens. */
export function StudyVersionButton({ study, className }: { study: StudyReader; className?: string }) {
  const t = useT();
  const name = useCompanionName();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const close = () => {
    setOpen(false);
    setAsking(null);
  };
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-8 flex-none items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[12.5px] whitespace-nowrap text-foreground coarse:h-11",
          className,
        )}
        onClick={() => setOpen(true)}
      >
        {t("info.study.versionButton", { n: study.viewing })}
        <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogSheetContent className="max-h-[80vh] overflow-y-auto">
          <DialogTitle className="text-[17px] font-semibold">{t("info.study.versionsTitle")}</DialogTitle>
          <p className="mb-1.5 text-[12.5px] leading-normal text-faint-foreground">{t("info.study.versionsSub")}</p>
          {study.rows.map((row) => (
            <div key={row.n} className="flex flex-col gap-1.5 border-t border-border-subtle py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <b className="text-[15px]">{t("info.study.versionButton", { n: row.n })}</b>
                <span className="text-[12px] text-faint-foreground [font-variant-numeric:tabular-nums]">{timeOf(row.at)}</span>
                {row.current && (
                  <span className="rounded border border-yes-border bg-yes-bg px-1.5 text-[11px] font-bold text-accent-line">
                    {t("info.study.current")}
                  </span>
                )}
                {row.viewing && !row.current && <span className="text-[11px] text-muted-foreground">{t("info.study.viewing")}</span>}
              </div>
              {row.line && <div className="text-[13px] leading-snug text-muted-foreground">{row.line}</div>}
              {asking === row.n ? (
                <>
                  <div className="rounded-lg border border-edge-border bg-edge-bg px-2.5 py-2 text-[13px] leading-normal">
                    {t("info.study.rollBackConfirm", { n: row.n, name })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="ghost" size="chip" onClick={() => setAsking(null)}>
                      {t("info.study.cancel")}
                    </Button>
                    <Button
                      size="chip"
                      onClick={() => {
                        close();
                        void study.rollBack(row.n);
                      }}
                    >
                      {t("info.study.rollBackGo", { n: row.n })}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {row.canOpen && (
                    <Button
                      variant="subtle"
                      size="chip"
                      onClick={() => {
                        close();
                        study.openVersion(row.n);
                      }}
                    >
                      {t("info.study.open")}
                    </Button>
                  )}
                  {row.canRollBack && (
                    <Button variant="subtle" size="chip" onClick={() => setAsking(row.n)}>
                      {t("info.study.rollBack")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </DialogSheetContent>
      </Dialog>
    </>
  );
}

/** The strip at the top of the book: an older version open, an update running, or a new version ready. */
export function StudyStripBar({ study, className }: { study: StudyReader; className?: string }) {
  const t = useT();
  const strip = study.strip;
  if (!strip) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 border-b border-border bg-secondary-faint px-3.5 py-1.5 text-[12.5px] leading-snug text-muted-foreground",
        className,
      )}
    >
      {strip.kind === "updating" && (
        <span aria-hidden className="size-3 flex-none animate-spin rounded-full border-2 border-muted-strong border-t-accent-line motion-reduce:animate-none" />
      )}
      <span className="min-w-0 flex-1">
        {strip.kind === "old"
          ? t("info.study.stripOld", { n: strip.viewing, current: strip.current })
          : strip.kind === "updating"
            ? t("info.study.stripUpdating", { to: strip.to, n: strip.viewing })
            : t("info.study.stripLanded", { n: strip.n })}
      </span>
      {strip.kind === "old" && (
        <Button variant="subtle" size="chip" onClick={study.viewCurrent}>
          {t("info.study.viewCurrent")}
        </Button>
      )}
      {strip.kind === "landed" && (
        <Button variant="subtle" size="chip" onClick={study.switchToLanded}>
          {t("info.study.switch")}
        </Button>
      )}
    </div>
  );
}

/** The section a tapped reference stands on: the original's words, and what the brief says of them. */
export function StudyCiteSheet({ study }: { study: StudyReader }) {
  const t = useT();
  const sheet = study.sheet;
  return (
    <Dialog open={sheet !== null} onOpenChange={(o) => !o && study.closeSheet()}>
      <DialogSheetContent className="max-h-[80vh] overflow-y-auto">
        {sheet && (
          <>
            <div className="text-[11px] font-semibold tracking-[.08em] text-accent-line">
              {t("info.study.citeKicker", { label: sheet.heading ?? sheet.label })}
            </div>
            <DialogTitle className="mt-1 mb-2.5 font-display text-[17px] leading-snug font-medium">{sheet.title ?? sheet.anchor}</DialogTitle>
            {sheet.quote && (
              <blockquote lang="en" className="mb-2.5 rounded-r-md border-l-3 border-accent-line bg-secondary-faint px-3 py-2 font-display text-[15px] leading-normal">
                {sheet.quote}
              </blockquote>
            )}
            {sheet.excerpt
              .filter((p) => !sheet.quote || sheet.excerptBy !== "quote" || p !== sheet.quote)
              .map((p, i) => (
                <p key={i} lang="en" className="mb-2 text-[14px] leading-relaxed text-foreground">
                  {p}
                </p>
              ))}
            {sheet.excerpt.length === 0 && <p className="mb-2 text-[12.5px] text-faint-foreground">{t("info.study.citeNoText")}</p>}
            {sheet.gist && (
              <p className="mt-2 text-[14px] leading-relaxed">
                <span className="mr-1.5 text-[11px] font-bold tracking-[.04em] text-faint-foreground">{t("info.study.citeGist")}</span>
                {sheet.gist}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-1.5">
              {sheet.url && (
                <Button variant="subtle" size="chip" onClick={() => openExternal(sheet.url!)}>
                  {t("info.study.citeOpen")}
                </Button>
              )}
              <Button variant="ghost" size="chip" onClick={study.closeSheet}>
                {t("info.study.close")}
              </Button>
            </div>
          </>
        )}
      </DialogSheetContent>
    </Dialog>
  );
}
