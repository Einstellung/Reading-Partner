// The conversation a talk is coached in (docs/44): closing the panel lands here,
// and this is where the pass just given gets answered.
//
// The same chat this app has everywhere, with no second pane: what would go in
// one is the outline, and the outline is what the reader just gave — they have
// been looking at it for the length of the pass. Editing it is a sentence to the
// coach, not a form beside the conversation.
//
// Citations render as text here, as they do in a retell: there is no reader
// underneath and no page to jump to, so the subtree provides a null
// CitationContext.

import ChatScaleScope from "../base/ChatScaleScope";
import { Composer, MessageList } from "../chat/chat";
import { CitationContext } from "../markdown/Markdown";
import { IconClose } from "../base/icons";
import { Button } from "../ui/button";
import { useCoach } from "./useCoach";

export default function CoachView(props: {
  outlineId: string;
  topicName: string;
  backLabel: string;
  // Bumped when a pass has reached disk and been handed to the conversation.
  passKey?: number;
  // A pass is still being written: the reader has stopped, and the last of what
  // they said is coming back from the recogniser (docs/43 — stopping a segmented
  // source waits for every segment still uploading). Said out loud rather than
  // shown as an empty conversation, which would read as the coach having nothing.
  pending?: boolean;
  onBack(): void;
}) {
  const coach = useCoach(props.outlineId, props.topicName, props.passKey ?? 0);

  return (
    <CitationContext.Provider value={null}>
      <div className="absolute inset-0 flex flex-col bg-background">
        <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={props.backLabel}
            aria-label={props.backLabel}
            onClick={props.onBack}
            className="h-9 w-9 text-muted-foreground"
          >
            <IconClose size={18} />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1.5 py-1">
            <span className="truncate text-[15px] font-medium">
              {coach.outline?.name ?? "The talk"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              How that pass went
            </span>
          </div>
        </div>

        <ChatScaleScope className="flex min-h-0 flex-1 flex-col">
          {coach.error && (
            <p className="m-0 border-b border-border bg-muted/40 px-4 py-2 text-sm text-destructive">
              {coach.error}
            </p>
          )}
          {props.pending && !coach.streaming && (
            <p className="m-0 border-b border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
              Getting the last of what you said back from the recogniser…
            </p>
          )}
          {coach.loading ? (
            <p className="m-0 px-4 py-3 text-sm text-muted-foreground">Opening the talk…</p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
              <MessageList
                messages={coach.messages}
                size="lg"
                className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
              />
            </div>
          )}
          <div className="px-4 pb-6">
            <div className="mx-auto w-full max-w-[calc(48rem*var(--chat-scale,1))]">
              <Composer
                onSend={coach.send}
                placeholder="Ask about the pass, or say what to change…"
                pill
                streaming={coach.streaming}
                onStop={coach.stop}
              />
            </div>
          </div>
        </ChatScaleScope>
      </div>
    </CitationContext.Provider>
  );
}
