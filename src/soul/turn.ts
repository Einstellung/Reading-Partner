// One assembly, for every turn the app takes (docs/61). What used to be a
// buildXTurn per domain — a reading turn, a retell turn, a coach turn, an info
// turn — each with its own copy of "gather the tools, compose the prompt, fit it
// to the window", is this: the desk says what is in front of the AI, the soul
// says what is known about the reader, and this puts the two together and prices
// the result.
//
// It knows about no domain. What a book contributes is written in src/reading;
// what a briefing contributes is written in src/info; this file only knows that
// items have tools, prompts, a history and a ladder.

import type { Api, Model } from "@earendil-works/pi-ai";
import { fitToBudget, type BudgetPurpose, type Rung } from "../budget";
import type { DeskItem, DeskMessage, OpenedDesk } from "../desk";
import type { Settings } from "../platform/app/settings";
import type { ProviderId } from "../ai/provider-ids";
import { providers, toPiMessages } from "../ai/providers";
import type { AgentTool } from "../ai/agent";
import { soulMemorySection, openSoul } from "./self";
import type { CatalogueIo } from "./catalogue";
import { appSequenceIo, readSequence, type SequenceIo } from "./sequence";
import { soulTail, TAIL_RUNG, TAIL_RUNG_ID, TURN_KEEP } from "./tail";
import { appConversationIo, type ConversationIo } from "../conversations";
import type { TopicProposalSurface } from "../memory";

export interface AssembleInput {
  desk: OpenedDesk;
  // The conversation to replay when no item on the desk carries one.
  messages?: readonly DeskMessage[];
  // Which budget this call is spent out of (src/budget). Chat unless the caller
  // says otherwise, because a turn the reader is waiting for is the default.
  purpose?: BudgetPurpose;
  // The two stores the soul's tail is read out of (tail.ts). Injected for the
  // tests; the ones on disk otherwise.
  sequenceIo?: SequenceIo;
  conversationIo?: ConversationIo;
  // The store the catalogue tools walk (catalogue.ts). Injected for the tests;
  // the one on disk otherwise. Nothing is walked while a turn is assembled — the
  // tools are built here and only read the store if the model calls one.
  catalogueIo?: CatalogueIo;
  // Where a topic proposal is drawn, for a conversation that has no topic yet
  // (memory/filing). A caller that passes nothing mounts no propose_topic and
  // carries no roster in its prompt: there would be no card to confirm.
  topic?: TopicProposalSurface;
}

export interface AssembledTurn {
  systemPrompt: string;
  tools: AgentTool[];
  messages: DeskMessage[];
  // A low-key line for the end of the reply, naming what this turn had to leave
  // out, or "" when nothing was dropped that the reader has a stake in.
  notice: string;
  // Set when the turn cannot be assembled small enough to leave the model room
  // to answer. Show this instead of sending; retrying changes nothing.
  refusal: string;
  // What the items handed back about themselves, merged in desk order.
  report: Record<string, unknown>;
}

/**
 * The configured model's metadata (its context window is all we want). A
 * synchronous catalog lookup — no credentials, no network. Null when settings
 * name a provider or model pi doesn't know, in which case the turn is assembled
 * without a budget rather than blocked on one.
 */
export function configuredModel(s: Settings): Model<Api> | null {
  const provider = providers[s.defaultProviderId as ProviderId];
  if (!provider) return null;
  return provider.getModels().find((m) => m.id === s.defaultModelId) ?? null;
}

/**
 * Assemble one turn from a laid desk. Null when the signal aborted while the
 * soul was being read — the caller has already been superseded.
 */
export async function assembleTurn(input: AssembleInput): Promise<AssembledTurn | null> {
  const {
    desk,
    messages = [],
    purpose = "chat",
    sequenceIo = appSequenceIo,
    conversationIo = appConversationIo,
  } = input;
  const { items, env } = desk;
  const anchor = items.find((i) => i.memory !== undefined);
  const teller = items.find((i) => i.history !== undefined);
  const soul = await openSoul(env, anchor?.memory, input.topic, input.catalogueIo);
  if (env.signal?.aborted) return null;

  // The soul's tools first, then each item's in the order it lies on the desk.
  // Which order they go out in is nothing to the model — the prompt names them
  // from a table of its own (platform/app/context.ts) — but it is the order a
  // reader of this list would expect: what is always there, then what this desk
  // happens to hold.
  const tools = [...soul.tools, ...items.flatMap((i) => i.tools)];
  const toolNames = tools.map((t) => t.name);
  // What each item is told the rest of the desk brought. Its own paragraphs are
  // left out: it already has them and decides where they sit.
  const othersToolPrompts = new Map<DeskItem, readonly string[]>(
    items.map((item) => [item, items.filter((o) => o !== item).flatMap((o) => [...o.toolPrompts])]),
  );
  const report: Record<string, unknown> = {};
  for (const item of items) Object.assign(report, item.report ?? {});

  // The prompt as a function of what this pass gave up: each item's own text, in
  // desk order, and the memory paragraph handed to the one item that anchors it.
  // A desk with one item on it produces that item's prompt byte for byte, which
  // is what keeps the provider's cache prefix where it was (docs/09).
  function composePrompt(dropped: ReadonlySet<string>): string {
    const memory = soulMemorySection(soul, anchor?.memory, dropped);
    const blocks = items.map((item) =>
      item.prompt({
        dropped,
        memory: item === anchor ? memory : "",
        toolNames,
        toolPrompts: othersToolPrompts.get(item) ?? [],
      }),
    );
    // What no item speaks for. The memory paragraph goes to the item that
    // anchors the retrieval, and where no item does — an empty desk, a talk
    // being rehearsed — the soul prints it itself: what is known about the
    // reader is not about the material (docs/48). What the soul mounted
    // publishes goes last either way.
    if (!anchor) blocks.push(memory);
    blocks.push(soul.prompt);
    return blocks.filter((p) => p !== "").join("\n\n");
  }

  function ownMessages(dropped: ReadonlySet<string>): DeskMessage[] {
    return teller ? teller.history!.compose(dropped) : [...messages];
  }

  // What the reader last said anywhere, whatever desk they said it over
  // (tail.ts). It fills what the item's own span leaves of the forty messages a
  // turn replays, so a desk carrying a long conversation gets none of it — and
  // on a device with nothing else on it there is none to be had, which is what
  // keeps a fresh install's call byte for byte what it was.
  const own = ownMessages(new Set());
  const sequence = await readSequence(sequenceIo);
  if (env.signal?.aborted) return null;
  const tail = await soulTail({
    spans: sequence.spans,
    exclude: { fileKey: env.thread.key, threadId: env.thread.id },
    keep: Math.max(0, TURN_KEEP - own.length),
    io: conversationIo,
  });
  if (env.signal?.aborted) return null;

  function composeMessages(dropped: ReadonlySet<string>): DeskMessage[] {
    const span = ownMessages(dropped);
    // The tight rung takes the tail with it: a turn cutting into what the reader
    // said here has no business carrying what they said somewhere else.
    if (tail.length === 0 || dropped.has(TAIL_RUNG_ID) || dropped.has("history-trim")) return span;
    return [...tail, ...span];
  }

  const rungs: readonly Rung<string>[] =
    tail.length === 0 ? (teller?.rungs ?? []) : [TAIL_RUNG, ...(teller?.rungs ?? [])];
  const skip = new Set<string>();
  for (const item of items) for (const id of item.skip ?? []) skip.add(id);

  // Fit the call to the model's context window before it is sent. Left
  // unchecked, an over-full request comes back one token long with a normal
  // `done` and no error (docs/pitfall/65).
  const model = configuredModel(env.settings);
  if (!model) {
    afterFit(items, new Set());
    return {
      systemPrompt: composePrompt(new Set()),
      tools,
      messages: composeMessages(new Set()),
      notice: "",
      refusal: "",
      report,
    };
  }
  const fitted = fitToBudget<string, DeskMessage>({
    model,
    tools,
    composePrompt,
    composeMessages,
    toPi: toPiMessages,
    rungs,
    purpose,
    skip,
  });
  afterFit(items, fitted.dropped);
  return {
    systemPrompt: fitted.systemPrompt,
    tools,
    messages: fitted.messages,
    notice: fitted.notice,
    refusal: fitted.refusal,
    report,
  };
}

function afterFit(items: readonly DeskItem[], dropped: ReadonlySet<string>): void {
  for (const item of items) item.afterFit?.(dropped);
}
