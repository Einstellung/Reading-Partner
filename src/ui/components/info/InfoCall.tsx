// The info call over the briefing / article (docs/16), on the call model (docs/03).
// It reuses the reader call's main-screen path (the top-bar AI button's
// "直接进主画面态,不经过气泡"): clicking "ask" opens the full chat window with the
// article/briefing shrunk to a corner position card. Tapping the card swaps
// (content main, chat becomes the corner pip); ✕ hangs up. No bubble, no
// auto-started take — the composer is ready and the user types.
//
// A shell can turn the corner cards off (the phone's does, docs/22): then the
// chat is the whole screen, there is no card to tap and no swapped layout to
// tap it into. call-layout.ts holds that rule.
//
// Every info thread runs the same agent loop with the shared companion tool set
// (docs/16/17): probe/trial/add_source plus update_profile, surfacing inline
// confirm cards. The anchors differ only in context (info/companion/anchors.ts):
// the briefing/article companion, or the onboarding add-source flow (the AI
// opens, and on the first source added a background first-briefing shows its
// progress/readiness as a card). update_profile drafts a profile change the user
// Applies; applying it offers a re-triage of today's cached items through the
// same progress card.
//
// Rendering and event binding only: the conversation, the briefing job and the
// card gestures are in use-info-call.ts.

import { Badge } from "../ui/badge";
import CallView from "../chat/CallView";
import ChatPipCard from "../chat/ChatPipCard";
import { callLayout } from "../chat/call-layout";
import ReadingPipCard from "../chat/ReadingPipCard";
import { useInfoCall } from "./use-info-call";
import type { ComposerVoice } from "../chat/chat";
import type { BriefingView } from "../../../info/briefing/reader";
import type { InfoCallAnchor } from "../../../info/companion/anchors";

export function InfoCall({
  anchor,
  dateKey,
  view,
  collecting,
  onHangUp,
  voice,
  onSourcesChanged,
  onOpenBriefing,
  pipCards = true,
}: {
  anchor: InfoCallAnchor;
  dateKey: string;
  // The briefing this chat talks about, and what can be done to it. On a
  // collector it is the running pipeline; on a reader it is the published files
  // and nothing is running (docs/36).
  view: BriefingView;
  // Whether this device is the one that collects. It decides which tools the
  // companion gets and what a request for a new briefing actually does: run one
  // here, or leave a note for the machine that can.
  collecting: boolean;
  onHangUp: () => void;
  voice?: ComposerVoice | false;
  // Called after the source list changes (add), so the host refreshes hasSources.
  onSourcesChanged?: () => void;
  // Clicking the briefing-ready card: open the briefing as the main screen.
  onOpenBriefing?: (date: string) => void;
  // Whether the call keeps its corner cards, and with them the swapped layout.
  // The shell decides — no shape is detected here. False on the phone (docs/22),
  // where the chat is a screen the reader pushed and pops with a back.
  pipCards?: boolean;
}) {
  const call = useInfoCall({
    anchor,
    dateKey,
    view,
    collecting,
    pipCards,
    onHangUp,
    onSourcesChanged,
    onOpenBriefing,
  });
  // Whether the reader has tapped the call out of the way. With no corner cards
  // there is no way to set it and no layout to set it to (call-layout.ts).
  const layout = callLayout(pipCards, call.swapped);
  const { position } = anchor;
  const lastMessage = call.messages.length ? call.messages[call.messages.length - 1].text : null;

  if (layout === "chat-pip") {
    return (
      <div className="absolute right-3 top-3 z-50">
        <ChatPipCard lastMessage={lastMessage} onClick={() => call.setSwapped(false)} onHangUp={onHangUp} />
      </div>
    );
  }

  return (
    <>
      <div className="absolute inset-0 z-40">
        <CallView
          messages={call.messages}
          onSend={call.send}
          onHangUp={onHangUp}
          streaming={call.streaming}
          onStop={call.stop}
          emptyTitle={anchor.emptyTitle}
          placeholder={anchor.placeholder}
          voice={voice}
          onCardAction={call.onCardAction}
          scalable={false}
        />
      </div>
      {pipCards && (
        <div className="absolute right-3 top-3 z-50">
          <ReadingPipCard
            title={position.title}
            badge={
              position.sourceName ? (
                <Badge className="shrink-0">{position.sourceName}</Badge>
              ) : undefined
            }
            body={
              position.line ? (
                <span className="line-clamp-3 text-[12px] leading-snug text-neutral-500">{position.line}</span>
              ) : undefined
            }
            onClick={() => call.setSwapped(true)}
          />
        </div>
      )}
    </>
  );
}
