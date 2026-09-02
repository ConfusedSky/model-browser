#!/usr/bin/env python3
"""Probe directory-mtime behavior on a filesystem — listing-tree-cache task 1.1.

The tree cache's D4 revalidates by directory mtime: one stat per directory,
re-reading only directories whose mtime moved. That is sound only where the
mtime (a) moves on add/remove/rename of direct entries, (b) does NOT move on
content edits or deeper changes (so a move is a *name* change signal), and
(c) has a granularity coarse-grained enough to name — two changes inside one
granule after a stat are invisible, which is the hazard D4's fallback exists
for. exFAT's on-disk format stores 10ms timestamps but drivers vary; measure,
never assume.

Usage: python3 scripts/probe-dir-mtime.py <directory-on-target-volume>
Creates and removes a `.mtime-probe-<pid>` scratch tree under the target; the
target's own entries are never touched. Run it against the real library volume
(`/run/media/masa/Files and S`) and record the table beside task 1.1.
"""
import os
import shutil
import sys
import time


def mtime_ns(p: str) -> int:
    return os.stat(p).st_mtime_ns


def run(target: str) -> None:
    base = os.path.join(target, f".mtime-probe-{os.getpid()}")
    os.mkdir(base)
    results: list[tuple[str, bool, str]] = []

    def probe(name: str, setup, op, subject: str, expect_move: bool) -> None:
        d = os.path.join(base, name.replace(" ", "-"))
        os.mkdir(d)
        setup(d)
        # Settle past any granularity so a non-move is a fact, not a granule.
        time.sleep(2.1)
        before = mtime_ns(os.path.join(d, subject) if subject else d)
        op(d)
        after = mtime_ns(os.path.join(d, subject) if subject else d)
        moved = after != before
        ok = moved == expect_move
        results.append((
            name,
            ok,
            f"{'moved' if moved else 'did not move'} "
            f"(expected {'move' if expect_move else 'no move'}); "
            f"before={before} after={after}",
        ))

    def touch(d: str, n: str) -> None:
        with open(os.path.join(d, n), "w") as f:
            f.write("x")

    probe("add file", lambda d: None, lambda d: touch(d, "a.stl"), "", True)
    probe("remove file", lambda d: touch(d, "a.stl"),
          lambda d: os.unlink(os.path.join(d, "a.stl")), "", True)
    probe("rename file", lambda d: touch(d, "a.stl"),
          lambda d: os.rename(os.path.join(d, "a.stl"), os.path.join(d, "b.stl")), "", True)
    probe("add subdir", lambda d: None,
          lambda d: os.mkdir(os.path.join(d, "sub")), "", True)
    probe("remove subdir", lambda d: os.mkdir(os.path.join(d, "sub")),
          lambda d: os.rmdir(os.path.join(d, "sub")), "", True)
    probe("rename subdir", lambda d: os.mkdir(os.path.join(d, "sub")),
          lambda d: os.rename(os.path.join(d, "sub"), os.path.join(d, "bus")), "", True)
    # The two silences D4 equally relies on:
    probe("content edit does not move parent", lambda d: touch(d, "a.stl"),
          lambda d: touch(d, "a.stl"), "", False)
    probe("deep change does not move grandparent",
          lambda d: os.makedirs(os.path.join(d, "kid")),
          lambda d: touch(os.path.join(d, "kid"), "a.stl"), "", False)

    # Granularity: rapid adds, watch the distinct mtime values step.
    g = os.path.join(base, "granularity")
    os.mkdir(g)
    seen: list[int] = []
    t0 = time.time()
    i = 0
    while time.time() - t0 < 4.5:
        touch(g, f"f{i}")
        m = mtime_ns(g)
        if not seen or seen[-1] != m:
            seen.append(m)
        i += 1
        time.sleep(0.05)
    deltas = [(b - a) / 1e6 for a, b in zip(seen, seen[1:])]
    frac = sorted({m % 1_000_000_000 for m in seen})

    print(f"target: {target}")
    for name, ok, detail in results:
        print(f"  [{'OK' if ok else '!!'}] {name}: {detail}")
    print(f"  granularity: {len(seen)} distinct mtimes over ~4.5s of ~90 adds")
    print(f"    steps (ms): {[round(d) for d in deltas]}")
    print(f"    sub-second parts (ns): {frac[:6]}{'…' if len(frac) > 6 else ''}")
    print(f"  remount check: note {base!r} and its mtimes, remount, re-stat by hand")
    print(f"  probe tree left for the remount half: {base}")
    print(f"  (delete with: rm -rf {base!r})")


if __name__ == "__main__":
    run(sys.argv[1])
