"""Synthesise the user's side of the silent voice scripts (docs/platform/560).

    python voice-fixtures.py <out-dir>

Needs edge-tts, numpy, soundfile and soxr in whatever venv runs it; none of
them are app dependencies. Writes one 16 kHz mono 16-bit WAV per line and one
JSON per script into <out-dir> (tests/fixtures/voice-scripts/). The voices are
male (Yunxi, Andrew) so they are never mistaken for the AI's Mimo 冰糖.

Each clip is trimmed to 150 ms before the first word and 300 ms after the last,
and its voiced part brought to -24 dBFS RMS, the median of near speech through
the voice-processing unit (docs/info/33).
"""

import asyncio
import io
import json
import sys
from pathlib import Path

import edge_tts
import numpy as np
import soundfile as sf
import soxr

RATE = 16000
ZH = "zh-CN-YunxiNeural"
EN = "en-US-AndrewNeural"

# name, locale, final replies, final timeout, steps:
#   (clip, voice, text, start, offsetMs, timeoutMs, expect, max voiced ms)
SCRIPTS = [
    ("zh-chat-then-delegate", "zh-CN", 1, 240_000, [
        ("zh-hello.wav", ZH, "你好，今天有什么值得看的？", "reply-end", 800, 45_000, "turn", None),
        ("zh-first.wav", ZH, "第一条讲的是什么？简单说两句就行。", "reply-end", 800, 90_000, "turn", None),
        ("zh-paper.wav", ZH, "这篇论文的结论站得住吗？方法上有没有问题？你帮我仔细查一下。", "reply-end", 800, 90_000, "turn", None),
        ("zh-chat-book.wav", ZH, "好，那先随便聊聊。你觉得周末适合读点什么？", "reply-end", 800, 90_000, "turn", None),
        ("zh-chat-why.wav", ZH, "为什么推荐这本？用一句话说。", "reply-end", 800, 90_000, "turn", None),
        ("zh-read-it.wav", ZH, "念吧。", "next-reply-end", 600, 300_000, "turn", None),
    ]),
    ("en-mixed", "en-US", 2, 180_000, [
        ("en-hello.wav", EN, "Hi, what's on today's briefing?", "reply-end", 800, 45_000, "turn", None),
        ("en-first.wav", EN, "Okay, tell me a bit more about the first one, briefly.", "reply-end", 800, 90_000, "turn", None),
        ("mix-key-point.wav", ZH, "So 这个 story 的 key point is what, in one sentence?", "reply-end", 800, 90_000, "turn", None),
        ("en-paper.wav", EN, "Can you check whether the paper's evidence actually supports its conclusion, and whether the method has any flaws?", "reply-end", 800, 90_000, "turn", None),
        ("mix-this-week.wav", ZH, "Got it. 那 meanwhile, this week 最值得关注的是哪个？", "reply-end", 800, 90_000, "turn", None),
        ("en-thanks.wav", EN, "Thanks, that's all for now.", "reply-end", 800, 90_000, "turn", None),
    ]),
    ("barge-in", "zh-CN", 1, 120_000, [
        ("zh-long.wav", ZH, "给我详细讲讲今天的第一条新闻，多说一点。", "reply-end", 800, 45_000, "turn", None),
        # A backchannel under 300 ms of voice: ducks, must not stop the reply.
        ("zh-uh-huh.wav", ZH, "嗯。", "reply-start", 3500, 90_000, "none", 250),
        ("zh-wait.wav", ZH, "等一下。", "clip-end", 2500, 90_000, "interrupt", None),
        ("zh-go-on.wav", ZH, "好，你接着说吧，简短一点。", "reply-end", 800, 90_000, "turn", None),
    ]),
]


async def synth(text: str, voice: str) -> np.ndarray:
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    data, rate = sf.read(io.BytesIO(bytes(audio)), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    return soxr.resample(data, rate, RATE).astype(np.float32)


def shape(x: np.ndarray, max_voiced_ms: int | None) -> np.ndarray:
    win = RATE // 100
    frames = len(x) // win
    rms = np.sqrt(np.mean(x[: frames * win].reshape(frames, win) ** 2, axis=1) + 1e-12)
    voiced = np.where(20 * np.log10(rms) > -45)[0]
    first, last = voiced[0] * win, (voiced[-1] + 1) * win
    if max_voiced_ms is not None:
        last = min(last, first + max_voiced_ms * RATE // 1000)
    y = x[first:last].copy()
    fade = min(len(y), RATE * 30 // 1000)
    y[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    level = np.sqrt(np.mean(y**2))
    y *= 10 ** (-24 / 20) / max(level, 1e-6)
    y = np.clip(y, -1, 1)
    pad = lambda ms: np.zeros(RATE * ms // 1000, dtype=np.float32)
    return np.concatenate([pad(150), y, pad(300)])


async def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, locale, final_replies, final_timeout, steps in SCRIPTS:
        rows = []
        for clip, voice, text, start, offset, timeout, expect, cap in steps:
            y = shape(await synth(text, voice), cap)
            sf.write(out / clip, y, RATE, subtype="PCM_16")
            print(f"{clip}: {len(y) / RATE:.2f}s")
            rows.append({
                "clip": clip, "text": text, "start": start, "offsetMs": offset,
                "timeoutMs": timeout, "expect": expect,
            })
        script = {
            "name": name, "locale": locale, "finalReplies": final_replies,
            "finalTimeoutMs": final_timeout, "tailMs": 1500, "steps": rows,
        }
        (out / f"{name}.json").write_text(json.dumps(script, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
