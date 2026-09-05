// Standalone runtime harness for the orb (docs/45). Not part of the app; it
// mounts the real BriefingPage under the real VoiceOrbEntry, over a canned
// briefing, so the orb can be looked at in the iOS simulator. Served by Vite in
// dev at /orb-spike.html.
//
// It exists because the simulator cannot reach the orb any other way. The audio
// stack does not start there at all (docs/pitfall/193), and a simulator with no
// AI key and no sources has no briefing to draw the page from. So the page comes
// from the fixture below and the four states come from `window.__orbStub`, which
// VoiceOrbEntry publishes in a dev build.
//
// `?pip` adds the corner card InfoCall draws over this same screen, which is the
// one thing on the briefing the orb could collide with.

import { createRoot } from "react-dom/client";

// The app's global baseline: what is measured here has to be the app's layout.
import "../../../styles.css";
import { Badge } from "../ui/badge";
import ReadingPipCard from "../chat/ReadingPipCard";
import { BriefingPage } from "./BriefingPage";
import { VoiceOrbEntry } from "./VoiceOrbEntry";
import type { Briefing } from "../../../info/briefing/types";

const BRIEFING: Briefing = {
  date: "2026-09-05",
  generatedAt: Date.now(),
  overview: "Three things worth your time today, and a long tail of vendor noise.",
  mustRead: [
    {
      itemId: "a",
      reason: "It is the measurement you wanted for the thing you read last week.",
    },
    { itemId: "b", reason: "The other half of the argument you have been following." },
  ],
  oneLiners: [
    { itemId: "c", line: "A second lab reproduces the result, with a smaller model." },
  ],
  outOfLane: [{ itemId: "d", reason: "Nothing to do with your lane, and it will be." }],
  filtered: [{ itemId: "e", category: "vendor PR" }],
  items: {
    a: {
      title: "Measuring what the decoder actually attends to",
      url: "https://example.com/a",
      source: "example",
      sourceName: "Example",
      publishedAt: "2026-09-05",
    },
    b: {
      title: "The case against the scaling story, restated",
      url: "https://example.com/b",
      source: "example",
      sourceName: "Example",
      publishedAt: "2026-09-05",
    },
    c: {
      title: "A smaller model reproduces it",
      url: "https://example.com/c",
      source: "example",
      sourceName: "Example",
      publishedAt: "2026-09-05",
    },
    d: {
      title: "A shipping company rewrites its scheduler",
      url: "https://example.com/d",
      source: "example",
      sourceName: "Example",
      publishedAt: "2026-09-05",
    },
    e: {
      title: "Vendor announces partnership",
      url: "https://example.com/e",
      source: "example",
      sourceName: "Example",
      publishedAt: "2026-09-05",
    },
  },
};

const noop = () => {};

function Harness() {
  const pip = new URLSearchParams(window.location.search).has("pip");
  return (
    <>
      <div className="absolute inset-0 overflow-y-auto bg-background">
        <BriefingPage
          briefing={BRIEFING}
          openedIds={new Set()}
          dismissedIds={new Set()}
          onOpenArticle={noop}
          onDismiss={noop}
          onAppeal={noop}
          onAskBriefing={noop}
          onAskArticle={noop}
          onOpenSources={noop}
          onBack={noop}
        />
      </div>
      {pip && (
        <div className="absolute right-3 top-3 z-50">
          <ReadingPipCard
            title="Today's briefing"
            badge={<Badge className="shrink-0">Example</Badge>}
            body={
              <span className="line-clamp-3 text-[12px] leading-snug text-neutral-500">
                The corner card the text call draws over this screen.
              </span>
            }
            onClick={noop}
          />
        </div>
      )}
      <VoiceOrbEntry />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
