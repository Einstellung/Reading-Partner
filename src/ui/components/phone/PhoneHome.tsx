// The phone home screen (docs/22): today's briefing on top, the articles kept
// out of it below. No Continue reading and no library link — the phone does not
// open books at all, so an entry point to them would only lead to a dead end.

import SettingsButton from "../common/SettingsButton";
import { BriefingCardBody, Card, CardLabel } from "../info/HomeCard";
import type { LaunchProps } from "../info/InfoHome";

export default function PhoneHome({
  launch,
  savedCount,
  onOpenSaved,
  settingsAlert,
}: {
  launch: LaunchProps;
  savedCount: number;
  onOpenSaved: () => void;
  settingsAlert: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[24px] font-semibold text-[#1b1b1b]">Reading Partner</h1>
          <p className="m-0 mt-1 text-[14px] text-[#999]">Today</p>
        </div>
        <SettingsButton alert={settingsAlert} onClick={launch.onOpenSettings} />
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <Card>
          <CardLabel>Today's briefing</CardLabel>
          <BriefingCardBody
            snap={launch.snap}
            configured={launch.configured}
            hasSources={launch.hasSources}
            onAsk={launch.onAsk}
            onStop={launch.onStop}
            onOpen={launch.onOpenBriefing}
            onOpenSettings={launch.onOpenSettings}
            onStartSubscribing={launch.onStartSubscribing}
          />
        </Card>

        <Card>
          <CardLabel>Saved</CardLabel>
          {savedCount > 0 ? (
            <button
              className="flex flex-1 flex-col justify-between text-left coarse:min-h-[44px]"
              onClick={onOpenSaved}
            >
              <p className="m-0 text-[15px] leading-relaxed text-[#2a2a2a]">
                Articles you kept, to read whenever.
              </p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[13px] text-[#888]">
                  {savedCount} article{savedCount === 1 ? "" : "s"}
                </span>
                <span className="text-[13px] font-medium text-primary">Open →</span>
              </div>
            </button>
          ) : (
            <p className="m-0 text-[14px] leading-relaxed text-[#777]">
              Nothing kept yet. Keep an article from the briefing and it waits here.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
