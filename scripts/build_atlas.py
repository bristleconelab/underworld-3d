"""Atlas of the Underworld slab catalogue -> public/data/slabs.json.

Source: van der Meer, D.G., van Hinsbergen, D.J.J., Spakman, W. (2018) Atlas of the underworld: slab remnants in the
mantle, their sinking history, and a new outlook on lower mantle viscosity. Tectonophysics 723, 309-448,
https://doi.org/10.1016/j.tecto.2017.10.004 (CC BY 4.0). Table as updated on www.atlas-of-the-underworld.org
(Atlas_of_the_Underworld_data.xlsx, 2019 update).

Only the catalogue (names, positions, depths, ages, sinking rates) is used; no tomography images.

usage: uv run --with openpyxl python scripts/build_atlas.py [path/to/Atlas_of_the_Underworld_data.xlsx]
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

import openpyxl

URL = "http://www.atlas-of-the-underworld.org/wp-content/uploads/2019/04/Atlas_of_the_Underworld_data.xlsx"
OUT = Path("public/data/slabs.json")
# columns of the sheet (row 4 holds the sub-headers)
COLS = ["nr", "name", "abbr", "updated", "mid_depth", "mid_lon", "mid_lat", "geo_lon", "geo_lat",
        "base_depth", "base_err", "top_depth", "top_err", "base_age_max", "base_age_min", "top_age_min",
        "top_age_max", "base_rate", "base_rate_err", "top_rate", "top_rate_err"]


def nice_name(s: str) -> str:
    """'AlJawf' -> 'Al Jawf', 'Aeg-WestAnatolia' -> 'Aegean-West Anatolia' stays readable; keep hyphens."""
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s.strip())
    s = s.replace("Aeg-", "Aegean-")
    return {"Juande Fuca": "Juan de Fuca"}.get(s, s)


# a few ages are given as periods; ICS International Chronostratigraphic Chart v2023/09 boundaries (Ma)
PERIODS = {"Triassic": (201.4, 251.9), "Lower_Cretaceous": (100.5, 145.0)}


def num(v, end: int | None = None):
    """Number, or for a period name its young (end=0) or old (end=1) boundary."""
    if v is None or v == "":
        return None
    if isinstance(v, str) and v in PERIODS:
        return PERIODS[v][end if end is not None else 0]
    return round(float(v), 2)


def pair(a, b):
    """Two numbers, or None when the source has none: 9999 there means "not estimated" (Maldives has no ages and
    no surface record)."""
    return None if a is None or b is None or a >= 9999 or b >= 9999 else [a, b]


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data-raw/Atlas_of_the_Underworld_data.xlsx")
    if not src.exists():
        src.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, src)
    ws = openpyxl.load_workbook(src, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    if rows[3][0] != "Nr" or rows[3][1] != "Slab Name":
        raise SystemExit(f"unexpected header row: {rows[3][:6]}")
    slabs = []
    for r in rows[4:]:
        if not r[0] or not r[1]:
            continue
        d = dict(zip(COLS, r[: len(COLS)]))
        slab = {
            "name": nice_name(str(d["name"])),
            "abbr": str(d["abbr"]),
            "mid": [num(d["mid_lon"]), num(d["mid_lat"]), num(d["mid_depth"])],
            "surface": pair(num(d["geo_lon"]), num(d["geo_lat"])),
            "top": [num(d["top_depth"]), num(d["top_err"])],
            "base": [num(d["base_depth"]), num(d["base_err"])],
            # Ma: when the deepest part went down (base) and when the shallowest part went down (top; 0 = still going)
            "ageBase": pair(num(d["base_age_min"], 0), num(d["base_age_max"], 1)),
            "ageTop": pair(num(d["top_age_min"], 0), num(d["top_age_max"], 1)),
            # average sinking rate, mm/yr; 9999 in the source = not estimated
            "rate": [None if (x := num(d[k])) is None or x >= 9999 else x for k in ("base_rate", "top_rate")],
        }
        periods = sorted({str(d[k]) for k in ("base_age_min", "base_age_max", "top_age_min", "top_age_max") if isinstance(d[k], str)})
        if periods:
            slab["ageNote"] = "ages given as " + " and ".join(p.replace("_", " ") for p in periods) + " in the source"
        if None in slab["mid"] or None in slab["base"][:1]:
            continue
        slabs.append(slab)
    if len(slabs) < 90:
        raise SystemExit(f"only {len(slabs)} slabs parsed, expected about 110")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "van der Meer, van Hinsbergen & Spakman (2018) Atlas of the underworld, Tectonophysics 723, "
                  "doi:10.1016/j.tecto.2017.10.004 (CC BY 4.0); table update 2019, www.atlas-of-the-underworld.org",
        "slabs": slabs,
    }, separators=(",", ":")))
    print(f"{len(slabs)} slabs -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
