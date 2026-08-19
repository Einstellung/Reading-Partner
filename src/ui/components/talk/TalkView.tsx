// One talk, opened (docs/31, "界面"): the rehearsal conversation in the main
// area and the outline it is growing beside it.
//
// It replaces the topic's sections while it is open, the way the saved-article
// reader does, so entering a talk needs no route and leaving it puts the topic
// back exactly as it was. There is no reader under it and no engine running —
// the materials come off disk (reading/talks/material.ts).
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
import { outlineRows, type Talk } from "../../../reading/talks";
import { defaultNavOpen, readNavEnv } from "../base/topic-nav";
import DeckDialog from "./DeckDialog";
import OutlinePane from "./OutlinePane";
import RunthroughView from "./RunthroughView";
import { rehearsalReadiness } from "./runthrough";
import { useRunthroughs, useTalkDeckFile } from "./useRunthrough";
import { useTalk } from "./useTalk";

// The line under the talk's name: what it is being prepared from.
export function materialsLine(talk: Talk | null): string {
  if (!talk || talk.materials.length === 0) return "";
  if (talk.materials.length === 1) return talk.materials[0].title;
  return `${talk.materials.length} materials`;
}

export default function TalkView(props: {
  talkId: string;
  topicName: string;
  onBack(): void;
}) {
  const talk = useTalk(props.talkId, props.topicName);
  // Desktop opens with the outline showing; a portrait iPad starts collapsed and
  // the button is right there (docs/31). Read once at mount, like the topic
  // sidebar: following a rotation would reopen a pane the reader closed.
  const [outlineOpen, setOutlineOpen] = useState(() => defaultNavOpen(readNavEnv(window)));
  const [renaming, setRenaming] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const rows = useMemo(() => (talk.talk ? outlineRows(talk.talk) : []), [talk.talk]);

  // Giving the talk covers this view rather than replacing it: no route, and
  // leaving it puts the talk back exactly as it was. Covering rather than
  // swapping is not cosmetic — unmounting the conversation is what distils it
  // (useTalk's cleanup), and stepping over to the deck for ten minutes is not
  // leaving the talk.
  const [rehearsing, setRehearsing] = useState(false);
  // Bumped when the deck dialog closes: a deck generated in this sitting has to
  // turn Rehearse on in this sitting.
  const [deckKey, setDeckKey] = useState(0);
  const deck = useTalkDeckFile(props.talkId, deckKey);
  const readiness = rehearsalReadiness({ deckFile: deck.file, loading: deck.loading });
  // Bumped when a run ends: that is the only moment the history can have changed.
  const [runsKey, setRunsKey] = useState(0);
  const runs = useRunthroughs(props.talkId, runsKey);

  return (
    <CitationContext.Provider value={null}>
      <div className="absolute inset-0 flex flex-col bg-white">
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
          {/* The name is the button: a talk gets named once, and a permanent
              field in a header that is otherwise about the conversation would be
              the loudest thing on the screen. */}
          <button
            className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left can-hover:hover:bg-muted"
            title="Rename this talk"
            disabled={!talk.talk}
            onClick={() => setRenaming(true)}
          >
            <span className="truncate text-[15px] font-medium">{talk.talk?.name ?? "Talk"}</span>
            {materialsLine(talk.talk) && (
              <span className="truncate text-xs text-muted-foreground">
                {materialsLine(talk.talk)}
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
              The talk so far
            </Button>
          )}
          {/* The deck is this talk's product and the last step of the loop
              (docs/31), so it starts here, from this talk's outline — there is
              no second place to generate one from. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!talk.talk}
            onClick={() => setDeckOpen(true)}
          >
            Deck
          </Button>
          {/* The deck is only half of the last step: docs/31's judgement is
              whether the reader can give the talk, so the deck has a Rehearse
              beside it and the pass is recorded. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!talk.talk || !readiness.ok}
            title={readiness.title}
            onClick={() => setRehearsing(true)}
          >
            Rehearse
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          <ChatScaleScope className="flex min-w-0 flex-1 flex-col">
            {talk.error && (
              <p className="m-0 border-b border-border bg-muted/40 px-4 py-2 text-sm text-destructive">
                {talk.error}
              </p>
            )}
            {talk.loading ? (
              <p className="m-0 px-4 py-3 text-sm text-muted-foreground">Loading the talk…</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4">
                <MessageList
                  messages={talk.messages}
                  size="lg"
                  className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
                />
              </div>
            )}
            <div className="px-4 pb-6">
              <div className="mx-auto w-full max-w-[calc(48rem*var(--chat-scale,1))]">
                <Composer
                  onSend={talk.send}
                  placeholder="Say it in your own words…"
                  pill
                  streaming={talk.streaming}
                  onStop={talk.stop}
                />
              </div>
            </div>
          </ChatScaleScope>

          {outlineOpen && (
            <OutlinePane
              rows={rows}
              runs={runs}
              onMove={talk.moveEntry}
              onSetIncluded={talk.cutEntry}
              onRemove={talk.removeEntry}
              onClose={() => setOutlineOpen(false)}
            />
          )}
        </div>

        {rehearsing && talk.talk && deck.file && (
          <RunthroughView
            talkId={talk.talk.id}
            talkName={talk.talk.name}
            deckFile={deck.file}
            onExit={() => {
              setRehearsing(false);
              setRunsKey((n) => n + 1);
            }}
          />
        )}

        {deckOpen && talk.talk && (
          <DeckDialog
            talkId={talk.talk.id}
            talkName={talk.talk.name}
            onClose={() => {
              setDeckOpen(false);
              setDeckKey((n) => n + 1);
            }}
          />
        )}

        {renaming && talk.talk && (
          <NameDialog
            open
            onOpenChange={setRenaming}
            title="Rename this talk"
            description="Only the name changes. The outline and the conversation stay as they are."
            confirmLabel="Save"
            initialValue={talk.talk.name}
            onConfirm={talk.rename}
          />
        )}
      </div>
    </CitationContext.Provider>
  );
}
