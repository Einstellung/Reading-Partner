// Live wiring of the prep pipeline: real deps (Tauri fs store, arXiv/Semantic
// Scholar over the http plugin, pi-ai through the app's provider config) bound
// to the dep-injected PrepPipeline. One pipeline instance per survey hash for
// the app's lifetime, so prep keeps running in the background across
// classroom toggles.

import { streamChat, type ProviderId } from "../ai/providers";
import { ensureFulltext } from "../fulltext/store";
import type { Fulltext } from "../fulltext/types";
import { loadSettings } from "../settings";
import { hashPath } from "../storage";
import { fetchFromArxiv, normalizeArxivId } from "./arxiv";
import { fetchFromOpenAlex } from "./openalex";
import { fetchWithRetry } from "./http";
import { runDigest } from "./digest";
import { serializeNote } from "./notes";
import { parsePlan, planUserMessage, uniqueSlug, PLAN_SYSTEM_PROMPT } from "./plan";
import {
  loadPrepState,
  paperCachePath,
  readPaperPdf,
  savePrepState,
  writePaperPdf,
  writePrepNote,
} from "./store";
import { fetchFromS2 } from "./s2";
import type { DigestOutcome, FetchOutcome, PipelineDeps } from "./pipeline";
import { PrepPipeline } from "./pipeline";
import type { PrepPaper } from "./types";

async function resolveModel(): Promise<{ providerId: ProviderId; modelId: string }> {
  const s = await loadSettings();
  if (!s.defaultProviderId || !s.defaultModelId) {
    throw new Error("no default AI provider configured (Settings)");
  }
  return { providerId: s.defaultProviderId as ProviderId, modelId: s.defaultModelId };
}

// One plain (tool-less) model call, promisified. onProgress reports the
// cumulative received character count so the pipeline's watchdog and liveness
// counter can track a long stream; signal aborts it.
function callModel(
  systemPrompt: string,
  userText: string,
  opts: { signal: AbortSignal; onProgress: (chars: number) => void },
): Promise<string> {
  return resolveModel().then(
    (model) =>
      new Promise<string>((resolve, reject) => {
        let chars = 0;
        void streamChat({
          providerId: model.providerId,
          modelId: model.modelId,
          systemPrompt,
          messages: [{ role: "user", text: userText }],
          signal: opts.signal,
          onDelta: (t) => {
            chars += t.length;
            opts.onProgress(chars);
          },
          onDone: resolve,
          onError: (m) => reject(new Error(m)),
        });
      }),
  );
}

function makeDeps(surveyHash: string, surveyName: string, surveyFulltext: Fulltext): PipelineDeps {
  return {
    loadState: loadPrepState,
    saveState: savePrepState,

    async buildPlan(opts) {
      const text = await callModel(PLAN_SYSTEM_PROMPT, planUserMessage(surveyFulltext), opts);
      return parsePlan(text);
    },

    async fetchPaper(paper): Promise<FetchOutcome | null> {
      // A previously downloaded PDF (e.g. a digest that failed midway) is reused.
      const cached = await readPaperPdf(surveyHash, paper.slug);
      if (cached) {
        return {
          source: paper.source ?? null,
          arxivId: paper.arxivId,
          abstract: paper.abstract ?? "",
          pdfBytes: cached,
        };
      }
      try {
        const hit = await fetchFromArxiv(paper);
        if (hit) {
          if (hit.pdfBytes) await writePaperPdf(surveyHash, paper.slug, hit.pdfBytes);
          return { source: "arxiv", arxivId: hit.arxivId, abstract: hit.abstract, pdfBytes: hit.pdfBytes };
        }
      } catch (e) {
        console.warn("arxiv lookup failed, trying OpenAlex", e);
      }
      // OpenAlex (keyless polite pool) before Semantic Scholar, so keyless
      // users almost never hit S2's shared, 429-prone pool.
      try {
        const oa = await fetchFromOpenAlex(paper);
        if (oa) {
          let pdfBytes = oa.pdfBytes;
          // OpenAlex knew the arXiv id but had no usable PDF: one direct try at
          // the arXiv PDF before falling through. The per-host throttle spaces it.
          if (!pdfBytes && oa.arxivId) {
            const id = normalizeArxivId(oa.arxivId);
            if (id) {
              try {
                const res = await fetchWithRetry(`https://arxiv.org/pdf/${id}`);
                if (res.ok) pdfBytes = await res.arrayBuffer();
              } catch {
                // Still abstract-only; S2 is next only if OpenAlex found nothing.
              }
            }
          }
          if (pdfBytes) await writePaperPdf(surveyHash, paper.slug, pdfBytes);
          return { source: "openalex", arxivId: oa.arxivId, abstract: oa.abstract, pdfBytes };
        }
      } catch (e) {
        console.warn("openalex lookup failed, trying Semantic Scholar", e);
      }
      const s2Key = (await loadSettings()).semanticScholarApiKey ?? undefined;
      const hit = await fetchFromS2(paper, undefined, s2Key);
      if (!hit) return null;
      if (hit.pdfBytes) await writePaperPdf(surveyHash, paper.slug, hit.pdfBytes);
      return { source: "semantic-scholar", arxivId: hit.arxivId, abstract: hit.abstract, pdfBytes: hit.pdfBytes };
    },

    async digestPaper(paper, fetched, opts): Promise<DigestOutcome> {
      // Extract (and cache) the paper's text; an unreadable PDF degrades to a
      // thin note rather than failing the paper.
      let ft: Fulltext;
      try {
        ft = await ensureFulltext(paperCachePath(surveyHash, paper.slug), fetched.pdfBytes!);
      } catch (e) {
        console.warn("paper text extraction failed", e);
        return { body: "", pages: null, thin: true };
      }
      if (ft.status !== "ok") return { body: "", pages: ft.pages.length, thin: true };
      const model = await resolveModel();
      const body = await runDigest({
        paper,
        surveyName,
        fulltext: ft,
        model,
        signal: opts.signal,
        onProgress: opts.onProgress,
      });
      return { body, pages: ft.pages.length, thin: false };
    },

    async writeNote(paper, body) {
      const content = serializeNote(
        {
          title: paper.title,
          authors: paper.authors,
          year: paper.year,
          arxivId: paper.arxivId,
          status: paper.status === "done" ? "done" : "abstract-only",
          source: paper.source ?? null,
          sourcePages: paper.pages ?? null,
          citedInChapters: paper.citedInChapters,
        },
        body,
      );
      await writePrepNote(surveyHash, paper.slug, content);
    },

    resolveAddition(query, taken): PrepPaper {
      const arxivId = normalizeArxivId(query);
      const title = arxivId ? `arXiv ${arxivId}` : query.trim();
      return {
        slug: uniqueSlug(taken, title),
        title,
        authors: [],
        year: null,
        arxivId,
        citedInChapters: [],
        reason: "added by the user",
        status: "queued",
        addedByUser: true,
      };
    },

    now: () => Date.now(),

    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),

    setTimer: (ms, cb) => {
      const id = setTimeout(cb, ms);
      return () => clearTimeout(id);
    },
  };
}

const pipelines = new Map<string, PrepPipeline>();

export function getPrepPipeline(
  surveyPath: string,
  surveyName: string,
  surveyFulltext: Fulltext,
): PrepPipeline {
  const hash = hashPath(surveyPath);
  let p = pipelines.get(hash);
  if (!p) {
    p = new PrepPipeline(hash, surveyName, makeDeps(hash, surveyName, surveyFulltext));
    pipelines.set(hash, p);
  }
  return p;
}

// A pipeline that may already exist for a book (no creation): lets the app
// re-attach UI after switching books without restarting anything.
export function peekPrepPipeline(surveyPath: string): PrepPipeline | null {
  return pipelines.get(hashPath(surveyPath)) ?? null;
}

// Whether a survey has prep state on disk (drives auto-resume on book open).
export async function hasPrepState(surveyPath: string): Promise<boolean> {
  return (await loadPrepState(hashPath(surveyPath))) !== null;
}
