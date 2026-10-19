# One-off: the call scenarios' microphone clips (src/call.rs, real-model tests).
# Kokoro-82M-v1.1-zh fp32 says each phrase with zf_001 on Linux, 24 kHz, cut
# to the voice plus 30 ms, resampled to 16 kHz, peak 0.5. The phonemes are
# phonemize_zh's (plugins/voice/src/kokoro_g2p) for the text beside them.
# Prints what Smart Turn v3.2 and Silero v6.0 say about each clip, which is how
# the pause scenario's first half was chosen (then, 0.028): Smart Turn must call it
# unfinished.
# usage: python -I make_call_fixtures.py <kokoro dir> <smart turn onnx> <silero onnx> <worktree vocab.rs> <out dir>
import re
import sys
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly
from transformers import WhisperFeatureExtractor

kokoro, smart, silero, vocab_rs, out = (Path(p) for p in sys.argv[1:6])
out.mkdir(parents=True, exist_ok=True)

vocab = {chr(int(h, 16)): int(i) for h, i in re.findall(r"\('\\u\{([0-9a-f]+)\}', (\d+)\)", vocab_rs.read_text())}
voice = np.fromfile(kokoro / "voices/zf_001.bin", dtype=np.float32).reshape(510, 256)
opts = ort.SessionOptions()
opts.intra_op_num_threads = 4
kok = ort.InferenceSession(str(kokoro / "onnx/model.onnx"), opts, providers=["CPUExecutionProvider"])


def zh_speed(n):
    s = 1.0 if n <= 83 else (1.0 - (n - 83) / 500 if n < 183 else 0.8)
    return s * 1.1


def say(ps):
    ids = [0] + [vocab[c] for c in ps if c in vocab] + [0]
    style = voice[min(max(len(ps), 1), 510) - 1][None, :]
    wav = kok.run(None, {"input_ids": np.array([ids], dtype=np.int64), "style": style,
                         "speed": np.array([zh_speed(len(ps))], dtype=np.float32)})[0]
    wav = np.asarray(wav, dtype=np.float64).reshape(-1)
    loud = np.nonzero(np.abs(wav) > 0.02 * np.abs(wav).max())[0]
    keep = int(0.03 * 24000)
    wav = resample_poly(wav[max(0, loud[0] - keep): loud[-1] + keep], 2, 3)
    return wav / np.abs(wav).max() * 0.5


PHRASES = {
    "one": "ㄐ阴1ㄊ言1ㄊ言1ㄑㄧ4/ㄗㄣ3ㄇㄜ5阳4?",                               # 今天天气怎么样？
    "ask": "我2ㄒ阳3/文4/ㄧ2ㄒ压4,",                                          # 我想问一下，
    "because": "阴1为4/我3/ㄐ月2ㄉㄜ5,",                                       # 因为我觉得，
    "then": "ㄖㄢ2ㄏㄡ4,",                                                     # 然后，
    "when": "ㄇ应2ㄊ言1/ㄒ压4ㄨ3/ㄉㄜ5/ㄏ为4ㄧ4/ㄐㄧ2ㄉ言3/ㄎㄞ1ㄕ十3.",          # 明天下午的会议几点开始。
    "wait": "ㄉㄥ3/ㄧ2ㄒ压4, 我2又3ㄍㄜ5/文4ㄊㄧ2.",                            # 等一下，我有个问题。
    "ah": "ㄚ5.",                                                               # 啊。
}

fe = WhisperFeatureExtractor(chunk_length=8)
st = ort.InferenceSession(str(smart), providers=["CPUExecutionProvider"])


def smart_turn(x):
    x = x[-128000:]
    x = np.concatenate([np.zeros(128000 - len(x)), x]).astype(np.float32)
    f = fe(x, sampling_rate=16000, return_tensors="np", padding="max_length", max_length=128000,
           truncation=True, do_normalize=True).input_features.astype(np.float32)
    return float(st.run(None, {"input_features": f})[0].reshape(-1)[0])


sv = ort.InferenceSession(str(silero), providers=["CPUExecutionProvider"])


def silero_frames(x):
    state = np.zeros((2, 1, 128), dtype=np.float32)
    ctx = np.zeros(64, dtype=np.float32)
    probs = []
    for i in range(0, len(x) - 511, 512):
        frame = x[i:i + 512].astype(np.float32)
        p, state = sv.run(None, {"input": np.concatenate([ctx, frame])[None, :], "state": state,
                                 "sr": np.array(16000, dtype=np.int64)})
        ctx = frame[-64:]
        probs.append(float(p.reshape(-1)[0]))
    return probs


def write(name, x):
    pcm = np.clip(np.round(x * 32768), -32768, 32767).astype(np.int16)
    with wave.open(str(out / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())


clips = {k: say(v) for k, v in PHRASES.items()}
# A short false alarm: the first 160 ms of 啊.
clips["ah"] = clips["ah"][: int(0.16 * 16000)]
pre = np.zeros(int(0.2 * 16000))
for k in ("ask", "because", "then", "one", "when", "wait"):
    x = clips[k]
    p = smart_turn(np.concatenate([pre, x, np.zeros(int(0.256 * 16000))]))
    print(f"{k}: {len(x) / 16000:.2f}s smart-turn after 256 ms of silence {p:.3f}")
s = silero_frames(np.concatenate([np.zeros(1024), clips["ah"], np.zeros(8192)]))
print("ah frames >= 0.5:", sum(1 for v in s if v >= 0.5), [round(v, 2) for v in s[:16]])
for k in ("one", "then", "when", "wait", "ah"):
    write(k, clips[k])
