// A topic's delete confirmation: the files only in this topic, listed, and a box
// that deletes them too (docs/50). The words are shelf/topic-delete.ts; the files are
// counted when the dialog opens and counted again by deleteTopic when it runs.
// Mounted only while it is open, and shown once the count is in, so the box
// never appears under a finger already on its way to Delete.

import { useEffect, useState } from "react";

import { listLibraryEntries, type LibraryEntry } from "../../../platform/app/library";
import type { FileRef, Topic } from "../../../platform/app/topics";
import { listFilesOnlyInTopic } from "../../../reading/delete/delete-book";
import { loadSavedArticles, savedArticlesForTopic } from "../../../reading/saved/saved-articles";
import ConfirmDestructiveDialog from "../common/ConfirmDestructiveDialog";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { topicDeleteWords } from "../shelf/topic-delete";

interface Counted {
  only: FileRef[];
  entries: Record<string, LibraryEntry>;
  saved: number;
}

export default function TopicDeleteDialog(props: {
  topic: Topic;
  topics: Topic[];
  onOpenChange(open: boolean): void;
  // The ids of the files to delete with the topic; empty when the box is not ticked.
  onConfirm(alsoDeleteFiles: string[]): void;
}) {
  const { topic, topics } = props;
  const [counted, setCounted] = useState<Counted | null>(null);
  const [alsoFiles, setAlsoFiles] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A count that cannot be made offers nothing: the topic can still go, and
    // its files are left where they are.
    void Promise.all([
      listFilesOnlyInTopic(topics, topic.id).catch((): FileRef[] => []),
      listLibraryEntries().catch((): Record<string, LibraryEntry> => ({})),
      loadSavedArticles().catch(() => []),
    ]).then(([only, entries, saved]) => {
      if (!cancelled) {
        setCounted({ only, entries, saved: savedArticlesForTopic(saved, topic.id).length });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [topic.id, topics]);

  if (!counted) return null;
  const words = topicDeleteWords({
    topic,
    topics,
    only: counted.only,
    entries: counted.entries,
    savedArticles: counted.saved,
  });

  return (
    <ConfirmDestructiveDialog
      title={words.title}
      description={words.description}
      actionLabel={words.action(alsoFiles)}
      open
      onOpenChange={props.onOpenChange}
      onConfirm={() =>
        props.onConfirm(alsoFiles ? counted.only.flatMap((f) => (f.hash ? [f.hash] : [])) : [])
      }
    >
      {words.checkLabel && (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0 rounded-md border border-border-subtle">
            <div className="px-3 pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {words.onlyCaption}
            </div>
            <ul className="max-h-48 min-w-0 overflow-y-auto px-3 pb-2">
              {words.rows.map((row) => (
                <li key={row.file.path} className="flex min-w-0 items-baseline gap-2 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className="shrink-0 text-xs text-faint-foreground">{row.kind}</span>
                </li>
              ))}
            </ul>
          </div>
          <Label>
            <Checkbox checked={alsoFiles} onCheckedChange={(v) => setAlsoFiles(v === true)} />
            {words.checkLabel}
          </Label>
        </div>
      )}
    </ConfirmDestructiveDialog>
  );
}
