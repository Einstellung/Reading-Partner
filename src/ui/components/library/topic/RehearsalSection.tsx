// The Rehearsal section of a topic (docs/43, "入口"): every deck under this
// topic that can be given out loud, and the door into giving it.
//
// Two kinds of row, one kind of object. A deck brought in from outside is a
// rehearsal the moment it is imported; a deck a retell built is listed from the
// retell, and the rehearsal behind it is made the first time it is given. Which
// is why pressing a row goes through rehearsalForRetell rather than creating
// something here: the Rehearse button on the retell's own header lands on the
// same call, and the two doors must not leave two histories behind.
//
// The join and the wording are rehearsalRows/rehearsalSummary in
// reading/rehearsal; what is left here is the reads, the presses and the list.

import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Topic } from "../../../../platform/app/topics";
import {
  deleteRehearsal,
  importRehearsalDeck,
  isImportedDeck,
  listRehearsalsForTopic,
  listAllRehearsals,
  loadRehearsalRuns,
  rehearsalForRetell,
  rehearsalRows,
  rehearsalSummary,
  type DeckedRetell,
  type Rehearsal,
  type RehearsalRow,
  type RunCount,
} from "../../../../reading/rehearsal";
import { listDecks, type RetellEntry } from "../../../../reading/slides";
import { listRetellsForTopic } from "../../../../reading/retell";
import { Button } from "../../ui/button";
import CardMenu from "../../shelf/CardMenu";
import DeleteRehearsalButton from "./DeleteRehearsalButton";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

export default function RehearsalSection(props: {
  topic: Topic;
  // Bumped by the shell when a pass has been recorded, so the counts below are
  // read again at the one moment they change.
  reloadKey: number;
  onStart: (rehearsal: Rehearsal) => void;
}) {
  const { topic, reloadKey, onStart } = props;
  // null while loading; [] when this topic has nothing to rehearse.
  const [rows, setRows] = useState<RehearsalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<RehearsalRow | null>(null);

  const refresh = useCallback(async () => {
    const [rehearsals, retells, decks] = await Promise.all([
      listRehearsalsForTopic(topic.id),
      listRetellsForTopic(topic.id),
      listDecks().catch((): RetellEntry[] => []),
    ]);
    const built = new Map<string, string>();
    for (const d of decks) if (d.retellId) built.set(d.retellId, d.file);
    const decked: DeckedRetell[] = [];
    for (const t of retells) {
      const file = built.get(t.id);
      if (file) decked.push({ retellId: t.id, name: t.name, deckFile: file });
    }
    // One read per rehearsal. The runs are a file of their own precisely so this
    // list does not have to hold every word ever said to draw a count.
    //
    // A runs file that will not open costs its own count and nothing else: this
    // list never writes a run, and the rest of the section — every other deck
    // under the topic, and the door into this one — has no reason to go with it.
    const counts = new Map<string, RunCount>();
    for (const r of rehearsals) {
      const log = await loadRehearsalRuns(r.id).catch(() => null);
      if (!log) continue;
      const last = log.runs[log.runs.length - 1];
      counts.set(r.id, { runs: log.runs.length, lastRunAt: last ? last.startedAt : null });
    }
    setRows(rehearsalRows(rehearsals, decked, counts));
  }, [topic.id]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    void refresh().catch(() => {
      if (!cancelled) setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, reloadKey]);

  // A row without an id is a retell's deck nobody has given yet: the object is
  // made now, which is the same call the retell's own Rehearse button makes.
  const start = useCallback(
    async (row: RehearsalRow) => {
      setError(null);
      setBusy(true);
      try {
        if (row.id) {
          const rehearsal = (await listAllRehearsals()).find((r) => r.id === row.id);
          if (!rehearsal) throw new Error("That rehearsal is no longer there");
          onStart(rehearsal);
          return;
        }
        if (!row.retellId) throw new Error("That deck has nothing to rehearse against");
        onStart(
          await rehearsalForRetell({
            topicId: topic.id,
            retellId: row.retellId,
            name: row.name,
            deckFile: row.deckFile,
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not open the rehearsal");
      } finally {
        setBusy(false);
      }
    },
    [onStart, topic.id],
  );

  // The system picker, through the dialog plugin — the same door the shelf opens
  // a PDF by. On iOS it is the document picker, which hands back a path in a
  // temporary inbox, which is why the import copies the bytes rather than
  // remembering where they were.
  const bringIn = useCallback(async () => {
    setError(null);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Deck", extensions: ["html", "htm"] }],
      });
      if (typeof picked !== "string") return;
      setBusy(true);
      await importRehearsalDeck({ topicId: topic.id, sourcePath: picked });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring that deck in");
    } finally {
      setBusy(false);
    }
  }, [refresh, topic.id]);

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <p className="m-0 text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="max-w-prose">
          <p className="m-0 mb-4 text-sm text-muted-foreground">
            Nothing to rehearse here yet. Bring in a deck you already have — a self-contained HTML
            one — and give it out loud; every pass is kept, page by page, so the next one has
            something to be held against. A retell that has built a deck shows up here on its own.
          </p>
          <Button disabled={busy} onClick={() => void bringIn()}>
            Bring in a deck
          </Button>
        </div>
      ) : (
        <>
          <ul className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
            {rows.map((row) => (
              <li key={row.key} className={ROW}>
                <button
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 border-0 bg-transparent px-0 py-2 text-left"
                  disabled={busy}
                  onClick={() => void start(row)}
                >
                  <span className="truncate text-[15px]">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{rehearsalSummary(row)}</span>
                </button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void start(row)}>
                  Rehearse
                </Button>
                {row.id && (
                  <CardMenu
                    label={`Actions for ${row.name}`}
                    items={[
                      {
                        label: "Delete this rehearsal",
                        destructive: true,
                        onSelect: () => setDeleting(row),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
          <Button variant="outline" disabled={busy} onClick={() => void bringIn()}>
            Bring in a deck
          </Button>
        </>
      )}

      {deleting?.id && (
        <DeleteRehearsalButton
          name={deleting.name}
          imported={isImportedDeck(deleting.deckFile)}
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          onDelete={() => {
            void deleteRehearsal(deleting.id as string).then(refresh);
          }}
        />
      )}
    </>
  );
}
