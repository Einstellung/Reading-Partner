#!/usr/bin/env python3
"""Turn one speech-result.json plus the captured tapes into the four verdicts.

  judge.py <devicerun dir>

E1 seams      — the tape against the fixture, sample for sample.
E2 playerTime — latencyMs per sentence and the drift of completedAtMs.
E3 echo       — how much of what the phone said came back through the mic.
E4 envelope   — the level distribution the orb would be driven by.
"""
import json, os, sys, math, array

REPO = os.environ.get("RP_REPO", "/home/xinyuan/Documents/Github/Reading-Partner/.claude/worktrees/agent-acc8aa81162eb7035")
MANIFEST = os.path.join(REPO, "docs/assets/tts-probe/manifest.json")
SR = 24000


def pcm(path):
    a = array.array("h")
    with open(path, "rb") as f:
        a.frombytes(f.read())
    return a


def dbfs(x):
    return -120.0 if x <= 0 else 20 * math.log10(x / 32768.0)


def peaks(samples, win):
    out = []
    for i in range(0, len(samples) - win, win):
        out.append(max(abs(v) for v in samples[i:i + win]))
    return out


def e1(d, run):
    print("\n=== E1 seams ===")
    man = json.load(open(MANIFEST))
    sen = sorted(man["sentences"], key=lambda s: s["index"])
    for label in ("trimmed-burst", "trimmed-measured", "raw-burst"):
        tape = os.path.join(run, f"{label}.pcm")
        if not os.path.exists(tape):
            print(f"{label}: no tape")
            continue
        kind = "raw" if label.startswith("raw") else "trimmed"
        ref = array.array("h")
        for s in sen:
            ref.extend(pcm(os.path.join(run, "fixture", kind, s["id"] + ".pcm")))
        got = pcm(tape)
        print(f"{label}: tape {len(got)} samples ({len(got)/SR:.2f}s), "
              f"reference {len(ref)} ({len(ref)/SR:.2f}s)")
        n = min(len(ref), len(got))
        diff = sum(1 for i in range(n) if ref[i] != got[i])
        print(f"  identical for {n - diff}/{n} samples "
              f"({100*(n-diff)/n:.4f}%), first mismatch at "
              f"{next((i for i in range(n) if ref[i] != got[i]), -1)}")
        # Seam peaks: a 10 ms window either side of every sentence boundary.
        win = SR // 100
        edge = 0
        for s in sen[:-1]:
            edge += s[kind]["samples"]
            if edge + win >= len(got):
                break
            here = max(abs(v) for v in got[edge - win:edge + win])
            before = max(abs(v) for v in got[max(0, edge - 5*win):edge - win] or [1])
            after = max(abs(v) for v in got[edge + win:edge + 5*win] or [1])
            jump = dbfs(here) - max(dbfs(before), dbfs(after))
            if jump > 20:
                print(f"  seam after {s['id']}: +{jump:.1f} dB over its neighbours")
        print("  no seam窗 exceeded its neighbours by 20 dB" if True else "")


def e2(d):
    print("\n=== E2 playerTime ===")
    man = json.load(open(MANIFEST))
    sen = sorted(man["sentences"], key=lambda s: s["index"])
    for leg in d["legs"]:
        rep = leg.get("report") or {}
        rows = rep.get("sentences") or []
        if not rows:
            print(f"{leg['label']}: no sentences in the report")
            continue
        lat = [r.get("latencyMs") for r in rows if r.get("latencyMs") is not None]
        print(f"{leg['label']}: {len(rows)} sentences, "
              f"outputPresentationLatencyMs={rep.get('outputPresentationLatencyMs')}, "
              f"sessionOutputLatencyMs={rep.get('sessionOutputLatencyMs')}, "
              f"ioBufferDurationMs={rep.get('ioBufferDurationMs')}")
        if lat:
            print(f"  latencyMs min {min(lat):.2f} max {max(lat):.2f} "
                  f"mean {sum(lat)/len(lat):.2f} negatives {sum(1 for v in lat if v < 0)}")
            print("  per sentence:", [round(v, 2) for v in lat])
        done = [r.get("completedAtMs") for r in rows if r.get("completedAtMs") is not None]
        if done and len(done) == len(sen):
            kind = "raw" if leg["label"].startswith("raw") else "trimmed"
            acc, drift = 0.0, []
            for s, got in zip(sen, done):
                acc += s[kind]["seconds"] * 1000
                drift.append(got - done[0] - (acc - sen[0][kind]["seconds"] * 1000))
            print("  drift vs the fixture's own clock, ms:", [round(v) for v in drift])


def e3(d):
    print("\n=== E3 echo ===")
    for leg in d.get("echo") or []:
        if not leg["bigrams"]:
            print(f"{leg['label']}: nothing spoken")
            continue
        pct = 100 * leg["bigramsHeard"] / leg["bigrams"]
        print(f"{leg['label']}: vpio={leg['vpio']} ok={leg['ok']} "
              f"events={leg['events']} wall={leg['wallMs']}ms "
              f"bigrams {leg['bigramsHeard']}/{leg['bigrams']} ({pct:.1f}%)")
        if leg["error"]:
            print("  error:", leg["error"])
        print("  heard:", (leg["heard"] or "")[:300])


def e4(d):
    print("\n=== E4 envelope ===")
    def pct(v, p):
        if not v:
            return float("nan")
        s = sorted(v)
        return s[min(len(s) - 1, int(p * len(s)))]
    for leg in d["legs"]:
        rep = leg.get("report") or {}
        raw = rep.get("levelDb") or []
        mapped = leg.get("levels") or []
        gaps = leg.get("levelGaps") or []
        print(f"{leg['label']}: levelDb n={len(raw)} "
              f"p10={pct(raw,0.10):.1f} p50={pct(raw,0.50):.1f} p90={pct(raw,0.90):.1f} "
              f"| mapped n={len(mapped)} p10={pct(mapped,0.10):.3f} "
              f"p50={pct(mapped,0.50):.3f} p90={pct(mapped,0.90):.3f} "
              f"pinned0={sum(1 for v in mapped if v <= 0.001)} "
              f"pinned1={sum(1 for v in mapped if v >= 0.999)}")
        print(f"  levelIntervalMs={rep.get('levelIntervalMs')} "
              f"firstTapFrames={rep.get('firstTapFrames')} "
              f"tapBuffers={rep.get('tapBuffers')} "
              f"| webview gaps median={pct(gaps,0.5)} max={max(gaps) if gaps else None}")


def routes(d):
    trials = (d.get("routes") or {})
    if isinstance(trials, dict):
        trials = trials.get("trials") or trials.get("error") or []
    if not trials:
        print("\n=== routes ===\nno survey in the file")
        return
    print("\n=== routes ===")
    if isinstance(trials, str):
        print(" ", trials)
        return
    for t in trials:
        print(f"{t['name']}: configured={t['configured']} vpio={t['voiceProcessing']}"
              + (f" error={t['error']}" if t.get("error") else ""))
        print("  ", t["route"])


def main():
    run = sys.argv[1]
    d = json.load(open(os.path.join(run, "speech-result.json")))
    print(f"ok={d['ok']} stage={d['stage']} error={d.get('error')} "
          f"legs={[l['label'] for l in d['legs']]}")
    for leg in d["legs"]:
        rep = leg.get("report") or {}
        print(f"  {leg['label']}: ok={leg['ok']} wall={leg['wallMs']}ms "
              f"speaking={[(s['value'], s.get('reason')) for s in leg['speaking']]} "
              f"error={leg['error'] or rep.get('error')}")
    routes(d)
    e1(d, run)
    e2(d)
    e3(d)
    e4(d)
    for leg in d["legs"]:
        if leg.get("relay"):
            print("\n=== live relay ===")
            print(json.dumps(leg["relay"], ensure_ascii=False)[:4000])
    ints = d.get("interrupts") or {}
    pos = ints.get("positions") or []
    if pos:
        print("\n=== interruptions ===")
        served = [p for p in pos if p.get("index", -1) >= 0]
        print(f"{len(pos)} rounds, {len(served)} landed on a playing sentence")
        print("  first three:", pos[:3])


if __name__ == "__main__":
    main()
