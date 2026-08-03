// The library home screen: the shelf of topics and one topic's file list. Owns
// which dialog is open (new topic, rename, delete confirmation); the topic list
// itself and which one is active stay on App, which needs them for the reading
// context.

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
import { Button } from "../ui/button";
import DeleteTopicButton from "./DeleteTopicButton";
import SavedArticleView from "./SavedArticleView";
import TopicCard from "./TopicCard";
import TopicNameDialog from "./TopicNameDialog";
import { shelfOrder, TOPIC_GRID_COLUMNS_CLASS } from "./topic-shelf";

const LIBRARY = "w-[min(680px,100%)] mx-auto px-6 py-10";
// The shelf is wider than a list ever was: five columns of cards need the room,
// and a topic name is short. The safe-area padding is the design's own gutter
// wherever there is no inset (styles.css takes the larger of the two), so this
// column never has to know which device it is on.
const SHELF_PAGE = "w-[min(1180px,100%)] mx-auto pt-8 pb-safe-10 pl-safe-6 pr-safe-6";
const TOPIC_LIST = "list-none m-0 p-0 flex flex-col gap-1.5";
const TOPIC_ROW = "flex items-center gap-2 border border-[#dcdcdc] rounded-lg py-1 pl-1 pr-1.5";
// min-w-0: without it a flex item cannot shrink below its content, and a long
// topic name pushes the row past the container into a horizontal scroll.
const TOPIC_NAME =
  "min-w-0 flex-1 flex items-baseline gap-2.5 text-left px-2.5 py-2 border-0 bg-transparent cursor-pointer text-[15px] rounded-md hover:bg-[#f0f0f0]";

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

  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-6 bg-white overflow-y-auto">
      {activeTopic ? (
        <TopicDetail
          topic={activeTopic}
          savedArticles={savedArticles}
          onAddFile={props.onAddFile}
          onOpenFile={props.onOpenFile}
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
      ) : (
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
      )}
    </div>
  );
}

// A topic is a question, so the placeholder is one and so is the empty state's
// sentence.
const NEW_TOPIC_PLACEHOLDER = "e.g. what makes JITs fast";
const NEW_TOPIC_BLURB = "A topic is one question and the books you read against it.";

// The card that creates a topic. Same corner radius and column width as a topic
// card, dashed rather than drawn, and no cover area of its own — an outline of a
// card is a slot, and a slot is what an empty place on a shelf looks like. The
// minimum height keeps it card-shaped when it is alone on its row, where a grid
// item has no siblings to take its height from.
const NEW_CARD =
  "flex h-full min-h-[14rem] w-full cursor-pointer flex-col items-center justify-center gap-2 " +
  "rounded-xl border-2 border-dashed border-border bg-background text-muted-foreground " +
  "can-hover:hover:border-primary can-hover:hover:text-primary";

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
    <div className={SHELF_PAGE}>
      <h1 className="mt-0 mb-6 mx-0 text-[22px] font-bold">Topics</h1>

      {topics.length === 0 ? (
        <div className="mx-auto max-w-sm pt-14 pb-16 text-center">
          {/* An empty shelf drawn the way a card's is, so the empty screen says
              what a full one will look like instead of being white. */}
          <div
            aria-hidden
            className="mx-auto flex h-36 w-52 items-end justify-center gap-2 rounded-xl bg-muted p-4"
          >
            <span className="block h-[64%] w-[24%] rounded-[3px] border border-dashed border-secondary-border bg-background/60" />
            <span className="block h-[86%] w-[24%] rounded-[3px] border border-dashed border-secondary-border bg-background/60" />
            <span className="block h-[72%] w-[24%] rounded-[3px] border border-dashed border-secondary-border bg-background/60" />
          </div>
          <p className="mt-7 mb-0 text-[17px] font-medium">Nothing on the shelf yet</p>
          <p className="mt-2 mb-0 text-sm text-muted-foreground">
            {NEW_TOPIC_BLURB} Name the question first; the PDFs go in after.
          </p>
          <Button size="lg" className="mt-6" onClick={() => setCreating(true)}>
            New topic
          </Button>
        </div>
      ) : (
        <ul className={`grid list-none m-0 p-0 gap-x-5 gap-y-7 ${TOPIC_GRID_COLUMNS_CLASS}`}>
          {topics.map((t) => (
            <TopicCard
              key={t.id}
              topic={t}
              onOpen={() => props.onOpen(t)}
              onRename={() => setRenaming(t)}
              onDelete={() => setDeleting(t)}
            />
          ))}
          <li>
            <button className={NEW_CARD} onClick={() => setCreating(true)}>
              <span aria-hidden className="text-[30px] leading-none font-light">
                +
              </span>
              <span className="text-sm">New topic</span>
            </button>
          </li>
        </ul>
      )}

      {creating && (
        <TopicNameDialog
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
        <TopicNameDialog
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

// Per-book reading metadata. `page`/`pages` are absent until the book has been
// opened at least once (no reading position, no full-text cache).
interface BookMeta {
  page?: number; // 1-based
  pages?: number;
  marks: number;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function relativeTime(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${plural(days, "day")} ago`;
  return new Date(ts).toLocaleDateString();
}

// Empty for a book that was never opened, which renders as no second line.
function metaLine(meta: BookMeta | undefined, lastOpenedAt?: number): string {
  const parts: string[] = [];
  if (meta?.page) {
    parts.push(meta.pages ? `Page ${meta.page} of ${meta.pages}` : `Page ${meta.page}`);
  }
  if (meta?.marks) parts.push(plural(meta.marks, "mark"));
  if (lastOpenedAt) parts.push(relativeTime(lastOpenedAt));
  return parts.join(" · ");
}

function TopicDetail(props: {
  topic: Topic;
  // Already filtered to this topic and newest-first by the host.
  savedArticles: SavedArticle[];
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  onRemoveFile: (path: string) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onRemoveSavedArticle: (id: string) => void;
}) {
  const files = sortedFiles(props.topic);
  const [meta, setMeta] = useState<Record<string, BookMeta>>({});

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
    <div className={LIBRARY}>
      <div className="flex items-center justify-between mb-4">
        <h1 className="m-0 text-[22px] font-bold">{props.topic.name}</h1>
        <Button variant="outline" onClick={props.onAddFile}>
          Add PDF
        </Button>
      </div>
      {files.length === 0 && <p className="my-3.5 text-[#777] text-sm">No files yet. Add a PDF to this topic.</p>}
      <ul className={TOPIC_LIST}>
        {files.map((f) => {
          const line = metaLine(meta[f.path], f.lastOpenedAt);
          return (
            <li key={f.path} className={TOPIC_ROW}>
              <button className={TOPIC_NAME} onClick={() => props.onOpenFile(f)}>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{f.name}</span>
                  {line && <span className="text-xs text-[#777]">{line}</span>}
                </span>
              </button>
              <div className="flex gap-1">
                <Button variant="destructive-outline" size="sm" onClick={() => props.onRemoveFile(f.path)}>
                  Remove
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {props.savedArticles.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-[15px] font-semibold text-[#444]">Saved articles</h2>
          <ul className={TOPIC_LIST}>
            {props.savedArticles.map((a) => {
              const line = [a.sourceName, formatPublishedAt(a.publishedAt)]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={a.id} className={TOPIC_ROW}>
                  <button className={TOPIC_NAME} onClick={() => props.onOpenSavedArticle(a)}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{a.title}</span>
                      {line && <span className="text-xs text-[#777]">{line}</span>}
                    </span>
                  </button>
                  <div className="flex gap-1">
                    <Button variant="destructive-outline" size="sm" onClick={() => props.onRemoveSavedArticle(a.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
