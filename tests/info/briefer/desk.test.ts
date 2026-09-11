// What info puts on the desk (src/info/briefer/desk.ts, docs/61): the day's
// briefing, and one article beside it. What is asserted here is the composition
// — which blocks come out in which order, where the tools come from, and that
// the companion now reads memory — rather than the prompt text, which is
// tests/info/briefer/chat.test.ts. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { assembleTurn } from "../../../src/soul";
import { openDesk, type DeskEnv, type DeskRef } from "../../../src/desk";
import {
  INFO_ARTICLE_KIND,
  INFO_BRIEFING_KIND,
  registerInfoDesk,
  withCompanionTools,
} from "../../../src/info/briefer/desk";
import { statementStore, type Observation } from "../../../src/memory";
import { DEFAULT_SETTINGS } from "../../../src/platform/app/settings";
import { BRIEF_TOPIC_ID } from "../../../src/platform/app/topics";
import {
  appendMessage,
  createThread,
  rebuildThreadStoreForTests,
  setThreadTopic,
} from "../../../src/platform/app/threads";
import { installAppData } from "../../support/appdata-fake";
import type { AgentTool } from "../../../src/ai/agent";
import type { CompanionContext } from "../../../src/info/briefer/chat";
import type { Briefing } from "../../../src/info/boxes/types";

const CTX: CompanionContext = { profile: "Reads robotics.", sources: [], collecting: true };

const BRIEFING: Briefing = {
  date: "2026-07-21",
  generatedAt: 0,
  version: 2,
  labs: [{ labId: "lab-a", name: "Models", cover: "A slow day.", judgments: [] }],
  quiet: [],
  items: {
    a1: {
      title: "Model X ships",
      url: "https://x.test",
      source: "qbitai",
      sourceName: "量子位",
      publishedAt: "2026-07-21",
    },
  },
  mustRead: [{ itemId: "a1", reason: "you track releases" }],
  oneLiners: [],
  outOfLane: [],
};

registerInfoDesk();

beforeEach(() => {
  installAppData();
  rebuildThreadStoreForTests();
  // The briefing conversation, filed under the brief topic. The desk reads the
  // topic off the thread record: a topic is where the material is filed, and
  // nothing about the turn itself carries one (src/desk/types.ts).
  createThread("info-2026-07-21", "info", "briefing-2026-07-21");
  setThreadTopic("info-2026-07-21", "briefing-2026-07-21", BRIEF_TOPIC_ID);
});

function env(): DeskEnv {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      defaultProviderId: "anthropic",
      defaultModelId: "claude-sonnet-4-5",
    },
    thread: { key: "info-2026-07-21", id: "briefing-2026-07-21" },
  };
}

function tool(name: string): AgentTool {
  return { name, description: "", parameters: {}, execute: async () => "" } as never;
}

const briefingRef: DeskRef = {
  kind: INFO_BRIEFING_KIND,
  ref: { dateKey: BRIEFING.date, briefing: BRIEFING, ctx: CTX },
};

const articleRef: DeskRef = {
  kind: INFO_ARTICLE_KIND,
  ref: {
    dateKey: BRIEFING.date,
    itemId: "a1",
    title: "Model X ships",
    overview: "A slow day.",
    bodyText: "the full body text",
  },
};

function observation(): Observation {
  return {
    id: "m-0001",
    type: "stuck-point",
    summary: "attention as a weighted average",
    body: "Could not see why the softmax is over keys.",
    created: "2026-07-20",
    updated: "2026-07-20",
    anchors: { annotationIds: [], messageIds: [] },
    topic: BRIEF_TOPIC_ID,
  };
}

// The topic's observations, without a store under them.
function withObservations(ref: DeskRef, observations: Observation[]): DeskRef {
  return {
    kind: ref.kind,
    ref: { ...(ref.ref as object), listObservations: async () => observations },
  };
}

async function assemble(refs: DeskRef[], tools: AgentTool[] = []) {
  const desk = await openDesk(withCompanionTools(refs, async () => tools), env());
  const turn = await assembleTurn({ desk });
  return turn!;
}

test("the briefing desk is the companion, whole", async () => {
  const turn = await assemble([briefingRef]);
  expect(turn.systemPrompt).toContain("- Models: A slow day.");
  expect(turn.systemPrompt).toContain("Model X ships — 量子位 — you track releases");
  expect(turn.systemPrompt).not.toContain("The user is reading this article");
});

test("an article desk keeps the briefing first and the article after it", async () => {
  const turn = await assemble([briefingRef, articleRef]);
  const briefingAt = turn.systemPrompt.indexOf("- Models: A slow day.");
  const articleAt = turn.systemPrompt.indexOf('The user is reading this article: "Model X ships".');
  expect(briefingAt).toBeGreaterThanOrEqual(0);
  expect(articleAt).toBeGreaterThan(briefingAt);
  expect(turn.systemPrompt).toContain("the full body text");
});

// The article brings a body of text and nothing else: what the companion can do
// is the briefing's, and a second copy of it on the same desk would be two names
// for one thing (openDesk refuses that outright).
test("the tools come from the briefing item alone", async () => {
  // The soul's statement tool rides on the reader having just said something.
  appendMessage("info-2026-07-21", "briefing-2026-07-21", {
    role: "user",
    text: "why is this one worth reading?",
    ts: 1000,
  });
  const turn = await assemble([briefingRef, articleRef], [tool("probe_source"), tool("add_source")]);
  expect(turn.tools.map((t) => t.name)).toEqual([
    "statement_write",
    "search_conversations",
    "read_conversation",
    "list_palace",
    "list_kind",
    "observation_search",
    "observation_read",
    "observation_update",
    "probe_source",
    "add_source",
  ]);
});

test("an article on its own desk brings no tools but the soul's", async () => {
  const turn = await assemble([articleRef], [tool("probe_source")]);
  expect(turn.tools.map((t) => t.name)).not.toContain("probe_source");
});

// Onboarding is the briefing item in a variant, not a kind of its own.
test("the onboarding variant opens on the add-source skill", async () => {
  const turn = await assemble([
    { kind: INFO_BRIEFING_KIND, ref: { onboarding: true, aiLanguage: "zh-CN" } },
  ]);
  expect(turn.systemPrompt).toContain("first run");
  expect(turn.systemPrompt).not.toContain("Overview:");
});

// docs/48: info's first read of memory. The statements are about the reader and
// ride whatever is on the desk; the topic's observations come back through the
// same retrieval a reading turn anchors.
test("the companion reads what is known about the reader, and the topic's observations", async () => {
  await statementStore.createStatement({
    kind: "profile",
    author: "reader",
    text: "I have no linear algebra.",
    evidence: [],
    confirmedOn: "2026-07-20",
  });
  const turn = await assemble([withObservations(briefingRef, [observation()])]);
  expect(turn.systemPrompt).toContain("I have no linear algebra.");
  // The index line the retrieval brought back, in the shape the snapshot writes.
  expect(turn.systemPrompt).toContain("[stuck-point] attention as a weighted average");
  // And what the topic mounts alongside them.
  expect(turn.systemPrompt).toContain("observation_search(query)");
  // The memory paragraph is the briefing item's, so it rides the briefing block
  // rather than trailing the article.
  expect(turn.systemPrompt.indexOf("I have no linear algebra.")).toBeGreaterThan(
    turn.systemPrompt.indexOf("- Models: A slow day."),
  );
});

// The retrieval needs an anchor; what is known about the reader does not
// (docs/48). With the briefing left off the desk nothing anchors the retrieval,
// and the standing statements ride the turn all the same — the soul prints them
// itself, after the article.
test("an article desk with no briefing keeps the statements and drops the retrieval", async () => {
  await statementStore.createStatement({
    kind: "profile",
    author: "reader",
    text: "I have no linear algebra.",
    evidence: [],
    confirmedOn: "2026-07-20",
  });
  const turn = await assemble([withObservations(articleRef, [observation()])]);
  expect(turn.systemPrompt).toContain("I have no linear algebra.");
  expect(turn.systemPrompt).not.toContain("[stuck-point] attention as a weighted average");
  expect(turn.systemPrompt.indexOf("I have no linear algebra.")).toBeGreaterThan(
    turn.systemPrompt.indexOf("the full body text"),
  );
});

// What the reader confirmed a topic for reaches the desk items that asked to
// hear it (src/desk: onTopicSettled). Filing the conversation is the soul's and
// says nothing about articles (memory/filing); the kept copy of this article is the
// article item's own half of the gesture.
test("the article files its kept copy when the conversation's topic settles", async () => {
  const filed: string[] = [];
  const laid = await openDesk(
    [
      {
        kind: INFO_ARTICLE_KIND,
        ref: {
          ...(articleRef.ref as object),
          savedId: "https://example.com/a",
          fileArticle: async (savedId: string, topicId: string) => {
            filed.push(`${savedId}:${topicId}`);
            return true;
          },
        },
      },
    ],
    env(),
  );
  await laid.items[0].onTopicSettled!("t-9f2");
  expect(filed).toEqual(["https://example.com/a:t-9f2"]);
});

test("an article with no kept copy asks to hear nothing", async () => {
  const laid = await openDesk([articleRef], env());
  expect(laid.items[0].onTopicSettled).toBeUndefined();
});
