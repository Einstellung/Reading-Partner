// The chat card a drawn diagram renders as.
//
// Everything shaped like a decision happens before this file: the layout is
// computed in reading/diagrams/layout.ts and the element tree in svg.ts. What is
// left here is the shell around the picture (title, source line, caption), the
// stepper for a staged diagram, and the horizontal scroll a wide diagram needs.
//
// Why the picture scrolls instead of scaling to fit: a "right"-flowing diagram
// with six steps is a thousand pixels wide, and scaling that into a chat column
// puts 12.5px labels at 7px, which is not a diagram any more. Scrolling keeps the
// text at the size it was laid out for. The prompt steers the model to "down" for
// exactly this reason, so the scroll is the fallback, not the normal case.

import { useMemo, useState } from "react";

import { layoutDiagram } from "../../../reading/diagrams/layout";
import { sceneToSvg } from "../../../reading/diagrams/svg";
import type { DiagramCard, DiagramCardData } from "../../../reading/diagrams/cards";
import type { CardComponentProps, CardRegistryFor } from "../chat/chatParts";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import { SvgFigure } from "./SvgFigure";

export function DiagramChatCard({ payload, dispatch }: CardComponentProps<DiagramCardData>) {
  const stages = payload.diagram.stages ?? [];
  // Seeded from the payload so a reopened thread comes back to the step the
  // reader had reached, and held locally so stepping is instant; the dispatch
  // below is what makes it durable.
  const [stage, setStage] = useState(() =>
    Math.min(Math.max(payload.stage ?? 0, 0), Math.max(stages.length - 1, 0)),
  );

  const { node, scene, caption } = useMemo(() => {
    const laid = layoutDiagram(payload.diagram, { stage });
    const label = [payload.diagram.title, payload.diagram.caption].filter(Boolean).join(" — ");
    return {
      scene: laid,
      node: sceneToSvg(laid, { title: label || "Diagram" }),
      caption: stages[stage]?.caption ?? payload.diagram.focus?.label ?? payload.diagram.caption ?? "",
    };
  }, [payload.diagram, stage, stages]);

  const source = payload.diagram.source;
  const sourceLine = source?.figure
    ? `Redrawn from Figure ${source.figure}${source.page ? `, p.${source.page}` : ""}`
    : source?.page
      ? `From p.${source.page}`
      : "";

  const step = (next: number) => {
    setStage(next);
    dispatch({ kind: "local", patch: { stage: next } });
  };

  if (scene.width === 0) return null;

  return (
    <div className="w-full max-w-2xl rounded-xl border border-black/10 bg-white p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {payload.diagram.title && (
        <div className="mb-2 text-[13px] font-medium text-[#1b1b1b]">{payload.diagram.title}</div>
      )}

      <div className="-mx-1 overflow-x-auto px-1">
        <SvgFigure node={node} />
      </div>

      {stages.length > 1 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {stages.map((s, i) => (
            <Button
              key={i}
              type="button"
              variant={i === stage ? "secondary" : "subtle"}
              size="chip"
              className={cn("px-2.5 py-1 text-[12px]", i === stage && "font-medium")}
              aria-current={i === stage ? "step" : undefined}
              onClick={() => step(i)}
            >
              {`${i + 1}. ${s.title}`}
            </Button>
          ))}
        </div>
      )}

      {caption && <div className="mt-2 text-[12px] leading-snug text-[#666]">{caption}</div>}
      {sourceLine && <div className="mt-1.5 text-[11px] text-[#999]">{sourceLine}</div>}
    </div>
  );
}

export const DIAGRAM_CARD_REGISTRY: CardRegistryFor<DiagramCard["kind"]> = {
  diagram: DiagramChatCard,
};
