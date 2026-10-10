// The minimal pi-durable scene the spike measures: one harness, a faux model,
// a replay-safe read tool (`lookup`) and a tool that is not (`note`).
// docs/research/pi-durable-spike.md.

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { FauxProviderHandle } from "@earendil-works/pi-ai/providers/faux";
import {
  createRegistry,
  defineExtension,
  defineTool,
  type Extension,
  Harness,
  type HarnessSettings,
  type Storage,
} from "@earendil-works/pi-durable";

export const SPIKE_MODEL = { provider: "faux", modelId: "faux-1" } as const;

/** What the two tools do; tests and the crash child supply their own. */
export interface SpikeTools {
  lookup(query: string): Promise<string>;
  note(text: string): Promise<string>;
}

export function spikeExtension(tools: SpikeTools) {
  const lookup = defineTool({
    name: "lookup",
    description: "Look up a passage in the open book.",
    parameters: Type.Object({ query: Type.String() }),
    replay: "safe",
    execute: async (args) => ({ content: [{ type: "text", text: await tools.lookup(args.query) }] }),
  });
  const note = defineTool({
    name: "note",
    description: "Write a note into the reader's notebook.",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (args) => ({ content: [{ type: "text", text: await tools.note(args.text) }] }),
  });
  return defineExtension({ name: "spike", tools: [lookup, note] });
}

export interface SpikeOptions {
  storage: Storage;
  faux: FauxProviderHandle;
  tools: SpikeTools;
  settings?: HarnessSettings;
  /** Installed next to the spike's own two tools. */
  extensions?: readonly Extension[];
}

export function openSpike(options: SpikeOptions): Promise<Harness> {
  const models = createModels();
  models.setProvider(options.faux.provider);
  const registry = createRegistry();
  registry.install(spikeExtension(options.tools));
  for (const extension of options.extensions ?? []) registry.install(extension);
  return Harness.open(
    options.storage,
    { models, registry, settings: options.settings },
    BACKGROUND_CONTEXT,
  );
}

/** One transcript entry as a line of text, for assertions and reports. */
export interface Line {
  kind: string;
  text: string;
  isError?: boolean;
}

interface Part {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "toolCall") return `[call ${part.name} ${JSON.stringify(part.arguments)}]`;
      return "";
    })
    .join("");
}

// An entry carries its model-facing message as `model[0]`.
export function lines(entries: readonly { kind: string; model?: unknown }[]): Line[] {
  return entries.map((entry) => {
    const message = ((entry.model as unknown[] | undefined)?.[0] ?? {}) as { content?: unknown; isError?: boolean };
    const line: Line = { kind: entry.kind, text: textOf(message.content) };
    if (message.isError) line.isError = true;
    return line;
  });
}

/** The streamed partial text of the running generation in a view's pi.live, if any. */
export function livePartial(docs: Readonly<Record<string, unknown>>): string | undefined {
  const live = docs["pi.live"] as { generation?: { message?: { content?: unknown } } } | undefined;
  const message = live?.generation?.message;
  return message === undefined ? undefined : textOf(message.content);
}
