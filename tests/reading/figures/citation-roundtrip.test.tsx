// Every id the figure index can mint has to survive the whole trip: listed to
// the model in the visual-aid block, written back as [fig:<id>], read by the
// citation grammar, and drawn as a card. An EPUB picture with no printed number
// gets an issued id ("c2-1"); the grammar once only knew printed numbers, so a
// citation copied straight out of the list came back as plain text.

import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildEpub, PNG, prose } from "../epub/fixture";
import { parseEpub } from "../../../src/reading/epub/parse";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { epubFigures } from "../../../src/reading/figures/epub";
import { findFigureById } from "../../../src/reading/figures/lookup";
import { buildVisualAidGuidance } from "../../../src/reading/figures/prompt";
import { figureCitationHref, parseAnchor, parseCitationHref } from "../../../src/reading/prep/anchors";
import MarkdownRenderer from "../../../src/ui/components/markdown/MarkdownRenderer";
import { FigureContext, type FigureHost } from "../../../src/ui/components/markdown/Markdown";
import type { Figure } from "../../../src/reading/figures/types";

async function bookFigures(): Promise<Figure[]> {
  const book = parseEpub(
    buildEpub({
      docs: [
        {
          name: "c1.xhtml",
          body:
            `<h1>First</h1>${prose(2)}` +
            `<figure><img src="images/a.png"/><figcaption>Figure 3-1: the loop</figcaption></figure>`,
        },
        {
          name: "c2.xhtml",
          body:
            `<h1>Second</h1>${prose(2)}` +
            `<p><img src="images/a.png" alt="An unnumbered sketch"/></p>` +
            `<figure><img src="images/a.png"/><figcaption>A map with no number</figcaption></figure>`,
        },
      ],
      images: { "OEBPS/images/a.png": PNG },
    }),
  );
  return epubFigures(book, await paginate(book, characterRuler(700))).figures;
}

test("the index mints both kinds of id", async () => {
  const ids = (await bookFigures()).map((f) => f.id);
  expect(ids).toEqual(["3-1", "c2-1", "c2-2"]);
});

test("every id listed to the model parses back as a figure citation", async () => {
  const figures = await bookFigures();
  const block = buildVisualAidGuidance({ figures });
  // The list's own lines, each the tag the model is to copy.
  const cited = [...block.matchAll(/^- \[(fig:[^\]]+)\]/gm)].map((m) => m[1]);
  expect(cited).toEqual(figures.map((f) => `fig:${f.id}`));
  for (const inner of cited) {
    const anchor = parseAnchor(inner);
    expect(anchor?.kind).toBe("figure");
    const id = anchor?.kind === "figure" ? anchor.id : "";
    expect(findFigureById(figures, id)).not.toBeNull();
    expect(parseCitationHref(figureCitationHref(id))).toEqual({ kind: "figure", id });
  }
});

test("a citation of an issued id is read case-insensitively", () => {
  expect(parseAnchor("fig: C2-1")).toEqual({ kind: "figure", id: "c2-1", label: "fig:c2-1" });
});

test("prose that only looks like an issued id is not a citation", () => {
  for (const inner of ["fig:c", "fig:c2", "fig:c2-", "fig:cx-1", "fig:c2-1-3"]) {
    expect(parseAnchor(inner)).toBeNull();
  }
});

test("every listed figure is drawn as a card in a reply", async () => {
  const figures = await bookFigures();
  const host: FigureHost = {
    getFigure: (id) => findFigureById(figures, id),
    renderCard: async () => null,
    onJump: () => {},
  };
  for (const f of figures) {
    const html = renderToStaticMarkup(
      createElement(
        FigureContext.Provider,
        { value: host },
        createElement(MarkdownRenderer, { text: `see [fig:${f.id}] here` }),
      ),
    );
    expect(html).toContain(`Fig. ${f.id}`);
    expect(html).toContain("<button");
    expect(html).not.toContain(`[fig:${f.id}]`);
  }
});
