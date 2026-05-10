#!/usr/bin/env python3
"""
Flip exactly one byte in a disk image (or any binary file) for hash/integrity testing.

Typical use: verify that Autopsy Case Data Extract "Image Integrity" (SHA-256 vs report/DB)
flags TAMPERED after a minimal change.

Notes:
- For raw (.dd / .img) images, physical file hash matches logical content for this test.
- For E01 and other containers, prefer testing against the reference the UI actually uses
  (see project wiki: container byte hash may differ from logical hash).

Safe default: writes a new file; original is not modified unless --in-place is used.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

_HASH_CHUNK = 8 * 1024 * 1024


def sha256_hex(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(_HASH_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def parse_offset(s: str, file_size: int) -> int:
    s = s.strip().lower()
    if s in ("mid", "middle", "center"):
        return max(0, file_size // 2)
    if s.startswith("0x"):
        return int(s, 16)
    return int(s, 10)


def transform_byte(orig: int, mode: str, set_value: int | None) -> int:
    if mode == "xor_ff":
        return orig ^ 0xFF
    if mode == "xor_01":
        return orig ^ 0x01
    if mode == "inc":
        return (orig + 1) & 0xFF
    if mode == "set":
        if set_value is None:
            raise SystemExit("--byte is required for mode set.")
        return set_value & 0xFF
    raise SystemExit(f"Unknown mode: {mode}")


def apply_one_byte_copy(
    src: Path,
    dst: Path,
    offset: int,
    mode: str,
    set_value: int | None,
) -> tuple[int, int]:
    size = src.stat().st_size
    if size == 0:
        raise SystemExit("Source file is empty; nothing to modify.")
    if offset < 0 or offset >= size:
        raise SystemExit(f"Offset {offset} out of range for file size {size} bytes.")
    if dst.resolve() == src.resolve():
        raise SystemExit("Source and destination are the same path; use --in-place explicitly.")

    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

    with dst.open("r+b") as f:
        f.seek(offset)
        b = f.read(1)
        if len(b) != 1:
            raise SystemExit("Read failed at offset.")
        orig = b[0]
        new_b = transform_byte(orig, mode, set_value)
        f.seek(offset)
        f.write(bytes((new_b,)))
    return orig, new_b


def apply_one_byte_inplace(
    path: Path,
    offset: int,
    mode: str,
    set_value: int | None,
) -> tuple[int, int]:
    size = path.stat().st_size
    if size == 0:
        raise SystemExit("Source file is empty; nothing to modify.")
    if offset < 0 or offset >= size:
        raise SystemExit(f"Offset {offset} out of range for file size {size} bytes.")

    with path.open("r+b") as f:
        f.seek(offset)
        b = f.read(1)
        if len(b) != 1:
            raise SystemExit("Read failed at offset.")
        orig = b[0]
        new_b = transform_byte(orig, mode, set_value)
        f.seek(offset)
        f.write(bytes((new_b,)))
    return orig, new_b


def main() -> None:
    p = argparse.ArgumentParser(
        description="Write a copy of an image with exactly one byte changed (integrity test)."
    )
    p.add_argument("image", type=Path, help="Path to source image/binary file.")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path (default: <stem>.one-byte-tamper<suffix> next to source).",
    )
    p.add_argument(
        "--offset",
        default="mid",
        help='Byte offset (decimal or 0x hex), or "mid" for middle of file (default: mid).',
    )
    p.add_argument(
        "--mode",
        choices=("xor_ff", "xor_01", "inc", "set"),
        default="xor_ff",
        help="How to change the byte: xor_ff (flip all bits, default), xor_01, inc, or set.",
    )
    p.add_argument(
        "--byte",
        type=lambda x: int(x, 0),
        default=None,
        help="With --mode set: new byte value (e.g. 0x00 or 255).",
    )
    p.add_argument(
        "--in-place",
        action="store_true",
        help="Modify the source file directly (dangerous). Implies no separate output file.",
    )
    p.add_argument(
        "--backup",
        action="store_true",
        help="With --in-place, copy source to <path>.bak before modifying.",
    )
    args = p.parse_args()

    src = args.image
    if not src.is_file():
        raise SystemExit(f"Not a file: {src}")

    size = src.stat().st_size
    offset = parse_offset(str(args.offset), size)

    sha_before = sha256_hex(src)

    if args.in_place:
        if args.output is not None:
            raise SystemExit("Do not use --output with --in-place.")
        if args.backup:
            bak = src.with_suffix(src.suffix + ".bak")
            if bak.exists():
                raise SystemExit(f"Backup already exists: {bak}")
            shutil.copy2(src, bak)
        orig, new_b = apply_one_byte_inplace(src, offset, args.mode, args.byte)
        out = src
    else:
        out = args.output
        if out is None:
            out = src.with_name(f"{src.stem}.one-byte-tamper{src.suffix}")
        orig, new_b = apply_one_byte_copy(src, out, offset, args.mode, args.byte)

    sha_after = sha256_hex(out)

    print(f"Source: {src}")
    print(f"Output: {out}")
    print(f"Size:   {size} bytes")
    print(f"Offset: {offset} (0x{offset:X})")
    print(f"Mode:   {args.mode}")
    print(f"Byte:   0x{orig:02X} -> 0x{new_b:02X}")
    print(f"SHA-256 (original): {sha_before}")
    print(f"SHA-256 (tampered): {sha_after}")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        sys.exit(0)
