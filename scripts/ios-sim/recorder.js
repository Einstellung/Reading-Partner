(() => {
  if (window.__rec) return "already installed";
  const TYPES = [
    "touchstart", "touchmove", "touchend", "touchcancel",
    "pointerdown", "pointermove", "pointerup", "pointercancel",
    "selectstart", "selectionchange",
  ];
  const R = {
    events: [],
    frames: [],
    on: false,
    t0: 0,
    raf: 0,
    // The reader's scroll container: the one element under the reader surface
    // with a scrolling overflow. Re-resolved each start (a layout switch
    // remounts it).
    el: null,
  };
  const findViewport = () => {
    const surface = document.querySelector("[data-reader-surface]");
    if (!surface) return null;
    for (const el of surface.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return el;
    }
    return null;
  };
  const tag = (t) => {
    if (!t || !t.tagName) return String(t);
    const cls = String(t.className || "").trim().split(/\s+/).slice(0, 2).join(".");
    return t.tagName + (cls ? "." + cls : "") + (t.getAttribute && t.getAttribute("data-page-index") !== null ? "#p" + t.getAttribute("data-page-index") : "");
  };
  const onEvent = (e) => {
    if (!R.on) return;
    const r = { t: +(performance.now() - R.t0).toFixed(1), type: e.type };
    if (e.type.startsWith("touch")) {
      r.n = e.touches.length;
      r.cancelable = e.cancelable;
      const t = e.changedTouches[0] || e.touches[0];
      if (t) { r.x = Math.round(t.clientX); r.y = Math.round(t.clientY); }
    } else if (e.type.startsWith("pointer")) {
      r.id = e.pointerId; r.pt = e.pointerType; r.cancelable = e.cancelable;
      r.x = Math.round(e.clientX); r.y = Math.round(e.clientY);
      r.wh = e.width + "x" + e.height;
    }
    if (e.target) r.tgt = tag(e.target);
    R.events.push(r);
  };
  const sample = () => {
    const el = R.el;
    if (el) {
      const child = el.firstElementChild;
      R.frames.push({
        t: +(performance.now() - R.t0).toFixed(1),
        st: Math.round(el.scrollTop), sl: Math.round(el.scrollLeft),
        sh: el.scrollHeight, sw: el.scrollWidth,
        // The vertical rubber band lives here (pitfall 45): the container's own
        // transform. The paged band lives on the content child (pitfall 41).
        band: el.style.transform || "",
        childBand: child ? child.style.transform || "" : "",
        // Ink strokes live in the annotation layer's SVG. Sampled every frame
        // because the failure docs/pitfall/37 warns about is transient: a
        // stroke that starts under a finger, never commits, and leaves a mark
        // on screen for the few frames before the scroll takes over.
        paths: document.querySelectorAll("[data-reader-surface] svg path").length,
      });
    }
    R.raf = requestAnimationFrame(sample);
  };
  for (const ty of TYPES) window.addEventListener(ty, onEvent, true);

  window.__rec = {
    start() {
      R.el = findViewport();
      R.events.length = 0;
      R.frames.length = 0;
      R.t0 = performance.now();
      R.on = true;
      if (!R.raf) R.raf = requestAnimationFrame(sample);
      const el = R.el;
      return el ? { st: el.scrollTop, sl: el.scrollLeft, sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth } : null;
    },
    stop() {
      R.on = false;
      if (R.raf) { cancelAnimationFrame(R.raf); R.raf = 0; }
      return window.__rec.report();
    },
    report() {
      const ev = R.events;
      const seq = ev.map((e) => e.type);
      const firstTouch = ev.find((e) => e.type === "touchstart");
      const firstMove = ev.find((e) => e.type === "touchmove");
      const firstPMove = ev.find((e) => e.type === "pointermove");
      const d = (a, b) => (a && b ? { dx: b.x - a.x, dy: b.y - a.y } : null);
      // Every distinct band value seen, and the largest excursion.
      const bands = [...new Set(R.frames.map((f) => f.band))].filter(Boolean);
      const childBands = [...new Set(R.frames.map((f) => f.childBand))].filter(Boolean);
      const num = (s) => (s.match(/-?\d+(\.\d+)?/g) || []).map(Number);
      const peak = (list) => list.reduce((m, s) => {
        const v = num(s);
        const mag = Math.max(...v.map(Math.abs), 0);
        return mag > m.mag ? { mag, s } : m;
      }, { mag: 0, s: "" });
      const st = R.frames.map((f) => f.st);
      const sl = R.frames.map((f) => f.sl);
      return {
        counts: seq.reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {}),
        // Does WebKit hand the sequence to its own scrolling? (pitfall 70)
        cancelled: seq.includes("pointercancel"),
        gotPointerUp: seq.includes("pointerup"),
        // How far the touch had already travelled when the page got its first
        // move (pitfall 71: this, not a threshold, is what decides).
        firstTouchMoveDelta: d(firstTouch, firstMove),
        firstPointerMoveDelta: d(firstTouch, firstPMove),
        touchMoveCancelable: firstMove ? firstMove.cancelable : null,
        scrollTop: { first: st[0], last: st[st.length - 1], min: Math.min(...st), max: Math.max(...st) },
        scrollLeft: { first: sl[0], last: sl[sl.length - 1], min: Math.min(...sl), max: Math.max(...sl) },
        bandPeak: peak(bands),
        childBandPeak: peak(childBands),
        bandValues: bands.slice(0, 8),
        childBandValues: childBands.slice(0, 8),
        frames: R.frames.length,
        svgPaths: { first: R.frames.length ? R.frames[0].paths : null, last: R.frames.length ? R.frames[R.frames.length - 1].paths : null, max: Math.max(...R.frames.map((f) => f.paths), 0) },
        selection: String(getSelection()).slice(0, 80),
        selectionChars: String(getSelection()).length,
        events: ev,
      };
    },
    // Compact form for the log: drop the raw event list.
    brief() {
      const r = window.__rec.report();
      delete r.events;
      return r;
    },
    events: () => R.events,
    frames: () => R.frames,
  };
  return "installed";
})()
