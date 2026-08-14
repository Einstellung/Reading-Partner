// Figure card for [fig:N] citations in AI replies (M9), rendered on its own
// line and centered. Shows the cropped figure image with its caption; clicking
// jumps the reader to the figure's page.
// The crop rasters lazily — only once the card scrolls into view — and the host
// memo-caches it, so a long reply that cites many figures doesn't raster them all
// at once. When the crop fails it degrades to a small text chip that still
// jumps; when the figure is not in the catalog at all there is nowhere to jump,
// so it is drawn as inert text rather than a control that does nothing.

import { useEffect, useRef, useState } from "react";
import type { FigureHost, RenderedCard } from "./Markdown";
import { cardDisplayWidth } from "../../../reading/figures/render";
import type { Figure } from "../../../reading/figures/types";

// "Fig. 3 · p.5" — the text chip label and the card's caption tag. Pure.
export function figureChipLabel(figure: Figure): string {
  return `Fig. ${figure.id} · p.${figure.page}`;
}

const CHIP =
  "!no-underline rounded bg-secondary px-1 py-0.5 !text-secondary-foreground text-[0.9em] can-hover:hover:bg-secondary-hover cursor-pointer";
// The figure isn't in the document's catalog, so there is nowhere to jump. It
// used to render as the chip above with no onClick: it looked like a control
// and did nothing when pressed. Drawn as inert text instead, with the reason on
// hover.
const CHIP_DEAD =
  "!no-underline rounded bg-black/[0.04] px-1 py-0.5 !text-neutral-400 text-[0.9em] cursor-default";

// A quiet clickable chip — the failed-render fallback, which still jumps.
function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={CHIP} onClick={onClick}>
      {label}
    </button>
  );
}

export default function FigureCard({ host, id }: { host: FigureHost; id: string }) {
  const figure = host.getFigure(id);
  const ref = useRef<HTMLButtonElement | null>(null);
  const [card, setCard] = useState<RenderedCard | null>(null);
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
    if (!figure || !visible || card || failed) return;
    let alive = true;
    host
      .renderCard(figure)
      .then((res) => {
        if (!alive) return;
        if (res) setCard(res);
        else setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [figure, visible, card, failed, host]);

  if (!figure)
    return (
      <span className={CHIP_DEAD} title={`No figure ${id} in this document.`}>
        fig:{id}
      </span>
    );
  if (failed) return <Chip label={figureChipLabel(figure)} onClick={() => host.onJump(figure)} />;

  // Display at the crop's natural size (÷ dpr) so a small figure is never
  // upscaled; max-w-full still shrinks a big crop to fit. The card is a block
  // box on its own line, centered in the reply.
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
  const displayWidth = card ? cardDisplayWidth(card.width, dpr) : undefined;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => host.onJump(figure)}
      className="mx-auto my-2 flex w-fit max-w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-black/10 bg-white p-1.5 text-left can-hover:hover:border-secondary-border"
    >
      {card ? (
        <img
          src={card.src}
          alt={figure.caption}
          className="rounded"
          style={{ width: displayWidth, maxWidth: "100%", height: "auto", maxHeight: 260, objectFit: "contain" }}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded bg-neutral-100 text-[0.8em] text-neutral-400"
          style={{ minHeight: 80, minWidth: 160 }}
        >
          Loading figure…
        </span>
      )}
      <span className="px-0.5 text-[0.8em] leading-snug text-neutral-500">
        <span className="font-medium text-secondary-foreground">Fig. {figure.id}</span> · p.{figure.page}
        {figure.caption ? ` — ${figure.caption}` : ""}
      </span>
    </button>
  );
}
