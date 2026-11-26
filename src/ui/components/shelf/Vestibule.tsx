// Today — the app's home on a tablet or desktop (docs/51): the book to resume
// and the shelf. Not a dashboard: two things, in the order a session uses them.
//
// The continue card is one button. A card with a Resume button inside it asks
// the reader to aim at a word when the whole card means the same thing; the
// chevron says which way it goes.
//
// Rendering and event binding only. The lines are in today.ts.

import { useEffect, useState } from "react";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { Button } from "../ui/button";
import { IconChevronRight } from "../base/icons";
import AddCard from "./AddCard";
import CoverBand from "./CoverBand";
import NameDialog from "../common/NameDialog";
import PeerUpdateNotice from "../common/PeerUpdateNotice";
import TopicCard from "./TopicCard";
import { LIBRARY_GRID } from "./cardStyles";
import { readBookMeta } from "./book-meta";
import { displayFileTitle, readingProgress, type BookMeta } from "./file-title";
import { shelfOrder, singleCoverTile } from "./topic-shelf";
import { continueMetaLine, todayDateLine } from "./today";
import { useT } from "../../../i18n";

// The column the page is set in. 32px top and bottom; 40px sides on a landscape
// tablet, 32 on a portrait one, where the sidebar has already taken 52px.
const PAGE = "mx-auto w-full max-w-[880px] px-8 py-8 lg:px-10";
const CARD =
  "rounded-2xl border border-border-soft bg-card p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]";
// The card when it is the button: the shelf card's pointer and its deepening
// shadow on hover (cardStyles.ts), so it lifts the way a cover does. The
// placeholder and empty states keep the plain CARD; nothing there is pressable.
const CARD_BUTTON =
  `${CARD} cursor-pointer transition-shadow can-hover:hover:border-border can-hover:hover:shadow-[0_2px_10px_rgba(0,0,0,0.10)]`;
const EYEBROW = "text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

export function Vestibule({
  continueBook,
  topics,
  onContinue,
  onOpenLibrary,
  onOpenTopic,
  onCreateTopic,
}: {
  // The book to resume, null when there is none, and undefined while the library
  // has not been read — "Nothing open yet" is a claim about a shelf nobody has
  // looked at.
  continueBook: { file: FileRef; topicName: string } | null | undefined;
  // The shelf, or null while it is being read.
  topics: Topic[] | null;
  onContinue: () => void;
  onOpenLibrary: () => void;
  onOpenTopic: (topic: Topic) => void;
  onCreateTopic: (name: string) => void;
}) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const shelf = topics ? shelfOrder(topics) : [];

  return (
    <div className={PAGE}>
      <div className="text-[13px] text-muted-foreground">{todayDateLine(new Date())}</div>
      <h1 className="mb-5 mt-1 font-display text-[26px] font-semibold text-foreground">{t("shell.vestibule.title")}</h1>

      {/* A desktop on an older build; draws only on an iPad. */}
      <PeerUpdateNotice className="mb-3" />

      <ContinueCard book={continueBook} onContinue={onContinue} onOpenLibrary={onOpenLibrary} />


      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="m-0 text-[15px] font-semibold text-foreground">{t("shell.vestibule.yourTopics")}</h2>
          <Button
            variant="link"
            size="link"
            className="text-[13px] text-muted-foreground underline-offset-4 can-hover:hover:underline"
            onClick={onOpenLibrary}
          >
            {t("shell.vestibule.allTopics")}
          </Button>
        </div>
        <ul className={`${LIBRARY_GRID} mt-3 grid-cols-3 lg:grid-cols-5`}>
          {shelf.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              onOpen={() => onOpenTopic(topic)}
              // No card menu here: renaming and deleting are done where the
              // topics are.
            />
          ))}
          <AddCard label={t("shell.vestibule.newTopic")} onClick={() => setCreating(true)} />
        </ul>
      </div>

      {creating && (
        <NameDialog
          open
          onOpenChange={setCreating}
          title={t("shell.vestibule.newTopic")}
          description={t("shell.vestibule.newTopicDescription")}
          placeholder={t("shell.vestibule.newTopicPlaceholder")}
          confirmLabel={t("shell.vestibule.create")}
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
  const t = useT();
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
        <div className={EYEBROW}>{t("shell.vestibule.continueReading")}</div>
        <div className="mt-3">
          <CardBodyPlaceholder />
        </div>
      </div>
    );
  }

  if (!props.book) {
    return (
      <div className={CARD}>
        <div className={EYEBROW}>{t("shell.vestibule.continueReading")}</div>
        <p className="m-0 mt-3 text-[14px] leading-relaxed text-muted-foreground">
          {t("shell.vestibule.nothingOpen")}
        </p>
        <Button variant="subtle" size="lg" className="mt-4 w-fit" onClick={props.onOpenLibrary}>
          {t("shell.vestibule.goToLibrary")}
        </Button>
      </div>
    );
  }

  const book = props.book;
  const progress = readingProgress(meta);

  return (
    <button className={`${CARD_BUTTON} flex w-full items-center gap-4 text-left`} onClick={props.onContinue}>
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
        <span className={`block ${EYEBROW}`}>{t("shell.vestibule.continueReading")}</span>
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

// The body of a card whose answer has not arrived: two grey bars where the text
// will be, so nothing below it moves when it arrives. Not animated: on a machine
// that has the files it is on screen for a fraction of a second.
function CardBodyPlaceholder() {
  return (
    <div className="flex flex-1 flex-col" data-placeholder="card-body" aria-hidden="true">
      <div className="h-3 w-4/5 rounded bg-muted" />
      <div className="mt-2.5 h-3 w-3/5 rounded bg-muted" />
    </div>
  );
}
