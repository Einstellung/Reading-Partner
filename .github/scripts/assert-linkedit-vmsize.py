#!/usr/bin/env python3
"""Assert a Mach-O's __LINKEDIT segment has vmsize >= filesize.

A fully unsigned iOS Mach-O crashes on a real device once a free-signing tool
(Sideloadly, Dadoum Sideloader) re-signs it: those tools append an
LC_CODE_SIGNATURE and grow __LINKEDIT's filesize without growing its vmsize, so
dyld aborts at launch with "segment __LINKEDIT filesize exceeds vmsize". Ad-hoc
signing in CI leaves a page-aligned __LINKEDIT (vmsize >= filesize); this guard
fails the build if that invariant is ever violated. See
docs/pitfall/35-ios-unsigned-linkedit-vmsize.md.

Handles a thin little-endian arm64 Mach-O (MH_MAGIC_64), which is what
`tauri ios build --target aarch64` emits. Exits non-zero on any problem.
"""
import struct
import sys

LC_SEGMENT_64 = 0x19
MH_MAGIC_64 = 0xFEEDFACF


def main(path: str) -> int:
    data = open(path, "rb").read()
    magic = struct.unpack_from("<I", data, 0)[0]
    if magic != MH_MAGIC_64:
        print(f"::error::unexpected Mach-O magic {magic:#x} (expected thin MH_MAGIC_64)")
        return 1
    ncmds = struct.unpack_from("<I", data, 16)[0]
    off = 32  # sizeof(mach_header_64)
    for _ in range(ncmds):
        cmd, cmdsize = struct.unpack_from("<II", data, off)
        if cmd == LC_SEGMENT_64:
            segname = data[off + 8 : off + 24].split(b"\x00")[0].decode()
            vmaddr, vmsize, fileoff, filesize = struct.unpack_from("<QQQQ", data, off + 24)
            if segname == "__LINKEDIT":
                print(f"__LINKEDIT vmsize={vmsize} filesize={filesize}")
                if filesize > vmsize:
                    print("::error::__LINKEDIT filesize exceeds vmsize (re-signing will crash on device)")
                    return 1
                print("__LINKEDIT ok: vmsize >= filesize")
                return 0
        off += cmdsize
    print("::error::__LINKEDIT segment not found")
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: assert-linkedit-vmsize.py <mach-o binary>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
