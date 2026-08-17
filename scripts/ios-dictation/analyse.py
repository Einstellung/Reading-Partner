#!/usr/bin/env python3
"""Read the dictation smoke's JSON and print the numbers the brief asks for."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "dictation-result.json"
d = json.load(open(path))

print(f"stage={d['stage']}  ok={d['ok']}  error={d.get('error')}")
print(f"hasOnDeviceDictation={d['hasOnDeviceDictation']}")
print()

print("=== bar-driven (the composer's own hold) ===")
for b in d.get("barDriven", []):
    print(json.dumps(b, ensure_ascii=False))
print()

print("=== overlapping start ===")
print(json.dumps(d.get("overlapping"), ensure_ascii=False, indent=2))
print()

print("=== scenarios ===")
rows = []
for s in d.get("scenarios", []):
    ev = s.get("events") or []
    vol = [e for e in ev if e["e"]["kind"] == "volatile"]
    fin = [e for e in ev if e["e"]["kind"] == "final"]
    lev = [e for e in ev if e["e"]["kind"] == "level"]
    rows.append(
        dict(
            name=s["name"],
            hold=s["holdMs"],
            locale=s.get("locale"),
            start=s.get("startMs"),
            firstBufferLevel=s.get("firstLevelMs"),
            firstVolatile=s.get("firstVolatileMs"),
            firstFinal=s.get("firstFinalMs"),
            release=s.get("releaseToAnswerMs"),
            nVol=len(vol),
            nFin=len(fin),
            nLev=len(lev),
            err=s.get("error"),
        )
    )
    print(json.dumps(rows[-1], ensure_ascii=False))
print()

print("=== transcripts: native answer vs the webview's own fold ===")
for s in d.get("scenarios", []):
    if s.get("transcript") is None and s.get("streamed") is None:
        continue
    same = s.get("transcript") == s.get("streamed")
    print(f"[{s['name']}] identical={same}")
    print(f"  native  : {s.get('transcript')!r}")
    print(f"  streamed: {s.get('streamed')!r}")
print()

print("=== volatile scoping: is a volatile the tail, or the whole utterance? ===")
for s in d.get("scenarios", []):
    ev = s.get("events") or []
    speech = [e for e in ev if e["e"]["kind"] in ("volatile", "final")]
    if len(speech) < 3:
        continue
    print(f"--- {s['name']} ({s.get('locale')}) ---")
    for e in speech:
        print(f"  {e['t']:>8.1f}  {e['e']['kind']:<8} {e['e']['text']!r}")
    print()

print("=== level distribution ===")
for s in d.get("scenarios", []):
    lv = s.get("levels") or []
    if not lv:
        continue
    lv_sorted = sorted(lv)
    n = len(lv)
    print(
        f"{s['name']:<16} n={n:<4} min={min(lv):.3f} p50={lv_sorted[n//2]:.3f} "
        f"p90={lv_sorted[int(n*0.9)]:.3f} max={max(lv):.3f} "
        f"rate={n/(s['holdMs']/1000):.1f}Hz"
    )
print()

print("=== release -> answer (what FINISH_TIMEOUT_MS has to cover) ===")
vals = [s["releaseToAnswerMs"] for s in d.get("scenarios", []) if s.get("releaseToAnswerMs")]
if vals:
    vs = sorted(vals)
    n = len(vs)
    print("all:", [round(v) for v in vs])
    print(f"n={n} min={vs[0]:.0f} p50={vs[n//2]:.0f} p90={vs[int(n*0.9)]:.0f} p95={vs[min(n-1,int(n*0.95))]:.0f} max={vs[-1]:.0f}")
for b in d.get("barDriven", []):
    if b.get("releaseToDeliveryMs"):
        print(f"bar release->delivery: {b['releaseToDeliveryMs']:.0f}ms")
