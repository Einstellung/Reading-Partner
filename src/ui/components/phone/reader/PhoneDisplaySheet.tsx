// The Aa sheet (docs/70): the type the column is set in and the paper it sits
// on, off the bottom edge like the outline is.
//
// Same shell as PhoneOutlineSheet — a Radix dialog through ui/dialog.tsx, so
// the layer, the safe area and the layer registration all come from one place
// (docs/30). It carries the paper as an attribute of its own because it is
// portalled to <body>: the reading screen's dark tokens are scoped to that
// attribute and do not reach out of the tree they are set on.
//
// Every control applies on the press. There is no Done: the book is behind the
// sheet, the change is visible in it, and a setting the reader has to confirm
// is a setting they cannot see while choosing.

import type { ReactNode } from "react";
import {
  FLOW_FONT_STEPS,
  FLOW_LINE_STEPS,
  FLOW_PAD_STEPS,
  FLOW_PAPERS,
  FLOW_PAPER_NAMES,
  flowFontStep,
  flowPaperSwatch,
  stepFlowFont,
  type FlowDisplay,
} from "../../../../reading/epub/flow/flow-display";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "../../ui/dialog";
import { Switch } from "../../ui/switch";

export default function PhoneDisplaySheet(props: {
  open: boolean;
  display: FlowDisplay;
  onOpenChange: (open: boolean) => void;
  onChange: (display: FlowDisplay) => void;
}) {
  const { display, onChange } = props;
  const step = flowFontStep(display);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent data-reader-paper={display.paper}>
        <DialogTitle className="border-b border-border-subtle px-4 py-3 text-[15px]">
          Display
        </DialogTitle>
        <div className="flex flex-col gap-4 p-4 pb-safe-4">
          <Row label="Size">
            <Button
              variant="outline"
              size="icon"
              aria-label="Smaller text"
              disabled={step === 0}
              onClick={() => onChange(stepFlowFont(display, -1))}
            >
              <span className="text-[14px]">A</span>
            </Button>
            <span className="min-w-12 text-center text-[13px] [font-variant-numeric:tabular-nums] text-muted-foreground">
              {display.fontPx}px
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Larger text"
              disabled={step === FLOW_FONT_STEPS.length - 1}
              onClick={() => onChange(stepFlowFont(display, 1))}
            >
              <span className="text-[19px]">A</span>
            </Button>
          </Row>

          <Row label="Line spacing">
            {FLOW_LINE_STEPS.map((s) => (
              <Choice
                key={s.value}
                label={s.label}
                selected={display.lineHeight === s.value}
                onClick={() => onChange({ ...display, lineHeight: s.value })}
              />
            ))}
          </Row>

          <Row label="Margins">
            {FLOW_PAD_STEPS.map((s) => (
              <Choice
                key={s.value}
                label={s.label}
                selected={display.padX === s.value}
                onClick={() => onChange({ ...display, padX: s.value })}
              />
            ))}
          </Row>

          <Row label="Turn pages">
            <Switch
              aria-label="Turn pages"
              checked={display.mode === "paged"}
              onCheckedChange={(on) => onChange({ ...display, mode: on ? "paged" : "scroll" })}
            />
          </Row>

          <Row label="Paper">
            {FLOW_PAPER_NAMES.map((name) => {
              const paper = FLOW_PAPERS[name];
              return (
                <Button
                  key={name}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "rounded-full border border-black/20",
                    display.paper === name && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: flowPaperSwatch(paper) }}
                  title={paper.label}
                  aria-label={paper.label}
                  aria-pressed={display.paper === name}
                  onClick={() => onChange({ ...display, paper: name })}
                />
              );
            })}
          </Row>
        </div>
      </DialogSheetContent>
    </Dialog>
  );
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex-none text-[14px] text-muted-foreground">{props.label}</span>
      <div className="flex items-center gap-2">{props.children}</div>
    </div>
  );
}

function Choice(props: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        props.selected && "bg-secondary text-secondary-foreground can-hover:hover:bg-secondary",
      )}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}
