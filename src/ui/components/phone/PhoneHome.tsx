// The phone home screen (docs/ui/22, docs/70): covers, as the shelves draw
// them. Intel on top — the info books last read, unread issues first — then
// meals and the kept articles as two small tiles, then the library with the
// book last opened on any device first, so the way back into a book is one tap
// from the screen the app opens on. Each section ends in a row that opens the
// whole shelf. What is picked and in what order is in home-intel.ts and
// home-library.ts.

import type { ReactNode } from "react";
import { useT } from "../../../i18n";
import type { Topic } from "../../../platform/app/topics";
import PeerUpdateNotice from "../common/PeerUpdateNotice";
import SettingsButton from "../common/SettingsButton";
import { companionToggleTitle } from "../base/companion-toggle";
import { useCompanionName } from "../base/use-companion-name";
import { BriefingCardBody, Card, CardLabel } from "../info/HomeCard";
import type { LaunchProps } from "../info/InfoHome";
import { OLD_BRIEFING_UI_ENABLED } from "../../../info/old-briefing";
import CoverBand from "../shelf/CoverBand";
import {
  BOOK_AUTHOR,
  BOOK_LABEL,
  BOOK_PROGRESS,
  BOOK_PROGRESS_FILL,
  BOOK_READ,
  BOOK_READ_ROW,
  BOOK_TITLE,
  LIBRARY_CARD,
  LIBRARY_GRID,
  NEW_BADGE,
  SECTION_LABEL,
} from "../shelf/cardStyles";
import { coverTiles, fileCountLabel, singleCoverTile } from "../shelf/topic-shelf";
import { cn } from "../lib/utils";
import { intelFile, intelLabel, intelTotalsLine, volumeFallbackCover, type IntelItem } from "./home-intel";
import { continueLine, homeTopics, libraryTotalsLine } from "./home-library";
import type { ContinueBook } from "./shelf-list";
import { useReadingProgress, type HomeIntel } from "./use-home-data";

// The home's cards carry no menu, so the label strip takes back the room
// BOOK_LABEL keeps for one.
const HOME_LABEL = cn(BOOK_LABEL, "pr-2.5");

// The row under a grid that opens the whole shelf, and the two small tiles.
const ALL_ROW =
  "mt-3 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-card px-4 text-left active:bg-muted";
const TILE =
  "flex min-h-[132px] flex-col rounded-xl border border-border-soft bg-card px-4 py-3.5 text-left active:bg-muted";
const KICKER = "text-[11px] leading-[1.35] font-medium tracking-[0.08em] text-faint-foreground uppercase";
const TILE_MID = "flex flex-1 items-center py-1.5";
const TILE_FOOT = "text-[12px] leading-[1.35] text-faint-foreground";

export default function PhoneHome({
  launch,
  intel,
  onOpenIntel,
  savedCount,
  onOpenSaved,
  onOpenBriefs,
  topics,
  continueBook,
  onContinue,
  onOpenTopic,
  onOpenLibrary,
  settingsAlert,
  meals,
  onOpenMeals,
  companionShown,
  onToggleCompanion,
  oldBriefing = OLD_BRIEFING_UI_ENABLED,
}: {
  launch: LaunchProps;
  // The Intel covers, or null while the info shelf is being read.
  intel: HomeIntel | null;
  onOpenIntel: (item: IntelItem) => void;
  // How many articles are kept, or null while saved-articles.json is being read.
  savedCount: number | null;
  onOpenSaved: () => void;
  // The info shelf: the brief's issues and the topic volumes (docs/info/88).
  onOpenBriefs: () => void;
  // The topics, null while topics.json is being read.
  topics: Topic[] | null;
  // The book to continue, null when no EPUB has been opened yet, and undefined
  // while topics.json is being read.
  continueBook: ContinueBook | null | undefined;
  onContinue: (book: ContinueBook) => void;
  onOpenTopic: (topicId: string) => void;
  onOpenLibrary: () => void;
  settingsAlert: boolean;
  // Whether the meals line is switched on (settings.meals, docs/73). Off, and
  // the tile is not here at all.
  meals: boolean;
  onOpenMeals: () => void;
  // The corner companion's switch (docs/68). The phone has no sidebar, so the
  // app's own name on the home screen is what carries it.
  companionShown: boolean;
  onToggleCompanion: () => void;
  // Whether the day's briefing card is drawn (info/old-briefing.ts). On, it is
  // on top and the kept articles always have their tile; off, the kept
  // articles show only once there are some: keeping one was the briefing's, so
  // an empty tile would point at a way in that is not there.
  oldBriefing?: boolean;
}) {
  const t = useT();
  const companionName = useCompanionName();
  const progress = useReadingProgress(continueBook?.file ?? null);

  const tiles: ReactNode[] = [];
  if (meals) {
    tiles.push(
      <button key="meals" className={TILE} onClick={onOpenMeals}>
        <span className={KICKER}>{t("phone.home.mealsLabel")}</span>
        <span className={TILE_MID}>
          <span className="font-serif text-[19px] leading-tight text-foreground">{t("phone.home.mealsWeek")}</span>
        </span>
        <span className={TILE_FOOT}>{t("phone.home.mealsFoot")}</span>
      </button>,
    );
  }
  if (oldBriefing || (savedCount ?? 0) > 0) {
    tiles.push(
      savedCount !== null && savedCount === 0 ? (
        <div key="saved" className={TILE}>
          <span className={KICKER}>{t("phone.home.savedLabel")}</span>
          <span className={cn(TILE_MID, "text-[13px] leading-snug text-faint-foreground")}>
            {t("phone.home.savedEmpty")}
          </span>
        </div>
      ) : (
        <button key="saved" className={TILE} disabled={savedCount === null} onClick={onOpenSaved}>
          <span className={KICKER}>{t("phone.home.savedLabel")}</span>
          <span className={TILE_MID}>
            {savedCount === null ? (
              <span className="block h-[30px] w-10 animate-pulse rounded-md bg-muted" aria-hidden="true" />
            ) : (
              <span className="font-serif text-[30px] leading-tight text-foreground">{savedCount}</span>
            )}
          </span>
          <span className={TILE_FOOT}>{t("phone.home.savedFoot", { count: savedCount ?? 0 })}</span>
        </button>
      ),
    );
  }

  const shownTopics = topics ? homeTopics(topics, continueBook ?? null) : [];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[24px] font-semibold text-foreground">
            <button
              type="button"
              className="bg-transparent p-0 text-left font-display text-[24px] font-semibold text-foreground"
              title={companionToggleTitle(companionShown, companionName)}
              aria-label={companionToggleTitle(companionShown, companionName)}
              aria-pressed={companionShown}
              onClick={onToggleCompanion}
            >
              Reading Partner
            </button>
          </h1>
          <p className="m-0 mt-1 text-[14px] text-faint-foreground">{t("phone.home.today")}</p>
        </div>
        <SettingsButton alert={settingsAlert} onClick={launch.onOpenSettings} />
      </div>

      <PeerUpdateNotice className="mt-4" />

      {oldBriefing && (
        <div className="mt-5 flex flex-col">
          <Card>
            <CardLabel>{t("phone.home.briefingLabel")}</CardLabel>
            <BriefingCardBody
              snap={launch.snap}
              ready={launch.ready}
              configured={launch.configured}
              hasSources={launch.hasSources}
              noLabs={launch.noLabs}
              collecting={launch.collecting}
              notices={launch.notices}
              onAsk={launch.onAsk}
              onStop={launch.onStop}
              onOpen={launch.onOpenBriefing}
              onOpenSettings={launch.onOpenSettings}
              onStartSubscribing={launch.onStartSubscribing}
            />
          </Card>
        </div>
      )}

      <section className="mt-6">
        <h2 className={SECTION_LABEL}>{t("phone.home.intelLabel")}</h2>
        {intel === null ? (
          <CoverSkeleton />
        ) : intel.items.length === 0 ? (
          <>
            <ul className={cn(LIBRARY_GRID, "grid-cols-2")}>
              <li className="min-w-0">
                <CoverBand tiles={[]} />
              </li>
            </ul>
            <p className="m-0 mt-2 text-[14px] leading-relaxed text-faint-foreground">
              {t("phone.home.intelEmpty", { name: companionName })}
            </p>
          </>
        ) : (
          <>
            <ul className={cn(LIBRARY_GRID, "grid-cols-2")}>
              {intel.items.map((item) => {
                const label = intelLabel(item);
                return (
                  <li key={`${item.kind}:${item.card.bookId}`} className="min-w-0">
                    <button className={LIBRARY_CARD} onClick={() => onOpenIntel(item)}>
                      <CoverBand
                        tiles={singleCoverTile(intelFile(item, intel.library))}
                        fallback={item.kind === "volume" ? volumeFallbackCover(item.card) : null}
                      />
                      <span className={HOME_LABEL}>
                        <span className={BOOK_TITLE}>{label.title}</span>
                        <span className={cn(BOOK_AUTHOR, label.accent && "text-accent-line")}>{label.line}</span>
                        <span className={cn(BOOK_READ_ROW, "justify-between")}>
                          <span className="truncate">{label.meta}</span>
                          {label.isNew && <span className={NEW_BADGE}>{t("info.shelf.new")}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <AllRow name={t("phone.home.allIntel")} count={intelTotalsLine(intel.totals)} onClick={onOpenBriefs} />
          </>
        )}
        {tiles.length > 0 && (
          <div className={cn("mt-4 grid gap-3", tiles.length === 2 ? "grid-cols-2" : "grid-cols-1")}>{tiles}</div>
        )}
      </section>

      <section className="mt-7">
        <h2 className={SECTION_LABEL}>{t("phone.home.libraryLabel")}</h2>
        {continueBook === undefined || topics === null ? (
          <CoverSkeleton />
        ) : !continueBook && shownTopics.length === 0 ? (
          <>
            <p className="m-0 text-[14px] leading-relaxed text-faint-foreground">{t("phone.home.libraryBlurb")}</p>
            <AllRow name={t("phone.home.allTopics")} count={libraryTotalsLine(topics)} onClick={onOpenLibrary} />
          </>
        ) : (
          <>
            <ul className={cn(LIBRARY_GRID, "grid-cols-2")}>
              {continueBook && (
                <li className="min-w-0">
                  <button className={LIBRARY_CARD} onClick={() => onContinue(continueBook)}>
                    <CoverBand tiles={singleCoverTile(continueBook.file)} />
                    <span className={HOME_LABEL}>
                      <span className={BOOK_TITLE}>{continueBook.title}</span>
                      <span className={BOOK_AUTHOR}>{continueBook.topicName}</span>
                      <span className={BOOK_READ}>{continueLine(progress)}</span>
                      <span className={BOOK_PROGRESS}>
                        <span className={BOOK_PROGRESS_FILL} style={{ width: `${(progress ?? 0) * 100}%` }} />
                      </span>
                    </span>
                  </button>
                </li>
              )}
              {shownTopics.map((topic) => (
                <li key={topic.id} className="min-w-0">
                  <button className={LIBRARY_CARD} onClick={() => onOpenTopic(topic.id)}>
                    <CoverBand tiles={coverTiles(topic)} />
                    <span className={HOME_LABEL}>
                      <span className={BOOK_TITLE}>{topic.name}</span>
                      <span className={BOOK_AUTHOR}>{fileCountLabel(topic.files.length)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <AllRow name={t("phone.home.allTopics")} count={libraryTotalsLine(topics)} onClick={onOpenLibrary} />
          </>
        )}
      </section>
    </div>
  );
}

// What a section shows while its books are being read: four card shapes.
function CoverSkeleton() {
  return (
    <div className={cn(LIBRARY_GRID, "grid-cols-2")} aria-hidden="true" data-placeholder="covers">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="block aspect-[3/5.1] animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function AllRow(props: { name: string; count: string; onClick: () => void }) {
  return (
    <button className={ALL_ROW} onClick={props.onClick}>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-foreground">{props.name}</span>
        <span className="mt-px block truncate text-[12px] text-faint-foreground">{props.count}</span>
      </span>
      <span className="flex-none text-[20px] leading-none text-accent-line" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
