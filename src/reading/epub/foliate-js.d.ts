// Types for the vendored foliate-js (vendor/foliate-js, aliased to `foliate-js`
// in vite.config.ts). Upstream ships plain JavaScript with no declarations, so
// these are hand-written and cover only what this repo calls. Widen them as more
// of the surface gets used; nothing here is generated.

declare module "foliate-js/epub.js" {
  export interface EpubSection {
    id: string;
    load(): Promise<string>;
    unload(): void;
    createDocument(): Promise<Document>;
    size: number;
    cfi: string;
    linear?: string;
    pageSpread?: string | null;
    resolveHref(href: string): string;
  }
  export class EPUB {
    constructor(loader: {
      loadText(href: string): Promise<string | null> | string | null;
      loadBlob(href: string): Promise<Blob | null> | Blob | null;
      getSize(href: string): number;
      sha1?: (data: ArrayBuffer | Uint8Array) => Promise<string> | string;
    });
    init(): Promise<this>;
    sections: EpubSection[];
    toc?: unknown[];
    pageList?: unknown[];
    metadata?: Record<string, unknown>;
    rendition?: { layout?: string };
    /// EventTarget dispatching a `data` CustomEvent for every resource before it
    /// becomes a blob URL: where sanitizing hooks in.
    transformTarget: EventTarget;
    resolveHref(href: string): { index: number; anchor: (doc: Document) => unknown } | null;
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => unknown };
    splitTOCHref(href: string): unknown;
    getTOCFragment(doc: Document, id: string): unknown;
    destroy(): void;
  }
}

declare module "foliate-js/view.js" {
  export class View extends HTMLElement {
    open(book: unknown): Promise<void>;
    close(): void;
    goTo(target: unknown): Promise<void>;
    goToFraction(fraction: number): Promise<void>;
    next(distance?: number): Promise<void>;
    prev(distance?: number): Promise<void>;
    renderer: HTMLElement & {
      getContents(): { doc: Document; index: number }[];
      next(): Promise<void>;
      prev(): Promise<void>;
    };
    book: unknown;
    lastLocation: unknown;
    isFixedLayout: boolean;
  }
}

declare module "foliate-js/epubcfi.js" {
  export function compare(a: string, b: string): number;
  export function collapse(cfi: string, toEnd?: boolean): string;
  export function fromRange(range: Range, filter?: unknown): string;
  export function toRange(doc: Document, cfi: string, filter?: unknown): Range;
  export function parse(cfi: string): unknown;
}

declare module "foliate-js/overlayer.js" {
  export class Overlayer {
    static highlight: unknown;
    static underline: unknown;
    element: Element;
    add(key: string, range: Range, draw: unknown, options?: unknown): void;
    remove(key: string): void;
    hitTest(event: Event): [string, Range] | [];
  }
}

declare module "foliate-js/search.js" {
  export function searchMatcher(walker: unknown, options: unknown): unknown;
}
