// One retell, opened (docs/31, "界面"): the conversation in the main
// area and the outline it is growing beside it.
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
// The conversation column is a ChatScaleScope, on the same value as the reader's
// call window.

import { useMemo, useState } from "react";
import ChatScaleScope from "../base/ChatScaleScope";
import { CitationContext } from "../markdown/Markdown";
import { IconClose, IconOutline } from "../base/icons";
import { Composer, MessageList } from "../chat/chat";
import NameDialog from "../common/NameDialog";
import { Button } from "../ui/button";
import {
  rehearsalForRetell,
  type Rehearsal,
  type TranscriptSource,
} from "../../../reading/rehearsal";
import { outlineRows, type Retell } from "../../../reading/retell";
import { defaultNavOpen, readNavEnv } from "../base/topic-nav";
import DeckDialog from "./DeckDialog";
import OutlinePane from "./OutlinePane";
import RehearsalView from "../rehearsal/RehearsalView";
import { rehearsalReadiness } from "../rehearsal/rehearsal";
import { openTranscriptSource } from "../rehearsal/start";
import {
  useRehearsalRuns,
  useRetellOutline,
  useRetellRehearsal,
} from "../rehearsal/useRehearsal";
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
  // Desktop opens with the outline showing; a portrait iPad starts collapsed and
  // the button is right there (docs/31). Read once at mount, like the topic
  // sidebar: following a rotation would reopen a pane the reader closed.
  const [outlineOpen, setOutlineOpen] = useState(() => defaultNavOpen(readNavEnv(window)));
  const [renaming, setRenaming] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const rows = useMemo(() => (retell.retell ? outlineRows(retell.retell) : []), [retell.retell]);

  // Giving the retell covers this view rather than replacing it: no route, and
  // leaving it puts the retell back exactly as it was. Covering rather than
  // swapping is not cosmetic — unmounting the conversation is what distils it
  // (useRetell's cleanup), and stepping over to the deck for ten minutes is not
  // leaving the retell.
  //
  // What is being given is a rehearsal object (docs/43), found or made by the
  // press: the topic's Rehearsal section opens the same object, so the two doors
  // end at one history and not two.
  const [rehearsing, setRehearsing] = useState<Rehearsal | null>(null);
  // The words for the pass about to be given, or null when the machine has no
  // way to hear them (no STT key on the desktop, no dictation on the host).
  // Which of the two shapes it is belongs to the rehearsal, not to this button
  // (reading/rehearsal/transcript-source.ts). Made here rather than inside the
  // rehearsal because the source has to be recording before the deck reports its
  // first page: reading the STT config is a trip to disk, and doing it after the
  // view is up would race the deck's own load — every word said to page one
  // while that race was on would be lost. Made once per pass, too: a source that
  // has been stopped is finished, and the next Rehearse needs a new one.
  const [transcript, setTranscript] = useState<TranscriptSource | null>(null);
  // Making it is a trip to disk, and the button stays on screen for the whole of
  // it. Two presses would make two sources and open two recording sessions, and
  // the recorder keeps one: the second start drains the first session
  // (src-tauri/src/voice.rs), so the first source's page turns would cut a
  // session that is already gone. The gate is the button's, through readiness.
  const [preparing, setPreparing] = useState(false);
  const rehearse = () => {
    const target = retell.retell;
    if (!target || !talk.outline) return;
    setPreparing(true);
    void Promise.all([
      rehearsalForRetell({
        topicId: target.topicId,
        retellId: target.id,
        name: target.name,
      }),
      // Which retell is being given is known before a word of it is said, so its
      // proper names go in as the recognizer's hot words.
      openTranscriptSource({ title: target.name, outline: [...target.materials, ...rows] }),
    ])
      .then(([rehearsal, source]) => {
        setTranscript(source);
        setRehearsing(rehearsal);
      })
      .catch((e: unknown) => {
        // The object is the pass: without it there is nothing to record against,
        // so unlike a missing transcript this does stop the rehearsal.
        console.warn("could not open the rehearsal", e);
      })
      .finally(() => setPreparing(false));
  };
  // The talk this retell has arranged, re-read as the conversation grows: the
  // arrangement comes out of the last exchange of the retell (docs/44), so the
  // outline that turns Rehearse on is written mid-sitting, by the turn that has
  // just finished.
  const talk = useRetellOutline(props.retellId, retell.messages.length);
  const readiness = rehearsalReadiness({
    segments: talk.loading ? null : (talk.outline?.segments.length ?? 0),
    preparing,
  });
  // Bumped when a run reaches the disk, not when the rehearsal is left: the two
  // are seconds apart, because the run waits for the last of the speech to come
  // back from STT (docs/43). It is the only moment this device changes the
  // history (a pull can too, and useRehearsalRuns says why it does not follow
  // that).
  const [runsKey, setRunsKey] = useState(0);
  const rehearsal = useRetellRehearsal(props.retellId, runsKey);
  const runs = useRehearsalRuns(rehearsal?.id ?? null, runsKey);

  return (
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
          {!outlineOpen && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOutlineOpen(true)}
              className="gap-1.5"
            >
              <IconOutline size={16} />
              The retell so far
            </Button>
          )}
          {/* The deck is this retell's product and the last step of the loop
              (docs/31), so it starts here, from this retell's outline — there is
              no second place to generate one from. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!retell.retell}
            onClick={() => setDeckOpen(true)}
          >
            Deck
          </Button>
          {/* The deck is only half of the last step: docs/31's judgement is
              whether the reader can give the retell, so the deck has a Rehearse
              beside it and the pass is recorded. */}
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

        <div className="flex min-h-0 flex-1">
          <ChatScaleScope className="flex min-w-0 flex-1 flex-col">
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

          {outlineOpen && (
            <OutlinePane
              rows={rows}
              runs={runs}
              onMove={retell.moveEntry}
              onSetIncluded={retell.cutEntry}
              onRemove={retell.removeEntry}
              onClose={() => setOutlineOpen(false)}
            />
          )}
        </div>

        {rehearsing && talk.outline && (
          <RehearsalView
            rehearsal={rehearsing}
            outline={talk.outline}
            backLabel="Back to the retell"
            transcript={transcript ?? undefined}
            onExit={() => {
              setRehearsing(null);
              setTranscript(null);
            }}
            onSaved={() => setRunsKey((n) => n + 1)}
          />
        )}

        {deckOpen && retell.retell && (
          <DeckDialog
            retellId={retell.retell.id}
            retellName={retell.retell.name}
            onClose={() => setDeckOpen(false)}
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
  );
}
