// The phone home screen (docs/ui/22, docs/70): the Meals tile on top when the
// meals line is on, then the library as covers, with the book last opened on any
// device first, so the way back into a book is one tap from the screen the app
// opens on. The section ends in a row that opens the whole shelf. What is picked
// and in what order is in home-library.ts.


import { useT } from "../../../i18n";
import type { Topic } from "../../../platform/app/topics";
import PeerUpdateNotice from "../common/PeerUpdateNotice";
import SettingsButton from "../common/SettingsButton";
import { companionToggleTitle } from "../base/companion-toggle";
import { useCompanionName } from "../base/use-companion-name";
import type { EntryTileView } from "../../../meals/screen/batch-cook";
import CoverBand from "../shelf/CoverBand";
import {
  BOOK_AUTHOR,
  BOOK_LABEL,
  BOOK_PROGRESS,
  BOOK_PROGRESS_FILL,
  BOOK_READ,
  BOOK_TITLE,
  LIBRARY_CARD,
  LIBRARY_GRID,
  SECTION_LABEL,
} from "../shelf/cardStyles";
import { coverTiles, fileCountLabel, singleCoverTile } from "../shelf/topic-shelf";
import { cn } from "../lib/utils";
import { continueLine, homeTopics, libraryTotalsLine } from "./home-library";
import type { ContinueBook } from "./shelf-list";
import { useReadingProgress } from "./use-home-data";

// The home's cards carry no menu, so the label strip takes back the room
// BOOK_LABEL keeps for one.
const HOME_LABEL = cn(BOOK_LABEL, "pr-2.5");

// The row under a grid that opens the whole shelf, and the Meals tile.
const ALL_ROW =
  "mt-3 flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-card px-4 text-left active:bg-muted";
const TILE =
  "flex min-h-[132px] flex-col rounded-xl border border-border-soft bg-card px-4 py-3.5 text-left active:bg-muted";
const KICKER = "text-[11px] leading-[1.35] font-medium tracking-[0.08em] text-faint-foreground uppercase";
const TILE_MID = "flex flex-1 items-center py-1.5";
const TILE_FOOT = "text-[12px] leading-[1.35] text-faint-foreground";

export default function PhoneHome({
  topics,
  continueBook,
  onContinue,
  onOpenTopic,
  onOpenLibrary,
  onOpenSettings,
  settingsAlert,
  meals,
  onOpenMeals,
  mealsTile,
  onMealsTile,
  companionShown,
  onToggleCompanion,
  companionAvailable = true,
}: {
  // The topics, null while topics.json is being read.
  topics: Topic[] | null;
  // The book to continue, null when no EPUB has been opened yet, and undefined
  // while topics.json is being read.
  continueBook: ContinueBook | null | undefined;
  onContinue: (book: ContinueBook) => void;
  onOpenTopic: (topicId: string) => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  settingsAlert: boolean;
  // Whether the meals line is shown (the Meals experiment, docs/73). Off, and
  // the tile is not here at all.
  meals: boolean;
  onOpenMeals: () => void;
  // The Meals tile (meals/screen/batch-cook.ts): null while info-meals.json is
  // being read, and what a tap on it does (ui/components/meals/use-meals-host.ts).
  mealsTile?: EntryTileView | null;
  onMealsTile?: () => void;
  // The corner companion's switch (docs/68). The phone has no sidebar, so the
  // app's own name on the home screen is what carries it.
  companionShown: boolean;
  onToggleCompanion: () => void;
  // False while the companion experiment is off (platform/experiments): the
  // name is a heading and toggles nothing.
  companionAvailable?: boolean;
}) {
  const t = useT();
  const companionName = useCompanionName();
  const progress = useReadingProgress(continueBook?.file ?? null);


  const shownTopics = topics ? homeTopics(topics, continueBook ?? null) : [];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[24px] font-semibold text-foreground">
            {companionAvailable ? (
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
            ) : (
              "Reading Partner"
            )}
          </h1>
          <p className="m-0 mt-1 text-[14px] text-faint-foreground">{t("phone.home.today")}</p>
        </div>
        <SettingsButton alert={settingsAlert} onClick={onOpenSettings} />
      </div>

      <PeerUpdateNotice className="mt-4" />

      {meals && (
        <section className="mt-6">
          <div className="grid grid-cols-1 gap-3">
            {/* The batch cook's state (meals/screen/batch-cook.ts): plan one, the
                prep ahead, or the next meal; a tap goes where the state says. */}
            <button className={TILE} onClick={onMealsTile ?? onOpenMeals}>
              <span className={KICKER}>{t("phone.home.mealsLabel")}</span>
              <span className={TILE_MID}>
                {mealsTile ? (
                  <span className="line-clamp-2 font-serif text-[19px] leading-tight text-foreground">{mealsTile.mid}</span>
                ) : (
                  <span className="block h-[24px] w-20 animate-pulse rounded-md bg-muted" aria-hidden="true" />
                )}
              </span>
              <span className={TILE_FOOT}>{mealsTile?.foot ?? ""}</span>
            </button>
          </div>
        </section>
      )}


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
