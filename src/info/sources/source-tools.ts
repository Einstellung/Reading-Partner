// The AI add-source tools (docs/17), wired into the info chat's agent loop:
// probe_source (find a feed / judge the site), trial_source (really fetch a few
// articles and surface a confirm card), add_source (write it to the store). The
// hard rule lives in the system prompt AND is echoed by the trial result: the
// model may only call add_source after the user explicitly agrees. Network,
// extraction and the webview fetcher are injected, so the tools test without a
// real fetch/DOM/window. The pure probe logic is in probe.ts; trialSource here
// is the one bit of orchestration that runs the generic engine over a candidate
// descriptor.
//
// trialSource is not a plain network call: for a `webview` source it opens a
// hidden browser window per article, one at a time, tens of seconds each. Any
// caller has to expect a slow call and tell the user before it starts.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../ai/agent";
import type { FetchFn } from "../extract/http";
import type { ExtractReadable } from "../extract/readable-select";
import type { SourceDescriptor } from "./descriptor";
import { validateDescriptor } from "./descriptor";
import { collectSource, fetchBodies, type WebviewFetch } from "./engine";
import type { InfoItem } from "./item";
import { probeSource, pipeLabel } from "./probe";
import type { ProbeConfirmCardData, TrialSample } from "./source-cards";

// A body of at least this many plain-text characters counts as "full text" in a
// trial sample (below it the fetch got a headline/teaser only).
const FULLTEXT_SAMPLE_MIN = 200;

// How many articles a trial fetches to prove a source.
export const TRIAL_LIMIT = 3;
// …and how many when the bodies come through the hidden webview: one. Each of
// those costs a browser window and 20-30 seconds, the fetcher runs one at a
// time, and the user is sitting in front of the trial waiting for its answer.
// One body answers the question the trial exists to answer — does a body come
// back at all — and the AI can trial again if one is not convincing.
export const WEBVIEW_TRIAL_LIMIT = 1;

export interface TrialDeps {
  fetchFn: FetchFn;
  extract?: ExtractReadable;
  // The hidden-webview article fetcher, where the host has one. Without it a
  // `webview` source can only be trialed down to what its feed carried, which
  // is a headline and a blurb — true on that host, and the note says so.
  fetchViaWebview?: WebviewFetch;
}

export interface TrialResult {
  ok: boolean;
  samples: TrialSample[];
  // What the samples alone do not say: why there is one of them, or why the
  // bodies could not be tested on this host. For the caller to relay.
  note?: string;
  error?: string;
}

// Whether trialing this descriptor will go through the hidden webview — which
// is what makes a trial slow and what decides how many articles it takes.
export function trialUsesWebview(
  descriptor: SourceDescriptor,
  deps: { fetchViaWebview?: WebviewFetch },
): boolean {
  return descriptor.fulltext.mode === "webview" && !!deps.fetchViaWebview;
}

// Really collect a few articles through the generic engine and report each
// one's title, character count, and whether the full body came back. Network,
// extract and the webview fetcher are injected. A discovery-layer failure
// (feed/list unreachable) is caught and returned as !ok so the caller can tell
// the user honestly.
//
// Slow for a `webview` source: it opens a hidden browser window for the body,
// tens of seconds, and only one of those runs at a time app-wide (a background
// collection holds the same gate). Callers must warn the user first.
export async function trialSource(
  descriptor: SourceDescriptor,
  deps: TrialDeps,
): Promise<TrialResult> {
  const viaWebview = trialUsesWebview(descriptor, deps);
  const limit = viaWebview ? WEBVIEW_TRIAL_LIMIT : TRIAL_LIMIT;
  try {
    let items = (
      await collectSource(
        { ...descriptor, limit },
        { fetchFn: deps.fetchFn, extract: deps.extract },
      )
    ).slice(0, limit);
    if (viaWebview) {
      // A discovery pass never opens a webview — a window per item over a whole
      // feed is exactly what the funnel refuses (engine.ts) — so the body is the
      // material step's job, and the trial runs that step itself for the one
      // article it is proving. Without this the gate that decides whether a
      // source is worth adding answers "summary only" for every webview source.
      items = await fetchBodies(items, [descriptor], {
        fetchFn: deps.fetchFn,
        extract: deps.extract,
        fetchViaWebview: deps.fetchViaWebview,
      });
    }
    const samples: TrialSample[] = items.map((it) => {
      const text = it.textContent || it.summary || "";
      return {
        title: it.title,
        chars: text.length,
        fullText: !it.summaryOnly && !!it.textContent && it.textContent.length >= FULLTEXT_SAMPLE_MIN,
      };
    });
    return {
      ok: samples.length > 0,
      samples,
      note: trialNote(descriptor, deps, items),
      error: samples.length ? undefined : "No articles could be fetched.",
    };
  } catch (e) {
    return { ok: false, samples: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// The line a webview trial needs next to its samples, because a list of titles
// and character counts cannot say why there is only one of them, why this host
// could not test the bodies at all, or which of the two "summary only" answers
// this is: a body that came back signed-out (sign in and trial again) or no body
// at all (a wall, a timeout, a page with no article — worth another try, not a
// verdict on the source).
function trialNote(
  descriptor: SourceDescriptor,
  deps: TrialDeps,
  items: InfoItem[],
): string | undefined {
  if (descriptor.fulltext.mode !== "webview") return undefined;
  if (!deps.fetchViaWebview) {
    return (
      "This source's bodies come from a hidden browser window, and this host has none, " +
      "so the samples are the feed's own summaries — not evidence that the source is summary-only."
    );
  }
  const head = `Only ${WEBVIEW_TRIAL_LIMIT} article was fetched (not ${TRIAL_LIMIT}): each body costs a hidden browser window and tens of seconds.`;
  const first = items[0];
  if (!first) return head;
  const signInUrl = descriptor.fulltext.signInUrl;
  if (first.textContent && first.summaryOnly && signInUrl) {
    return `${head} The body came back as the signed-out preview, not the whole story — sign in at ${signInUrl} and trial again to see the full text.`;
  }
  if (!first.textContent) {
    return `${head} The window came back without a body (a wall, a timeout, or a page with no article), which is worth one more try rather than a verdict on the source.`;
  }
  return head;
}

export interface SourceToolDeps {
  fetchFn: FetchFn;
  extract: ExtractReadable;
  // The hidden-webview article fetcher where the host has one. Optional: absent
  // it, trial_source reports a `webview` source's feed summaries and says why.
  fetchViaWebview?: WebviewFetch;
  // Write a descriptor to the source store.
  addSource(descriptor: SourceDescriptor): Promise<void>;
  // Surface a confirm card in the chat after a successful trial.
  onProbeCard(card: ProbeConfirmCardData): void;
}

// The fulltext mode of the descriptor an argument bag carries, or "" when it
// carries nothing readable. The status label is drawn while the call runs, so a
// descriptorJson that does not parse simply falls back to the generic wording.
function argsFulltextMode(args: Record<string, unknown>): string {
  try {
    const raw = JSON.parse(String(args.descriptorJson ?? "")) as { fulltext?: { mode?: unknown } };
    const mode = raw?.fulltext?.mode;
    return typeof mode === "string" ? mode : "";
  } catch {
    return "";
  }
}

// A running/failed status line for a source tool call, shown in the chat trace.
// The webview line is what stands between the user and a silent minute; it reads
// off the descriptor, not the host, so on a host with no webview fetcher (iOS)
// it flashes for the instant the summary-only trial takes.
export function sourceToolStatusLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "probe_source":
      return `Probing ${String(args.input ?? "the site")}`;
    case "trial_source":
      return argsFulltextMode(args) === "webview"
        ? `Fetching ${WEBVIEW_TRIAL_LIMIT} article through a background browser window — tens of seconds`
        : `Fetching ${TRIAL_LIMIT} articles to test`;
    case "add_source":
      return "Adding the source";
    default:
      return `Running ${name}`;
  }
}

// Resolve the descriptor a trial/add call refers to: the JSON descriptor the
// model assembled from (or received verbatim from) a probe. Always enabled.
function resolveDescriptor(args: Record<string, unknown>): SourceDescriptor {
  const json = String(args.descriptorJson ?? "").trim();
  if (!json) throw new Error("Provide descriptorJson (from probe_source, or one you drafted yourself).");
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
  descriptorJson: Type.String({
    description:
      "The source descriptor as a JSON object string. It may come from probe_source, or be one " +
      "you wrote or adapted yourself (a new URL, a tweaked linkPattern, a same-site verified " +
      "shape cloned). trial_source really fetches to prove it, so a wrong draft simply fails.",
  }),
};

export function buildSourceTools(deps: SourceToolDeps): AgentTool[] {
  return [
    {
      name: "probe_source",
      description:
        "Given a site URL or bare domain the user named or linked, try the common feed " +
        "paths (/feed, /rss, wp-json, …), detect RSS/Atom/RDF/JSON, judge whether the feed " +
        "carries full text or only summaries, and — if there is no feed — inspect the page " +
        "to tell an SSR list page from a browser-only app. A bare domain or the exact list " +
        "URL a verified source already covers returns that descriptor directly; a different " +
        "path on a covered site is probed normally, with the built-in offered as a shape to " +
        "clone. Returns a candidate descriptor (JSON) and the probe log.",
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
        const note = r.note ? `\n\nKnown caveat for this source: ${r.note}` : "";
        return (
          `Found a candidate: "${r.descriptor.name}" — ${r.pipeLabel}.${note}${log}\n\n` +
          `Descriptor (pass this as descriptorJson to trial_source; set a good name and line first):\n` +
          JSON.stringify(r.descriptor)
        );
      },
    },
    {
      name: "trial_source",
      description:
        "Really fetch 3 articles through the generic engine to prove a source works " +
        "before adding it. Pass a descriptorJson — from probe_source, or one you drafted or " +
        "adapted yourself (a new URL, a tweaked linkPattern, a same-site verified shape " +
        "cloned). This is the check: a wrong draft fails here, so just tell the user honestly " +
        "if it does. Shows a confirmation card with the titles and character counts. Always " +
        "trial before add_source. A `webview` source is proved with 1 article instead of 3, " +
        "because each body opens a hidden browser window for tens of seconds — say that it " +
        "will take up to a minute BEFORE you make the call, not after.",
      parameters: Type.Object(DESCRIPTOR_ARGS),
      execute: async (args) => {
        const descriptor = resolveDescriptor(args);
        const trial = await trialSource(descriptor, {
          fetchFn: deps.fetchFn,
          extract: deps.extract,
          fetchViaWebview: deps.fetchViaWebview,
        });
        if (!trial.ok) {
          throw new Error(trial.error || "The trial fetch returned nothing.");
        }
        const label = pipeLabel(descriptor);
        deps.onProbeCard({ kind: "probe-confirm", descriptor, pipeLabel: label, samples: trial.samples });
        const lines = trial.samples
          .map((s, i) => `${i + 1}. ${s.title} — ${s.chars} chars${s.fullText ? " (full text)" : " (summary only)"}`)
          .join("\n");
        const note = trial.note ? `\n\n${trial.note}` : "";
        return (
          `Trial of "${descriptor.name}" (${label}) succeeded:\n${lines}${note}\n\n` +
          `A confirmation card is now shown to the user. Only call add_source after they explicitly say yes.`
        );
      },
    },
    {
      name: "add_source",
      description:
        "Add a source to the user's list. ONLY call this after you have shown a trial " +
        "result of this exact descriptor and the user has explicitly agreed to add it. Pass " +
        "the same descriptorJson you trialed.",
      parameters: Type.Object(DESCRIPTOR_ARGS),
      execute: async (args) => {
        const descriptor = resolveDescriptor(args);
        await deps.addSource(descriptor);
        return `Added "${descriptor.name}" to the user's sources.`;
      },
    },
  ];
}
