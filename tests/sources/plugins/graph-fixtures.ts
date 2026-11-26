// Answers for the graph expansion's calls (docs/info/92), cut down by hand from
// the documented shapes and from what the APIs answered on 2026-10-22: S2's
// recommendations and OpenAlex's arXiv-DOI lookups were recorded live, S2's
// batch and edges are the documented shapes (the keyless pool answered 429).

// POST /graph/v1/paper/batch with ["ARXIV:1706.03762", "DOI:10.1038/s41586-021-03819-2", "ARXIV:9912.99999"]:
// one entry per id asked, null for the one S2 does not know.
export const S2_BATCH = [
  {
    paperId: "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
    externalIds: { ArXiv: "1706.03762", DBLP: "journals/corr/VaswaniSPUJGKP17", CorpusId: 13756489 },
    title: "Attention is All you Need",
    abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
    year: 2017,
    publicationDate: "2017-06-12",
    citationCount: 160000,
    authors: [{ authorId: "40348417", name: "Ashish Vaswani" }],
  },
  {
    paperId: "dc32a984b651256a8ec282be52310e6bd33d9815",
    externalIds: { DOI: "10.1038/s41586-021-03819-2", PubMed: "34265844", CorpusId: 235959867 },
    title: "Highly accurate protein structure prediction with AlphaFold",
    abstract: null,
    year: 2021,
    publicationDate: "2021-07-15",
    citationCount: 30000,
    authors: [{ authorId: "1", name: "John Jumper" }],
  },
  null,
];

// POST /recommendations/v1/papers/?limit=100&fields=title,publicationDate,externalIds,
// positivePaperIds ["DOI:10.1038/s41586-021-03819-2"]: a DOI positive is taken,
// and the papers are recent (2025-12 to 2026-10 that day), most with a DOI only.
export const S2_RECOMMENDATIONS = {
  recommendedPapers: [
    {
      paperId: "a1",
      externalIds: { ArXiv: "2609.01234", DOI: "10.48550/arXiv.2609.01234", CorpusId: 1 },
      title: "Protein structure prediction at scale",
      publicationDate: "2026-09-03",
    },
    {
      paperId: "a2",
      externalIds: { DOI: "10.1101/2026.09.10.123456", CorpusId: 2 },
      title: "A bioRxiv preprint on folding",
      publicationDate: "2026-09-10",
    },
    { paperId: "a3", externalIds: { CorpusId: 3 }, title: "", publicationDate: null },
  ],
};

export const S2_RECOMMENDATIONS_NOT_FOUND = { error: "Input papers not found" };

// GET /graph/v1/paper/ARXIV:1706.03762/citations: edges wrapped under citingPaper.
export const S2_CITATIONS = {
  offset: 0,
  next: 1000,
  data: [
    {
      citingPaper: {
        paperId: "c1",
        externalIds: { ArXiv: "2610.00001" },
        title: "A citing preprint",
        abstract: "It builds on attention.",
        year: 2026,
        publicationDate: "2026-10-01",
        citationCount: 0,
        authors: [{ name: "A. Author" }],
      },
    },
    {
      citingPaper: {
        paperId: "c2",
        externalIds: { DOI: "10.1016/j.x.2026.1" },
        title: "A citing journal paper",
        abstract: null,
        year: 2026,
        publicationDate: null,
        citationCount: 2,
        authors: [],
      },
    },
  ],
};

// 200 with the edges withheld (docs/pitfall/73).
export const S2_EDGES_ELIDED = { data: null, citingPaperInfo: { title: "Seed" } };

// GET /works?filter=doi:10.48550/arxiv.2501.12948|10.48550/arxiv.1706.03762: both
// found, neither under its arXiv DOI; the second is another paper altogether
// that OpenAlex merged the arXiv copy into (docs/pitfall/668).
export const OA_WORKS_BY_ARXIV = {
  meta: { count: 2, page: 1, per_page: 50 },
  results: [
    {
      id: "https://openalex.org/W2626778328",
      display_name: "Attention Is All You Need",
      doi: "https://doi.org/10.65215/2q58a426",
      publication_date: "2025-08-23",
      abstract_inverted_index: { The: [0], dominant: [1], models: [2] },
      locations: [
        { landing_page_url: "https://doi.org/10.65215/2q58a426" },
        { landing_page_url: "http://arxiv.org/abs/1706.03762", pdf_url: "https://arxiv.org/pdf/1706.03762v5" },
      ],
    },
    {
      id: "https://openalex.org/W4406779522",
      display_name: "Can Open Large Language Models Catch Vulnerabilities?",
      doi: "https://doi.org/10.4230/oasics.icpec.2025.4",
      publication_date: "2025-01-01",
      locations: [
        { landing_page_url: "https://doi.org/10.4230/oasics.icpec.2025.4" },
        { landing_page_url: "http://arxiv.org/abs/2501.12948" },
      ],
    },
  ],
};

// GET /works/doi:10.48550/arXiv.1706.03762?select=…,referenced_works,related_works
export const OA_WORK_WITH_EDGES = {
  id: "https://openalex.org/W2626778328",
  display_name: "Attention Is All You Need",
  doi: "https://doi.org/10.65215/2q58a426",
  publication_date: "2025-08-23",
  cited_by_count: 78168,
  referenced_works: ["https://openalex.org/W2064675550", "https://openalex.org/W2194775991"],
  related_works: ["https://openalex.org/W2965373594", "https://openalex.org/W2964308564", "not-an-id"],
  locations: [{ landing_page_url: "http://arxiv.org/abs/1706.03762" }],
};
