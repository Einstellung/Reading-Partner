// Unit tests for the PubMed client (src/reading/prep/pubmed.ts): query URLs, the
// esearch id list, and the efetch XML reader. The fixture is trimmed from a real
// efetch response (2026-07-30) and keeps the shapes that bite: a structured
// abstract, inline markup in a title, a consortium byline, a free-text
// MedlineDate, and a reference list carrying other papers' PMIDs and DOIs. No
// network. Run: bun test.

import { expect, test } from "bun:test";
import {
  parsePubmedArticles,
  parsePubmedIds,
  pubmedFetchUrl,
  pubmedSearchUrl,
  pubmedUrl,
  searchPubmed,
} from "../../../src/reading/prep/pubmed";

test("esearch URL asks for relevance, not the sort schema E-utilities ignores", () => {
  const u = pubmedSearchUrl("cortical neuron scaling", { limit: 7 });
  expect(u).toContain("db=pubmed");
  expect(u).toContain("retmode=json");
  expect(u).toContain("retmax=7");
  expect(u).toContain("sort=relevance");
  expect(u).toContain("term=cortical%20neuron%20scaling");
  expect(u).toContain("tool=Reading-Partner");
  expect(u).not.toContain("sort=date");
});

test("a since year becomes a closed pdat range, because mindate needs a maxdate", () => {
  const u = pubmedSearchUrl("brain evolution", { sinceYear: 2025 });
  expect(u).toContain("datetype=pdat");
  expect(u).toContain("mindate=2025/01/01");
  expect(u).toContain("maxdate=2100/12/31");
});

test("parsePubmedIds keeps numeric ids and nothing else", () => {
  const body = { esearchresult: { count: "3", idlist: ["42428047", 42160515, "not-an-id"] } };
  expect(parsePubmedIds(body)).toEqual(["42428047", "42160515"]);
  expect(parsePubmedIds({})).toEqual([]);
  expect(parsePubmedIds(null)).toEqual([]);
});

test("pubmedFetchUrl batches the ids into one efetch", () => {
  const u = pubmedFetchUrl(["1", "2", "3"]);
  expect(u).toContain("efetch.fcgi");
  expect(u).toContain("id=1,2,3");
  expect(u).toContain("retmode=xml");
});

const EFETCH = `<?xml version="1.0" ?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation Status="MEDLINE" Owner="NLM"><PMID Version="1">42428047</PMID>
<Article PubModel="Print-Electronic"><Journal><ISSN IssnType="Print">1871-4080</ISSN>
<JournalIssue CitedMedium="Print"><Volume>20</Volume><PubDate><Year>2026</Year><Month>Dec</Month></PubDate></JournalIssue>
<Title>Human vaccines &amp; immunotherapeutics</Title><ISOAbbreviation>Hum Vaccin Immunother</ISOAbbreviation></Journal>
<ArticleTitle>Cortical neuron scaling in <i>Primates</i> and its metabolic cost.</ArticleTitle>
<ELocationID EIdType="pii" ValidYN="Y">127</ELocationID>
<ELocationID EIdType="doi" ValidYN="Y">10.1007/s11571-026-10496-2</ELocationID>
<Abstract><AbstractText Label="BACKGROUND">Brains scale unevenly.</AbstractText>
<AbstractText Label="RESULTS">Neuron counts rise faster than mass.</AbstractText></Abstract>
<AuthorList CompleteYN="Y">
<Author ValidYN="Y"><LastName>Herculano-Houzel</LastName><ForeName>Suzana</ForeName><Initials>S</Initials>
<AffiliationInfo><Affiliation>Vanderbilt University.</Affiliation></AffiliationInfo></Author>
<Author ValidYN="Y"><LastName>Zhang</LastName><ForeName>Ming</ForeName></Author>
<Author ValidYN="Y"><CollectiveName>The Brain Scaling Consortium</CollectiveName></Author>
</AuthorList></Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">42428047</ArticleId>
<ArticleId IdType="doi">10.1007/s11571-026-10496-2</ArticleId></ArticleIdList>
<ReferenceList><Reference><Citation>Someone else. An older paper.</Citation>
<ArticleIdList><ArticleId IdType="pubmed">11112222</ArticleId>
<ArticleId IdType="doi">10.9999/other</ArticleId></ArticleIdList></Reference></ReferenceList></PubmedData>
</PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">42160515</PMID>
<Article><Journal><JournalIssue><PubDate><MedlineDate>2025 Dec-2026 Jan</MedlineDate></PubDate></JournalIssue>
<Title>Journal of Comparative Neurology</Title></Journal>
<ArticleTitle>Encephalization without abstract.</ArticleTitle>
<AuthorList><Author><LastName>Roe</LastName><ForeName>John</ForeName></Author></AuthorList>
</Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="pubmed">42160515</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle>
<PubmedArticle><MedlineCitation><Article><ArticleTitle>No PMID, dropped.</ArticleTitle></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>`;

test("parsePubmedArticles reads the six fields a candidate needs", () => {
  const articles = parsePubmedArticles(EFETCH);
  // The third record has no PMID and is dropped.
  expect(articles).toHaveLength(2);

  const [first, second] = articles;
  expect(first.pmid).toBe("42428047");
  // Inline markup is stripped, entities decoded.
  expect(first.title).toBe("Cortical neuron scaling in Primates and its metabolic cost.");
  // A structured abstract keeps its section labels, in order.
  expect(first.abstract).toBe("BACKGROUND: Brains scale unevenly. RESULTS: Neuron counts rise faster than mass.");
  expect(first.authors).toEqual([
    "Suzana Herculano-Houzel",
    "Ming Zhang",
    "The Brain Scaling Consortium",
  ]);
  expect(first.year).toBe(2026);
  expect(first.journal).toBe("Human vaccines & immunotherapeutics");
  // The record's own DOI, not the one in its reference list.
  expect(first.doi).toBe("10.1007/s11571-026-10496-2");

  expect(second.pmid).toBe("42160515");
  // A free-text MedlineDate still yields a year.
  expect(second.year).toBe(2025);
  expect(second.abstract).toBe("");
  expect(second.doi).toBeNull();
  expect(second.journal).toBe("Journal of Comparative Neurology");
});

test("pubmedUrl points at the record a reader can open", () => {
  expect(pubmedUrl("42428047")).toBe("https://pubmed.ncbi.nlm.nih.gov/42428047/");
});

test("searchPubmed is esearch then efetch, and skips efetch on an empty id list", async () => {
  const urls: string[] = [];
  const articles = await searchPubmed("brain evolution", { limit: 2 }, async (url) => {
    urls.push(url);
    if (url.includes("esearch")) {
      return new Response(JSON.stringify({ esearchresult: { idlist: ["42428047"] } }), { status: 200 });
    }
    return new Response(EFETCH, { status: 200 });
  });
  expect(urls).toHaveLength(2);
  expect(urls[1]).toContain("id=42428047");
  expect(articles).toHaveLength(2);

  const empty: string[] = [];
  const none = await searchPubmed("nothing at all", {}, async (url) => {
    empty.push(url);
    return new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 });
  });
  expect(none).toEqual([]);
  expect(empty).toHaveLength(1);
});

test("a status PubMed cannot answer with throws instead of reading as no results", async () => {
  await expect(
    searchPubmed("x", {}, async () => new Response("nope", { status: 400 })),
  ).rejects.toThrow(/400/);
});
