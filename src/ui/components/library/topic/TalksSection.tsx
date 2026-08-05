// The Talks section of a topic (docs/31, "界面"): the decks already generated
// from this topic's materials, each openable in the system browser.
//
// A list only. Starting a talk is the review mode's entry point and is not here
// yet; until it lands, the way a deck appears in this list is still the reader's
// Slides dialog.

import { useCallback, useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { Topic } from "../../../../platform/app/topics";
import { listTalks, type TalkEntry } from "../../../../reading/slides";
import { Button } from "../../ui/button";
import { talkBooksLabel, talksForTopic } from "./topic-talks";

const ROW = "flex items-center gap-2 rounded-lg border border-border py-1 pl-3 pr-1.5";

export default function TalksSection({ topic }: { topic: Topic }) {
  // null while loading; [] when this topic has no decks.
  const [talks, setTalks] = useState<TalkEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listTalks()
      .catch((): TalkEntry[] => [])
      .then((all) => {
        if (!cancelled) setTalks(talksForTopic(all, topic));
      });
    return () => {
      cancelled = true;
    };
  }, [topic]);

  // Same path the Slides dialog opens a deck by: the deck is a self-contained
  // HTML file under AppData, handed to the system's default handler.
  const open = useCallback(async (file: string) => {
    setError(null);
    try {
      await openPath(await join(await appDataDir(), file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the deck");
    }
  }, []);

  if (talks === null) {
    return <p className="m-0 text-sm text-muted-foreground">Loading…</p>;
  }

  if (talks.length === 0) {
    return (
      <p className="m-0 max-w-prose text-sm text-muted-foreground">
        No talks yet. A talk is a deck built from the books and papers in this topic; the ones you
        generate will be listed here.
      </p>
    );
  }

  return (
    <>
      {error && <p className="mt-0 mb-3 text-sm text-destructive">{error}</p>}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {talks.map((t) => (
          <li key={t.file} className={ROW}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
              <span className="truncate text-[15px]">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(t.createdAt).toLocaleDateString()} · {talkBooksLabel(t)}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void open(t.file)}>
              Open
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
