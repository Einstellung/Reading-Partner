// The phone home screen (docs/22, docs/70): today's briefing on top, the
// articles kept out of it, and the library. The library card carries the book
// last opened on any device, so the way back into a book is one tap from the
// screen the app opens on.

import PeerUpdateNotice from "../common/PeerUpdateNotice";
import SettingsButton from "../common/SettingsButton";
import type { ContinueBook } from "./shelf-list";
import { lumenToggleTitle } from "../lumen/corner-pref";
import { BriefingCardBody, Card, CardBodyPlaceholder, CardLabel } from "../info/HomeCard";
import type { LaunchProps } from "../info/InfoHome";

export default function PhoneHome({
  launch,
  savedCount,
  onOpenSaved,
  continueBook,
  onContinue,
  onOpenLibrary,
  settingsAlert,
  meals,
  onOpenMeals,
  lumenShown,
  onToggleLumen,
}: {
  launch: LaunchProps;
  // How many articles are kept, or null while saved-articles.json is being read.
  savedCount: number | null;
  onOpenSaved: () => void;
  // The book to continue, null when no EPUB has been opened yet, and undefined
  // while topics.json is being read.
  continueBook: ContinueBook | null | undefined;
  onContinue: (book: ContinueBook) => void;
  onOpenLibrary: () => void;
  settingsAlert: boolean;
  // Whether the meals line is switched on (settings.meals, docs/73). Off, and
  // the row is not here at all.
  meals: boolean;
  onOpenMeals: () => void;
  // The corner companion's switch (docs/68). The phone has no sidebar, so the
  // app's own name on the home screen is what carries it.
  lumenShown: boolean;
  onToggleLumen: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[24px] font-semibold text-foreground">
            <button
              type="button"
              className="bg-transparent p-0 text-left font-display text-[24px] font-semibold text-foreground"
              title={lumenToggleTitle(lumenShown)}
              aria-label={lumenToggleTitle(lumenShown)}
              aria-pressed={lumenShown}
              onClick={onToggleLumen}
            >
              Reading Partner
            </button>
          </h1>
          <p className="m-0 mt-1 text-[14px] text-faint-foreground">Today</p>
        </div>
        <SettingsButton alert={settingsAlert} onClick={launch.onOpenSettings} />
      </div>

      <PeerUpdateNotice className="mt-4" />

      <div className="mt-5 flex flex-col gap-4">
        <Card>
          <CardLabel>Today's briefing</CardLabel>
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

        {/* Under the briefing, above what is kept: it is the other thing the
            day needs deciding, and it is decided in the evening. */}
        {meals && (
          <Card>
            <CardLabel>Meals</CardLabel>
            <button
              className="flex flex-1 flex-col justify-between text-left coarse:min-h-[44px]"
              onClick={onOpenMeals}
            >
              <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
                This week's breakfasts, lunches and dinners, and what to buy.
              </p>
              <div className="mt-4 flex items-center justify-end">
                <span className="text-[13px] font-medium text-accent-line">Open →</span>
              </div>
            </button>
          </Card>
        )}

        <Card>
          <CardLabel>Saved</CardLabel>
          {savedCount === null ? (
            <CardBodyPlaceholder />
          ) : savedCount > 0 ? (
            <button
              className="flex flex-1 flex-col justify-between text-left coarse:min-h-[44px]"
              onClick={onOpenSaved}
            >
              <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
                Articles you kept, to read whenever.
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[13px] text-faint-foreground">
                  {savedCount} article{savedCount === 1 ? "" : "s"}
                </span>
                <span className="text-[13px] font-medium text-accent-line">Open →</span>
              </div>
            </button>
          ) : (
            <p className="m-0 text-[14px] leading-relaxed text-faint-foreground">
              Nothing kept yet. Keep an article from the briefing and it waits here.
            </p>
          )}
        </Card>

        <Card>
          <CardLabel>Library</CardLabel>
          {continueBook === undefined ? (
            <CardBodyPlaceholder />
          ) : (
            <div className="flex flex-1 flex-col justify-between">
              {continueBook ? (
                <button
                  className="text-left coarse:min-h-[44px]"
                  onClick={() => onContinue(continueBook)}
                >
                  <p className="m-0 truncate text-[15px] leading-relaxed text-foreground">
                    {continueBook.title}
                  </p>
                  <p className="m-0 mt-0.5 text-[13px] text-faint-foreground">
                    Continue reading · {continueBook.topicName}
                  </p>
                </button>
              ) : (
                <p className="m-0 text-[15px] leading-relaxed text-muted-foreground">
                  Your topics and the books filed under them.
                </p>
              )}
              <button
                className="mt-4 flex items-center justify-between coarse:min-h-[44px]"
                onClick={onOpenLibrary}
              >
                <span className="text-[13px] text-faint-foreground">All topics</span>
                <span className="text-[13px] font-medium text-accent-line">Open →</span>
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
