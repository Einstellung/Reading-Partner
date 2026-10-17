"""Export the dictionaries the Rust Kokoro G2P frontend needs, from the exact Python packages misaki 0.9.4 runs on.

Usage: python -I export_data.py OUT_DIR
Needs a venv with misaki[zh,en]==0.9.4 (jieba 0.42.1, pypinyin 0.55.0, pypinyin-dict 0.9.0).
Writes raw little-endian blobs (zh.bin, en.bin) and lists.rs; compress_data.py turns the blobs into .br.

Sources and licenses: jieba (MIT), pypinyin (MIT), pypinyin-dict large_pinyin (MIT),
misaki us_gold/us_silver + word lists (Apache-2.0).
"""
import json
import os
import struct
import sys
import importlib.resources

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


class W:
    def __init__(self):
        self.b = bytearray()

    def u8(self, v):
        self.b += struct.pack('<B', v)

    def u16(self, v):
        self.b += struct.pack('<H', v)

    def u32(self, v):
        self.b += struct.pack('<I', v)

    def u64(self, v):
        self.b += struct.pack('<Q', v)

    def f64(self, v):
        self.b += struct.pack('<d', v)

    def s(self, v):
        e = v.encode('utf-8')
        assert len(e) < 65536, v
        if len(e) < 255:
            self.u8(len(e))
        else:
            self.u8(255)
            self.u16(len(e))
        self.b += e


# ---------------------------------------------------------------- zh
import jieba
import jieba.posseg as psg
import jieba.finalseg as fs
from misaki.zh_frontend import ZHFrontend
from misaki.tone_sandhi import ToneSandhi

fe = ZHFrontend()  # loads large_pinyin, the custom phrases and the 地 override into pypinyin's globals
jieba.dt.initialize()
from pypinyin.constants import PINYIN_DICT, PHRASES_DICT, RE_HANS
from pypinyin.converter import UltimateConverter
from pypinyin import Style, lazy_pinyin

w = W()
w.b += b'KZH1'

# jieba dictionary: every word of dict.txt with its FREQ value and POS tag
FREQ = jieba.dt.FREQ
tagtab = psg.dt.word_tag_tab
for k, v in FREQ.items():
    if v:
        assert k in tagtab, k
tags = sorted(set(tagtab.values()))
assert len(tags) < 256
w.u64(jieba.dt.total)
w.u8(len(tags))
for t in tags:
    w.s(t)
tag_id = {t: i for i, t in enumerate(tags)}
words = sorted(tagtab)
w.u32(len(words))
for word in words:
    w.s(word)
    w.u32(FREQ.get(word, 0))
    w.u8(tag_id[tagtab[word]])

# finalseg HMM (jieba.cut with HMM=True)
for y in 'BMES':
    w.f64(fs.start_P[y])
for y0 in 'BMES':
    for y in 'BMES':
        w.f64(fs.trans_P[y0].get(y, -3.14e100))
for y in 'BMES':
    em = fs.emit_P[y]
    w.u32(len(em))
    for ch in sorted(em):
        w.u32(ord(ch))
        w.f64(em[ch])

# posseg HMM (jieba.posseg with HMM=True); states sorted like Python tuples so index order == tuple order
states = sorted(set(psg.trans_P) | set(psg.start_P) | set(psg.emit_P))
sid = {s: i for i, s in enumerate(states)}
w.u16(len(states))
for s in states:
    w.u8(ord(s[0]))
    w.s(s[1])
    w.u8(1 if s in psg.trans_P else 0)  # only states that are keys of trans_P are in all_states
for s in states:
    w.f64(psg.start_P.get(s, float('-inf')))
for s in states:
    tr = psg.trans_P.get(s, {})
    w.u16(len(tr))
    for y in sorted(tr):
        w.u16(sid[y])
        w.f64(tr[y])
for s in states:
    em = psg.emit_P.get(s, {})
    w.u32(len(em))
    for ch in sorted(em):
        w.u32(ord(ch))
        w.f64(em[ch])
cst = psg.char_state_tab_P
w.u32(len(cst))
for ch in sorted(cst):
    w.u32(ord(ch))
    lst = cst[ch]
    w.u16(len(lst))
    for s in lst:
        w.u16(sid[s])

# pypinyin: syllable table (raw first reading -> INITIALS / FINALS_TONE3 with neutral tone 5, strict)
conv = UltimateConverter(neutral_tone_with_five=True)
syl_index = {}
syls = []


def syl(py):
    if py not in syl_index:
        syl_index[py] = len(syls)
        syls.append((conv.convert_style('', py, Style.INITIALS, True),
                     conv.convert_style('', py, Style.FINALS_TONE3, True)))
    return syl_index[py]


# RE_HANS ranges
ranges = []
start = None
for cp in range(0x110000):
    ok = 0xD800 <= cp <= 0xDFFF and False or (not (0xD800 <= cp <= 0xDFFF) and RE_HANS.match(chr(cp)) is not None)
    if ok and start is None:
        start = cp
    elif not ok and start is not None:
        ranges.append((start, cp - 1))
        start = None
if start is not None:
    ranges.append((start, 0x10FFFF))

single = {}
for cp, v in PINYIN_DICT.items():
    single[cp] = syl(v.split(',')[0])


def default_reading(phrase):
    return [single.get(ord(c)) for c in phrase]


# Phrase table. A phrase whose first readings equal the per-character defaults only matters through the
# forward-max-match segmentation in pypinyin's mmseg; keep_all decides whether such phrases are kept.
keep_all = os.environ.get('KZH_KEEP_ALL_PHRASES') == '1'
phrases = {}
dropped = 0
for p, v in PHRASES_DICT.items():
    r = [syl(x[0]) for x in v]
    if not keep_all and len(r) == len(p) and r == default_reading(p):
        dropped += 1
        continue
    phrases[p] = r

# self-check of the dropped-phrase shortcut: simulate pypinyin's mmseg over every jieba word with and without
# the dropped phrases and compare the readings.
if not keep_all:
    full_prefix = set()
    for p in PHRASES_DICT:
        for i in range(len(p)):
            full_prefix.add(p[:i + 1])
    kept_prefix = set()
    for p in phrases:
        for i in range(len(p)):
            kept_prefix.add(p[:i + 1])

    def mm(text, prefix, table):
        out = []
        remain = text
        while remain:
            lv, li = '', 0
            for index in range(len(remain)):
                word = remain[:index + 1]
                if word in prefix:
                    if word in table:
                        lv, li = word, index + 1
                else:
                    if lv:
                        out.append(lv)
                        remain = remain[li:]
                    else:
                        out.append(remain[0])
                        remain = remain[1:]
                    break
            else:
                if lv:
                    out.append(lv)
                    remain = remain[li:]
                else:
                    if remain not in table:
                        out.extend(remain)
                    else:
                        out.append(remain)
                    break
        return out

    def read(text, prefix, table):
        r = []
        for seg in mm(text, prefix, table):
            if seg in table:
                r += table[seg] if isinstance(table[seg][0], int) else [syl(x[0]) for x in table[seg]]
            else:
                r += default_reading(seg)
        return r

    # Put back every phrase the full segmentation uses for a word whose reading changed, until no jieba
    # dictionary word reads differently from the full table.
    han_words = [x for x in words if all(RE_HANS.match(c) for c in x)]
    for rnd in range(10):
        bad = []
        for word in han_words:
            if read(word, full_prefix, PHRASES_DICT) != read(word, kept_prefix, phrases):
                bad.append(word)
        print('round', rnd, 'jieba words whose reading changes with dropped phrases:', len(bad))
        if not bad:
            break
        for word in bad:
            if rnd >= 2:  # the prefix chain itself differs: keep every phrase inside the word
                for i in range(len(word)):
                    for j in range(i + 2, len(word) + 1):
                        seg = word[i:j]
                        if seg in PHRASES_DICT and seg not in phrases:
                            phrases[seg] = [syl(x[0]) for x in PHRASES_DICT[seg]]
                            for k2 in range(len(seg)):
                                kept_prefix.add(seg[:k2 + 1])
            for seg in mm(word, full_prefix, PHRASES_DICT):
                if seg in PHRASES_DICT and seg not in phrases:
                    phrases[seg] = [syl(x[0]) for x in PHRASES_DICT[seg]]
                    for i in range(len(seg)):
                        kept_prefix.add(seg[:i + 1])

print('phrases kept', len(phrases), 'of', len(PHRASES_DICT))
w.u16(len(syls))
for a, b in syls:
    w.s(a)
    w.s(b)
w.u32(len(ranges))
for a, b in ranges:
    w.u32(a)
    w.u32(b)
w.u32(len(single))
for cp in sorted(single):
    w.u32(cp)
    w.u16(single[cp])
w.u32(len(phrases))
for p in sorted(phrases):
    w.s(p)
    r = phrases[p]
    w.u8(len(r))
    for x in r:
        w.u16(x)
# str.isnumeric ranges (misaki's merge_er / phone assembly test it)
num_ranges = []
for cp in range(0x110000):
    if chr(cp).isnumeric():
        if num_ranges and num_ranges[-1][1] == cp - 1:
            num_ranges[-1][1] = cp
        else:
            num_ranges.append([cp, cp])
w.u32(len(num_ranges))
for a, b in num_ranges:
    w.u32(a)
    w.u32(b)
open(f'{OUT}/zh.bin', 'wb').write(w.b)
print('zh.bin', len(w.b))

# sanity: syllable conversion agrees with lazy_pinyin
import random
random.seed(0)
cps = random.sample(sorted(single), 3000)
for cp in cps:
    c = chr(cp)
    if c in PHRASES_DICT:
        continue
    a = lazy_pinyin(c, style=Style.INITIALS, neutral_tone_with_five=True)
    b = lazy_pinyin(c, style=Style.FINALS_TONE3, neutral_tone_with_five=True)
    if RE_HANS.match(c):
        assert (a[0], b[0]) == syls[single[cp]], (c, a, b, syls[single[cp]])
print('syllables', len(syls), 'han ranges', len(ranges))

# word lists for lists.rs
ts = ToneSandhi()


def rs_list(name, items):
    body = ', '.join(json.dumps(x, ensure_ascii=False) for x in sorted(items))
    return f'pub const {name}: &[&str] = &[{body}];\n'


with open(f'{OUT}/lists.rs', 'w') as f:
    f.write('// Generated by plugins/voice/tools/kokoro_g2p/export_data.py from misaki 0.9.4 '
            '(tone_sandhi.py, zh_frontend.py). Apache-2.0, adapted from PaddleSpeech. Do not edit.\n')
    f.write(rs_list('MUST_NEURAL_TONE_WORDS', ts.must_neural_tone_words))
    f.write(rs_list('MUST_NOT_NEURAL_TONE_WORDS', ts.must_not_neural_tone_words))
    f.write(rs_list('MUST_ERHUA', fe.must_erhua))
    f.write(rs_list('NOT_ERHUA', fe.not_erhua))

# ---------------------------------------------------------------- en
from misaki import data as mdata

w = W()
w.b += b'KEN1'
for name in ('us_gold.json', 'us_silver.json'):
    with importlib.resources.open_text(mdata, name) as r:
        d = json.load(r)
    w.u32(len(d))
    for k in sorted(d):
        v = d[k]
        w.s(k)
        if isinstance(v, str):
            w.u8(0)
            w.s(v)
        else:
            w.u8(len(v))
            for t in sorted(v):
                w.s(t)
                if v[t] is None:
                    w.u8(0)
                else:
                    w.u8(1)
                    w.s(v[t])
open(f'{OUT}/en.bin', 'wb').write(w.b)
print('en.bin', len(w.b))

# cn2an unit list length check
from cn2an.conf import UNIT_LOW_ORDER_AN2CN
print('an2cn unit list', len(UNIT_LOW_ORDER_AN2CN), UNIT_LOW_ORDER_AN2CN)
print('jieba re_han_default', jieba.re_han_default.pattern, 'skip', jieba.re_skip_default.pattern)
print('finalseg', fs.re_skip.pattern if hasattr(fs, 're_skip') else '?')
