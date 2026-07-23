// Live wiring of the prep pipeline: real deps (Tauri fs store, arXiv/Semantic
// Scholar over the http plugin, pi-ai through the app's provider config) bound
// to the dep-injected PrepPipeline. One pipeline instance per survey hash for
// the app's lifetime, so prep keeps running in the background across
// classroom toggles.

import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { streamChat, type ProviderId } from "../ai/providers";
import { ensureFulltext, saveFulltext } from "../fulltext/store";
import { FULLTEXT_VERSION, type Fulltext } from "../fulltext/types";
import { buildFigureCatalog, ensureFigures } from "../figures";
import { loadSettings, toReasoning } from "../app/settings";
import { extractArticle } from "./article";
import { fetchFromArxiv, normalizeArxivId } from "./arxiv";
import { fetchFromOpenAlex } from "./openalex";
import { fetchWithRetry } from "./http";
import { runDigest } from "./digest";
import { serializeNote } from "./notes";
import { parsePlan, planUserMessage, uniqueSlug, PLAN_SYSTEM_PROMPT } from "./plan";
import { looksLikeHttpUrl, resolveUrlAddition, sniffContentType } from "./url";
import {
  loadPrepState,
  paperFulltextHash,
  readPaperPdf,
  savePrepState,
  writePaperPdf,
  writePrepNote,
} from "./store";
import { fetchFromS2 } from "./s2";
import type { DigestOutcome, FetchOutcome, PipelineDeps } from "./pipeline";
import { PrepPipeline } from "./pipeline";
import type { PrepPaper } from "./types";

async function resolveModel(): Promise<{
  providerId: ProviderId;
  modelId: string;
  reasoning: ThinkingLevel | undefined;
}> {
  const s = await loadSettings();
  if (!s.defaultProviderId || !s.defaultModelId) {
    throw new Error("no default AI provider configured (Settings)");
  }
  return {
    providerId: s.defaultProviderId as ProviderId,
    modelId: s.defaultModelId,
    reasoning: toReasoning(s.prepThinking),
  };
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
        // Both visible text and thinking count as liveness, so a model that
        // thinks for a long stretch before answering isn't aborted as stalled.
        const bump = (t: string) => {
          chars += t.length;
          opts.onProgress(chars);
        };
        void streamChat({
          providerId: model.providerId,
          modelId: model.modelId,
          systemPrompt,
          messages: [{ role: "user", text: userText }],
          signal: opts.signal,
          reasoning: model.reasoning,
          onDelta: bump,
          onThinking: bump,
          onDone: resolve,
          onError: (m) => reject(new Error(m)),
        });
      }),
  );
}

// Largest source a pasted link may pull; a bigger response is aborted.
const MAX_SOURCE_BYTES = 30 * 1024 * 1024;

// Fetch a user-pasted URL source (link ingestion, docs/09). GETs the URL,
// enforces the size cap, sniffs PDF vs HTML, and returns a FetchOutcome whose
// full text is already extracted and cached — so the chat can read it the moment
// the fetch stage ends, before digestion. A PDF is stored and text-extracted; an
// HTML page's main content becomes a single-"page" full text. Throws a clear
// error on 404 / oversize / an empty article.
async function fetchSource(surveyHash: string, paper: PrepPaper): Promise<FetchOutcome> {
  const url = paper.sourceUrl!;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`could not fetch the link (HTTP ${res.status})`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    throw new Error(`the source is too large (${Math.round(declared / 1e6)}MB; the limit is 30MB)`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`the source is too large (${Math.round(buf.byteLength / 1e6)}MB; the limit is 30MB)`);
  }
  const bytes = new Uint8Array(buf);
  const cacheKey = paperFulltextHash(surveyHash, paper.slug);

  if (sniffContentType(bytes, res.headers.get("content-type")) === "pdf") {
    await writePaperPdf(surveyHash, paper.slug, buf);
    // Extract now so the PDF is readable right after fetch; a no-text-layer PDF
    // degrades to a thin note in the digest stage (its cache is already written).
    let ft: Fulltext | null = null;
    try {
      ft = await ensureFulltext(cacheKey, buf);
    } catch (e) {
      console.warn("source pdf extraction failed", e);
    }
    return {
      source: "url",
      arxivId: null,
      abstract: "",
      pdfBytes: buf,
      fulltext: ft && ft.status === "ok" ? ft : null,
      kind: "pdf",
    };
  }

  const article = extractArticle(new TextDecoder("utf-8").decode(bytes));
  if (!article.text.trim()) throw new Error("no readable article content at the link");
  const ft: Fulltext = {
    version: FULLTEXT_VERSION,
    status: "ok",
    pages: [article.text],
    outline: [],
  };
  await saveFulltext(cacheKey, ft);
  return {
    source: "url",
    arxivId: null,
    abstract: "",
    pdfBytes: null,
    fulltext: ft,
    kind: "article",
    title: article.title ?? undefined,
  };
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
      // A user-pasted URL bypasses the arXiv/OpenAlex/S2 lookup: fetch the link
      // directly (link ingestion, docs/09). A cached PDF still short-circuits.
      if (paper.sourceUrl && !(await readPaperPdf(surveyHash, paper.slug))) {
        return fetchSource(surveyHash, paper);
      }
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
      const isArticle = fetched.kind === "article";
      // Prefer a full text the fetch already extracted (link ingestion); else
      // extract (and cache) the PDF's text. An unreadable PDF degrades to a thin
      // note rather than failing the paper.
      let ft: Fulltext;
      if (fetched.fulltext) {
        ft = fetched.fulltext;
      } else {
        try {
          ft = await ensureFulltext(paperFulltextHash(surveyHash, paper.slug), fetched.pdfBytes!);
        } catch (e) {
          console.warn("paper text extraction failed", e);
          return { body: "", pages: null, thin: true };
        }
      }
      if (ft.status !== "ok") return { body: "", pages: ft.pages.length, thin: true };
      const model = await resolveModel();
      // The paper's figure catalog (M9), so the note can cite key figures as
      // [fig:N]. PDF-only (a fetched article has no figures); extraction-only (no
      // vision); a failure just omits the catalog.
      const figs =
        !isArticle && fetched.pdfBytes
          ? await ensureFigures(paperFulltextHash(surveyHash, paper.slug), fetched.pdfBytes).catch(
              () => null,
            )
          : null;
      const body = await runDigest({
        paper,
        surveyName,
        fulltext: ft,
        model,
        signal: opts.signal,
        onProgress: opts.onProgress,
        figureCatalog: figs ? buildFigureCatalog(figs.figures) : "",
        isArticle,
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
          sourceUrl: paper.sourceUrl ?? null,
          kind: paper.kind ?? null,
        },
        body,
      );
      await writePrepNote(surveyHash, paper.slug, content);
    },

    resolveAddition(query, taken): PrepPaper {
      // A pasted http(s) link ingests as a URL source (link ingestion, docs/09);
      // resolveUrlAddition throws on a non-https URL. Otherwise it's a title or
      // arXiv id, as before.
      if (looksLikeHttpUrl(query.trim())) return resolveUrlAddition(query, taken);
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
  surveyHash: string,
  surveyName: string,
  surveyFulltext: Fulltext,
): PrepPipeline {
  let p = pipelines.get(surveyHash);
  if (!p) {
    p = new PrepPipeline(surveyHash, surveyName, makeDeps(surveyHash, surveyName, surveyFulltext));
    pipelines.set(surveyHash, p);
  }
  return p;
}

// A pipeline that may already exist for a book (no creation): lets the app
// re-attach UI after switching books without restarting anything.
export function peekPrepPipeline(surveyHash: string): PrepPipeline | null {
  return pipelines.get(surveyHash) ?? null;
}

// Whether a survey has prep state on disk (drives auto-resume on book open).
export async function hasPrepState(surveyHash: string): Promise<boolean> {
  return (await loadPrepState(surveyHash)) !== null;
}
