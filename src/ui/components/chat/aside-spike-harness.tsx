// Standalone runtime harness for the chat's aside control. Not part of the app;
// it mounts the real MessageList in the shape CallView gives it — book-level,
// size lg, the same column — with canned settled replies, so useAsideSelection
// and AskAsideControl run for real in whatever webview this page is opened in.
// Served by Vite in dev at /chat-aside-spike.html.
//
// It exists for one question the DOM alone cannot answer: where WebKit's own
// Copy | Look Up | Translate bar lands relative to a control we place off a
// selection. The callout is native and invisible to JS, so the measurement is
// half from here (window.__aside) and half from the accessibility tree
// (scripts/ios-sim.sh describe). This side has to supply a real long-pressable
// reply and hand back exact rects — a programmatic selection raises no callout
// (docs/pitfall/04), so everything here is arranged for a real finger.

import { useState } from "react";
import { createRoot } from "react-dom/client";
// The app's global baseline, for the same reason the engine harness imports it:
// a layout measured here has to be the app's layout.
import "../../../styles.css";
import ChatScaleScope from "../base/ChatScaleScope";
import { MessageList } from "./chat";
import type { ThreadMessage } from "./types";
import type { AsideAnchor } from "../../../platform/app/threads";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

declare global {
  interface Window {
    __aside: {
      ready: boolean;
      // Every anchor the control has opened, newest last.
      opened: AsideAnchor[];
      // The control's own box, or null when it is not on screen.
      control(): Rect | null;
      // What is selected, as the page sees it: the string, the range's bounding
      // box and every client rect the selection draws.
      selection(): { text: string; bounding: Rect | null; rects: Rect[] } | null;
      // The prose elements a selection may be picked out of, in order.
      prose(): Rect[];
      // Put paragraph `i` of the list at viewport y `y`.
      place(i: number, y: number): Rect;
      // The scroller CallView wraps the list in.
      scroll(top: number): number;
      viewport(): { w: number; h: number; dpr: number; insets: Rect };
      // Collapse the selection without touching the page.
      clear(): void;
    };
  }
}

function rect(r: DOMRect): Rect {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    x: round(r.x),
    y: round(r.y),
    width: round(r.width),
    height: round(r.height),
    top: round(r.top),
    right: round(r.right),
    bottom: round(r.bottom),
    left: round(r.left),
  };
}

// Long enough that one reply fills more than a screen, so a span can be put at
// the top of the viewport and at the bottom of it without changing which row it
// is in. The words are ordinary prose because the measurement is about where a
// selection lands, and a paragraph of lorem would wrap differently from the
// sentences this app actually renders.
const PARAGRAPH = [
  "The first thing to notice about a diffusion model is that it never learns the data directly. It learns to undo a corruption, one step at a time, and the corruption is chosen so that its endpoint is pure noise.",
  "That choice is what makes the training tractable. Every step is a small denoising problem with a closed-form target, so the network is never asked to produce a whole image out of nothing — only to walk one step back up a path it has already been shown.",
  "Sampling reverses the walk. You start from noise, apply the learned step over and over, and the sample condenses out of it. The number of steps is a knob: fewer steps is faster and coarser, more steps is slower and closer to the distribution the model was fit to.",
  "Conditioning enters as an extra input to that step. A text prompt, a class label, a depth map — anything the network can read alongside the noisy sample — bends the walk toward the part of the distribution that matches it.",
  "Guidance is the trick that makes conditioning bite. The model is run twice, once with the condition and once without, and the difference between the two predictions is amplified before the step is taken. Turn it up and the samples match the prompt more tightly while losing variety.",
  "None of this requires the forward corruption to be Gaussian, and none of it requires the steps to be equal in size. Those are conveniences that make the algebra come out, and a good deal of the recent work is about replacing them with something cheaper.",
];

// Four rounds of it, so the list is taller than the viewport: a span has to be
// placeable at the top of the screen and at the bottom of it, and a list that
// does not scroll can put one nowhere.
const MESSAGES: ThreadMessage[] = Array.from({ length: 4 }, (_, round) => [
  {
    role: "user" as const,
    text: `Can you walk me through how diffusion models actually work? (${round + 1})`,
    ts: round * 10 + 1,
  },
  { role: "ai" as const, text: PARAGRAPH.slice(0, 3).join("\n\n"), ts: round * 10 + 2 },
  { role: "user" as const, text: "And where does the prompt come in?", ts: round * 10 + 3 },
  { role: "ai" as const, text: PARAGRAPH.slice(3).join("\n\n"), ts: round * 10 + 4 },
]).flat();

function Harness() {
  const [opened, setOpened] = useState<AsideAnchor[]>([]);
  return (
    // CallView's own frame: the surface variables, the scroller, the centred
    // column. Without them the control would be measured against a different
    // line length and a different scroll container from the app's.
    <div className="relative flex h-full w-full flex-col bg-chat-surface [--chat-bubble-bg:var(--chat-bubble)] [--chat-code-bg:var(--chat-code)]">
      <ChatScaleScope className="flex min-h-0 flex-1 flex-col">
        <div data-aside-scroller className="min-h-0 flex-1 overflow-y-auto px-4 pt-36">
          <MessageList
            messages={MESSAGES}
            size="lg"
            className="mx-auto max-w-[calc(48rem*var(--chat-scale,1))] pb-6"
            onOpenAside={(anchor) => {
              openedAnchors.push(anchor);
              setOpened((prev) => [...prev, anchor]);
            }}
          />
        </div>
      </ChatScaleScope>
      {/* A visible receipt for question 4: whether the tap reaches the control
          at all is answered by the count going up, and the last span says which
          words it was opened on. */}
      <div data-aside-log className="px-4 pb-3 text-[13px] text-neutral-500">
        opened: {opened.length}
        {opened.length > 0 ? ` — “${opened[opened.length - 1].text.slice(0, 40)}”` : ""}
      </div>
    </div>
  );
}

// Module scope, and not named `opened`: the component has a state variable by
// that name, and a shadowed push writes to the wrong array without a word.
const openedAnchors: AsideAnchor[] = [];
const scroller = () => document.querySelector<HTMLElement>("[data-aside-scroller]");
const paragraphs = () =>
  [...document.querySelectorAll<HTMLElement>("[data-aside-ts] p")];

window.__aside = {
  ready: false,
  opened: openedAnchors,
  control: () => {
    // The control is the only fixed button outside the list.
    const el = document.querySelector<HTMLElement>('button[data-slot="button"].fixed');
    return el ? rect(el.getBoundingClientRect()) : null;
  },
  selection: () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return {
      text: sel.toString(),
      bounding: sel.isCollapsed ? null : rect(range.getBoundingClientRect()),
      rects: sel.isCollapsed ? [] : [...range.getClientRects()].map(rect),
    };
  },
  prose: () => paragraphs().map((p) => rect(p.getBoundingClientRect())),
  place: (i, y) => {
    const p = paragraphs()[i];
    const s = scroller();
    if (!p || !s) throw new Error(`no paragraph ${i}`);
    s.scrollTop += p.getBoundingClientRect().top - y;
    return rect(p.getBoundingClientRect());
  },
  scroll: (top) => {
    const s = scroller();
    if (!s) throw new Error("no scroller");
    s.scrollTop = top;
    return s.scrollTop;
  },
  viewport: () => {
    const probe = document.createElement("div");
    probe.className = "safe-probe";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const num = (v: string) => Number.parseFloat(v) || 0;
    const insets = {
      top: num(cs.paddingTop),
      right: num(cs.paddingRight),
      bottom: num(cs.paddingBottom),
      left: num(cs.paddingLeft),
    };
    probe.remove();
    return {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
      insets: { ...insets, x: 0, y: 0, width: 0, height: 0 },
    };
  },
  clear: () => document.getSelection()?.removeAllRanges(),
};

createRoot(document.getElementById("root")!).render(<Harness />);

// Ready when the lazy Markdown renderer has swapped in — until it does the
// reply is one plain-text span with no paragraphs to press on.
const tick = () => {
  if (paragraphs().length >= PARAGRAPH.length * 4) {
    window.__aside.ready = true;
  } else {
    requestAnimationFrame(tick);
  }
};
requestAnimationFrame(tick);
