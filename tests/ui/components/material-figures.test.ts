// Pooling a retell's materials into one figure host: which id resolves to which
// book, and when there is no host at all.

import { expect, test } from "bun:test";

import {
  figureScope,
  scopeFigure,
  type MaterialFigures,
} from "../../../src/ui/components/common/material-figures";
import type { Figure } from "../../../src/reading/figures";

function fig(id: string, page: number): Figure {
  return { id, page, caption: `Figure ${id}`, bbox: null };
}

test("no material has a figure: no host", () => {
  expect(figureScope([])).toBeNull();
  expect(figureScope([{ bookId: "a", figures: [] }])).toBeNull();
  expect(figureScope([{ bookId: "a", figures: [] }, { bookId: "b", figures: [] }])).toBeNull();
});

test("one material with figures is enough for a host", () => {
  const scope = figureScope([
    { bookId: "a", figures: [] },
    { bookId: "b", figures: [fig("3", 5)] },
  ]);
  expect(scope).not.toBeNull();
  expect(scope?.figures.length).toBe(1);
});

const TWO_BOOKS: MaterialFigures[] = [
  { bookId: "book-a", figures: [fig("1", 2), fig("3-1", 9)] },
  { bookId: "book-b", figures: [fig("2", 4), fig("7", 30)] },
];

test("an id resolves against the book it came from, whichever material holds it", () => {
  const scope = figureScope(TWO_BOOKS);
  expect(scopeFigure(scope, "1")).toEqual({ figure: TWO_BOOKS[0].figures[0], bookId: "book-a" });
  expect(scopeFigure(scope, "7")).toEqual({ figure: TWO_BOOKS[1].figures[1], bookId: "book-b" });
});

test("separators fold the way the reader folds them", () => {
  const scope = figureScope(TWO_BOOKS);
  // The book prints "3-1"; a citation that picked the dot still lands.
  expect(scopeFigure(scope, "3.1")?.figure.id).toBe("3-1");
  expect(scopeFigure(scope, "Figure 3-1")?.figure.id).toBe("3-1");
});

test("an id no material has resolves to nothing", () => {
  expect(scopeFigure(figureScope(TWO_BOOKS), "99")).toBeNull();
  expect(scopeFigure(null, "1")).toBeNull();
});

test("two books printing the same figure number: the first material wins", () => {
  const clash: MaterialFigures[] = [
    { bookId: "book-a", figures: [fig("3", 11)] },
    { bookId: "book-b", figures: [fig("3", 88)] },
  ];
  const resolved = scopeFigure(figureScope(clash), "3");
  expect(resolved?.bookId).toBe("book-a");
  expect(resolved?.figure.page).toBe(11);
});
