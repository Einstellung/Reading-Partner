// A mark that was tapped (docs/82). A highlight offers Delete and Ask; an AI
// underline is a door into its conversation and offers Open and Delete. Where
// an underline runs through a highlight, the one bubble names which of the two
// each Delete removes.
//
// Everything else on the screen is covered by a scrim while it is up: a tap
// anywhere only puts it away, the page does not turn under it.

import { useT } from "../../../../i18n";
import type { FlowMarkPopup } from "../../../../reading/epub/flow/flow-contract";
import { markKind } from "../../../../reading/epub/annotation";
import { PhonePopup, PopupItem, PopupSep, type ScreenFrame } from "./PhonePopup";

export default function PhoneMarkPopup(props: {
  popup: FlowMarkPopup;
  frame: ScreenFrame;
  onClose: () => void;
  onDelete: (id: string) => void;
  onAsk: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const { popup, frame } = props;
  const [left, top, right, bottom] = popup.rect;
  const rects = [{ left, top, width: right - left, height: bottom - top }];
  const mark = popup.annotation;
  const underline = markKind(mark) === "underline";
  const under = popup.under;
  const act = (run: (id: string) => void, id: string) => () => {
    props.onClose();
    run(id);
  };
  return (
    <>
      <div
        className="absolute inset-0 z-6"
        data-testid="mark-popup-scrim"
        onPointerUp={props.onClose}
        onPointerCancel={props.onClose}
      />
      {underline ? (
        <PhonePopup rects={rects} frame={frame} gap={12} label={t("phone.markPopup.conversation")}>
          <PopupItem onClick={act(props.onOpen, mark.id)}>{t("phone.markPopup.open")}</PopupItem>
          <PopupSep />
          <PopupItem onClick={act(props.onDelete, mark.id)}>
            {under ? t("phone.markPopup.deleteUnderline") : t("phone.markPopup.delete")}
          </PopupItem>
          {under && (
            <>
              <PopupSep />
              <PopupItem onClick={act(props.onDelete, under.id)}>{t("phone.markPopup.deleteHighlight")}</PopupItem>
            </>
          )}
        </PhonePopup>
      ) : (
        <PhonePopup rects={rects} frame={frame} gap={12} label={t("phone.markPopup.highlight")}>
          <PopupItem onClick={act(props.onDelete, mark.id)}>{t("phone.markPopup.delete")}</PopupItem>
          <PopupSep />
          <PopupItem onClick={act(props.onAsk, mark.id)}>{t("phone.markPopup.ask")}</PopupItem>
        </PhonePopup>
      )}
    </>
  );
}
