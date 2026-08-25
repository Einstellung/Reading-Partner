// The library home screen: the shelf of topics and, one level in, one topic.
// The shelf and the topic's Materials section are the same grid of cover cards
// (cardStyles.ts, CoverBand, CardMenu); what differs is the label under the band
// and what the menu offers. This file owns which dialog is open; the topic list
// itself and which one is active stay on App, which needs them for the reading
// context.
//
// A topic has a sidebar down its left (docs/31, "界面"): Materials, Retell, AI
// observations. Which section is showing and whether the sidebar is open live
// here — they are view state of this screen and nothing above it reads them.
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
import { getViewState } from "../../../platform/app/storage";
import { getFulltext } from "../../../fulltext";
import { loadAnnotations } from "../../../platform/app/annotations";
import {
  formatPublishedAt,
  loadSavedArticles,
  removeSavedArticle,
  savedArticlesForTopic,
  type SavedArticle,
} from "../../../reading/saved-articles";
import { createRetell } from "../../../reading/retell";
import RetellView from "../retell/RetellView";
import RehearsalScreen from "../rehearsal/RehearsalScreen";
import type { Rehearsal } from "../../../reading/rehearsal";
import { Button } from "../ui/button";
import BookCard from "../shelf/BookCard";
import { ADD_CARD, ADD_CARD_BOX, CARD_LABEL, LIBRARY_GRID, LIBRARY_PAGE } from "../shelf/cardStyles";
import DeleteTopicButton from "./DeleteTopicButton";
import { displayFileTitle, type BookMeta } from "../shelf/file-title";
import RemoveFileButton from "./RemoveFileButton";
import SavedArticleView from "./SavedArticleView";
import TopicCard from "../shelf/TopicCard";
import NameDialog from "../common/NameDialog";
import { shelfOrder, TOPIC_GRID_COLUMNS_CLASS } from "../shelf/topic-shelf";
import ObservationSection from "./topic/ObservationSection";
import RehearsalSection from "./topic/RehearsalSection";
import RetellSection from "./topic/RetellSection";
import TopicNav from "./topic/TopicNav";
import {
  browserNavStore,
  DEFAULT_SECTION,
  readNavEnv,
  readNavOpen,
  writeNavOpen,
  type TopicSection,
} from "../base/topic-nav";

const GRID = `${LIBRARY_GRID} ${TOPIC_GRID_COLUMNS_CLASS}`;
const PAGE_TITLE = "mt-0 mb-6 mx-0 text-[22px] font-bold";
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
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  // A topic or file was created / renamed / deleted on disk: reload the list.
  onTopicsChanged: () => Promise<void> | void;
}) {
  // Articles kept out of a briefing (docs/21), and which one is being read.
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [openSavedArticle, setOpenSavedArticle] = useState<SavedArticle | null>(null);
  const { activeTopic } = props;

  // The sidebar. Read once at mount, like the shell choice it shares its
  // measurements with: following a rotation would reopen a sidebar the user
  // closed. The section resets to Materials with every topic — a topic is
  // entered to read, and Retell is where you go on purpose.
  const [section, setSection] = useState<TopicSection>(DEFAULT_SECTION);
  // The retell being prepared, if any. Nothing else on this screen changes while
  // one is open, so leaving it is one setState.
  const [openRetellId, setOpenRetellId] = useState<string | null>(null);
  // The deck being given, if any (docs/43). A rehearsal replaces the sections
  // the way a retell does rather than covering them: the section it is started
  // from sits inside a scrolling column, which would clip a full-screen cover.
  const [openRehearsal, setOpenRehearsal] = useState<Rehearsal | null>(null);
  // Bumped when a pass reaches disk, which is the only moment this device
  // changes the counts the section shows.
  const [rehearsalKey, setRehearsalKey] = useState(0);
  const [navOpen, setNavOpen] = useState(() =>
    readNavOpen(browserNavStore(window), readNavEnv(window)),
  );
  const toggleNav = useCallback(() => {
    setNavOpen((open) => {
      writeNavOpen(browserNavStore(window), !open);
      return !open;
    });
  }, []);
  useEffect(() => {
    setSection(DEFAULT_SECTION);
    setOpenRetellId(null);
    setOpenRehearsal(null);
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
    return (
      <RehearsalScreen
        key={openRehearsal.id}
        rehearsal={openRehearsal}
        onBack={() => setOpenRehearsal(null)}
        onSaved={() => setRehearsalKey((n) => n + 1)}
      />
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

  // One topic: the sidebar beside a column that scrolls. The sidebar is a column
  // in the flow rather than a drawer over the content, so the shelf narrows
  // instead of being covered and nothing has to be dismissed to reach a card.
  if (activeTopic) {
    return (
      <div className="absolute inset-0 flex items-stretch bg-background">
        <TopicNav
          section={section}
          onSelect={(next) => {
            if (next === "observations") logEvent(activeTopic.id, "observations-open");
            setSection(next);
          }}
          open={navOpen}
          onToggle={toggleNav}
        />
        {section === "observations" ? (
          // The panel scrolls inside itself, so this column does not scroll.
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* No second width utility here: LIBRARY_PAGE owns it (docs/30). */}
            <div className={`${LIBRARY_PAGE} flex min-h-0 flex-1 flex-col`}>
              <h1 className={PAGE_TITLE}>{activeTopic.name}</h1>
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
                <ObservationSection topicId={activeTopic.id} />
              </div>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1 overflow-y-auto">
            <div className={LIBRARY_PAGE}>
              <h1 className={PAGE_TITLE}>{activeTopic.name}</h1>
              {section === "rehearsal" ? (
                <RehearsalSection
                  topic={activeTopic}
                  reloadKey={rehearsalKey}
                  onStart={setOpenRehearsal}
                />
              ) : section === "retell" ? (
                <RetellSection topic={activeTopic} onOpenRetell={setOpenRetellId} />
              ) : (
                <TopicMaterials
                  topic={activeTopic}
                  savedArticles={savedArticles}
                  onAddFile={props.onAddFile}
                  onOpenFile={props.onOpenFile}
                  onRetell={(f) => void startRetellOn(f)}
                  onRemoveFile={async (p) => {
                    await removeFileFromTopic(activeTopic.id, p);
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

// The last tile in a grid: the one that adds something rather than opening it.
// Same two pieces as a card, so it is the same size as the cards beside it.
function AddCard(props: { label: string; onClick: () => void }) {
  return (
    <li>
      <button className={ADD_CARD} onClick={props.onClick}>
        <span className={ADD_CARD_BOX}>
          <span aria-hidden className="text-[30px] leading-none font-light">
            +
          </span>
          <span className="text-[13px]">{props.label}</span>
        </span>
        <span className={CARD_LABEL} />
      </button>
    </li>
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
      <h1 className={PAGE_TITLE}>Topics</h1>

      {topics.length === 0 ? (
        <EmptyState
          title="Nothing on the shelf yet"
          blurb={`${NEW_TOPIC_BLURB} Name the question first; the PDFs go in after.`}
          action="New topic"
          onAction={() => setCreating(true)}
        />
      ) : (
        <ul className={GRID}>
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              onOpen={() => props.onOpen(t)}
              onRename={() => setRenaming(t)}
              onDelete={() => setDeleting(t)}
            />
          ))}
          <AddCard label="New topic" onClick={() => setCreating(true)} />
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
  // Already filtered to this topic and newest-first by the host.
  savedArticles: SavedArticle[];
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  // Start a retell of this one book and go straight into it.
  onRetell: (file: FileRef) => void;
  onRemoveFile: (path: string) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onRemoveSavedArticle: (id: string) => void;
}) {
  const files = sortedFiles(props.topic);
  const [meta, setMeta] = useState<Record<string, BookMeta>>({});
  const [removing, setRemoving] = useState<FileRef | null>(null);

  // Loaded off the render path, per file, keyed by book id (content hash). Every
  // read is optional: a book that was never opened has no state, no full-text
  // cache and no annotation file — the normal case, not an error. A file without
  // a book id yet (added but never opened since the upgrade) shows no meta line.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      props.topic.files.map(async (f): Promise<[string, BookMeta]> => {
        if (!f.hash) return [f.path, { marks: 0 }];
        const [state, fulltext, annotations] = await Promise.all([
          getViewState(f.hash).catch(() => null),
          getFulltext(f.hash).catch(() => null),
          loadAnnotations(f.hash).catch(() => []),
        ]);
        return [
          f.path,
          {
            page: state ? state.pageIndex + 1 : undefined,
            pages: fulltext?.pages.length || undefined,
            marks: annotations.length,
          },
        ];
      }),
    ).then((entries) => {
      if (!cancelled) setMeta(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [props.topic]);

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
          <AddCard label="Add PDF" onClick={props.onAddFile} />
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
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          onRemove={() => props.onRemoveFile(removing.path)}
        />
      )}
    </>
  );
}
