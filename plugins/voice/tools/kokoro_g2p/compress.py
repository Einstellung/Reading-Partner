# Brotli-compress the exported tables for include_bytes!. Usage: python3 compress.py <raw dir> <data dir>
import sys

import brotli

src, dst = sys.argv[1], sys.argv[2]
for name in ['zh', 'en']:
    raw = open(f'{src}/{name}.bin', 'rb').read()
    packed = brotli.compress(raw, quality=11, lgwin=24)
    open(f'{dst}/{name}.bin.br', 'wb').write(packed)
    print(name, len(raw), '->', len(packed))
