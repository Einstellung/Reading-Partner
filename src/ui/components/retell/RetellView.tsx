// One retell, opened (docs/31, "界面"): the conversation, and nothing beside it.
// The retell's product is the talk note (docs/44), which is read and corrected
// by talking, so there is no second column here to keep in step with it.
//
// It replaces the topic's sections while it is open, the way the saved-article
// reader does, so entering a retell needs no route and leaving it puts the topic
// back exactly as it was. There is no reader under it and no engine running —
// the materials come off disk (reading/retell/material.ts).
//
// Citations render as text here. [p.12] can be clicked in the reader because
// there is a page to jump to; there is none here, and a chip that answers a tap
// with nothing is worse than the plain text it was made from — so this subtree
// provides a null CitationContext, which is what makes the markdown renderer
// leave them alone.
//
// Figures are the exception, and for the same reason. A [fig:N] is a picture,
// not a way back to a page: the card can be drawn from the materials' figure
// indexes and the crop taken with pdf.js, so MaterialFigureScope wraps the
// subtree and a tap opens the figure over this view instead of navigating.
// RehearsalView and CoachView mount inside here and take the scope from it.
//
// The conversation column is a ChatScaleScope, on the same value as the reader's
// call window.

import { useState } from "react";
import ChatScaleScope from "../base/ChatScaleScope";
import { CitationContext } from "../markdown/Markdown";
import { IconClose } from "../base/icons";
import { Composer, MessageList } from "../chat/chat";
import MaterialFigureScope from "../common/MaterialFigureScope";
import NameDialog from "../common/NameDialog";
import { Button } from "../ui/button";
import { rehearsalForRetell, type Rehearsal } from "../../../reading/rehearsal";
import type { Retell } from "../../../reading/retell";
import CoachView from "../rehearsal/CoachView";
import RehearsalView from "../rehearsal/RehearsalView";
import { rehearsalReadiness } from "../rehearsal/rehearsal";
import { openTranscriptSource } from "../rehearsal/start";
import { useRetellOutline } from "../rehearsal/useRehearsal";
import { useRetell } from "./useRetell";

// The line under the retell's name: what it is being prepared from.
export function materialsLine(retell: Retell | null): string {
  if (!retell || retell.materials.length === 0) return "";
  if (retell.materials.length === 1) return retell.materials[0].title;
  return `${retell.materials.length} materials`;
}

export default function RetellView(props: {
  retellId: string;
  topicName: string;
  onBack(): void;
}) {
  const retell = useRetell(props.retellId, props.topicName);
  const [renaming, setRenaming] = useState(false);

  // Giving the retell covers this view rather than replacing it: no route, and
  // leaving it puts the retell back exactly as it was. Covering rather than
  // swapping is not cosmetic — unmounting the conversation is what distils it
  // (useRetell's cleanup), and stepping over to a pass for ten minutes is not
  // leaving the retell.
  //
  // What is being given is a rehearsal object (docs/43), found or made by the
  // press: the topic's Rehearsal section opens the same object, so the two doors
  // end at one history and not two.
  const [rehearsing, setRehearsing] = useState<Rehearsal | null>(null);
  // The coach's conversation, opened by the pass ending and covering the retell
  // the way the panel does. A pass not written yet keeps `passPending` on, and
  // `passKey` is bumped when it has landed in the conversation.
  const [coaching, setCoaching] = useState(false);
  const [passPending, setPassPending] = useState(false);
  const [passKey, setPassKey] = useState(0);
  // Finding or making the object is a trip to disk, and the button stays on
  // screen for the whole of it. The gate is the button's, through readiness: a
  // second press while the first is out would mount the panel on whichever of
  // the two objects came back last, and only one of them would be given.
  const [preparing, setPreparing] = useState(false);
  const rehearse = () => {
    const target = retell.retell;
    if (!target || !talk.outline) return;
    setPreparing(true);
    void rehearsalForRetell({
      topicId: target.topicId,
      retellId: target.id,
      name: target.name,
    })
      .then(setRehearsing)
      .catch((e: unknown) => {
        // The object is what a pass is recorded against: without it there is
        // nothing to open the panel on.
        console.warn("could not open the rehearsal", e);
      })
      .finally(() => setPreparing(false));
  };
  // The talk this retell is writing, re-read as the conversation grows: the note
  // is written a rib at a time as the retell goes (docs/44), so the block that
  // turns Rehearse on lands mid-sitting, by the turn that has just finished —
  // and Rehearse comes on at the first rib, because a note with one block on it
  // is a note that can be read aloud.
  const talk = useRetellOutline(props.retellId, retell.messages.length);
  const readiness = rehearsalReadiness({
    segments: talk.loading ? null : (talk.outline?.segments.length ?? 0),
    preparing,
  });

  return (
    <MaterialFigureScope retellId={props.retellId}>
      <CitationContext.Provider value={null}>
        <div className="absolute inset-0 flex flex-col bg-background">
          <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Back to the topic"
              aria-label="Back to the topic"
              onClick={props.onBack}
              className="h-9 w-9 text-muted-foreground"
            >
              <IconClose size={18} />
            </Button>
            {/* The name is the button: a retell gets named once, and a permanent
                field in a header that is otherwise about the conversation would be
                the loudest thing on the screen. */}
            <button
              className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left can-hover:hover:bg-muted"
              title="Rename this retell"
              disabled={!retell.retell}
              onClick={() => setRenaming(true)}
            >
              <span className="truncate text-[15px] font-medium">{retell.retell?.name ?? "Retell"}</span>
              {materialsLine(retell.retell) && (
                <span className="truncate text-xs text-muted-foreground">
                  {materialsLine(retell.retell)}
                </span>
              )}
            </button>
            {/* The last step of the loop is docs/31's judgement: whether the
                reader can give the retell. It is given from the note this retell
                wrote (docs/44), so the one button here starts a pass. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!retell.retell || !readiness.ok}
              title={readiness.title}
              onClick={rehearse}
            >
              Rehearse
            </Button>
          </div>

          <ChatScaleScope className="flex min-h-0 min-w-0 flex-1 flex-col">
            {retell.error && (
              <p className="m-0 border-b border-border bg-muted/40 px-4 py-2 text-sm text-destructive">
                {retell.error}
              </p>
            )}
            {retell.loading ? (
              <p className="m-0 px-4 py-3 text-sm text-muted-foreground">Loading the retell…</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
                <MessageList
                  messages={retell.messages}
                  size="lg"
                  className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
                />
              </div>
            )}
            <div className="px-4 pb-6">
              <div className="mx-auto w-full max-w-[calc(48rem*var(--chat-scale,1))]">
                <Composer
                  onSend={retell.send}
                  placeholder="Say it in your own words…"
                  pill
                  streaming={retell.streaming}
                  onStop={retell.stop}
                />
              </div>
            </div>
          </ChatScaleScope>

          {rehearsing && talk.outline && (
            <RehearsalView
              rehearsal={rehearsing}
              outline={talk.outline}
              backLabel="Back to the retell"
              // Which retell is being given is known before a word of it is said,
              // so its proper names go in as the recognizer's hot words: the
              // materials' titles and the chapter titles the retell has settled.
              openSource={() =>
                openTranscriptSource({
                  title: rehearsing.name,
                  outline: [
                    ...(retell.retell?.materials ?? []),
                    ...(retell.retell?.decisions ?? []),
                  ],
                })
              }
              // A pass hands itself in (docs/44), so it lands in the talk's
              // conversation — which is a different conversation from this one.
              // The retell settled what the talk says; the coach hears it said,
              // and covers the retell the way the panel did. A talk that was only
              // read has nothing to say to the coach, so it goes nowhere.
              onExit={(gave) => {
                setRehearsing(null);
                if (!gave) return;
                setCoaching(true);
                setPassPending(true);
              }}
              onSaved={(recorded) => {
                setPassPending(false);
                if (!recorded) return;
                setPassKey((n) => n + 1);
              }}
            />
          )}

          {coaching && talk.outline && (
            <CoachView
              outlineId={talk.outline.id}
              topicName={props.topicName}
              backLabel="Back to the retell"
              passKey={passKey}
              pending={passPending}
              onBack={() => setCoaching(false)}
            />
          )}

          {renaming && retell.retell && (
            <NameDialog
              open
              onOpenChange={setRenaming}
              title="Rename this retell"
              description="Only the name changes. The outline and the conversation stay as they are."
              confirmLabel="Save"
              initialValue={retell.retell.name}
              onConfirm={retell.rename}
            />
          )}
        </div>
      </CitationContext.Provider>
    </MaterialFigureScope>
  );
}
