// The Talks section of a topic (docs/31, "界面"): the talks being prepared under
// this topic, each one openable back into its own rehearsal conversation.
//
// It lists talks, not decks. A deck is one thing a talk eventually produces, so
// it shows as a talk's state ("deck ready") and as a button on its row — the
// list itself is of the objects being prepared, which is what a reader comes
// here looking for.

import { useCallback, useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { appDataDir, join } from "@tauri-apps/api/path";
import { loadAnnotations } from "../../../../platform/app/annotations";
import { logEvent } from "../../../../platform/app/events";
import { sortedFiles, type Topic } from "../../../../platform/app/topics";
import { listTalks, type TalkEntry } from "../../../../reading/slides";
import {
  deleteTalk,
  listTalksForTopic,
  startTalk,
  talkRows,
  talkSummary,
  type MaterialCandidate,
  type TalkRow,
} from "../../../../reading/talks";
import { Button } from "../../ui/button";
import CardMenu from "../CardMenu";
import { displayFileTitle } from "../file-title";
import DeleteTalkButton from "./DeleteTalkButton";
import NewTalkDialog from "./NewTalkDialog";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

// The topic's materials that a talk can be started from: everything with a book
// id, with its mark count so the picker can tick the ones worth rehearsing.
async function candidatesFor(topic: Topic): Promise<MaterialCandidate[]> {
  const files = sortedFiles(topic).filter((f) => !!f.hash);
  return Promise.all(
    files.map(async (f) => ({
      bookId: f.hash as string,
      title: displayFileTitle(f.name),
      marks: (await loadAnnotations(f.hash as string).catch(() => [])).length,
    })),
  );
}

export default function TalksSection(props: {
  topic: Topic;
  onOpenTalk: (talkId: string) => void;
}) {
  const { topic, onOpenTalk } = props;
  // null while loading; [] when this topic has no talks.
  const [rows, setRows] = useState<TalkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<TalkRow | null>(null);
  const [candidates, setCandidates] = useState<MaterialCandidate[]>([]);

  const refresh = useCallback(async () => {
    const [talks, decks] = await Promise.all([
      listTalksForTopic(topic.id),
      listTalks().catch((): TalkEntry[] => []),
    ]);
    setRows(talkRows(talks, decks));
  }, [topic.id]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void refresh().catch(() => {
      if (!cancelled) setRows([]);
    });
    void candidatesFor(topic).then((c) => {
      if (!cancelled) setCandidates(c);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, refresh]);

  // Same path the reader's Slides dialog opens a deck by: a self-contained HTML
  // file under AppData, handed to the system's default handler.
  const openDeck = useCallback(async (file: string) => {
    setError(null);
    try {
      await openPath(await join(await appDataDir(), file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the deck");
    }
  }, []);

  const create = useCallback(
    async (bookIds: string[]) => {
      setError(null);
      try {
        const picked = candidates.filter((c) => bookIds.includes(c.bookId));
        const talk = await startTalk({
          topicId: topic.id,
          materials: picked.map(({ bookId, title }) => ({ bookId, title })),
        });
        logEvent(topic.id, "talk-start", { talkId: talk.id, materials: picked.length });
        onOpenTalk(talk.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start the talk");
      }
    },
    [candidates, topic.id, onOpenTalk],
  );

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="max-w-prose">
          <p className="m-0 mb-4 text-sm text-muted-foreground">
            No talks yet. A talk is one thing you are preparing to give from what you have read here
            — you go through it chapter by chapter with the AI, and the outline of the talk is what
            comes out.
          </p>
          <Button onClick={() => setCreating(true)}>New talk</Button>
        </div>
      ) : (
        <>
          <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
            {rows.map((row) => (
              <li key={row.id} className={ROW}>
                <button
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-0 py-2 text-left"
                  onClick={() => {
                    logEvent(topic.id, "talk-open", { talkId: row.id });
                    onOpenTalk(row.id);
                  }}
                >
                  <span className="truncate text-[15px]">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{talkSummary(row)}</span>
                </button>
                {row.deckFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openDeck(row.deckFile as string)}
                  >
                    Open deck
                  </Button>
                )}
                <CardMenu
                  label={`Actions for ${row.name}`}
                  items={[
                    {
                      label: "Delete this talk",
                      destructive: true,
                      onSelect: () => setDeleting(row),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setCreating(true)}>
            New talk
          </Button>
        </>
      )}

      {deleting && (
        <DeleteTalkButton
          name={deleting.name}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onDelete={() => {
            void deleteTalk(deleting.id).then(refresh);
          }}
        />
      )}

      {creating && (
        <NewTalkDialog
          open
          onOpenChange={setCreating}
          candidates={candidates}
          onConfirm={(ids) => void create(ids)}
        />
      )}
    </>
  );
}
