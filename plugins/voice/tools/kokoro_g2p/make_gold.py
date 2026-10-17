"""Generate the golden phonemes for the Rust Kokoro G2P tests with Python misaki 0.9.4.

Usage: python -I make_gold.py corpus.txt OUT.json [manifest.json]
Runs KPipeline (model=False) exactly as Kokoro feeds the model: lang 'z' with an en_callable built on the
lang 'a' pipeline, and lang 'a' for lines prefixed "a|". The espeak fallback is switched off on purpose:
out-of-lexicon English words come out empty, which is what the Rust frontend does too.
"""
import json
import os
import sys
import warnings

warnings.filterwarnings('ignore')
os.environ['HF_HUB_OFFLINE'] = '1'
for k in ('ALL_PROXY', 'all_proxy'):
    os.environ.pop(k, None)

from kokoro import KPipeline
from misaki import espeak


def _no_espeak(*args, **kwargs):
    raise RuntimeError('espeak disabled for the golden set')


# KPipeline('a') builds an espeak fallback when it can; the golden set must not use espeak at all.
espeak.EspeakFallback = _no_espeak

REPO = 'hexgrad/Kokoro-82M-v1.1-zh'
en = KPipeline(lang_code='a', repo_id=REPO, model=False)
en.g2p.fallback = None


def run(pipe, text):
    return [r.phonemes for r in pipe(text)]


def en_callable(text):
    ps = run(en, text)
    return ps[0] if ps else ''


zh = KPipeline(lang_code='z', repo_id=REPO, model=False, en_callable=en_callable)

items = []
for line in open(sys.argv[1], encoding='utf-8'):
    line = line.rstrip('\n')
    if not line.strip() or line.startswith('#'):
        continue
    if line.startswith('a|'):
        lang, text = 'a', line[2:]
    else:
        lang, text = 'z', line
    items.append({'lang': lang, 'text': text, 'phonemes': run(en if lang == 'a' else zh, text)})

json.dump(items, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('sentences', len(items))

if len(sys.argv) > 3:
    man = json.load(open(sys.argv[3], encoding='utf-8'))
    by_text = {x['text']: x for x in items}
    for m in man['items']:
        g = by_text.get(m['text'])
        got = ' '.join(g['phonemes']) if g else None
        if got != m['phonemes']:
            print('manifest differs:', m['text'])
            print('   manifest', m['phonemes'])
            print('   gold    ', got)
