// What WebKit does with a touch before the page gets a say.
//
// docs/pitfall/70 and 71 were both measured in headless Chromium and both say
// so: Chromium takes the sequence over at its own slop (~8px), tells the page
// by sending pointercancel, and only a non-passive touchmove preventDefault
// issued on the FIRST move it delivers keeps it. Neither number was ever
// checked on iOS. This builds the same experiment inside the real WKWebView: a
// plain overflow-y:auto scroller (the reader's own page boxes are
// touch-action:none, so they cannot answer this question), a full event log,
// and an optional claim at a chosen displacement.
//
//   __claim.reset("native")   observe only — does WebKit cancel, and how far
//                             had the finger travelled at the first touchmove
//   __claim.reset(3)          preventDefault from 3px of travel onward
//   __claim.reset("first")    preventDefault on the first move, whatever it is
//   __claim.reset("once")     preventDefault on the first move only, then stop
//                             (pitfall 70 says this is not enough)
(() => {
  const ID = "claim-probe";
  document.getElementById(ID)?.remove();

  const box = document.createElement("div");
  box.id = ID;
  box.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#fff;overflow-y:auto;-webkit-overflow-scrolling:touch;font:14px/1.6 -apple-system,sans-serif";
  const inner = document.createElement("div");
  inner.style.cssText = "padding:24px";
  let rows = "";
  for (let i = 0; i < 200; i++) rows += "<p>scrollable line " + i + "</p>";
  inner.innerHTML = "<div id=" + ID + "-out style='position:fixed;top:8px;left:8px;right:8px;padding:8px;background:#111;color:#0f0;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;z-index:1'>probe armed</div><div style='height:120px'></div>" + rows;
  box.appendChild(inner);
  document.body.appendChild(box);
  const out = document.getElementById(ID + "-out");

  const S = {
    mode: "native",
    events: [],
    start: null,
    t0: 0,
    prevented: 0,
    scrollFirst: 0,
    scrollLast: 0,
  };

  const shouldPrevent = (dy, dx, moveIndex) => {
    if (S.mode === "native") return false;
    if (S.mode === "first") return true;
    if (S.mode === "once") return moveIndex === 0;
    const n = Number(S.mode);
    return Number.isFinite(n) && Math.max(Math.abs(dy), Math.abs(dx)) >= n;
  };

  let moveIndex = 0;
  const push = (r) => {
    S.events.push(r);
    render();
  };
  const render = () => {
    const seq = S.events.map((e) => e.type);
    const fm = S.events.find((e) => e.type === "touchmove");
    out.textContent =
      "mode " + S.mode +
      "\nfirst touchmove dy " + (fm ? fm.dy : "-") + "  cancelable " + (fm ? fm.cancelable : "-") +
      "\nprevented " + S.prevented +
      "\npointercancel " + (seq.includes("pointercancel") ? "YES" : "no") +
      "  pointerup " + (seq.includes("pointerup") ? "YES" : "no") +
      "\nscrolled " + (box.scrollTop - S.scrollFirst) + "px" +
      "\n" + seq.join(" ");
  };

  const onTouch = (e) => {
    const t = e.changedTouches[0] || e.touches[0];
    const now = +(performance.now() - S.t0).toFixed(1);
    if (e.type === "touchstart") {
      S.start = { x: t.clientX, y: t.clientY };
      moveIndex = 0;
      S.scrollFirst = box.scrollTop;
      push({ t: now, type: e.type, x: Math.round(t.clientX), y: Math.round(t.clientY), n: e.touches.length });
      return;
    }
    const dx = S.start ? Math.round(t.clientX - S.start.x) : 0;
    const dy = S.start ? Math.round(t.clientY - S.start.y) : 0;
    const rec = { t: now, type: e.type, dx, dy, cancelable: e.cancelable };
    if (e.type === "touchmove") {
      if (shouldPrevent(dy, dx, moveIndex)) {
        if (e.cancelable) {
          e.preventDefault();
          S.prevented++;
          rec.prevented = true;
        } else {
          // WebKit has already handed the sequence to its own scrolling; this
          // is the moment the claim was lost.
          rec.tooLate = true;
        }
      }
      moveIndex++;
    }
    push(rec);
    S.scrollLast = box.scrollTop;
  };
  const onPointer = (e) => {
    push({
      t: +(performance.now() - S.t0).toFixed(1),
      type: e.type,
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      id: e.pointerId,
      pt: e.pointerType,
    });
  };

  // Non-passive is the whole point: a passive listener cannot preventDefault,
  // and preventDefault on a touchmove is the only thing that stops the browser
  // from scrolling (a pointer event's default behaviour does not include it).
  for (const ty of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
    box.addEventListener(ty, onTouch, { passive: false });
  }
  for (const ty of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    box.addEventListener(ty, onPointer);
  }

  window.__claim = {
    reset(mode) {
      S.mode = mode === undefined ? "native" : mode;
      S.events.length = 0;
      S.prevented = 0;
      S.start = null;
      S.t0 = performance.now();
      box.scrollTop = 400; // room to scroll in both directions
      S.scrollFirst = box.scrollTop;
      moveIndex = 0;
      render();
      return { mode: S.mode, scrollTop: box.scrollTop };
    },
    report() {
      const seq = S.events.map((e) => e.type);
      const moves = S.events.filter((e) => e.type === "touchmove");
      const first = moves[0];
      return {
        mode: S.mode,
        // The number pitfall 71 says actually decides the outcome.
        firstTouchMoveDy: first ? first.dy : null,
        firstTouchMoveCancelable: first ? first.cancelable : null,
        moves: moves.length,
        cancelableMoves: moves.filter((m) => m.cancelable).length,
        prevented: S.prevented,
        tooLateAt: moves.findIndex((m) => m.tooLate),
        // WebKit's "I am taking this" signal, if it sends one at all.
        pointercancel: seq.includes("pointercancel"),
        pointerup: seq.includes("pointerup"),
        touchcancel: seq.includes("touchcancel"),
        scrolledPx: box.scrollTop - S.scrollFirst,
        sequence: seq.join(" "),
        events: S.events,
      };
    },
    remove() {
      box.remove();
      delete window.__claim;
      return "removed";
    },
  };
  return "claim probe installed";
})()
