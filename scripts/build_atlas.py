"""Atlas of the Underworld slab catalogue -> public/data/slabs.json.

Source: van der Meer, D.G., van Hinsbergen, D.J.J., Spakman, W. (2018) Atlas of the underworld: slab remnants in the
mantle, their sinking history, and a new outlook on lower mantle viscosity. Tectonophysics 723, 309-448,
https://doi.org/10.1016/j.tecto.2017.10.004 (CC BY 4.0). Table as updated on www.atlas-of-the-underworld.org
(Atlas_of_the_Underworld_data.xlsx, 2019 update). Only the catalogue is used; no tomography images.

Column layout (row 4 of the sheet): Nr, Slab Name, Abbreviation, Latest update, midpoint Depth/Lon/Lat, geological
record Lon/Lat, Base Depth/Error, Top Depth/Error, Base age "Max"/"Min", Top age "Min"/"Max", Base Rate/Error,
Top Rate/Error. In every numeric row the first age column of each pair holds the OLDER value (India: base 140/120,
top 50/35), whatever the header says; all age ranges are therefore stored as [young, old] Ma after sorting.

Conventions in the output:
- 9999 anywhere means "not estimated" in the source and becomes null (Maldives: surface record, ages, rates).
- Ages given as a geological period (three Telkhinia slabs) become that period's ICS 2023/09 span [young, old].
- A rate of 0 with no corresponding age is the table's blank, not a measured zero, and becomes null.
- base rate = base depth / mean base age (checked here, listed in rateCheck when the table disagrees by > 5 %).
- top rate of a slab whose top is still at the surface (0 km, 0 Ma) cannot be depth / age; the table gives it without
  derivation and it is flagged topRateNote.

usage: uv run --with openpyxl python scripts/build_atlas.py [path/to/Atlas_of_the_Underworld_data.xlsx]
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

URL = "http://www.atlas-of-the-underworld.org/wp-content/uploads/2019/04/Atlas_of_the_Underworld_data.xlsx"
OUT = Path("public/data/slabs.json")
COLS = ["nr", "name", "abbr", "updated", "mid_depth", "mid_lon", "mid_lat", "geo_lon", "geo_lat",
        "base_depth", "base_err", "top_depth", "top_err", "base_age_a", "base_age_b", "top_age_a",
        "top_age_b", "base_rate", "base_rate_err", "top_rate", "top_rate_err"]
SENTINEL = 9999
# ICS International Chronostratigraphic Chart v2023/09 boundaries (Ma): [young, old]
PERIODS = {"Triassic": (201.4, 251.9), "Lower_Cretaceous": (100.5, 145.0)}


def nice_name(s: str) -> str:
    """'AlJawf' -> 'Al Jawf', 'Aeg-WestAnatolia' -> 'Aegean-West Anatolia'."""
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s.strip())
    s = s.replace("Aeg-", "Aegean-")
    return {"Juande Fuca": "Juan de Fuca", "North Appenines": "North Apennines"}.get(s, s)


def num(v) -> float | None:
    """A number, None for blanks and for the 9999 sentinel."""
    if v is None or v == "" or isinstance(v, str):
        return None
    x = float(v)
    return None if x >= SENTINEL else round(x, 3)


def age_range(a, b) -> tuple[list[float] | None, str | None]:
    """Two age cells -> sorted [young, old] Ma, or a period name -> its ICS span."""
    if isinstance(a, str) or isinstance(b, str):
        names = {x for x in (a, b) if isinstance(x, str)}
        if len(names) != 1 or not all(isinstance(x, str) for x in (a, b)) or a not in PERIODS:
            raise SystemExit(f"unexpected age cells {a!r} {b!r}")
        return list(PERIODS[a]), a.replace("_", " ")
    x, y = num(a), num(b)
    if x is None or y is None:
        return None, None
    return sorted([x, y]), None


def ll(lon, lat) -> list[float] | None:
    lo, la = num(lon), num(lat)
    if lo is None or la is None:
        return None
    if not (-180 <= lo <= 180 and -90 <= la <= 90):
        raise SystemExit(f"coordinate out of range: {lon}, {lat}")
    return [lo, la]


def main() -> None:
    import openpyxl  # only needed to read the sheet; the helpers above are tested without it

    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data-raw/Atlas_of_the_Underworld_data.xlsx")
    if not src.exists():
        src.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, src)
    ws = openpyxl.load_workbook(src, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    if rows[3][0] != "Nr" or rows[3][1] != "Slab Name" or rows[3][13:17] != ("Max", "Min", "Min", "Max"):
        raise SystemExit(f"unexpected header row: {rows[3][:17]}")
    slabs, checks = [], []
    for r in rows[4:]:
        if not r[0] or not r[1]:
            continue
        d = dict(zip(COLS, r[: len(COLS)]))
        mid = ll(d["mid_lon"], d["mid_lat"])
        if mid is None or num(d["mid_depth"]) is None or num(d["base_depth"]) is None:
            raise SystemExit(f"slab {d['abbr']}: no midpoint or base depth")
        age_base, pb = age_range(d["base_age_a"], d["base_age_b"])
        age_top, pt = age_range(d["top_age_a"], d["top_age_b"])
        top = [num(d["top_depth"]), num(d["top_err"])]
        base = [num(d["base_depth"]), num(d["base_err"])]

        def rate(v, e, age):
            x = num(v)
            if x is None or age is None or (x == 0 and (num(e) or 0) == 0):
                return None
            return [round(x, 2), round(num(e) or 0, 2)]

        slab = {
            "nr": int(d["nr"]),
            "name": nice_name(str(d["name"])),
            "abbr": str(d["abbr"]),
            "updated": d["updated"].date().isoformat() if isinstance(d["updated"], dt.datetime) else None,
            "mid": [mid[0], mid[1], num(d["mid_depth"])],
            "surface": ll(d["geo_lon"], d["geo_lat"]),
            "top": top,
            "base": base,
            "ageBase": age_base,   # [young, old] Ma: onset of subduction (now at the slab base)
            "ageTop": age_top,     # [young, old] Ma: end of subduction / break-off (0 = still subducting)
            "rateBase": rate(d["base_rate"], d["base_rate_err"], age_base),  # [mm/yr, 1 sigma]
            "rateTop": rate(d["top_rate"], d["top_rate_err"], age_top),
        }
        periods = sorted({p for p in (pb, pt) if p})
        if periods:
            slab["ageNote"] = "ages given as " + " and ".join(periods) + " in the source (ICS 2023/09 span used)"
        active = top[0] == 0 and age_top is not None and age_top[0] == 0
        if active and slab["rateTop"]:
            slab["topRateNote"] = "top at 0 km and 0 Ma: the table's top rate is not depth/age (no derivation given)"
        if slab["rateBase"] and age_base:
            implied = base[0] / (sum(age_base) / 2)
            if abs(implied - slab["rateBase"][0]) / implied > 0.05:
                checks.append({"abbr": slab["abbr"], "field": "rateBase", "table": slab["rateBase"][0], "depthOverMeanAge": round(implied, 2)})
        if slab["rateTop"] and age_top and not active and top[0]:
            implied = top[0] / (sum(age_top) / 2)
            if abs(implied - slab["rateTop"][0]) / implied > 0.05:
                checks.append({"abbr": slab["abbr"], "field": "rateTop", "table": slab["rateTop"][0], "depthOverMeanAge": round(implied, 2)})
        slabs.append(slab)
    if len(slabs) != 100:
        raise SystemExit(f"{len(slabs)} slabs parsed, expected 100")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "van der Meer, van Hinsbergen & Spakman (2018) Atlas of the underworld, Tectonophysics 723, 309-448, "
                  "doi:10.1016/j.tecto.2017.10.004 (CC BY 4.0); table update 2019, www.atlas-of-the-underworld.org",
        "sourceSha256": hashlib.sha256(src.read_bytes()).hexdigest(),
        "units": {"mid": "lon deg, lat deg, depth km", "top/base": "depth km, error km", "ageBase/ageTop": "[young, old] Ma",
                  "rateBase/rateTop": "[mm/yr, 1 sigma mm/yr]"},
        "rateCheck": checks,
        "slabs": slabs,
    }, separators=(",", ":")))
    print(f"{len(slabs)} slabs -> {OUT} ({OUT.stat().st_size // 1024} KB); {len(checks)} rate(s) differ >5% from depth/mean age: "
          + ", ".join(f"{c['abbr']}.{c['field']} {c['table']} vs {c['depthOverMeanAge']}" for c in checks))


if __name__ == "__main__":
    main()
