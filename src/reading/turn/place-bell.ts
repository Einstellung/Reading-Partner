// Answering a bell in a place's own conversation on the durable runtime
// (docs/soul/87, 第二阶段; docs/55). The door uses it now; info, meals, the
// coach and the retell each give it their place the same way.
//
// The bell is the turn's input and is never written to the conversation. A
// turn this bell started before a restart is waited for and never started
// twice (`bellTurn`). A conversation busy with another turn — the reader's,
// running or landing, or one recovery resumed — is waited for, and the bell's
// turn starts once that one has landed. Only this bell waits; the pass goes on
// with the rest (soul/bell.ts).
//
// Where the reader has the conversation open (place-session.ts) the bell's turn
// runs in that session: it streams there, can be stopped and talked into, and
// what was said into it is filed and answered there. Nobody looking, it runs
// headless: started on the runtime and followed to its end with no rows drawn.
// A reader who opens the conversation meanwhile follows it from the runtime
// like any turn in flight (`resume`), and the steers and the stop are theirs.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { catalogDescribe, type DeviceDurable } from "../../legion/durable/device";
import type { ThreadOrigin } from "../../legion/durable/extension";
import { getThread, loadThreads } from "../../platform/app/threads";
import type { ThreadFiles } from "../../legion/durable/thread-files";
import { bellTurn, TurnBusy } from "../../legion/durable/turn";
import type { TurnDelivery, TurnDeliveryOutcome } from "../../soul";
import { drivePlaceTurn, type BookTurnEnd } from "./book-turn-rows";
import type { CallRow } from "./call-state";
import type { StallOptions } from "./durable-turn";
import { openPlaceSession, type PlaceBellRequest, type PlaceSession } from "./place-session";

/** A bell's turn as the place assembles it: everything but the bell itself. */
export type PlaceBellAssembly = Omit<PlaceBellRequest, "line" | "bell" | "describe">;

/** How the place lays its conversation for one bell. */
export interface PlaceBell {
  /** The conversation's key in `rp.conversations`. */
  key: string;
  origin: ThreadOrigin;
  /** The thread file the reply lands in. */
  address: { key: string; threadId: string };
  /**
   * Assemble the bell's turn over the conversation as it stands, the place's
   * history and desk put where its readers find them. Null when there is
   * nothing to answer in any more.
   */
  assemble(bell: string, signal: AbortSignal): Promise<PlaceBellAssembly | { failed: string } | null>;
  /** Whether the reader has the conversation open as the turn lands. */
  watching(): boolean;
}

export interface PlaceBellDeps {
  durable(): Promise<DeviceDurable> | undefined;
  threads: Pick<ThreadFiles, "load" | "messages">;
  /** The session a surface has open on the conversation. */
  session(key: string): PlaceSession | undefined;
  now(): number;
  stall?: StallOptions;
}

export function appPlaceBellDeps(durable: () => Promise<DeviceDurable> | undefined): PlaceBellDeps {
  return {
    durable,
    threads: {
      load: async (key) => {
        await loadThreads(key);
      },
      messages: (key, threadId) => getThread(key, threadId)?.messages,
    },
    session: openPlaceSession,
    now: Date.now,
  };
}

/** A stopped or failed turn keeps what it produced; a row that says nothing is not a row. */
function kept(rows: readonly CallRow[]): CallRow[] {
  return rows.filter((r) => r.role === "user" || r.text !== "" || (r.tools?.length ?? 0) > 0);
}

/** A turn nobody is looking at: started on the runtime and followed to its end, no rows drawn. */
export async function headlessPlaceTurn(
  durable: DeviceDurable,
  request: PlaceBellRequest,
  stall: StallOptions = {},
): Promise<BookTurnEnd> {
  const driven = await drivePlaceTurn(durable, { ...request, ...stall }, () => {});
  return driven.ended;
}

/** Answer a bell in a place's conversation. Null when there is nothing to answer in. */
export async function deliverPlaceBell(
  input: TurnDelivery,
  place: PlaceBell,
  deps: PlaceBellDeps,
): Promise<TurnDeliveryOutcome | null> {
  const durable = await deps.durable();
  if (!durable) return { status: "failed", reason: "the turn runtime has not started" };
  const { runtime } = durable;
  const answered = (reply: string): TurnDeliveryOutcome => ({ status: "answered", reply, watching: place.watching() });

  const conversation = await runtime.conversationFor(place.key, place.origin, BACKGROUND_CONTEXT);
  const earlier = await bellTurn(runtime, conversation.id, input.bellId, BACKGROUND_CONTEXT);
  if (earlier) {
    input.onWait?.();
    const result = await earlier;
    if (result?.status === "done" || (result?.reason === "aborted" && result.landed)) {
      await deps.threads.load(place.address.key);
      const said = (deps.threads.messages(place.address.key, place.address.threadId) ?? []).filter(
        (m) => m.role === "ai" && input.runId !== undefined && m.origin?.runId === input.runId,
      );
      return answered(said[said.length - 1]?.text ?? "");
    }
  }

  for (;;) {
    const open = deps.session(place.key);
    if (open?.running()) {
      input.onWait?.();
      await open.idle();
      continue;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const assembled = await place.assemble(input.bell, controller.signal).finally(() =>
      input.signal?.removeEventListener("abort", abort),
    );
    if (!assembled) return null;
    if ("failed" in assembled) return { status: "failed", reason: assembled.failed };
    const request: PlaceBellRequest = {
      ...assembled,
      line: { text: input.bell },
      bell: { id: input.bellId, ...(input.runId !== undefined ? { runId: input.runId } : {}) },
      describe: catalogDescribe(assembled.tools),
    };
    // Subscribed before the turn is tried, so a busy turn that lands meanwhile is not missed.
    let landedHere!: () => void;
    const landed = new Promise<void>((resolve) => (landedHere = resolve));
    const off = durable.onTurnSettled((event) => {
      if (event.conversationId === conversation.id) landedHere();
    });
    let end: BookTurnEnd;
    try {
      // The reader may have opened the conversation, or started a turn in it, while this was assembled.
      const session = deps.session(place.key);
      if (session?.running()) continue;
      const after = Math.max(
        deps.now(),
        ...(deps.threads.messages(place.address.key, place.address.threadId) ?? []).map((m) => m.ts),
      );
      end = await (session?.bell(after, request) ?? headlessPlaceTurn(durable, request, deps.stall));
    } catch (e) {
      if (!(e instanceof TurnBusy)) return { status: "failed", reason: e instanceof Error ? e.message : String(e) };
      // A turn with no session of its own (resumed after a restart, another bell's) is running or landing.
      input.onWait?.();
      await landed;
      continue;
    } finally {
      off();
    }

    if (end.kind === "stalled") return { status: "failed", reason: "the answer stalled" };
    const rows = kept(end.rows);
    const reply = [...rows].reverse().find((r) => r.role === "ai")?.text ?? "";
    if (end.kind === "answered") return answered(reply);
    if (end.kind === "stopped" && rows.some((r) => r.role === "ai")) return answered(reply);
    return { status: "failed", reason: end.kind === "stopped" ? "stopped" : end.message };
  }
}
