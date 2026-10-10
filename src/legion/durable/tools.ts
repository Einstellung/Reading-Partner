// AgentTool to pi-durable tool registration (docs/soul/87, "工具的 replay").
// Registration is per process, one per name: the schema comes from a catalog
// known when the Harness opens, and each call resolves the conversation's desk
// (the tools today's build*Tools made for that book or place) through the
// resolver registered for its place, cached per conversation in memory.

import type { Context } from "@earendil-works/chord";
import { awaitWithContext } from "@earendil-works/chord/context";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ConversationId, JsonObject, ToolRegistration } from "@earendil-works/pi-durable";
import type { AgentTool } from "../execute/contract";
import { normalizeToolResult } from "../execute/tool-result";
import { ThreadDoc, type ThreadOrigin } from "./extension";

/** The tools of one desk: what today's opener and build*Tools give for this origin. */
export type DeskResolver = (origin: ThreadOrigin, context: Context) => Promise<readonly AgentTool[]>;

export class DeskCache {
  private readonly desks = new Map<ConversationId, Promise<readonly AgentTool[]>>();

  constructor(private readonly resolvers: Readonly<Record<string, DeskResolver>>) {}

  tools(conversationId: ConversationId, origin: ThreadOrigin, context: Context): Promise<readonly AgentTool[]> {
    const cached = this.desks.get(conversationId);
    if (cached) return cached;
    const resolver = this.resolvers[origin.place];
    if (!resolver) return Promise.reject(new Error(`no desk resolver for place "${origin.place}"`));
    const resolving = resolver(origin, context);
    this.desks.set(conversationId, resolving);
    resolving.catch(() => {
      if (this.desks.get(conversationId) === resolving) this.desks.delete(conversationId);
    });
    return resolving;
  }

  /** A new turn assembles a new desk. */
  forget(conversationId: ConversationId): void {
    this.desks.delete(conversationId);
  }

  clear(): void {
    this.desks.clear();
  }
}

/**
 * One registration for `spec`. Every wait in a call goes through the call's
 * context, so an abort, closing the app or a generation swap lets go of it at
 * once (docs/pitfall/508, 514); what the tool goes on to do is nobody's.
 */
export function toolRegistration(spec: AgentTool, desks: DeskCache): ToolRegistration {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    ...(spec.replay === "safe" ? { replay: "safe" as const } : {}),
    async execute(args, api, context) {
      const origin = (await api.snapshot(ThreadDoc, api.conversationId, context))?.origin;
      if (!origin) throw new Error(`${spec.name}: this conversation has no thread`);
      const tools = await awaitWithContext(desks.tools(api.conversationId, origin, context), context);
      const tool = tools.find((t) => t.name === spec.name);
      if (!tool) throw new Error(`${spec.name} is not available here`);
      const raw = await awaitWithContext(tool.execute(args as Record<string, unknown>), context);
      const { text, images, receipt } = normalizeToolResult(tool, raw);
      const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
      for (const image of images) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
      return receipt === undefined ? { content } : { content, details: receipt as unknown as JsonObject };
    },
  };
}
