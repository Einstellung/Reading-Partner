// find_seed_paper (docs/info/91 起草与种子): the door tool that looks up a paper
// the reader named while drafting a study, and draws the seed card with what
// the libraries found (seed-lookup.ts). The card carries the program's titles,
// authors, dates and ids; the reader marks each 「是这篇」 or 「不是」 there or in
// words, and propose_topic_search takes the confirmed ones (seeds.ts). Reads
// only: nothing is written until the drafting card is applied.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import { asString } from "../../platform/std/json";
import { t } from "../../i18n";
import type { StudySeedCandidate, StudySeedsCardData } from "./cards";
import { openingAnchor, type ReaderLine } from "./propose-tool";
import { findSeedPaper, type SeedSearches } from "./seed-lookup";

export interface SeedToolDeps {
  threadId: string;
  readerLines(): readonly ReaderLine[];
  searches: SeedSearches;
  now(): number;
  raiseCard(card: StudySeedsCardData): void;
}

function byline(c: StudySeedCandidate): string {
  const authors = c.authors.length > 3 ? `${c.authors.slice(0, 3).join(", ")} et al.` : c.authors.join(", ");
  return [authors, c.date, c.handle].filter(Boolean).join(" · ");
}

export function buildFindSeedPaperTool(deps: SeedToolDeps): AgentTool {
  return {
    name: "find_seed_paper",
    label: (args) => t("info.tool.findingSeedPaper", { name: String(args.name ?? "") }),
    effect: "read",
    description:
      "Look up a paper the reader named while drafting a study (a once topic search) and is sure is on target. " +
      "The program asks arXiv and Hugging Face, then Semantic Scholar, and draws a seed card with at most 3 " +
      "candidates, each with title, authors, date and id as the library gives them; the reader marks each " +
      "'this one' or 'not it'. One call per name the reader gave; never call it again for the same name.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "What to look up, as the paper itself would be titled: its title, short name, or authors and year " +
          "(\"Vaswani 2017 attention\"), or an arXiv id or link. In the paper's language, not the conversation's.",
      }),
      said: Type.String({ description: "The reader's own words naming it, copied exactly." }),
    }),
    execute: async (args) => {
      const name = asString(args.name).trim();
      if (!name) throw new Error("find_seed_paper needs a name.");
      const said = asString(args.said).trim() || name;
      const found = await findSeedPaper(name, deps.searches);
      const unanswered = found.misses.map(
        (m) => `${m.source} did not answer${m.cooling ? " (rate limited, cooling down; a later try may find it)" : ""}: ${m.why}`,
      );
      if (found.candidates.length === 0) {
        return {
          text: [
            `No paper found for "${name}".`,
            ...unanswered,
            "Tell the reader so, and ask for a link or the fuller title. Do not guess a paper.",
          ].join(" "),
          receipt: null,
        };
      }
      deps.raiseCard({
        kind: "study-seeds",
        threadId: deps.threadId,
        said,
        evidence: openingAnchor(deps.readerLines(), said, deps.threadId),
        at: deps.now(),
        candidates: found.candidates,
      });
      return {
        text: [
          `Drew the seed card for "${said}" with ${found.candidates.length} candidate${found.candidates.length === 1 ? "" : "s"}:`,
          ...found.candidates.map((c, i) => `${i + 1}. ${c.title} — ${byline(c)} (key ${c.key})`),
          ...unanswered,
          "Ask the reader which one, if any, is the paper they meant; they can press the card's buttons or say it. " +
            "Say nothing about these papers beyond what is listed here. Pass the keys they confirmed to " +
            "propose_topic_search as seeds.",
        ].join("\n"),
        receipt: null,
      };
    },
  };
}
