// The AI add-source tools (docs/17), wired into the info chat's agent loop:
// probe_source (find a feed / judge the site), trial_source (really fetch 3
// articles and surface a confirm card), add_source (write it to the store). The
// hard rule lives in the system prompt AND is echoed by the trial result: the
// model may only call add_source after the user explicitly agrees. Network and
// extraction are injected, so the tools test without a real fetch/DOM. The pure
// probe logic is in probe.ts; trialSource here is the one bit of orchestration
// that runs the generic engine over a candidate descriptor.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../ai/agent";
import type { FetchFn } from "./http";
import type { ExtractReadable, SourceDescriptor } from "./descriptor";
import { validateDescriptor } from "./descriptor";
import { collectSource } from "./engine";
import { probeSource, pipeLabel } from "./probe";
import type { ProbeConfirmCardData, TrialSample } from "./cards";

// A body of at least this many plain-text characters counts as "full text" in a
// trial sample (below it the fetch got a headline/teaser only).
const FULLTEXT_SAMPLE_MIN = 200;

export interface TrialResult {
  ok: boolean;
  samples: TrialSample[];
  error?: string;
}

// Really collect 3 articles through the generic engine and report each one's
// title, character count, and whether the full body came back. Network + extract
// injected. A discovery-layer failure (feed/list unreachable) is caught and
// returned as !ok so the caller can tell the user honestly.
export async function trialSource(
  descriptor: SourceDescriptor,
  deps: { fetchFn: FetchFn; extract?: ExtractReadable },
): Promise<TrialResult> {
  try {
    const items = await collectSource(
      { ...descriptor, limit: 3 },
      { fetchFn: deps.fetchFn, extract: deps.extract },
    );
    const samples: TrialSample[] = items.slice(0, 3).map((it) => {
      const text = it.textContent || it.summary || "";
      return {
        title: it.title,
        chars: text.length,
        fullText: !it.summaryOnly && !!it.textContent && it.textContent.length >= FULLTEXT_SAMPLE_MIN,
      };
    });
    return { ok: samples.length > 0, samples, error: samples.length ? undefined : "No articles could be fetched." };
  } catch (e) {
    return { ok: false, samples: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface SourceToolDeps {
  fetchFn: FetchFn;
  extract: ExtractReadable;
  // Resolve a catalog id (builtins.ts) to its ready-made descriptor.
  resolveKnown(id: string): SourceDescriptor | undefined;
  // Write a descriptor to the source store.
  addSource(descriptor: SourceDescriptor): Promise<void>;
  // Surface a confirm card in the chat after a successful trial.
  onProbeCard(card: ProbeConfirmCardData): void;
}

// A running/failed status line for a source tool call, shown in the chat trace.
export function sourceToolStatusLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "probe_source":
      return `Probing ${String(args.input ?? "the site")}`;
    case "trial_source":
      return "Fetching 3 articles to test";
    case "add_source":
      return "Adding the source";
    default:
      return `Running ${name}`;
  }
}

// Resolve the descriptor a trial/add call refers to: either a catalog id (a
// builtin, already researched) or a JSON descriptor the model assembled from a
// probe. Always returned enabled.
function resolveDescriptor(args: Record<string, unknown>, deps: SourceToolDeps): SourceDescriptor {
  const knownId = args.knownId ? String(args.knownId).trim() : "";
  if (knownId) {
    const d = deps.resolveKnown(knownId);
    if (!d) throw new Error(`Unknown catalog source id: "${knownId}".`);
    return { ...d, enabled: true };
  }
  const json = String(args.descriptorJson ?? "").trim();
  if (!json) throw new Error("Provide either knownId (a catalog source) or descriptorJson.");
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("descriptorJson is not valid JSON.");
  }
  const v = validateDescriptor(raw);
  if (!v.ok) throw new Error(`Invalid descriptor: ${v.error}`);
  return { ...v.descriptor, enabled: true };
}

const DESCRIPTOR_ARGS = {
  descriptorJson: Type.Optional(
    Type.String({
      description:
        "The candidate source descriptor as a JSON object string (from probe_source). Omit if using knownId.",
    }),
  ),
  knownId: Type.Optional(
    Type.String({ description: "Id of a catalog source to use directly, skipping probe (see the catalog in your instructions)." }),
  ),
};

export function buildSourceTools(deps: SourceToolDeps): AgentTool[] {
  return [
    {
      name: "probe_source",
      description:
        "Given a site URL or bare domain, try the common feed paths (/feed, /rss, " +
        "wp-json, …), detect RSS/Atom/RDF/JSON, judge whether the feed carries full " +
        "text or only summaries, and — if there is no feed — inspect the homepage to " +
        "tell an SSR list page from a browser-only app. Returns a candidate descriptor " +
        "(JSON) and the probe log. Use it for a site the user names or links; for a " +
        "catalog source, skip straight to trial_source with knownId.",
      parameters: Type.Object({
        input: Type.String({ description: "A site URL or domain, e.g. https://example.com or example.com." }),
      }),
      execute: async (args) => {
        const input = String(args.input ?? "").trim();
        if (!input) throw new Error("probe_source needs a URL or domain.");
        const r = await probeSource(input, { fetchFn: deps.fetchFn });
        const log = r.steps.length ? `\n\nProbe log:\n${r.steps.map((s) => `- ${s}`).join("\n")}` : "";
        if (!r.ok || !r.descriptor) {
          return `Could not connect this source: ${r.reason ?? "no feed found."}${log}\n\nTell the user honestly it can't be added.`;
        }
        return (
          `Found a candidate: "${r.descriptor.name}" — ${r.pipeLabel}.${log}\n\n` +
          `Descriptor (pass this as descriptorJson to trial_source; set a good name and line first):\n` +
          JSON.stringify(r.descriptor)
        );
      },
    },
    {
      name: "trial_source",
      description:
        "Really fetch 3 articles through the generic engine to prove a source works " +
        "before adding it. Pass either a knownId (catalog source) or descriptorJson (from " +
        "probe_source). Shows the user a confirmation card with the 3 titles and their " +
        "character counts. Always trial before add_source.",
      parameters: Type.Object(DESCRIPTOR_ARGS),
      execute: async (args) => {
        const descriptor = resolveDescriptor(args, deps);
        const trial = await trialSource(descriptor, { fetchFn: deps.fetchFn, extract: deps.extract });
        if (!trial.ok) {
          throw new Error(trial.error || "The trial fetch returned nothing.");
        }
        const label = pipeLabel(descriptor);
        deps.onProbeCard({ kind: "probe-confirm", descriptor, pipeLabel: label, samples: trial.samples });
        const lines = trial.samples
          .map((s, i) => `${i + 1}. ${s.title} — ${s.chars} chars${s.fullText ? " (full text)" : " (summary only)"}`)
          .join("\n");
        return (
          `Trial of "${descriptor.name}" (${label}) succeeded:\n${lines}\n\n` +
          `A confirmation card is now shown to the user. Only call add_source after they explicitly say yes.`
        );
      },
    },
    {
      name: "add_source",
      description:
        "Add a source to the user's list. ONLY call this after you have shown a trial " +
        "result and the user has explicitly agreed to add it. Pass the same knownId or " +
        "descriptorJson you trialed.",
      parameters: Type.Object(DESCRIPTOR_ARGS),
      execute: async (args) => {
        const descriptor = resolveDescriptor(args, deps);
        await deps.addSource(descriptor);
        return `Added "${descriptor.name}" to the user's sources.`;
      },
    },
  ];
}
