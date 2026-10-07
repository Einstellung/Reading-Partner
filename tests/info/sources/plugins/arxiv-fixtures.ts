// What arXiv answers for a pasted paper link, as a test serves it: the export
// API's Atom entry for one id (the shape `id_list=` returns, namespaces and
// opensearch fields included) and the head of a PDF. Shared by the site
// adapter's own tests and the URL ingest's.

import type { FetchedBytes } from "../../../../src/workshop/bindery";

export const ATTENTION_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query?search_query%3D%26id_list%3D1706.03762%26start%3D0%26max_results%3D1" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=&amp;id_list=1706.03762&amp;start=0&amp;max_results=1</title>
  <id>http://arxiv.org/api/cHxbiOdZaP56ODnBPIenZhzg5f8</id>
  <updated>2026-10-07T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:41:18Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>  The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks in an encoder-decoder configuration. We propose a
new simple network architecture, the Transformer.
</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Niki Parmar</name></author>
    <author><name>Jakob Uszkoreit</name></author>
    <author><name>Llion Jones</name></author>
    <author><name>Aidan N. Gomez</name></author>
    <author><name>Lukasz Kaiser</name></author>
    <author><name>Illia Polosukhin</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">15 pages, 5 figures</arxiv:comment>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
`;

export const MALDACENA_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=hep-th/9711200&amp;start=0&amp;max_results=1</title>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9711200v3</id>
    <updated>1998-01-22T18:41:42Z</updated>
    <published>1997-11-27T22:22:59Z</published>
    <title>The Large N Limit of Superconformal Field Theories and Supergravity</title>
    <summary>  We show that the large N limit of certain conformal field theories in
various dimensions include in their Hilbert space a sector describing supergravity.
</summary>
    <author><name>Juan M. Maldacena</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>
`;

// What the export API answers for an id it does not know: an error entry,
// whose id is not a paper's.
export const ERROR_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_1706.03762</id>
    <title>Error</title>
    <summary>incorrect id format for 1706.03762</summary>
    <author><name>arXiv api core</name></author>
  </entry>
</feed>
`;

export const PDF_HEAD = new TextEncoder().encode("%PDF-1.5\n%ÐÔÅØ\n1 0 obj\n<<>>\nendobj\n");

export function served(body: Uint8Array | string, contentType: string): FetchedBytes {
  return {
    ok: true,
    status: 200,
    bytes: typeof body === "string" ? new TextEncoder().encode(body) : body,
    contentType,
  };
}

export const NOT_FOUND: FetchedBytes = {
  ok: false,
  status: 404,
  bytes: new Uint8Array(),
  contentType: null,
};

export const UNAVAILABLE: FetchedBytes = {
  ok: false,
  status: 503,
  bytes: new Uint8Array(),
  contentType: null,
};

export function apiUrl(id: string): string {
  return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
}

export function pdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}`;
}
