// The meals call (docs/73), on the call model (docs/03): Ask on a meals screen
// opens the full chat window with the screen shrunk to a corner position card.
// Tapping the card swaps (the screen main, the chat the corner pip); ✕ hangs
// up. A shell can turn the corner cards off (the phone's does, docs/22): then
// the chat is the whole screen. call-layout.ts holds that rule.
//
// Rendering and event binding only: the conversation and the card gestures are
// in use-meals-call.ts.

import CallView from "../chat/call/CallView";
import ChatPipCard from "../chat/call/ChatPipCard";
import { callLayout, INFO_CHAT_PIP_CORNER } from "../chat/call/call-layout";
import ReadingPipCard from "../chat/call/ReadingPipCard";
import { useMealsCall } from "./use-meals-call";
import type { ComposerVoice } from "../chat/composer-voice";
import { chatGlance } from "../chat/chatParts";
import type { MealsCallAnchor } from "../../../meals/conversation/anchor";

export function MealsCall({
  anchor,
  position,
  onHangUp,
  voice,
  onTopicsChanged,
  onMealsChanged,
  onOpenMeals,
  onMealsApplied,
  pipCards = true,
}: {
  anchor: MealsCallAnchor;
  // The corner position card drawn from the meals as last read (anchor.ts: mealsPosition).
  position: MealsCallAnchor["position"];
  onHangUp: () => void;
  voice?: ComposerVoice | false;
  // Called after a topic proposal is applied, so the host reloads the shelf.
  onTopicsChanged?: () => void;
  // The meals screen reloads after a plan lands or a deviation is recorded.
  onMealsChanged?: () => void;
  onOpenMeals?: (screen: "meals" | "meals-shopping") => void;
  // A meal plan was just applied: open its prep session's page, or the Meals page for null.
  onMealsApplied?: (session: string | null) => void;
  // Whether the call keeps its corner cards, and with them the swapped layout.
  // The shell decides; false on the phone (docs/22).
  pipCards?: boolean;
}) {
  const call = useMealsCall({ anchor, pipCards, onHangUp, onTopicsChanged, onMealsChanged, onOpenMeals, onMealsApplied });
  const layout = callLayout(pipCards, call.swapped);
  const lastMessage = chatGlance(call.messages);

  if (layout === "chat-pip") {
    return (
      <div className={INFO_CHAT_PIP_CORNER}>
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
          stickKey={call.stickKey}
        />
      </div>
      {pipCards && (
        <div className="absolute right-3 top-3 z-50">
          <ReadingPipCard
            title={position.title}
            badge={
              position.sourceName ? (
                <span className="shrink-0 text-[11px] text-faint-foreground">{position.sourceName}</span>
              ) : undefined
            }
            body={
              position.line ? (
                <span className="line-clamp-3 text-[12px] leading-snug text-faint-foreground">{position.line}</span>
              ) : undefined
            }
            onClick={() => call.setSwapped(true)}
          />
        </div>
      )}
    </>
  );
}
