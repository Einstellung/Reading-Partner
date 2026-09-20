// The phone's shelf (docs/70): the topics, and one level in, what is filed under
// one of them. The same cards the desk draws — the cover band, the label strip,
// the grid's own class names — with everything the phone does not have taken
// off: no renaming, no deleting, no retell, no rehearsal, no observations.
// Adding is one button, and it takes EPUBs only (reading/session/import-book.ts).
//
// What it adds instead is the answers only this shell needs: a PDF is drawn but
// not opened, a book that is not on this device says so and is fetched when it
// is tapped, and a file the desk has not imported yet says that instead of
// pretending to be either (shelf-list.ts).

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { libraryHas, type LibraryEntry } from "../../../platform/app/library";
import { fetchBook, subscribeSyncStatus } from "../../../platform/sync";
import { sortedFiles, type Topic } from "../../../platform/app/topics";
import { importEpub, uploadImported } from "../../../reading/session/import-book";
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
import { coverTiles, fileCountLabel, singleCoverTile } from "../shelf/topic-shelf";
import { Button } from "../ui/button";
import {
  materialNote,
  materialTap,
  shelfMaterials,
  PDF_ELSEWHERE,
  type FetchAbility,
  type ShelfMaterial,
} from "./shelf-list";

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
  onBack: () => void;
  // One line, said out loud: a PDF, or a book this device cannot go and get.
  onSay: (line: string) => void;
  // A book was filed under the topic on this device: the topics are stale.
  onImported: () => Promise<void>;
}) {
  if (props.topic) {
    return (
      <TopicShelf
        topic={props.topic}
        entries={props.entries}
        onOpenBook={props.onOpenBook}
        onBack={props.onBack}
        onSay={props.onSay}
        onImported={props.onImported}
      />
    );
  }
  return <TopicList topics={props.topics} onOpen={props.onOpenTopic} onBack={props.onBack} />;
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
      <div className="flex items-center justify-between gap-3">
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

function TopicList(props: {
  topics: Topic[] | null;
  onOpen: (topicId: string) => void;
  onBack: () => void;
}) {
  const topics = props.topics ?? [];
  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <Header
        title="Library"
        sub={props.topics === null ? "…" : topicLine(topics)}
        backLabel="Home"
        onBack={props.onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-safe-6">
        {topics.length === 0 ? (
          <p className="m-0 text-[14px] text-faint-foreground">
            No topics yet. They are made on the desk.
          </p>
        ) : (
          <ul className={`${LIBRARY_GRID} grid-cols-2`}>
            {topics.map((topic) => (
              <li key={topic.id}>
                <button className={LIBRARY_CARD} onClick={() => props.onOpen(topic.id)}>
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
    </div>
  );
}

function topicLine(topics: Topic[]): string {
  const n = topics.length;
  return `${n} topic${n === 1 ? "" : "s"}`;
}

function TopicShelf(props: {
  topic: Topic;
  entries: Record<string, LibraryEntry>;
  onOpenBook: (book: PhoneBookOpen) => void;
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

  const materials = shelfMaterials(files, entries, onDevice ?? new Set());
  const books = materials.filter((m) => !m.article);
  const articles = materials.filter((m) => m.article);

  const tap = useCallback(
    async (m: ShelfMaterial): Promise<void> => {
      // Nothing is tappable before the shelf knows what is on the device: a tap
      // then would download a book that is already here.
      if (onDevice === null) return;
      const action = materialTap(m, can);
      if (action.kind === "pdf") return props.onSay(PDF_ELSEWHERE);
      if (action.kind === "unavailable") return props.onSay(action.why);
      if (action.kind === "open") {
        return props.onOpenBook({
          bookId: m.bookId as string,
          name: m.title,
          topicId: topic.id,
          path: m.file.path,
        });
      }
      setDownloading(action.bookId);
      try {
        await fetchBook(action.bookId);
        await readOnDevice();
        setCoverRevision((n) => n + 1);
        props.onOpenBook({
          bookId: action.bookId,
          name: m.title,
          topicId: topic.id,
          path: m.file.path,
        });
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
    <div className="absolute inset-0 flex flex-col bg-background">
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
                <li key={m.file.path}>
                  <button className={LIBRARY_CARD} onClick={() => void tap(m)}>
                    <CoverBand tiles={singleCoverTile(m.file)} revision={coverRevision} />
                    <span className={BOOK_LABEL}>
                      <span className={BOOK_TITLE} title={m.file.name}>
                        {m.title}
                      </span>
                      <span className={BOOK_READ}>
                        {materialNote(m, downloading === m.bookId) ?? ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {articles.length > 0 && (
              <ul className={`${ROW_LIST} mt-6`}>
                {articles.map((m) => (
                  <li key={m.file.path} className={ROW}>
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
    </div>
  );
}
