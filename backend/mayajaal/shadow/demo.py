"""Eyeball a shadow world:  uv run python -m mayajaal.shadow.demo <session> [--static]"""

from __future__ import annotations

import sys
from datetime import datetime

from mayajaal.shadow.registry import shadow_key
from mayajaal.shadow.world import ShadowWorld


def _ls_la(w: ShadowWorld, path: str) -> str:
    st = w.stat(path)
    lines = [f"total {sum((w.stat(path + '/' + c).size or 0) for c in st.children) // 1024}"]
    entries = [(".", st), ("..", w.stat(path.rsplit("/", 1)[0] or "/"))]
    entries += [(c, w.stat(f"{path}/{c}")) for c in st.children]
    for name, n in entries:
        mt = datetime.fromisoformat(n.mtime)
        size = n.size
        human = f"{size / 1_048_576:.0f}M" if size > 1_048_576 else (f"{size / 1024:.0f}K" if size > 1024 else str(size))
        lines.append(f"{n.mode} 1 {n.owner:<6} {n.group:<6} {human:>5} {mt:%b %d %H:%M} {name}")
    return "\n".join(lines)


def main(argv: list[str]) -> None:
    session = argv[0] if argv else "demo-session"
    static = "--static" in argv
    w = ShadowWorld(session, key=shadow_key(), static=static)
    print(f"== {w!r}  (hostname {w.hostname()})\n")

    p = w.list_patients("eas", 0, 1)[0]
    print("== sample patient")
    for k, v in vars(p).items():
        print(f"  {k:<12} {v}")
    print("\n== labs")
    for o in w.observations(p.mrn):
        print(f"  {o.issued}  {o.code:<8} {o.display:<30} {o.value:>8g} {o.unit:<14} ({o.ref_range})  "
              f"{o.performer_hospital}  {o.obs_id}")

    print("\n== n.okafor@jump-eas:~$ ls -la /mnt/backups")
    print(_ls_la(w, "/mnt/backups"))

    print(f"\n== zcat {w.latest_dump} | head -15")
    print("\n".join(w.read_file(w.latest_dump).splitlines()[:15]))

    print("\n== honeytokens")
    for t in w.honeytokens.values():
        print(f"  {t.token_id:<24} {t.kind:<10} {t.placed_at:<52} {t.value[:60]}")
    print(f"  touched: {sorted(w.touched_honeytokens)}")


if __name__ == "__main__":
    main(sys.argv[1:])
