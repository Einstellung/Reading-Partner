// The Retell section of a topic (docs/31, "界面"): the retells being prepared under
// this topic, each one openable back into its own retell conversation.
//
// It lists retells, not decks. A deck is one thing a retell eventually produces, so
// it shows as a retell's state ("deck ready") and as a button on its row — the
// list itself is of the objects being prepared, which is what a reader comes
// here looking for.

import { useCallback, useEffect, useState } from "react";
import { logEvent } from "../../../../platform/app/events";
import type { Topic } from "../../../../platform/app/topics";
import { listDecks, revealDeckFile, type RetellEntry } from "../../../../reading/slides";
import {
  createRetell,
  deleteRetell,
  listRetellsForTopic,
  retellCandidates,
  retellRows,
  retellSummary,
  type MaterialCandidate,
  type RetellRow,
} from "../../../../reading/retell";
import { Button } from "../../ui/button";
import CardMenu from "../../shelf/CardMenu";
import { displayFileTitle } from "../../shelf/file-title";
import DeleteRetellButton from "./DeleteRetellButton";
import NewRetellDialog from "./NewRetellDialog";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

export default function RetellSection(props: {
  topic: Topic;
  onOpenRetell: (retellId: string) => void;
}) {
  const { topic, onOpenRetell } = props;
  // null while loading; [] when this topic has no retells.
  const [rows, setRows] = useState<RetellRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RetellRow | null>(null);
  const [candidates, setCandidates] = useState<MaterialCandidate[]>([]);

  const refresh = useCallback(async () => {
    const [retells, decks] = await Promise.all([
      listRetellsForTopic(topic.id),
      listDecks().catch((): RetellEntry[] => []),
    ]);
    // The join between a retell and the deck built from it is the shared id; the
    // retell list only needs the file to open, so that is all it is handed.
    const files = new Map<string, string>();
    for (const d of decks) if (d.talkId) files.set(d.talkId, d.file);
    setRows(retellRows(retells, files));
  }, [topic.id]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void refresh().catch(() => {
      if (!cancelled) setRows([]);
    });
    void retellCandidates(topic, displayFileTitle).then((c) => {
      if (!cancelled) setCandidates(c);
    });
    return () => {
      cancelled = true;
    };
  }, [topic, refresh]);

  // Literally the same path the retell's own deck dialog opens a deck by, and the
  // failure goes on screen where the button is.
  const revealDeck = useCallback(async (file: string) => {
    setError(null);
    const failure = await revealDeckFile(file);
    if (failure) setError(failure);
  }, []);

  const create = useCallback(
    async (bookIds: string[]) => {
      setError(null);
      try {
        const picked = candidates.filter((c) => bookIds.includes(c.bookId));
        const retell = await createRetell(
          topic.id,
          picked.map(({ bookId, title }) => ({ bookId, title })),
        );
        onOpenRetell(retell.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start the retell");
      }
    },
    [candidates, topic.id, onOpenRetell],
  );

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="max-w-prose">
          <p className="m-0 mb-4 text-sm text-muted-foreground">
            No retells yet. A retell is one thing you are preparing to give from what you have read here
            — you go through it chapter by chapter with the AI, and the outline of the retell is what
            comes out.
          </p>
          <Button onClick={() => setCreating(true)}>New retell</Button>
        </div>
      ) : (
        <>
          <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
            {rows.map((row) => (
              <li key={row.id} className={ROW}>
                <button
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-0 py-2 text-left"
                  onClick={() => {
                    logEvent(topic.id, "talk-open", { retellId: row.id });
                    onOpenRetell(row.id);
                  }}
                >
                  <span className="truncate text-[15px]">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{retellSummary(row)}</span>
                </button>
                {row.deckFile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void revealDeck(row.deckFile as string)}
                  >
                    Open deck
                  </Button>
                )}
                <CardMenu
                  label={`Actions for ${row.name}`}
                  items={[
                    {
                      label: "Delete this retell",
                      destructive: true,
                      onSelect: () => setDeleting(row),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          <Button variant="outline" onClick={() => setCreating(true)}>
            New retell
          </Button>
        </>
      )}

      {deleting && (
        <DeleteRetellButton
          name={deleting.name}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onDelete={() => {
            void deleteRetell(deleting.id).then(refresh);
          }}
        />
      )}

      {creating && (
        <NewRetellDialog
          open
          onOpenChange={setCreating}
          candidates={candidates}
          onConfirm={(ids) => void create(ids)}
        />
      )}
    </>
  );
}
