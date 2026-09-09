// The reading area for an EPUB, until the renderer lands (docs/39 stage 3).
// The book is fully read by then — full text, outline, [p.N], figures — so what
// is missing is the page, not the book, and the line says so.

export default function EpubPlaceholderPane({ className }: { className?: string }) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center p-8 ${className ?? ""}`}
      data-testid="epub-placeholder"
    >
      <p className="max-w-sm text-center text-sm leading-relaxed text-neutral-500">
        EPUB rendering is coming; the AI can already read this book.
      </p>
    </div>
  );
}
