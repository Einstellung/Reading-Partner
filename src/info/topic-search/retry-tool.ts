// retry_topic_search_first_run (docs/info/88 「重跑第一次」): the door's way to
// read again what a search's first look missed, after the reader signed in to X
// or arXiv failed. The door cannot read X itself: X is read only in a first
// run, a retry of it and the nightly run from 01:00, all on the desktop
// collector. The texts say only what the call did, never when it will finish.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/durable/contract";
import { asString } from "../../platform/std/json";
import { t } from "../../i18n";
import { searchLabelName } from "./edit-tools";
import { isEmptyPlan, X_READ_RULE, type RetryPlan } from "./retry";
import type { RetryAsk } from "./run-worker";
import { resolveTopicSearch } from "./topic-searches";
import type { TopicSearch } from "./types";

export interface RetryToolDeps {
  searches(): Promise<TopicSearch[]>;
  known(): readonly TopicSearch[];
  /** What a retry would read again, from this device's copy of the source health (the run decides again on the collector). */
  plan(search: TopicSearch): Promise<RetryPlan>;
  /** X as last checked on this device: signed in, signed out, or null when never checked or the check could not tell. */
  xSignedIn(): Promise<boolean | null>;
  ask(searchId: string): Promise<RetryAsk>;
}

function queries(n: number): string {
  return `${n} ${n === 1 ? "query" : "queries"}`;
}

/** What the tool says after asking. Exported for the tests. */
export function askedText(name: string, plan: RetryPlan, xSignedIn: boolean | null): string {
  const reads = [
    plan.x.length ? `X for ${queries(plan.x.length)}` : "",
    plan.arxiv.length ? `arXiv for ${queries(plan.arxiv.length)}` : "",
    plan.huggingface?.length ? `Hugging Face for ${queries(plan.huggingface.length)}` : "",
    plan.graph?.length ? `the citation graph for ${plan.graph.length} ${plan.graph.length === 1 ? "stream" : "streams"}` : "",
  ].filter(Boolean);
  const signedOut =
    plan.x.length && xSignedIn === false
      ? " The last check on this device found X signed out: unless the reader has signed in to X " +
        "in Settings > Accounts since, X fails again and only the paper sources are read."
      : "";
  return (
    `Asked to read again what the first look of "${name}" missed: ${reads.join(", ")} (as this ` +
    "device last saw it; the run checks again). It runs on the desktop collector when that is on; " +
    "what it finds is added to the first look's result, and a brief issue of its own comes when " +
    `it is done.${signedOut} Tell the reader in one line. Do not say when it will finish. When ` +
    "they later ask how it is going or whether it came back, call background_status first."
  );
}

export function buildRetryFirstRunTool(deps: RetryToolDeps): AgentTool {
  return {
    name: "retry_topic_search_first_run",
    label: (args) => t("info.tool.retryingFirstRun", { name: searchLabelName(args.searchId, deps.known()) }),
    effect: "write",
    gate: "instruction",
    description:
      "Read again what a topic search's first run missed: the X queries that failed (for " +
      "example X had signed this device out), the arXiv queries that failed or came back " +
      "empty before the query ladder, and the Hugging Face paper searches that failed. What already read is not read again; what is found is " +
      "added to the first run's result. Call it when the reader asks to search again after " +
      `signing in to X, or to redo the first look. ${X_READ_RULE} To change what is searched, ` +
      "use update_topic_search with the reader's say-so first.",
    parameters: Type.Object({
      searchId: Type.String({ description: "The search's id (ts-…) or name." }),
    }),
    execute: async (args) => {
      const raw = asString(args.searchId).trim();
      const searches = await deps.searches();
      const search = resolveTopicSearch(raw, searches);
      if (!search) {
        const names = searches.map((s) => `- ${s.name} (id: ${s.id}, ${s.status})`).join("\n");
        return { text: `"${raw}" is not one of the reader's topic searches; nothing was asked.${names ? `\nThey have:\n${names}` : ""}`, receipt: null };
      }
      // A stopped study is an ended one (docs/info/91 结束): its brief is in reading and never revised again.
      if (search.status !== "active") {
        const what = search.once ? "is a study that has ended" : "is stopped";
        return { text: `"${search.name}" ${what}, so nothing is read for it; nothing was asked.`, receipt: null };
      }
      const plan = await deps.plan(search);
      if (isEmptyPlan(plan)) {
        return {
          text:
            `Nothing the first look of "${search.name}" missed is left to read again: every query ` +
            "read on X, arXiv and Hugging Face. Nothing was asked. New posts come with the nightly run from 01:00.",
          receipt: null,
        };
      }
      const asked = await deps.ask(search.id);
      if (asked.status === "busy") {
        return {
          text:
            `The ${asked.what === "first" ? "first run" : "earlier retry"} of "${search.name}" has not ` +
            "finished yet, so no other was asked. What it finds comes as a brief issue when it is done. " +
            "Call background_status to see how far it has got.",
          receipt: null,
        };
      }
      if (asked.status === "refused") return { text: `The retry could not be asked: ${asked.reason}`, receipt: null };
      return {
        text: askedText(search.name, plan, plan.x.length ? await deps.xSignedIn() : null),
        receipt: { label: t("info.tool.retriedFirstRun"), summary: search.name },
      };
    },
  };
}
