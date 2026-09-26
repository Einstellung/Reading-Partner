// The phone's shelf (docs/70): the topics, and one level in, what is filed under
// one of them. The same cards the desk draws — the cover band, the label strip,
// the grid's own class names — with everything the phone does not have taken
// off: no renaming, no retell, no rehearsal, no observations. Adding is one
// button on each screen: a topic on the list, an EPUB in a topic
// (reading/session/import-book.ts). Deleting is a hold on a card or a row
// (hold-menu.ts), and what goes leaves where it stands.
//
// What it adds instead is the answers only this shell needs: a PDF opens as a
// lesson rather than as pages, a book that is not on this device says so and is
// fetched when it is tapped, and a file the desk has not imported yet says that
// instead of pretending to be either (shelf-list.ts).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { libraryHas, type LibraryEntry } from "../../../platform/app/library";
import { getBookThread, loadThreads } from "../../../platform/app/threads";
import { fetchBook, subscribeSyncStatus } from "../../../platform/sync";
import { createTopic, sortedFiles, type Topic } from "../../../platform/app/topics";
import { getFulltext } from "../../../fulltext/store";
import { loadChapterTable } from "../../../reading/lecture/live";
import { importEpub, uploadImported } from "../../../reading/session/import-book";
import ConfirmDestructiveDialog from "../common/ConfirmDestructiveDialog";
import TopicDeleteDialog from "../library/TopicDeleteDialog";
import CoverBand from "../shelf/CoverBand";
import {
  BOOK_LABEL,
  BOOK_READ,
  BOOK_TITLE,
  CARD_LABEL,
  CARD_META,
  CARD_TITLE,
  LIBRARY_CARD,
  LIBRARY_GRID,
  ROW,
  ROW_LIST,
  ROW_NAME,
} from "../shelf/cardStyles";
import {
  coverTiles,
  fileCountLabel,
  NEW_TOPIC_BLURB,
  shelfOrder,
  singleCoverTile,
} from "../shelf/topic-shelf";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import HoldMenu, { HOLDABLE, HOLDABLE_ROW } from "./HoldMenu";
import { visibleItems, type HoldSubject } from "./hold-menu";
import NewTopicSheet from "./NewTopicSheet";
import { useHoldDelete, type HoldDeleteControl, type NoticeKind } from "./use-hold-delete";
import {
  lessonNote,
  materialNote,
  materialTap,
  shelfMaterials,
  type FetchAbility,
  type ShelfMaterial,
} from "./shelf-list";

// The label strip's bottom line on a card that carries the Lesson mark. The
// desk's BOOK_READ is one truncating line of text; this one holds a mark beside
// the text, so it is a row. Spelled out rather than appended to BOOK_READ: the
// two would set `display` twice and which one won would be Tailwind's emission
// order (docs/pitfall/78).
const LESSON_READ =
  "mt-1 flex items-center gap-1.5 overflow-hidden text-[12px] leading-[14px] whitespace-nowrap text-faint-foreground";

export interface PhoneBookOpen {
  bookId: string;
  name: string;
  topicId: string;
  path: string;
}

export default function PhoneShelf(props: {
  topics: Topic[] | null;
  // The topic being looked into, or null for the list of topics.
  topic: Topic | null;
  // The library registry, held by the shell so a pull that lands library.json
  // redraws these cards (PhoneApp registers the shelf's pull route). A file
  // that is in a topic but not in here has not been imported on the desk yet,
  // and the card says so rather than guessing (shelf-list.ts).
  entries: Record<string, LibraryEntry>;
  onOpenTopic: (topicId: string) => void;
  onOpenBook: (book: PhoneBookOpen) => void;
  // Into the lesson: a PDF, which this shell teaches rather than draws
  // (docs/70). Same payload as a book — the screen needs the same four things.
  onOpenLesson: (book: PhoneBookOpen) => void;
  onBack: () => void;
  // One line, said out loud: a PDF, or a book this device cannot go and get.
  onSay: (line: string) => void;
  // A book was filed under the topic on this device: the topics are stale.
  onImported: () => Promise<void>;
  // Something was deleted or made here (or failed to be): reread the shelf.
  onChanged: () => Promise<void>;
  // The line after a delete or a new topic, or the one saying it failed.
  onNotice: (kind: NoticeKind, line: string) => void;
}) {
  if (props.topic) {
    return (
      <TopicShelf
        topic={props.topic}
        topics={props.topics ?? []}
        onChanged={props.onChanged}
        onNotice={props.onNotice}
        entries={props.entries}
        onOpenBook={props.onOpenBook}
        onOpenLesson={props.onOpenLesson}
        onBack={props.onBack}
        onSay={props.onSay}
        onImported={props.onImported}
      />
    );
  }
  return (
    <TopicList
      topics={props.topics}
      entries={props.entries}
      onOpen={props.onOpenTopic}
      onBack={props.onBack}
      onChanged={props.onChanged}
      onNotice={props.onNotice}
    />
  );
}

function Header(props: {
  title: string;
  sub: string;
  onBack: () => void;
  backLabel: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex-none border-b border-border-subtle px-4 pt-3 pb-3">
      {/* The row keeps the button's height when there is no button, so the
          title under it does not move when the last topic goes. */}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Button
          variant="link"
          size="link"
          className="text-[13px] text-muted-foreground"
          onClick={props.onBack}
        >
          ‹ {props.backLabel}
        </Button>
        {props.action}
      </div>
      <h1 className="mx-0 mt-1 mb-0 font-display text-[20px] font-semibold">{props.title}</h1>
      <p className="mx-0 mt-1 mb-0 text-[13px] text-muted-foreground">{props.sub}</p>
    </div>
  );
}

// What both lists hand the hold: the menu next to the held one, and the
// confirmation for what was picked in it.
function HoldLayer(props: { hold: HoldDeleteControl; topics?: Topic[] }) {
  const { hold } = props;
  return (
    <>
      <HoldMenu {...hold.menu} />
      {hold.ask && (
        <ConfirmDestructiveDialog
          title={hold.ask.words.title}
          description={hold.ask.words.description}
          actionLabel={hold.ask.words.action}
          open
          onOpenChange={(open) => !open && hold.endAsk()}
          onConfirm={hold.confirm}
        />
      )}
      {hold.topicAsk && props.topics && (
        <TopicDeleteDialog
          topic={hold.topicAsk}
          topics={props.topics}
          onOpenChange={(open) => !open && hold.endAsk()}
          onConfirm={hold.confirmTopic}
        />
      )}
    </>
  );
}

function TopicList(props: {
  topics: Topic[] | null;
  entries: Record<string, LibraryEntry>;
  onOpen: (topicId: string) => void;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onNotice: (kind: NoticeKind, line: string) => void;
}) {
  // Newest first, as on the desk: a topic made here lands at the top.
  const all = shelfOrder(props.topics ?? []);
  const surface = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const nameField = useRef<HTMLInputElement | null>(null);
  const [naming, setNaming] = useState(false);

  const hold = useHoldDelete({
    host: surface,
    subjectOf: (key) => {
      const topic = all.find((t) => t.id === key);
      return topic ? { kind: "topic", topic } : null;
    },
    presentKeys: all.map((t) => t.id),
    topics: all,
    entries: props.entries,
    onNotice: props.onNotice,
    onChanged: props.onChanged,
  });
  const topics = visibleItems(all, hold.hidden, (t) => t.id);

  // Opened and focused inside the tap: iOS raises the keyboard only for a
  // focus made during the gesture (NewTopicSheet.tsx).
  const startNaming = () => {
    flushSync(() => setNaming(true));
    nameField.current?.focus({ preventScroll: true });
  };

  const create = (name: string) => {
    setNaming(false);
    void createTopic(name)
      .then(async () => {
        // The new card is the first one; the list goes back up to where it lands.
        scroller.current?.scrollTo({ top: 0, behavior: "smooth" });
        await props.onChanged();
        props.onNotice("info", `Created “${name}”`);
      })
      .catch((e: unknown) => {
        console.error("failed to create the topic", e);
        props.onNotice("error", "The topic could not be created.");
      });
  };

  return (
    <div
      ref={surface}
      className="absolute inset-0 flex flex-col bg-background select-none [-webkit-touch-callout:none]"
    >
      <Header
        title="Library"
        sub={props.topics === null ? "…" : topicLine(topics)}
        backLabel="Home"
        onBack={props.onBack}
        action={
          topics.length > 0 && (
            <Button variant="outline" size="sm" onClick={startNaming}>
              New topic
            </Button>
          )
        }
      />
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-safe-6">
        {props.topics !== null && topics.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-[14px] text-faint-foreground">No topics yet. {NEW_TOPIC_BLURB}</p>
            <Button onClick={startNaming}>New topic</Button>
          </div>
        ) : (
          <ul className={`${LIBRARY_GRID} grid-cols-2`}>
            {topics.map((topic) => (
              <li key={topic.id} className="min-w-0">
                <button
                  data-hold={topic.id}
                  className={cn(LIBRARY_CARD, HOLDABLE)}
                  onClick={() => props.onOpen(topic.id)}
                >
                  <CoverBand tiles={coverTiles(topic)} />
                  <span className={CARD_LABEL}>
                    <span className={CARD_TITLE}>{topic.name}</span>
                    <span className={CARD_META}>{fileCountLabel(topic.files.length)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <HoldLayer hold={hold} topics={all} />
      <NewTopicSheet
        open={naming}
        onOpenChange={setNaming}
        onCreate={create}
        inputRef={nameField}
      />
    </div>
  );
}

function topicLine(topics: Topic[]): string {
  const n = topics.length;
  return `${n} topic${n === 1 ? "" : "s"}`;
}

function TopicShelf(props: {
  topic: Topic;
  topics: Topic[];
  onChanged: () => Promise<void>;
  onNotice: (kind: NoticeKind, line: string) => void;
  entries: Record<string, LibraryEntry>;
  onOpenBook: (book: PhoneBookOpen) => void;
  onOpenLesson: (book: PhoneBookOpen) => void;
  onBack: () => void;
  onSay: (line: string) => void;
  onImported: () => Promise<void>;
}) {
  const { topic, entries } = props;
  // The book ids whose bytes are in the library directory. Null while it is
  // being worked out: "in the cloud" is a claim about a directory nobody has
  // listed yet.
  const [onDevice, setOnDevice] = useState<ReadonlySet<string> | null>(null);
  const [can, setCan] = useState<FetchAbility>({ configured: false, signedIn: false });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Bumped when a download puts a book's bytes here: the cover of a book that
  // was in the cloud could not be rendered before, and nothing about the files
  // themselves changed to say it can be now.
  const [coverRevision, setCoverRevision] = useState(0);

  const files = sortedFiles(topic);

  // Which of this topic's books have their bytes here. Re-run whenever the
  // shell hands down a new topic or a new registry — a pull that wrote
  // topics.json or library.json does both (PhoneApp), and a book downloaded
  // here does it on its own.
  const readOnDevice = useCallback(async (): Promise<void> => {
    const here = new Set<string>();
    await Promise.all(
      sortedFiles(topic).map(async (f) => {
        if (f.hash && (await libraryHas(f.hash).catch(() => false))) here.add(f.hash);
      }),
    );
    setOnDevice(here);
  }, [topic, entries]);

  useEffect(() => {
    void readOnDevice();
  }, [readOnDevice]);

  useEffect(
    () => subscribeSyncStatus((s) => setCan({ configured: s.configured, signedIn: s.signedIn })),
    [],
  );

  const listed = shelfMaterials(files, entries, onDevice ?? new Set());

  const surface = useRef<HTMLDivElement | null>(null);
  // Bumped when a lesson was deleted here: its card's note reads again.
  const [notesRevision, setNotesRevision] = useState(0);
  const { onChanged } = props;
  const rereadShelf = useCallback(async () => {
    setNotesRevision((n) => n + 1);
    await onChanged();
  }, [onChanged]);
  const hold = useHoldDelete({
    host: surface,
    subjectOf: (key) => {
      const m = listed.find((x) => x.file.path === key);
      return m ? materialSubject(topic, m) : null;
    },
    presentKeys: listed.map((m) => m.file.path),
    topics: props.topics,
    entries,
    onNotice: props.onNotice,
    onChanged: rereadShelf,
  });
  const materials = visibleItems(listed, hold.hidden, (m) => m.file.path);
  const books = materials.filter((m) => !m.article);
  const articles = materials.filter((m) => m.article);
  const pdfIds = books
    .filter((m) => m.format === "pdf" && m.bookId)
    .map((m) => m.bookId as string)
    .join(" ");

  // How far each lesson has got, one card at a time. Two local reads per PDF:
  // the book's conversations, and the chapter table, which is derived from the
  // full text and so exists only for a paper a lesson has already read here
  // (shelf-list.ts lessonNote says what is left when it does not).
  const [lessonNotes, setLessonNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = pdfIds ? pdfIds.split(" ") : [];
    if (ids.length === 0) return;
    let live = true;
    void (async () => {
      const lines = await Promise.all(
        ids.map(async (id): Promise<[string, string]> => {
          await loadThreads(id).catch(() => ({}));
          const ft = await getFulltext(id).catch(() => null);
          const chapters = await loadChapterTable(id, ft, []).catch(() => null);
          return [id, lessonNote(getBookThread(id), chapters)];
        }),
      );
      if (live) setLessonNotes(Object.fromEntries(lines));
    })();
    return () => {
      live = false;
    };
  }, [pdfIds, notesRevision]);

  const tap = useCallback(
    async (m: ShelfMaterial): Promise<void> => {
      // Nothing is tappable before the shelf knows what is on the device: a tap
      // then would download a book that is already here.
      if (onDevice === null) return;
      const action = materialTap(m, can);
      if (action.kind === "unavailable") return props.onSay(action.why);
      const opened: PhoneBookOpen = {
        bookId: (m.bookId ?? "") as string,
        name: m.title,
        topicId: topic.id,
        path: m.file.path,
      };
      if (action.kind === "open") return props.onOpenBook(opened);
      if (action.kind === "lesson") return props.onOpenLesson(opened);
      setDownloading(action.bookId);
      try {
        await fetchBook(action.bookId);
        await readOnDevice();
        setCoverRevision((n) => n + 1);
        const door = action.then === "lesson" ? props.onOpenLesson : props.onOpenBook;
        door({ ...opened, bookId: action.bookId });
      } catch (e) {
        console.warn("failed to download the book", e);
        props.onSay(e instanceof Error ? e.message : "This book could not be downloaded");
      } finally {
        setDownloading(null);
      }
    },
    [can, onDevice, props, readOnDevice, topic.id],
  );

  const importBook = useCallback(async (): Promise<void> => {
    setImporting(true);
    let bookId: string;
    try {
      const result = await importEpub(topic.id);
      if (result.kind === "cancelled") return;
      if (result.kind === "refused") return props.onSay(result.why);
      bookId = result.bookId;
      await props.onImported();
    } catch (e) {
      console.warn("failed to import the book", e);
      return props.onSay(e instanceof Error ? e.message : "This book could not be imported");
    } finally {
      setImporting(false);
    }
    const line = await uploadImported(bookId);
    if (line) props.onSay(line);
  }, [props, topic.id]);

  return (
    <div
      ref={surface}
      className="absolute inset-0 flex flex-col bg-background select-none [-webkit-touch-callout:none]"
    >
      <Header
        title={topic.name}
        sub={fileCountLabel(topic.files.length)}
        backLabel="Library"
        onBack={props.onBack}
        action={
          <Button
            variant="outline"
            size="sm"
            disabled={importing}
            onClick={() => void importBook()}
          >
            {importing ? "Importing…" : "Import EPUB"}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-safe-6">
        {materials.length === 0 ? (
          <p className="m-0 text-[14px] text-faint-foreground">Nothing filed here yet.</p>
        ) : (
          <>
            <ul className={`${LIBRARY_GRID} grid-cols-2`}>
              {books.map((m) => (
                <li key={m.file.path} className="min-w-0">
                  <button
                    data-hold={m.file.path}
                    className={cn(LIBRARY_CARD, HOLDABLE)}
                    onClick={() => void tap(m)}
                  >
                    <CoverBand tiles={singleCoverTile(m.file)} revision={coverRevision} />
                    <span className={BOOK_LABEL}>
                      <span className={BOOK_TITLE} title={m.file.name}>
                        {m.title}
                      </span>
                      <span className={m.format === "pdf" ? LESSON_READ : BOOK_READ}>
                        {/* The mark that says this one is taught, not read. A
                            word in the label strip rather than a ribbon on the
                            cover: the cover is artwork to all four edges
                            (shelf/cardStyles.ts). */}
                        {m.format === "pdf" && (
                          <span className="flex-none rounded-sm border border-accent-line px-[5px] text-[10px] leading-[14px] font-medium tracking-[0.08em] text-accent-line uppercase">
                            Lesson
                          </span>
                        )}
                        <span className="truncate">
                          {materialNote(m, downloading === m.bookId) ??
                            (m.format === "pdf" ? (lessonNotes[m.bookId as string] ?? "") : "")}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {articles.length > 0 && (
              <ul className={`${ROW_LIST} mt-6`}>
                {articles.map((m) => (
                  <li key={m.file.path} data-hold={m.file.path} className={cn(ROW, HOLDABLE_ROW)}>
                    <button className={ROW_NAME} onClick={() => void tap(m)}>
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <span className="flex-none text-[12px] text-faint-foreground">
                        {materialNote(m, downloading === m.bookId) ?? m.line}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <HoldLayer hold={hold} />
    </div>
  );
}

// What a hold on one of a topic's files is about (hold-menu.ts).
function materialSubject(topic: Topic, m: ShelfMaterial): HoldSubject {
  return {
    kind: "file",
    topicId: topic.id,
    topicName: topic.name,
    file: m.file,
    title: m.title,
    format: m.format === "pdf" ? "pdf" : m.format === "epub" ? "epub" : "other",
    article: m.article,
    bookId: m.bookId,
  };
}
