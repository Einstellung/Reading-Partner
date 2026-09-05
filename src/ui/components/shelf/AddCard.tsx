// The last tile in a grid: the one that adds something rather than opening it.
// Same two pieces as a card, so it is the same size as the cards beside it.

import { ADD_CARD, ADD_CARD_BOX, CARD_LABEL } from "./cardStyles";

export default function AddCard(props: { label: string; onClick: () => void }) {
  return (
    <li>
      <button className={ADD_CARD} onClick={props.onClick}>
        <span className={ADD_CARD_BOX}>
          <span aria-hidden className="text-[30px] leading-none font-light">
            +
          </span>
          <span className="text-[13px]">{props.label}</span>
        </span>
        <span className={CARD_LABEL} />
      </button>
    </li>
  );
}
