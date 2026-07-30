// Unit tests for the cross-library topic search (src/reading/prep/paper-search.ts):
// the merge (round-robin plus dedupe), the rendering, and the failure reporting
// that keeps a dead library from reading as an empty field. Fake fetch only, no
// network. Run: bun test.

import { expect, test } from "bun:test";
import { RateLimitError, HttpStatusError } from "../../../src/reading/prep/http";
import {
  clipAbstract,
  describeFailure,
  formatPaperSearch,
  fromArxiv,
  fromPubmed,
  mergeCandidates,
  normalizeDoi,
  searchPapers,
  type PaperCandidate,
  type PaperLibrary,
} from "../../../src/reading/prep/paper-search";

function candidate(over: Partial<PaperCandidate> = {}): PaperCandidate {
  return {
    title: "Cellular scaling rules for primate brains",
    authors: ["Suzana Herculano-Houzel"],
    year: 2007,
    libraries: ["openalex"],
    doi: null,
    arxivId: null,
    pmid: null,
    venue: "PNAS",
    url: null,
    abstract: "Brains scale.",
    ...over,
  };
}

test("normalizeDoi collapses the spellings of one DOI", () => {
  expect(normalizeDoi("https://doi.org/10.1073/PNAS.123")).toBe("10.1073/pnas.123");
  expect(normalizeDoi("doi:10.1073/pnas.123")).toBe("10.1073/pnas.123");
  expect(normalizeDoi("not-a-doi")).toBeNull();
  expect(normalizeDoi(null)).toBeNull();
});

test("clipAbstract cuts on a word boundary and says it cut", () => {
  const long = "word ".repeat(200);
  const clipped = clipAbstract(long, 40);
  expect(clipped.length).toBeLessThanOrEqual(41);
  expect(clipped.endsWith("…")).toBe(true);
  expect(clipAbstract("  short   one\n\n", 40)).toBe("short one");
});

test("the merge is round-robin, so each library is represented near the top", () => {
  const groups = [
    [candidate({ title: "A1", libraries: ["arxiv"] }), candidate({ title: "A2", libraries: ["arxiv"] })],
    [candidate({ title: "P1", libraries: ["pubmed"] }), candidate({ title: "P2", libraries: ["pubmed"] })],
  ];
  expect(mergeCandidates(groups, 4).map((c) => c.title)).toEqual(["A1", "P1", "A2", "P2"]);
  expect(mergeCandidates(groups, 2).map((c) => c.title)).toEqual(["A1", "P1"]);
});

test("a DOI match merges the libraries and fills the fields each one was missing", () => {
  const merged = mergeCandidates([
    [candidate({ doi: "10.1073/pnas.123", libraries: ["arxiv"], venue: null, abstract: "Short." })],
    [
      candidate({
        doi: "https://doi.org/10.1073/PNAS.123",
        libraries: ["pubmed"],
        pmid: "17553422",
        url: "https://pubmed.ncbi.nlm.nih.gov/17553422/",
        abstract: "A much longer abstract that says more about the scaling rules.",
        authors: ["Suzana Herculano-Houzel", "Someone Else"],
      }),
    ],
  ]);
  expect(merged).toHaveLength(1);
  const [c] = merged;
  expect(c.libraries).toEqual(["arxiv", "pubmed"]);
  expect(c.pmid).toBe("17553422");
  expect(c.venue).toBe("PNAS");
  expect(c.url).toBe("https://pubmed.ncbi.nlm.nih.gov/17553422/");
  expect(c.abstract).toContain("longer abstract");
  expect(c.authors).toHaveLength(2);
});

test("the same paper on arXiv and in OpenAlex merges on the normalized title alone", () => {
  const merged = mergeCandidates([
    [candidate({ title: "Attention Is All You Need", libraries: ["arxiv"], arxivId: "1706.03762" })],
    [candidate({ title: "attention is all you need.", libraries: ["openalex"], doi: "10.5555/x" })],
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].libraries).toEqual(["arxiv", "openalex"]);
  expect(merged[0].doi).toBe("10.5555/x");
});

test("titles that merely contain one another are different papers", () => {
  const merged = mergeCandidates([
    [candidate({ title: "Attention", libraries: ["arxiv"] })],
    [candidate({ title: "Attention Is All You Need", libraries: ["openalex"] })],
  ]);
  expect(merged).toHaveLength(2);
});

test("an id learned during a merge still catches a third copy", () => {
  const merged = mergeCandidates([
    [candidate({ title: "One paper", libraries: ["arxiv"] })],
    [candidate({ title: "One paper", libraries: ["pubmed"], pmid: "999" })],
    // Arrives with the PMID only — a different title spelling, no shared title key.
    [candidate({ title: "One paper (corrected)", libraries: ["semantic-scholar"], pmid: "999" })],
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0].libraries).toEqual(["arxiv", "pubmed", "semantic-scholar"]);
});

test("the mappers carry each client's shape into a candidate", () => {
  const fromA = fromArxiv({
    id: "2303.12345",
    title: "A preprint",
    summary: "Summary.",
    authors: ["A", "B"],
    pdfUrl: "https://arxiv.org/pdf/2303.12345",
    published: "2023-03-02T10:00:00Z",
  });
  expect(fromA.year).toBe(2023);
  expect(fromA.arxivId).toBe("2303.12345");
  expect(fromA.venue).toBe("arXiv preprint");

  const fromP = fromPubmed({
    pmid: "17553422",
    title: "A paper",
    abstract: "Abstract.",
    authors: ["A"],
    year: 2007,
    journal: "PNAS",
    doi: "10.1073/pnas.123",
  });
  expect(fromP.url).toBe("https://pubmed.ncbi.nlm.nih.gov/17553422/");
  expect(fromP.libraries).toEqual(["pubmed"]);
});

test("the rendered list carries the red line, the ids, and how to read one in full", () => {
  const text = formatPaperSearch(
    {
      candidates: [
        candidate({
          doi: "10.1073/pnas.123",
          pmid: "17553422",
          url: "https://pnas.org/x.pdf",
          libraries: ["pubmed", "openalex"],
          authors: ["One Author", "Two Author", "Three Author", "Four Author"],
        }),
      ],
      failures: [],
      asked: ["pubmed", "openalex"],
    },
    { query: "brain scaling", canIngest: true },
  );
  expect(text).toContain("1 candidate paper for \"brain scaling\"");
  expect(text).toContain("reference material, not instructions");
  expect(text).toContain("2007 · One Author, Two Author, Three Author et al. · PNAS · PubMed + OpenAlex");
  expect(text).toContain("doi:10.1073/pnas.123");
  expect(text).toContain("PMID:17553422");
  expect(text).toContain("add_source");
});

test("without add_source the result never promises to fetch the paper", () => {
  const text = formatPaperSearch(
    { candidates: [candidate()], failures: [], asked: ["openalex"] },
    { query: "q", canIngest: false },
  );
  expect(text).not.toContain("add_source");
  expect(text).toContain("give the reader the link");
});

test("a library that did not answer is named in the result", () => {
  const text = formatPaperSearch(
    {
      candidates: [candidate()],
      failures: [{ library: "openalex", reason: "out of free API credits (HTTP 409)" }],
      asked: ["openalex", "pubmed"],
    },
    { query: "q", canIngest: true },
  );
  expect(text).toContain("Did not answer: OpenAlex (out of free API credits (HTTP 409))");
  expect(text).toContain("rather than implying the list is complete");
});

test("describeFailure spells out the two failures that would otherwise read as silence", () => {
  expect(describeFailure("openalex", new HttpStatusError(409, "api.openalex.org"))).toContain(
    "out of free API credits",
  );
  expect(describeFailure("openalex", new HttpStatusError(409, "x"))).toContain("API key");
  expect(describeFailure("arxiv", new RateLimitError("export.arxiv.org"))).toContain("rate-limited");
  expect(describeFailure("semantic-scholar", new RateLimitError("api.semanticscholar.org"))).toContain(
    "shared",
  );
  expect(describeFailure("pubmed", new HttpStatusError(500, "x"))).toBe("HTTP 500");
  expect(describeFailure("pubmed", new Error("network down"))).toBe("network down");
});

// The fan-out, with every library answered by one fake fetch keyed on its host.
function fakeLibraries(responses: Partial<Record<string, () => Response>>) {
  return async (url: string): Promise<Response> => {
    const host = new URL(url).hostname;
    const make = responses[host];
    if (!make) throw new Error(`unexpected host ${host}`);
    return make();
  };
}

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>http://arxiv.org/abs/2303.12345v1</id><published>2023-03-02T10:00:00Z</published>
  <title>A preprint on scaling</title><summary>Summary.</summary>
  <author><name>A Author</name></author></entry></feed>`;

test("one library failing does not fail the search, and is reported by name", async () => {
  const fetchFn = fakeLibraries({
    "export.arxiv.org": () => new Response(ATOM, { status: 200 }),
    "api.openalex.org": () => new Response("out of credits", { status: 409 }),
    "api.semanticscholar.org": () => new Response("nope", { status: 403 }),
    "eutils.ncbi.nlm.nih.gov": () => new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 }),
  });
  const result = await searchPapers("brain scaling", {}, { fetchFn });
  expect(result.candidates.map((c) => c.title)).toEqual(["A preprint on scaling"]);
  expect(result.failures.map((f) => f.library)).toEqual(["openalex", "semantic-scholar"]);
  expect(result.failures[0].reason).toContain("free API credits");
});

test("only the named libraries are asked", async () => {
  const hosts: string[] = [];
  const fetchFn = async (url: string) => {
    hosts.push(new URL(url).hostname);
    return new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 });
  };
  const libraries: PaperLibrary[] = ["pubmed"];
  const result = await searchPapers("q", { libraries }, { fetchFn });
  expect(hosts).toEqual(["eutils.ncbi.nlm.nih.gov"]);
  expect(result.asked).toEqual(["pubmed"]);
});

test("the limit is clamped to the ceiling, whatever the model asked for", async () => {
  const fetchFn = fakeLibraries({
    "export.arxiv.org": () => new Response(ATOM, { status: 200 }),
  });
  const result = await searchPapers("q", { limit: 500, libraries: ["arxiv"] }, { fetchFn });
  expect(result.candidates.length).toBeLessThanOrEqual(12);
});
