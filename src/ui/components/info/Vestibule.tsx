// Today — the app's home (docs/51). What is open, what came in overnight, and
// the shelf. Not a dashboard: three things, in the order a session uses them.
//
// The two cards are each one button. A card with a Resume button inside it asks
// the reader to aim at a word when the whole card means the same thing; the
// chevron says which way it goes. The briefing card is the exception when it has
// nothing to open yet — those states carry buttons of their own (Stop, Start
// subscribing), and a button inside a button is neither valid nor clickable, so
// the card stays a plain box until there is a briefing in it.
//
// Rendering and event binding only. The lines are in today.ts, the card chrome
// and the briefing card's other states in HomeCard (shared with the phone).

import { useEffect, useState } from "react";
import type { InfoSnapshot } from "../../../info/briefing/pipeline";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { BriefingCardBody, CardBodyPlaceholder } from "./HomeCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IconChevronRight } from "../base/icons";
import AddCard from "../shelf/AddCard";
import CoverBand from "../shelf/CoverBand";
import NameDialog from "../common/NameDialog";
import TopicCard from "../shelf/TopicCard";
import { LIBRARY_GRID } from "../shelf/cardStyles";
import { readBookMeta } from "../shelf/book-meta";
import { displayFileTitle, readingProgress, type BookMeta } from "../shelf/file-title";
import { shelfOrder, singleCoverTile } from "../shelf/topic-shelf";
import {
  briefingEyebrow,
  briefingFooterLine,
  continueMetaLine,
  todayDateLine,
  TODAY_CARD_ITEMS,
} from "./today";

// The column the page is set in. 32px top and bottom; 40px sides on a landscape
// tablet, 32 on a portrait one, where the sidebar has already taken 52px.
const PAGE = "mx-auto w-full max-w-[880px] px-8 py-8 lg:px-10";
const CARD =
  "rounded-2xl border border-border-soft bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
const EYEBROW = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

export function Vestibule({
  continueBook,
  topics,
  snap,
  ready,
  configured,
  hasSources,
  collecting,
  notices,
  onContinue,
  onOpenLibrary,
  onOpenTopic,
  onCreateTopic,
  onAsk,
  onStop,
  onOpenBriefing,
  onOpenSettings,
  onStartSubscribing,
}: {
  // The book to resume, null when there is none, and undefined while the library
  // has not been read — "Nothing open yet" is a claim about a shelf nobody has
  // looked at.
  continueBook: { file: FileRef; topicName: string } | null | undefined;
  // The shelf, or null while it is being read.
  topics: Topic[] | null;
  snap: InfoSnapshot | null;
  ready: boolean;
  configured: boolean;
  hasSources: boolean | null;
  collecting: boolean;
  notices: string[];
  onContinue: () => void;
  onOpenLibrary: () => void;
  onOpenTopic: (topic: Topic) => void;
  onCreateTopic: (name: string) => void;
  onAsk: () => void;
  onStop: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const shelf = topics ? shelfOrder(topics) : [];

  return (
    <div className={PAGE}>
      <div className="text-[13px] text-muted-foreground">{todayDateLine(new Date())}</div>
      <h1 className="mb-5 mt-1 font-display text-[26px] font-semibold text-foreground">Today</h1>

      <ContinueCard book={continueBook} onContinue={onContinue} onOpenLibrary={onOpenLibrary} />

      <div className="mt-3">
        <BriefingCard
          snap={snap}
          ready={ready}
          configured={configured}
          hasSources={hasSources}
          collecting={collecting}
          notices={notices}
          onAsk={onAsk}
          onStop={onStop}
          onOpen={onOpenBriefing}
          onOpenSettings={onOpenSettings}
          onStartSubscribing={onStartSubscribing}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-[15px] font-semibold text-foreground">Your topics</h2>
          <Button
            variant="link"
            size="link"
            className="text-[13px] text-muted-foreground underline-offset-4 can-hover:hover:underline"
            onClick={onOpenLibrary}
          >
            All topics →
          </Button>
        </div>
        <ul className={`${LIBRARY_GRID} mt-3 grid-cols-3 lg:grid-cols-5`}>
          {shelf.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              onOpen={() => onOpenTopic(t)}
              // No card menu here: renaming and deleting are done where the
              // topics are.
            />
          ))}
          <AddCard label="New topic" onClick={() => setCreating(true)} />
        </ul>
      </div>

      {creating && (
        <NameDialog
          open
          onOpenChange={setCreating}
          title="New topic"
          description="A topic is one question and the books you read against it."
          placeholder="e.g. what makes JITs fast"
          confirmLabel="Create"
          onConfirm={onCreateTopic}
        />
      )}
    </div>
  );
}

// The card that resumes reading. The cover, its progress bar and the title are
// the shelf's own treatment, so a book looks the same here as on the shelf it
// came from.
function ContinueCard(props: {
  book: { file: FileRef; topicName: string } | null | undefined;
  onContinue: () => void;
  onOpenLibrary: () => void;
}) {
  const file = props.book?.file ?? null;
  const [meta, setMeta] = useState<BookMeta | undefined>(undefined);

  // Off the render path, and forgotten when the book changes: a page count read
  // for the previous book must not be shown under this one's title.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setMeta(undefined);
    void readBookMeta(file).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (props.book === undefined) {
    return (
      <div className={CARD}>
        <div className={EYEBROW}>Continue reading</div>
        <div className="mt-3">
          <CardBodyPlaceholder />
        </div>
      </div>
    );
  }

  if (!props.book) {
    return (
      <div className={CARD}>
        <div className={EYEBROW}>Continue reading</div>
        <p className="m-0 mt-3 text-[14px] leading-relaxed text-muted-foreground">
          Nothing open yet. Add a book to a topic in the library.
        </p>
        <Button variant="subtle" size="lg" className="mt-4 w-fit" onClick={props.onOpenLibrary}>
          Go to library
        </Button>
      </div>
    );
  }

  const book = props.book;
  const progress = readingProgress(meta);

  return (
    <button className={`${CARD} flex w-full items-center gap-4 text-left`} onClick={props.onContinue}>
      <span className="relative block w-24 flex-none">
        <CoverBand tiles={singleCoverTile(book.file)} />
        {progress !== null && (
          <span className="absolute inset-x-0 bottom-0 block h-[3px] bg-black/15">
            <span
              className="absolute left-0 top-0 block h-full bg-accent-line"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block ${EYEBROW}`}>Continue reading</span>
        <span className="mt-1.5 block font-display text-[18px] font-medium leading-snug text-foreground">
          {displayFileTitle(book.file.name)}
        </span>
        <span className="mt-1 block text-[13px] text-muted-foreground">
          {continueMetaLine(book.topicName, meta)}
        </span>
      </span>
      <span className="flex flex-none text-muted-foreground">
        <IconChevronRight />
      </span>
    </button>
  );
}

// The day's briefing, when there is one: the overview, the top of the list, and
// what is left over. Every other state is HomeCard's, drawn in place of the
// rows — the card is not a button in any of them, because they carry buttons.
function BriefingCard(props: {
  snap: InfoSnapshot | null;
  ready: boolean;
  configured: boolean;
  hasSources: boolean | null;
  collecting: boolean;
  notices: string[];
  onAsk: () => void;
  onStop: () => void;
  onOpen: () => void;
  onOpenSettings: () => void;
  onStartSubscribing: () => void;
}) {
  const { snap } = props;
  const briefing = snap?.running ? null : (snap?.briefing ?? null);

  if (!briefing) {
    return (
      <div className={CARD}>
        <div className={EYEBROW}>{briefingEyebrow(null)}</div>
        <div className="mt-3 flex flex-col">
          <BriefingCardBody
            snap={props.snap}
            ready={props.ready}
            configured={props.configured}
            hasSources={props.hasSources}
            collecting={props.collecting}
            notices={props.notices}
            onAsk={props.onAsk}
            onStop={props.onStop}
            onOpen={props.onOpen}
            onOpenSettings={props.onOpenSettings}
            onStartSubscribing={props.onStartSubscribing}
          />
        </div>
      </div>
    );
  }

  const rows = briefing.mustRead.slice(0, TODAY_CARD_ITEMS);

  return (
    <button className={`${CARD} block w-full text-left`} onClick={props.onOpen}>
      <span className="flex items-center gap-3">
        <span className={`min-w-0 flex-1 ${EYEBROW}`}>{briefingEyebrow(briefing)}</span>
        <span className="flex flex-none text-muted-foreground">
          <IconChevronRight />
        </span>
      </span>
      <span className="mt-2.5 block text-[15px] leading-relaxed text-muted-foreground">
        {briefing.overview}
      </span>
      {rows.length > 0 && (
        <span className="mt-2.5 block">
          {rows.map((r, i) => {
            const meta = briefing.items[r.itemId];
            if (!meta) return null;
            return (
              <span
                key={r.itemId}
                className={
                  "flex h-10 items-center gap-3" +
                  (i < rows.length - 1 ? " border-b border-border-faint" : "")
                }
              >
                {meta.sourceName && (
                  <span className="flex-none">
                    <Badge>{meta.sourceName}</Badge>
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                  {meta.title}
                </span>
              </span>
            );
          })}
        </span>
      )}
      <span className="mt-3 block text-[13px] text-muted-foreground">
        {briefingFooterLine(briefing)}
      </span>
    </button>
  );
}
