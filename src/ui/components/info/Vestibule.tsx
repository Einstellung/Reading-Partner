// The vestibule — the app's launch view (docs/16). A thin, calm hall in front of
// the library: two cards, Continue reading and Today's briefing, plus a way into
// the library. Not a dashboard; it holds the two things a session usually starts
// from. Tailwind-only, English copy. The card chrome and the briefing card's body
// are shared with the phone shell's home screen (HomeCard).

import type { InfoSnapshot } from "../../../info/briefing/pipeline";
import { BriefingCardBody, Card, CardLabel } from "./HomeCard";

export function Vestibule({
  continueBook,
  snap,
  configured,
  hasSources,
  onContinue,
  onOpenLibrary,
  onGenerate,
  onStop,
  onOpenBriefing,
  onOpenSettings,
  onStartSubscribing,
}: {
  continueBook: { title: string; topicName: string } | null;
  snap: InfoSnapshot | null;
  configured: boolean;
  hasSources: boolean | null;
  onContinue: () => void;
  onOpenLibrary: () => void;
  onGenerate: () => void;
  onStop: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-5 py-8 sm:px-6 sm:py-12">
      <h1 className="m-0 text-[26px] font-semibold text-[#1b1b1b]">Reading Partner</h1>
      <p className="mb-6 mt-1 text-[14px] text-[#999] sm:mb-9">Today</p>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Card>
          <CardLabel>Continue reading</CardLabel>
          {continueBook ? (
            <button className="flex flex-1 flex-col justify-between text-left" onClick={onContinue}>
              <div>
                <div className="text-[16px] font-medium leading-snug text-[#2a2a2a]">{continueBook.title}</div>
                <div className="mt-1 text-[13px] text-[#999]">{continueBook.topicName}</div>
              </div>
              <span className="mt-4 text-[13px] font-medium text-[#6d5ae0]">Resume →</span>
            </button>
          ) : (
            <div className="flex flex-1 flex-col justify-between">
              <p className="m-0 text-[14px] leading-relaxed text-[#777]">
                Nothing open yet. Add a book to a topic in the library.
              </p>
              <button
                className="mt-4 w-fit rounded-lg border border-[#dcdcdc] px-4 py-2 text-[14px] text-[#555] coarse:min-h-[44px] hover:bg-[#f4f4f4]"
                onClick={onOpenLibrary}
              >
                Go to library
              </button>
            </div>
          )}
        </Card>

        <Card>
          <CardLabel>Today's briefing</CardLabel>
          <BriefingCardBody
            snap={snap}
            configured={configured}
            hasSources={hasSources}
            onGenerate={onGenerate}
            onStop={onStop}
            onOpen={onOpenBriefing}
            onOpenSettings={onOpenSettings}
            onStartSubscribing={onStartSubscribing}
          />
        </Card>
      </div>

      <button
        className="mt-8 inline-flex w-fit items-center text-[14px] text-[#888] underline-offset-4 coarse:mt-5 coarse:min-h-[44px] hover:text-[#555] hover:underline"
        onClick={onOpenLibrary}
      >
        Library
      </button>
    </div>
  );
}
