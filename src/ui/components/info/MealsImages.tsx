// Pictures on the meals screen (docs/73 图片), and what is drawn when there is
// none.
//
// The reader cannot tell one vegetable from another, so a line without a
// photograph still has to say what kind of thing it is. Six glyphs, one per
// aisle, drawn inline: no icon library is installed, and six shapes are not
// worth one. They are deliberately crude — a glyph says "this is produce", a
// photograph says which vegetable, and nothing in between is any use.
//
// Rendering only; which URL an image resolves to is in info/meals/images.ts.

import { useState } from "react";

import { imageSrc } from "../../../info/meals/images";
import type { IngredientCategory } from "../../../info/meals/types";
import { hideBrokenImage } from "../markdown/proseCss";

function Glyph({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// One shape per aisle: a leaf, a cut of meat, a bottle, a snowflake, an ear of
// grain, a jar, and a bag for whatever is left.
const GLYPHS: Record<IngredientCategory, (p: { size?: number }) => JSX.Element> = {
  produce: ({ size }) => (
    <Glyph size={size}>
      <path d="M19 5c0 7-4 11-10 11-2 0-3-1-3-3 0-6 5-9 13-8Z" />
      <path d="M6 19c3-4 6-6 10-7" />
    </Glyph>
  ),
  protein: ({ size }) => (
    <Glyph size={size}>
      <path d="M5 13c0-4 3-7 7-7s7 2 7 6-3 6-7 6H8a3 3 0 0 1-3-3Z" />
      <path d="M11 10c1.5 0 2.5 1 2.5 2.5S12.5 15 11 15" />
    </Glyph>
  ),
  dairy: ({ size }) => (
    <Glyph size={size}>
      <path d="M9 3h6v3l2 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10l2-4Z" />
      <path d="M7 12h10" />
    </Glyph>
  ),
  frozen: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9" />
    </Glyph>
  ),
  grains: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 21V9" />
      <path d="M12 9c0-3 2-5 5-6 0 3-2 5-5 6Z" />
      <path d="M12 13c0-3-2-5-5-6 0 3 2 5 5 6Z" />
    </Glyph>
  ),
  pantry: ({ size }) => (
    <Glyph size={size}>
      <path d="M8 3h8v3H8z" />
      <path d="M7 6h10v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1Z" />
      <path d="M7 12h10" />
    </Glyph>
  ),
  other: ({ size }) => (
    <Glyph size={size}>
      <path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Glyph>
  ),
};

/** The aisle's glyph, for a line or a thumbnail with no photograph. */
export function CategoryGlyph({ category, size }: { category: IngredientCategory; size?: number }) {
  const G = GLYPHS[category];
  return <G size={size} />;
}

/**
 * One ingredient's 40px square: its photograph when a source has one, the
 * aisle's glyph when it does not. Never a broken-image icon — a picture that
 * 404s, or that cannot be reached at all, lands on the glyph like a missing
 * one.
 *
 * A failed load has no CSS to hit (docs/pitfall/30), so the square listens for
 * the error in the capture phase — `error` does not bubble but it does capture
 * — and remembers which src failed. Remembering the src rather than a flag is
 * what lets a re-render with a different photograph try again.
 */
export function IngredientThumb({
  url,
  pageUrl,
  category,
  alt,
  size = 40,
}: {
  url: string | null;
  // The page the picture sits on, sent as Referer by the proxy. Only a picture
  // the image search found has one (docs/pitfall/30).
  pageUrl?: string | null;
  category: IngredientCategory;
  alt: string;
  // 40px on the list itself, 28px in the preview on the meals page. Two sizes,
  // spelled out rather than computed, so the classes survive Tailwind's scan.
  size?: 28 | 40;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = imageSrc(url, pageUrl);
  const usable = src && src !== failed ? src : null;
  const box = size === 28 ? "size-7 rounded-[5px]" : "size-10 rounded-md";
  return (
    <span
      className={`flex ${box} flex-none items-center justify-center overflow-hidden bg-muted-soft text-faint-foreground`}
      onErrorCapture={() => setFailed(src)}
    >
      {usable ? (
        <img src={usable} alt={alt} className="size-full object-cover" loading="lazy" />
      ) : (
        <CategoryGlyph category={category} size={size === 28 ? 16 : 20} />
      )}
    </span>
  );
}

/**
 * The picture for a night: the dish's own photograph, or a strip of up to three
 * of its ingredients', or a neutral block. The block is a block and not an
 * apology — a night with nothing to show still has to hold its place in the
 * layout.
 */
export function DishImage({
  image,
  imagePageUrl,
  thumbnails,
  alt,
  className,
  onPhotoFailed,
}: {
  image?: string;
  // The page the dish's photograph sits on, sent as Referer by the proxy. Only
  // a web image search result has one (docs/pitfall/30).
  imagePageUrl?: string | null;
  thumbnails: string[];
  alt: string;
  className?: string;
  // Told when the dish's own photograph fails to load, so a caller drawing its
  // credit line can take the line down with the picture.
  onPhotoFailed?: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const wanted = imageSrc(image, imagePageUrl);
  const src = wanted && wanted !== failed ? wanted : null;
  const box = `block overflow-hidden rounded-lg border border-border-subtle bg-muted-soft ${className ?? ""}`;
  // The dish's own photograph failing falls back to the strip, not to a gap.
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${box} size-full object-cover`}
        loading="lazy"
        onError={() => {
          setFailed(wanted);
          onPhotoFailed?.();
        }}
      />
    );
  }
  if (thumbnails.length) {
    return (
      <span className={`${box} flex`} onErrorCapture={(e) => hideBrokenImage(e.target)}>
        {thumbnails.map((url, i) => (
          <img
            key={i}
            src={imageSrc(url) ?? undefined}
            alt=""
            className="min-w-0 flex-1 object-cover"
            loading="lazy"
          />
        ))}
      </span>
    );
  }
  return <span className={box} aria-hidden="true" />;
}
