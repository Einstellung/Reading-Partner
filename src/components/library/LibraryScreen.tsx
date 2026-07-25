// The library home screen: the topic list and one topic's file list. Owns the
// topic CRUD form state (new name, rename-in-place); the topic list itself and
// which one is active stay on App, which needs them for the reading context.

import { useEffect, useState } from "react";
import {
  createTopic,
  deleteTopic,
  removeFileFromTopic,
  renameTopic,
  sortedFiles,
  type FileRef,
  type Topic,
} from "../../platform/app/topics";
import { getViewState } from "../../platform/app/storage";
import { getFulltext } from "../../fulltext";
import { loadAnnotations } from "../../platform/app/annotations";
import { BTN, BTN_SM, BTN_SM_DANGER } from "../common/buttons";

const INPUT = "flex-1 px-2.5 py-2 border border-[#dcdcdc] rounded-md [font:inherit]";
const LIBRARY = "w-[min(680px,100%)] mx-auto px-6 py-10";
const TOPIC_LIST = "list-none m-0 p-0 flex flex-col gap-1.5";
const TOPIC_ROW = "flex items-center gap-2 border border-[#dcdcdc] rounded-lg py-1 pl-1 pr-1.5";
const TOPIC_NAME =
  "flex-1 flex items-baseline gap-2.5 text-left px-2.5 py-2 border-0 bg-transparent cursor-pointer text-[15px] rounded-md hover:bg-[#f0f0f0]";

export default function LibraryScreen(props: {
  topics: Topic[];
  activeTopic: Topic | null;
  onOpenTopic: (topic: Topic) => void;
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  // A topic or file was created / renamed / deleted on disk: reload the list.
  onTopicsChanged: () => Promise<void> | void;
}) {
  const [newTopicName, setNewTopicName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const { activeTopic } = props;

  return (
    <div className="absolute inset-0 flex flex-col items-stretch justify-start gap-6 bg-white overflow-y-auto">
      {activeTopic ? (
        <TopicDetail
          topic={activeTopic}
          onAddFile={props.onAddFile}
          onOpenFile={props.onOpenFile}
          onRemoveFile={async (p) => {
            await removeFileFromTopic(activeTopic.id, p);
            await props.onTopicsChanged();
          }}
        />
      ) : (
        <TopicLibrary
          topics={props.topics}
          newTopicName={newTopicName}
          setNewTopicName={setNewTopicName}
          renamingId={renamingId}
          renameText={renameText}
          setRenameText={setRenameText}
          onCreate={async () => {
            if (!newTopicName.trim()) return;
            await createTopic(newTopicName);
            setNewTopicName("");
            await props.onTopicsChanged();
          }}
          onStartRename={(t) => {
            setRenamingId(t.id);
            setRenameText(t.name);
          }}
          onCommitRename={async () => {
            if (renamingId) await renameTopic(renamingId, renameText);
            setRenamingId(null);
            await props.onTopicsChanged();
          }}
          onDelete={async (t) => {
            if (!window.confirm(`Delete topic "${t.name}"? Files stay on disk.`)) return;
            await deleteTopic(t.id);
            await props.onTopicsChanged();
          }}
          onOpen={props.onOpenTopic}
        />
      )}
    </div>
  );
}

function TopicLibrary(props: {
  topics: Topic[];
  newTopicName: string;
  setNewTopicName: (v: string) => void;
  renamingId: string | null;
  renameText: string;
  setRenameText: (v: string) => void;
  onCreate: () => void;
  onStartRename: (t: Topic) => void;
  onCommitRename: () => void;
  onDelete: (t: Topic) => void;
  onOpen: (t: Topic) => void;
}) {
  return (
    <div className={LIBRARY}>
      <h1 className="mt-0 mb-5 mx-0 text-[22px]">Topics</h1>
      <div className="flex gap-2 mb-5">
        <input
          className={INPUT}
          placeholder="New topic (e.g. what makes JITs fast)"
          value={props.newTopicName}
          onChange={(e) => props.setNewTopicName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && props.onCreate()}
        />
        <button className={BTN} onClick={props.onCreate}>
          Add
        </button>
      </div>
      {props.topics.length === 0 && <p className="text-[#777] text-sm">No topics yet. Create one to start reading.</p>}
      <ul className={TOPIC_LIST}>
        {props.topics.map((t) => (
          <li key={t.id} className={TOPIC_ROW}>
            {props.renamingId === t.id ? (
              <input
                className={INPUT}
                autoFocus
                value={props.renameText}
                onChange={(e) => props.setRenameText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && props.onCommitRename()}
                onBlur={props.onCommitRename}
              />
            ) : (
              <button className={TOPIC_NAME} onClick={() => props.onOpen(t)}>
                {t.name}
                <span className="text-xs text-[#777]">{t.files.length} file{t.files.length === 1 ? "" : "s"}</span>
              </button>
            )}
            <div className="flex gap-1">
              <button className={BTN_SM} onClick={() => props.onStartRename(t)}>
                Rename
              </button>
              <button className={BTN_SM_DANGER} onClick={() => props.onDelete(t)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
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
  onAddFile: () => void;
  onOpenFile: (file: FileRef) => void;
  onRemoveFile: (path: string) => void;
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
        <h1 className="m-0 text-[22px]">{props.topic.name}</h1>
        <button className={BTN} onClick={props.onAddFile}>
          Add PDF
        </button>
      </div>
      {files.length === 0 && <p className="text-[#777] text-sm">No files yet. Add a PDF to this topic.</p>}
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
                <button className={BTN_SM_DANGER} onClick={() => props.onRemoveFile(f.path)}>
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
