// Figures for the surfaces that have no reader under them: the retell's
// conversation, the rehearsal note, the coach. All three render the model's
// markdown, all three carry [fig:N] citations, and until now all three showed
// them as literal text — the only FigureContext provider in the app is the
// shell's, bound to the open book, and none of these has one open.
//
// Everything a picture needs is already on disk under the book's content hash,
// so this is a set of reads and a pdf.js crop, no engine and no document open
// (reading/figures/render.ts). It deliberately does not go through
// reading/retell's loadMaterials: that reads the full text, the marks and the
// chapter skeleton for every book in the retell, which is the AI's context and
// not a picture.
//
// A tap opens the figure larger where it stands rather than jumping. There is
// nowhere to jump to — that is the same fact that makes these surfaces provide a
// null CitationContext — and a rehearsal is the one moment when navigating away
// would cost the most: the reader is mid-talk and the note must still be where
// they left it. So the viewer is a dialog over the surface, and closing it
// changes nothing else.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { getFigures, renderFigure } from "../../../reading/figures";
import { loadRetell, readMaterialBytes } from "../../../reading/retell";
import { loadTalkOutline } from "../../../reading/talk";
import { FigureContext, type FigureHost } from "../markdown/Markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  figureScope,
  scopeFigure,
  type MaterialFigures,
  type ScopedFigure,
} from "./material-figures";

// Where the pictures come from: a retell by id, or a talk outline that names one
// (the coach is opened on an outline and never sees the retell id itself).
// Both absent — an outline arranged on its own — means no host, which is the
// surface as it was.
export default function MaterialFigureScope(props: {
  retellId?: string | null;
  outlineId?: string | null;
  children: ReactNode;
}) {
  const retellId = props.retellId ?? null;
  const outlineId = props.outlineId ?? null;
  const [materials, setMaterials] = useState<MaterialFigures[]>([]);
  const [viewing, setViewing] = useState<ScopedFigure | null>(null);

  // The book's bytes, once per book for as long as this scope is mounted. A
  // book is hundreds of megabytes and one note can hold half a dozen cards; the
  // promise rather than the buffer is cached so cards that mount in the same
  // frame share the one read instead of starting six.
  const bytes = useRef(new Map<string, Promise<ArrayBuffer | null>>());
  const readBytes = useCallback((bookId: string): Promise<ArrayBuffer | null> => {
    const cached = bytes.current.get(bookId);
    if (cached) return cached;
    const reading = readMaterialBytes(bookId);
    bytes.current.set(bookId, reading);
    return reading;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMaterials([]);
    setViewing(null);
    bytes.current = new Map();
    void (async () => {
      const id = retellId ?? (outlineId ? ((await loadTalkOutline(outlineId))?.retellId ?? null) : null);
      if (!id) return;
      const retell = await loadRetell(id);
      if (!retell) return;
      const read = await Promise.all(
        retell.materials.map(async (m) => ({
          bookId: m.bookId,
          figures: (await getFigures(m.bookId).catch(() => null))?.figures ?? [],
        })),
      );
      if (!cancelled) setMaterials(read);
    })().catch((e: unknown) => {
      console.warn("failed to read the figures of", retellId ?? outlineId, e);
    });
    return () => {
      cancelled = true;
    };
  }, [retellId, outlineId]);

  const scope = useMemo(() => figureScope(materials), [materials]);

  const host = useMemo<FigureHost | null>(() => {
    if (!scope) return null;
    return {
      getFigure: (id) => scopeFigure(scope, id)?.figure ?? null,
      renderCard: async (figure) => {
        const bookId = scope.bookOf.get(figure);
        if (!bookId) return null;
        const buf = await readBytes(bookId);
        if (!buf) return null;
        const r = await renderFigure(bookId, buf, figure, "card");
        return r ? { src: r.dataUrl, width: r.width, height: r.height } : null;
      },
      onJump: (figure) => {
        const bookId = scope.bookOf.get(figure);
        if (bookId) setViewing({ figure, bookId });
      },
    };
  }, [scope, readBytes]);

  return (
    <FigureContext.Provider value={host}>
      {props.children}
      {viewing && (
        <FigureViewer target={viewing} readBytes={readBytes} onClose={() => setViewing(null)} />
      )}
    </FigureContext.Provider>
  );
}

// The figure, larger. The "view" tier rather than the card's: the card is
// rendered at 2x the page and capped to its own resolution, so opening it would
// otherwise show the same pixels in a bigger box.
//
// The layer, the safe area and the layer registration all come from
// DialogContent (ui/overlay.tsx, docs/30) — this is a box floating over the
// surface, which is the shape that primitive already is.
function FigureViewer(props: {
  target: ScopedFigure;
  readBytes: (bookId: string) => Promise<ArrayBuffer | null>;
  onClose: () => void;
}) {
  const { target, readBytes } = props;
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    void (async () => {
      const buf = await readBytes(target.bookId);
      const r = buf ? await renderFigure(target.bookId, buf, target.figure, "view") : null;
      if (!alive) return;
      if (r) setSrc(r.dataUrl);
      else setFailed(true);
    })().catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [target, readBytes]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      {/* The width is the caller's and it is a `w-*`: max-width belongs to the
          safe-area utility alone (docs/30). */}
      <DialogContent className="w-[min(56rem,100%)]">
        <DialogHeader>
          <DialogTitle className="text-base leading-normal">
            Fig. {target.figure.id} · p.{target.figure.page}
          </DialogTitle>
          <DialogDescription>{target.figure.caption}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 items-center justify-center overflow-auto">
          {src ? (
            <img
              src={src}
              alt={target.figure.caption}
              className="max-h-[70vh] max-w-full rounded object-contain"
            />
          ) : (
            <p className="m-0 py-10 text-sm text-muted-foreground">
              {failed ? "This figure could not be rendered." : "Rendering the figure…"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
