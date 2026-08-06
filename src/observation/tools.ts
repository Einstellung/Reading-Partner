// The three memory agent tools (docs/02 part 2), registered in the same tool
// loop as the M6 reading tools. All writes go through the adapter; the optional
// onWrite hook lets the distiller count what changed and the app refresh the
// memory panel.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import type { MemoryAdapter } from "./adapter";
import { MEMORY_TYPES, isMemoryType, type MemoryEntry } from "./types";

export type MemoryWriteAction = "create" | "update" | "delete";

export interface MemoryToolOptions {
  onWrite?(action: MemoryWriteAction): void;
}

function describeEntry(e: MemoryEntry): string {
  const anchors: string[] = [];
  if (e.anchors.annotationIds.length) anchors.push(`annotations: ${e.anchors.annotationIds.join(", ")}`);
  if (e.anchors.messageIds.length) anchors.push(`messages: ${e.anchors.messageIds.join(", ")}`);
  return [
    `id: ${e.id}`,
    `type: ${e.type}`,
    `created: ${e.created}, updated: ${e.updated}`,
    ...anchors,
    "",
    e.body || e.summary,
  ].join("\n");
}

const TYPE_LIST = MEMORY_TYPES.join(" | ");

export function buildMemoryTools(adapter: MemoryAdapter, opts: MemoryToolOptions = {}): AgentTool[] {
  return [
    {
      name: "memory_search",
      description:
        "Keyword-search your long-term memory of this reader (this topic only). " +
        "Returns ranked snippets with memory ids. If the first search doesn't answer " +
        "the question, try different terms before giving up.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
      }),
      execute: async (args) => {
        const hits = await adapter.recall(String(args.query));
        if (hits.length === 0) return `No memory matches "${args.query}".`;
        return hits
          .map((h) => `[${h.entry.id}] (${h.entry.type}, updated ${h.entry.updated}) ${h.snippet}`)
          .join("\n\n");
      },
    },
    {
      name: "memory_read",
      description: "Read one memory in full by its id (as returned by memory_search or the index).",
      parameters: Type.Object({
        id: Type.String({ description: "The memory id, e.g. m-1a2b3c4d." }),
      }),
      execute: async (args) => {
        const id = String(args.id);
        const entry = (await adapter.listObservations()).find((e) => e.id === id);
        return entry ? describeEntry(entry) : `No memory with id "${id}".`;
      },
    },
    {
      name: "memory_update",
      description:
        "Create, update, or delete one memory about this reader. Update an existing " +
        "memory instead of creating a near-duplicate; delete a memory that turned out " +
        "wrong. When a new fact contradicts an existing memory, rewrite that memory as " +
        "an evolution (keep the old state and add the resolution with its date) — never " +
        "silently drop the old state. Write absolute dates, one fact per memory.",
      parameters: Type.Object({
        action: Type.String({ description: 'One of "create" | "update" | "delete".' }),
        id: Type.Optional(Type.String({ description: "Memory id (required for update/delete)." })),
        type: Type.Optional(Type.String({ description: `Memory type: ${TYPE_LIST} (required for create).` })),
        summary: Type.Optional(Type.String({ description: "One-line summary (required for create)." })),
        body: Type.Optional(Type.String({ description: "Full markdown body (required for create; replaces on update)." })),
        annotationIds: Type.Optional(Type.Array(Type.String(), { description: "Evidence: annotation ids this memory came from." })),
        messageIds: Type.Optional(Type.Array(Type.String(), { description: "Evidence: message ids this memory came from." })),
      }),
      execute: async (args) => {
        const action = String(args.action);
        const anchors =
          args.annotationIds !== undefined || args.messageIds !== undefined
            ? {
                annotationIds: (args.annotationIds as string[] | undefined) ?? [],
                messageIds: (args.messageIds as string[] | undefined) ?? [],
              }
            : undefined;

        if (action === "create") {
          const type = String(args.type ?? "");
          if (!isMemoryType(type)) throw new Error(`type must be one of: ${TYPE_LIST}`);
          const summary = String(args.summary ?? "").trim();
          const body = String(args.body ?? "").trim();
          if (!summary || !body) throw new Error("create requires summary and body");
          const entry = await adapter.retain({ type, summary, body, anchors });
          opts.onWrite?.("create");
          return `Created ${entry.id}.`;
        }

        const id = String(args.id ?? "").trim();
        if (!id) throw new Error(`${action} requires id`);

        if (action === "delete") {
          await adapter.correct(id, null);
          opts.onWrite?.("delete");
          return `Deleted ${id}.`;
        }

        if (action === "update") {
          const type = args.type === undefined ? undefined : String(args.type);
          if (type !== undefined && !isMemoryType(type)) {
            throw new Error(`type must be one of: ${TYPE_LIST}`);
          }
          const entry = await adapter.correct(id, {
            type,
            summary: args.summary === undefined ? undefined : String(args.summary),
            body: args.body === undefined ? undefined : String(args.body),
            anchors,
          });
          if (!entry) return `No memory with id "${id}".`;
          opts.onWrite?.("update");
          return `Updated ${entry.id}.`;
        }

        throw new Error('action must be one of "create" | "update" | "delete"');
      },
    },
  ];
}
