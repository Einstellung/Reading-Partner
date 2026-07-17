// Inline figure card for [fig:N] citations in AI replies (M9). Shows the cropped
// figure image with its caption; clicking jumps the reader to the figure's page.
// The crop rasters lazily — only once the card scrolls into view — and the host
// memo-caches it, so a long reply that cites many figures doesn't raster them all
// at once. When the figure is unknown or the crop fails, it degrades to a small
// text chip that still jumps.

import { useEffect, useRef, useState } from "react";
import type { FigureHost } from "./Markdown";
import type { Figure } from "../figures/types";

// "Fig. 3 · p.5" — the text chip label and the card's caption tag. Pure.
export function figureChipLabel(figure: Figure): string {
  return `Fig. ${figure.id} · p.${figure.page}`;
}

const CHIP =
  "!no-underline rounded bg-[#efecfb] px-1 py-0.5 !text-[#4a3a9e] text-[0.9em] hover:bg-[#e2dcf6] cursor-pointer";

// A quiet clickable chip — the unknown-figure / failed-render fallback.
function Chip({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" className={CHIP} onClick={onClick}>
      {label}
    </button>
  );
}

export default function FigureCard({ host, id }: { host: FigureHost; id: string }) {
  const figure = host.getFigure(id);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Reveal when scrolled into view; render immediately if IntersectionObserver
  // is unavailable.
  useEffect(() => {
    if (!figure) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [figure]);

  useEffect(() => {
    if (!figure || !visible || src || failed) return;
    let alive = true;
    host
      .renderCard(figure)
      .then((url) => {
        if (!alive) return;
        if (url) setSrc(url);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [figure, visible, src, failed, host]);

  if (!figure) return <Chip label={`fig:${id}`} />;
  if (failed) return <Chip label={figureChipLabel(figure)} onClick={() => host.onJump(figure)} />;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => host.onJump(figure)}
      className="my-1 inline-flex max-w-full cursor-pointer flex-col items-stretch gap-1 rounded-lg border border-black/10 bg-white p-1.5 text-left align-top hover:border-[#c9bff0]"
    >
      {src ? (
        <img src={src} alt={figure.caption} className="max-w-full rounded" style={{ maxHeight: 260 }} />
      ) : (
        <span
          className="flex items-center justify-center rounded bg-neutral-100 text-[0.8em] text-neutral-400"
          style={{ minHeight: 80, minWidth: 160 }}
        >
          Loading figure…
        </span>
      )}
      <span className="px-0.5 text-[0.8em] leading-snug text-neutral-500">
        <span className="font-medium text-[#4a3a9e]">Fig. {figure.id}</span> · p.{figure.page}
        {figure.caption ? ` — ${figure.caption}` : ""}
      </span>
    </button>
  );
}
