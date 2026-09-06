// The library home screen: the shelf of topics and, one level in, one topic.
// The shelf and the topic's Materials section are the same grid of cover cards
// (cardStyles.ts, CoverBand, CardMenu); what differs is the label under the band
// and what the menu offers. This file owns which dialog is open; the topic list
// itself and which one is active stay on App, which needs them for the reading
// context.
//
// A topic's four sections are a row of tabs under its name (docs/51): Materials,
// Retell, Rehearsal, AI observations. Which one is showing lives here — it is
// view state of this screen and nothing above it reads it.
//
// An open retell replaces the whole topic while it lasts (the same move the saved
// article reader makes), so entering one needs no route and leaving it puts the
// topic back as it was. A retell runs on material read from disk, so nothing above
// this screen has to know a retell is happening.

import { useCallback, useEffect, useState } from "react";
import {
  createTopic,
  deleteTopic,
  removeFileFromTopic,
  renameTopic,
  sortedFiles,
  type FileRef,
  type Topic,
} from "../../../platform/app/topics";
import { logEvent } from "../../../platform/app/events";
import { deleteBook } from "../../../reading/delete/delete-book";
import { isLastReferenceToBook } from "../../../reading/delete/pick";
import {
  formatPublishedAt,
  loadSavedArticles,
  removeSavedArticle,
  savedArticlesForTopic,
  type SavedArticle,
} from "../../../reading/saved-articles";
import { createRetell } from "../../../reading/retell";
import RetellView from "../retell/RetellView";
import CoachView from "../rehearsal/CoachView";
import MaterialFigureScope from "../common/MaterialFigureScope";
import RehearsalScreen from "../rehearsal/RehearsalScreen";
import type { Rehearsal } from "../../../reading/rehearsal";
import { Button } from "../ui/button";
import BookCard from "../shelf/BookCard";
import { readBookMeta } from "../shelf/book-meta";
import {
  HEADER_ACTION,
  LIBRARY_GRID,
  LIBRARY_PAGE,
  PAGE_EYEBROW,
  PAGE_HEADER,
  PAGE_HEADER_TEXT,
  PAGE_SUB,
  PAGE_TITLE,
} from "../shelf/cardStyles";
import DeleteTopicButton from "./DeleteTopicButton";
import { displayFileTitle, type BookMeta } from "../shelf/file-title";
import RemoveFileButton from "./RemoveFileButton";
import SavedArticleView from "./SavedArticleView";
import TopicCard from "../shelf/TopicCard";
import NameDialog from "../common/NameDialog";
import { shelfHeaderLine, shelfOrder, TOPIC_GRID_COLUMNS_CLASS } from "../shelf/topic-shelf";
import ObservationSection from "./topic/ObservationSection";
import RehearsalSection from "./topic/RehearsalSection";
import RetellSection from "./topic/RetellSection";
import TopicNav from "./topic/TopicNav";
import { topicHeaderLine } from "./topic/topic-header";
import { DEFAULT_SECTION, type TopicSection } from "../base/topic-nav";

const GRID = `${LIBRARY_GRID} ${TOPIC_GRID_COLUMNS_CLASS}`;
// The list rows that are still rows: a saved article has no cover to show.
const ROW_LIST = "list-none m-0 p-0 flex flex-col gap-1.5";
const ROW = "flex items-center gap-2 border border-border rounded-lg py-1 pl-1 pr-1.5";
// min-w-0: without it a flex item cannot shrink below its content, and a long
// title pushes the row past the container into a horizontal scroll.
const ROW_NAME =
  "min-w-0 flex-1 flex items-baseline gap-2.5 text-left px-2.5 py-2 border-0 bg-transparent cursor-pointer text-[15px] rounded-md can-hover:hover:bg-muted";

export default function LibraryScreen(props: {
  topics: Topic[];
  activeTopic: Topic | null;
  onOpenTopic: (topic: Topic) => void;
  // Leave the open topic for the shelf. The list of topics and which one is
  // active belong to App, which needs them for the reading context.
  onCloseTopic: () => void;
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  // A topic or file was created / renamed / deleted on disk: reload the list.
  onTopicsChanged: () => Promise<void> | void;
}) {
  // Articles kept out of a briefing (docs/21), and which one is being read.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [openSavedArticle, setOpenSavedArticle] = useState<SavedArticle | null>(null);
  const { activeTopic } = props;

  // Which tab is showing. It resets to Materials with every topic — a topic is
  // entered to read, and Retell is where you go on purpose.
  const [section, setSection] = useState<TopicSection>(DEFAULT_SECTION);
  // The retell being prepared, if any. Nothing else on this screen changes while
  // one is open, so leaving it is one setState.
  const [openRetellId, setOpenRetellId] = useState<string | null>(null);
  // The talk being given, if any (docs/43). A rehearsal replaces the sections
  // the way a retell does rather than covering them: the section it is started
  // from sits inside a scrolling column, which would clip a full-screen cover.
  const [openRehearsal, setOpenRehearsal] = useState<Rehearsal | null>(null);
  // The talk whose conversation is open, which is where a pass is handed in
  // (docs/44). Held as the outline's id and not as the rehearsal's: the
  // conversation belongs to the talk and spans every pass over it.
  const [coachOutlineId, setCoachOutlineId] = useState<string | null>(null);
  // A pass has been given and is not on disk yet — the last of the speech is
  // still coming back from the recogniser.
  const [passPending, setPassPending] = useState(false);
  // Bumped when a pass has landed in the conversation, so the coach reads it.
  const [passKey, setPassKey] = useState(0);
  // Bumped when a pass reaches disk, which is the only moment this device
  // changes the counts the section shows.
  const [rehearsalKey, setRehearsalKey] = useState(0);
  // What the header counts and the Materials grid labels: reading position,
  // length and marks, per file, keyed by path. Loaded off the render path; every
  // read is optional (book-meta.ts).
  const [meta, setMeta] = useState<Record<string, BookMeta>>({});
  useEffect(() => {
    if (!activeTopic) {
      setMeta({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      activeTopic.files.map(async (f): Promise<[string, BookMeta]> => [f.path, await readBookMeta(f)]),
    ).then((entries) => {
      if (!cancelled) setMeta(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [activeTopic]);
  useEffect(() => {
    setSection(DEFAULT_SECTION);
    setOpenRetellId(null);
    setOpenRehearsal(null);
    setCoachOutlineId(null);
  }, [activeTopic?.id]);

  // Retell one book: a retell of its own, entered straight away (docs/31 — the
  // entry is in the topic, on the material). A file with no book id has nothing
  // on disk to retell from, so the card does not offer it.
  const startRetellOn = useCallback(
    async (file: FileRef) => {
      if (!activeTopic || !file.hash) return;
      const retell = await createRetell(activeTopic.id, [
        { bookId: file.hash, title: displayFileTitle(file.name) },
      ]);
      setOpenRetellId(retell.id);
    },
    [activeTopic],
  );

  // Reloaded whenever the open topic changes: a keep that happened while the
  // reader was over in the briefing has to show up here.
  const refreshSavedArticles = useCallback(async () => {
    if (!activeTopic) {
      setSavedArticles([]);
      return;
    }
    const all = await loadSavedArticles().catch((): SavedArticle[] => []);
    setSavedArticles(savedArticlesForTopic(all, activeTopic.id));
  }, [activeTopic]);

  useEffect(() => {
    void refreshSavedArticles();
  }, [refreshSavedArticles]);

  if (openSavedArticle) {
    return <SavedArticleView article={openSavedArticle} onBack={() => setOpenSavedArticle(null)} />;
  }

  if (activeTopic && openRehearsal) {
    const outlineId = openRehearsal.outlineId;
    return (
      <RehearsalScreen
        key={openRehearsal.id}
        rehearsal={openRehearsal}
        // A pass hands itself in (docs/44), so leaving one lands in the talk's
        // conversation rather than back on the section it was opened from. The
        // pass itself is still being written at this point — the coach's view
        // says so until onSaved lands. A talk that was opened to read goes
        // straight back to the section instead: there is no pass to answer.
        onBack={(gave) => {
          if (gave) {
            setCoachOutlineId(outlineId);
            setPassPending(true);
          }
          setOpenRehearsal(null);
        }}
        onSaved={(recorded) => {
          setPassPending(false);
          if (!recorded) return;
          setRehearsalKey((n) => n + 1);
          setPassKey((n) => n + 1);
        }}
      />
    );
  }

  if (activeTopic && coachOutlineId) {
    // The coach reads the note and can name a figure in it, so it gets the same
    // figure scope the retell's copy of this view gets — reached from the topic
    // it must not behave differently. The outline is all this door knows; the
    // scope reads the retell off it.
    return (
      <MaterialFigureScope outlineId={coachOutlineId}>
        <CoachView
          key={coachOutlineId}
          outlineId={coachOutlineId}
          topicName={activeTopic.name}
          backLabel="Back to the topic"
          passKey={passKey}
          pending={passPending}
          onBack={() => setCoachOutlineId(null)}
        />
      </MaterialFigureScope>
    );
  }

  if (activeTopic && openRetellId) {
    return (
      <RetellView
        key={openRetellId}
        retellId={openRetellId}
        topicName={activeTopic.name}
        onBack={() => setOpenRetellId(null)}
      />
    );
  }

  // One topic: a header that does not scroll — the way back, the name, what is
  // in it, and the four sections as tabs — over the section that does.
  if (activeTopic) {
    return (
      <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
        <div className="flex-none border-b border-border-subtle px-6 pt-6">
          <div className="mx-auto w-[min(1180px,100%)]">
            <div className={PAGE_HEADER}>
              <div className={PAGE_HEADER_TEXT}>
                <Button
                  variant="link"
                  size="link"
                  className="text-[13px] text-muted-foreground underline-offset-4 can-hover:hover:underline"
                  onClick={props.onCloseTopic}
                >
                  ‹ All topics
                </Button>
                <h1 className="mx-0 mt-1.5 mb-0 font-display text-[22px] font-bold">
                  {activeTopic.name}
                </h1>
                <p className="mx-0 mt-1.5 mb-0 text-[13px] text-muted-foreground">
                  {topicHeaderLine(activeTopic, meta, new Date())}
                </p>
              </div>
              {/* Only on Materials: the other three sections have nothing to add
                  a PDF to, and a button that acts on a section you cannot see is
                  a button in the wrong place. */}
              {section === "materials" && (
                <Button className={HEADER_ACTION} onClick={props.onAddFile}>
                  + Add PDF
                </Button>
              )}
            </div>
            <div className="mt-3">
              <TopicNav
                section={section}
                onSelect={(next) => {
                  if (next === "observations") logEvent(activeTopic.id, "observations-open");
                  setSection(next);
                }}
              />
            </div>
          </div>
        </div>

        {section === "observations" ? (
          // The panel scrolls inside itself, so this column does not scroll.
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* No second width utility here: LIBRARY_PAGE owns it (docs/30). */}
            <div className={`${LIBRARY_PAGE} flex min-h-0 flex-1 flex-col`}>
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
                <ObservationSection topicId={activeTopic.id} />
              </div>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className={LIBRARY_PAGE}>
              {section === "rehearsal" ? (
                <RehearsalSection
                  topic={activeTopic}
                  reloadKey={rehearsalKey}
                  onStart={setOpenRehearsal}
                  onTalk={setCoachOutlineId}
                />
              ) : section === "retell" ? (
                <RetellSection topic={activeTopic} onOpenRetell={setOpenRetellId} />
              ) : (
                <TopicMaterials
                  topic={activeTopic}
                  topics={props.topics}
                  meta={meta}
                  savedArticles={savedArticles}
                  onAddFile={props.onAddFile}
                  onOpenFile={props.onOpenFile}
                  onRetell={(f) => void startRetellOn(f)}
                  onRemoveFile={async (p) => {
                    await removeFileFromTopic(activeTopic.id, p);
                    await props.onTopicsChanged();
                  }}
                  // deleteBook unlinks the book from every topic itself, so the
                  // shelf reread below is the only thing left to do here.
                  onDeleteBook={async (bookId) => {
                    await deleteBook(bookId);
                    await props.onTopicsChanged();
                  }}
                  onOpenSavedArticle={setOpenSavedArticle}
                  onRemoveSavedArticle={async (id) => {
                    await removeSavedArticle(id);
                    await refreshSavedArticles();
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-6 bg-background overflow-y-auto">
      <TopicLibrary
        topics={props.topics}
        onCreate={async (name) => {
          await createTopic(name);
          await props.onTopicsChanged();
        }}
        onRename={async (topic, name) => {
          await renameTopic(topic.id, name);
          await props.onTopicsChanged();
        }}
        // Confirmed in DeleteTopicButton, which is what calls this.
        onDelete={async (t) => {
          await deleteTopic(t.id);
          await props.onTopicsChanged();
        }}
        onOpen={props.onOpenTopic}
      />
    </div>
  );
}

// A topic is a question, so the placeholder is one and so is the empty state's
// sentence.
const NEW_TOPIC_PLACEHOLDER = "e.g. what makes JITs fast";
const NEW_TOPIC_BLURB = "A topic is one question and the books you read against it.";

// The empty shelf both screens draw when they have nothing: three book-shaped
// outlines standing on a line, so an empty screen says what a full one will look
// like instead of being white.
function EmptyShelf() {
  return (
    <div
      aria-hidden
      className="mx-auto flex h-32 w-44 items-end justify-center gap-2.5 border-b border-border"
    >
      <span className="block h-[64%] w-[28%] rounded-[2px] border border-dashed border-secondary-border" />
      <span className="block h-[88%] w-[28%] rounded-[2px] border border-dashed border-secondary-border" />
      <span className="block h-[74%] w-[28%] rounded-[2px] border border-dashed border-secondary-border" />
    </div>
  );
}

function EmptyState(props: { title: string; blurb: string; action: string; onAction: () => void }) {
  return (
    <div className="mx-auto max-w-sm pt-14 pb-16 text-center">
      <EmptyShelf />
      <p className="mt-7 mb-0 text-[17px] font-medium">{props.title}</p>
      <p className="mt-2 mb-0 text-sm text-muted-foreground">{props.blurb}</p>
      <Button size="lg" className="mt-6" onClick={props.onAction}>
        {props.action}
      </Button>
    </div>
  );
}

function TopicLibrary(props: {
  topics: Topic[];
  onCreate: (name: string) => void;
  onRename: (topic: Topic, name: string) => void;
  onDelete: (topic: Topic) => void;
  onOpen: (topic: Topic) => void;
}) {
  // Which dialog is up. Each is mounted only while it is open, so its field
  // starts from the right value every time.
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Topic | null>(null);
  const [deleting, setDeleting] = useState<Topic | null>(null);
  const topics = shelfOrder(props.topics);

  return (
    <div className={LIBRARY_PAGE}>
      <div className={PAGE_HEADER}>
        <div className={PAGE_HEADER_TEXT}>
          <span className={PAGE_EYEBROW}>Your topics</span>
          <h1 className={PAGE_TITLE}>Topics</h1>
          <p className={PAGE_SUB}>
            {topics.length === 0 ? NEW_TOPIC_BLURB : shelfHeaderLine(topics)}
          </p>
        </div>
        {/* An empty shelf makes its topic from the empty state's own button,
            which is the only thing on the page. */}
        {topics.length > 0 && (
          <Button className={HEADER_ACTION} onClick={() => setCreating(true)}>
            + New topic
          </Button>
        )}
      </div>

      {topics.length === 0 ? (
        <EmptyState
          title="Nothing on the shelf yet"
          blurb={`${NEW_TOPIC_BLURB} Name the question first; the PDFs go in after.`}
          action="New topic"
          onAction={() => setCreating(true)}
        />
      ) : (
        <ul className={`${GRID} mt-6`}>
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              onOpen={() => props.onOpen(t)}
              onRename={() => setRenaming(t)}
              onDelete={() => setDeleting(t)}
            />
          ))}
        </ul>
      )}

      {creating && (
        <NameDialog
          open
          onOpenChange={setCreating}
          title="New topic"
          description={NEW_TOPIC_BLURB}
          placeholder={NEW_TOPIC_PLACEHOLDER}
          confirmLabel="Create"
          onConfirm={props.onCreate}
        />
      )}
      {renaming && (
        <NameDialog
          open
          onOpenChange={(open) => !open && setRenaming(null)}
          title="Rename topic"
          description="Only the name changes. The reading list stays as it is."
          confirmLabel="Save"
          initialValue={renaming.name}
          onConfirm={(name) => props.onRename(renaming, name)}
        />
      )}
      {deleting && (
        <DeleteTopicButton
          topicName={deleting.name}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onDelete={() => props.onDelete(deleting)}
        />
      )}
    </div>
  );
}

// The Materials section: the topic's shelf, unchanged. The page column and the
// topic's name are the sidebar shell's now, because every section wears them.
function TopicMaterials(props: {
  topic: Topic;
  // Every topic, for the one question this section asks of them: whether the
  // book being taken out of this one is anywhere else (pick.ts).
  topics: Topic[];
  // Reading position, length and marks per file, keyed by path; read by the
  // host, which needs the same numbers for the topic's header line.
  meta: Record<string, BookMeta>;
  // Already filtered to this topic and newest-first by the host.
  savedArticles: SavedArticle[];
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  // Start a retell of this one book and go straight into it.
  onRetell: (file: FileRef) => void;
  onRemoveFile: (path: string) => void;
  // Take the book itself away, with everything about it.
  onDeleteBook: (bookId: string) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onRemoveSavedArticle: (id: string) => void;
}) {
  const files = sortedFiles(props.topic);
  const meta = props.meta;
  const [removing, setRemoving] = useState<FileRef | null>(null);
  // Whether the confirmation is offering to unlink or to delete.
  const lastReference = removing
    ? isLastReferenceToBook(props.topics, props.topic.id, removing)
    : false;

  return (
    <>
      {files.length === 0 ? (
        <EmptyState
          title="No books in this topic yet"
          blurb="Add the PDFs you want to read against this question. They are read where they are; nothing is copied or moved."
          action="Add PDF"
          onAction={props.onAddFile}
        />
      ) : (
        <ul className={GRID}>
          {files.map((f) => (
            <BookCard
              key={f.path}
              file={f}
              meta={meta[f.path]}
              onOpen={() => props.onOpenFile(f)}
              onRetell={f.hash ? () => props.onRetell(f) : undefined}
              onRemove={() => setRemoving(f)}
            />
          ))}
        </ul>
      )}

      {props.savedArticles.length > 0 && (
        <>
          {/* Articles are rows, not cards: a kept web page has no cover, and a
              grid of blank tiles would say less than a line of text. */}
          <h2 className="mt-10 mb-3 text-[15px] font-semibold text-foreground">Saved articles</h2>
          <ul className={ROW_LIST}>
            {props.savedArticles.map((a) => {
              const line = [a.sourceName, formatPublishedAt(a.publishedAt)]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={a.id} className={ROW}>
                  <button className={ROW_NAME} onClick={() => props.onOpenSavedArticle(a)}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{a.title}</span>
                      {line && <span className="text-xs text-muted-foreground">{line}</span>}
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <Button
                      variant="destructive-outline"
                      size="sm"
                      onClick={() => props.onRemoveSavedArticle(a.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {removing && (
        <RemoveFileButton
          title={displayFileTitle(removing.name)}
          lastReference={lastReference}
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          onRemove={() =>
            lastReference && removing.hash
              ? props.onDeleteBook(removing.hash)
              : props.onRemoveFile(removing.path)
          }
        />
      )}
    </>
  );
}
