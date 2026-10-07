// The Aa sheet (docs/70, docs/82): the type the column is set in and the paper
// it sits on, off the bottom edge like the outline is. Kept as short as it can
// be, so the page it changes stays in view above it.
//
// Same shell as PhoneContentsSheet — a Radix dialog through ui/dialog.tsx, so
// the layer, the safe area and the layer registration all come from one place
// (docs/30). It carries the paper as an attribute of its own because it is
// portalled to <body>: the reading screen's dark tokens are scoped to that
// attribute and do not reach out of the tree they are set on.
//
// Two text tabs and no title bar. Layout is scrolling or turning pages
// (docs/79), then text size, line spacing and margins as stepped tracks
// (SteppedTrack.tsx) whose end icons stand in for row labels, then the paper.
// More is the Lumen switch, the same one as Settings and the home screen's
// title (docs/68). Both panels share one grid cell, so the sheet is as tall on
// More as on Layout and the tabs stay under the finger; it opens on Layout
// every time because the content unmounts on close.
//
// Every control applies on the press. There is no Done: the book is behind the
// sheet, the change is visible in it, and a setting the reader has to confirm
// is a setting they cannot see while choosing.

import { useT } from "../../../../i18n";
import {
  FLOW_DISPLAY_DEFAULT,
  FLOW_FONT_STEPS,
  FLOW_LINE_STEPS,
  FLOW_PAD_STEPS,
  FLOW_PAPERS,
  FLOW_PAPER_NAMES,
  flowFontStep,
  flowPaperSwatch,
  type FlowDisplay,
} from "../../../../reading/epub/flow/flow-display";
import {
  IconLinesLoose,
  IconLinesTight,
  IconMarginsNarrow,
  IconMarginsWide,
} from "../../base/icons";
import { cn } from "../../lib/utils";
import { setLumenShown, useLumenShown } from "../../lumen/use-lumen-shown";
import { Button } from "../../ui/button";
import { Dialog, DialogSheetContent, DialogTitle } from "../../ui/dialog";
import { Switch } from "../../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import SteppedTrack from "./SteppedTrack";
import { stepIndexOf } from "./stepped-track";

const LINE_LABEL = {
  tight: "phone.displaySheet.lineTight",
  standard: "phone.displaySheet.lineStandard",
  loose: "phone.displaySheet.lineLoose",
} as const;

const PAD_LABEL = {
  narrow: "phone.displaySheet.marginsNarrow",
  wide: "phone.displaySheet.marginsWide",
} as const;

const PAPER_LABEL = {
  white: "phone.displaySheet.paperWhite",
  paper: "phone.displaySheet.paperPaper",
  green: "phone.displaySheet.paperGreen",
  dark: "phone.displaySheet.paperDark",
} as const;

const LINE_VALUES = FLOW_LINE_STEPS.map((s) => s.value);
const PAD_VALUES = FLOW_PAD_STEPS.map((s) => s.value);

const TAB_CLASS =
  "relative flex-none rounded-none px-1 text-[15px] font-medium text-muted-foreground after:absolute after:bottom-1 after:left-1/2 after:h-[3px] after:w-5 after:-translate-x-1/2 after:rounded-full after:content-[''] data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-foreground";

const PANEL_CLASS = "[grid-area:1/1] data-[state=inactive]:invisible";

export default function PhoneDisplaySheet(props: {
  open: boolean;
  display: FlowDisplay;
  onOpenChange: (open: boolean) => void;
  onChange: (display: FlowDisplay) => void;
}) {
  const { display, onChange } = props;
  const t = useT();
  const lumenShown = useLumenShown();
  const lineStep = stepIndexOf(LINE_VALUES, display.lineHeight, FLOW_DISPLAY_DEFAULT.lineHeight);
  const padStep = stepIndexOf(PAD_VALUES, display.padX, FLOW_DISPLAY_DEFAULT.padX);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogSheetContent data-reader-paper={display.paper} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("phone.displaySheet.title")}</DialogTitle>
        <Tabs defaultValue="layout" className="flex-col gap-0">
          <TabsList className="justify-start gap-5 rounded-none bg-transparent p-0 px-4 pt-1">
            <TabsTrigger value="layout" className={TAB_CLASS}>
              {t("phone.displaySheet.layout")}
            </TabsTrigger>
            <TabsTrigger value="more" className={TAB_CLASS}>
              {t("phone.displaySheet.more")}
            </TabsTrigger>
          </TabsList>

          <div className="grid">
            <TabsContent value="layout" forceMount className={cn(PANEL_CLASS, "flex flex-col gap-2.5 px-4 pt-2 pb-safe-4")}>
              <div className="mb-1 grid grid-cols-2 gap-1 rounded-xl bg-muted p-[3px]" role="group">
                {(["scroll", "paged"] as const).map((mode) => (
                  <Button
                    key={mode}
                    variant="ghost"
                    className={cn(
                      "h-10 rounded-[9px] text-[15px] font-normal text-muted-foreground",
                      display.mode === mode && "bg-background font-semibold text-foreground shadow-sm can-hover:hover:bg-background",
                    )}
                    aria-pressed={display.mode === mode}
                    onClick={() => onChange({ ...display, mode })}
                  >
                    {t(mode === "scroll" ? "phone.displaySheet.scroll" : "phone.displaySheet.pages")}
                  </Button>
                ))}
              </div>

              <SteppedTrack
                label={t("phone.displaySheet.size")}
                count={FLOW_FONT_STEPS.length}
                index={flowFontStep(display)}
                valueText={(i) => `${FLOW_FONT_STEPS[i]}px`}
                start={{ icon: <span className="text-[13px] leading-none">A</span>, label: t("phone.displaySheet.smallerText") }}
                end={{ icon: <span className="text-[21px] leading-none">A</span>, label: t("phone.displaySheet.largerText") }}
                onStep={(i) => onChange({ ...display, fontPx: FLOW_FONT_STEPS[i] })}
              />

              <SteppedTrack
                label={t("phone.displaySheet.lineSpacing")}
                count={FLOW_LINE_STEPS.length}
                index={lineStep}
                valueText={(i) => t(LINE_LABEL[FLOW_LINE_STEPS[i].id])}
                start={{ icon: <IconLinesTight />, label: t("phone.displaySheet.tighterLines") }}
                end={{ icon: <IconLinesLoose />, label: t("phone.displaySheet.looserLines") }}
                onStep={(i) => onChange({ ...display, lineHeight: FLOW_LINE_STEPS[i].value })}
              />

              <SteppedTrack
                label={t("phone.displaySheet.margins")}
                count={FLOW_PAD_STEPS.length}
                index={padStep}
                valueText={(i) => t(PAD_LABEL[FLOW_PAD_STEPS[i].id])}
                start={{ icon: <IconMarginsNarrow />, label: t("phone.displaySheet.narrowerMargins") }}
                end={{ icon: <IconMarginsWide />, label: t("phone.displaySheet.widerMargins") }}
                onStep={(i) => onChange({ ...display, padX: FLOW_PAD_STEPS[i].value })}
              />

              <div className="mt-1 grid grid-cols-4 justify-items-center" role="group" aria-label={t("phone.displaySheet.paper")}>
                {FLOW_PAPER_NAMES.map((name) => {
                  const paper = FLOW_PAPERS[name];
                  return (
                    <Button
                      key={name}
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "size-12 rounded-full border border-foreground/20 coarse:size-12",
                        display.paper === name && "ring-2 ring-foreground ring-offset-[3px] ring-offset-background",
                      )}
                      style={{ backgroundColor: flowPaperSwatch(paper) }}
                      title={t(PAPER_LABEL[name])}
                      aria-label={t(PAPER_LABEL[name])}
                      aria-pressed={display.paper === name}
                      onClick={() => onChange({ ...display, paper: name })}
                    />
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="more" forceMount className={cn(PANEL_CLASS, "px-4 pt-2")}>
              <div className="flex min-h-11 items-center justify-between gap-3 px-1">
                <span className="text-[15px]">{t("phone.displaySheet.lumen")}</span>
                <Switch
                  className="data-[state=checked]:bg-foreground"
                  aria-label={t("phone.displaySheet.lumen")}
                  checked={lumenShown}
                  onCheckedChange={setLumenShown}
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogSheetContent>
    </Dialog>
  );
}
