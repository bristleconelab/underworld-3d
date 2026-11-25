"""Slab2 depth grids -> public/data/plates/: one triangle mesh per subduction zone, on the unit sphere.

Source: Hayes, G., 2018, Slab2 - A Comprehensive Subduction Zone Geometry Model: U.S. Geological Survey data release,
https://doi.org/10.5066/F7PV6JNV (public domain / CC0). The *_dep_*.grd files (GMT netCDF-4: x = lon 0..360,
y = lat, z = depth in km, negative down, NaN outside the slab) arrive as data-raw/slab2_bundle.json (base64), collected
in the browser because ScienceBase answers scripts with a bot check.

Per zone file (little-endian): float32 xyz * nv, float32 depth_km * nv, uint32 triangle indices * nt*3.
Grids are thinned to about STEP degrees; a cell becomes two triangles when all four corners are inside the slab.

usage: uv run --with h5py --with numpy python scripts/build_slab2.py [data-raw/slab2_bundle.json]
"""
from __future__ import annotations

import base64
import io
import json
import math
import sys
from pathlib import Path

import h5py
import numpy as np

STEP = 0.2  # degrees
OUT = Path("public/data/plates")
R_KM = 6371.0


def mesh(lon: np.ndarray, lat: np.ndarray, dep: np.ndarray):
    """lon/lat 1-D, dep 2-D [lat, lon] (km, positive down, NaN outside)."""
    ok = np.isfinite(dep)
    ids = -np.ones(dep.shape, dtype=np.int64)
    ids[ok] = np.arange(ok.sum())
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    d = dep[ok]
    r = 1 - d / R_KM
    phi, lam = np.radians(la[ok]), np.radians(lo[ok])
    # same convention as src/earth.ts toXYZ: lon 0 on +z, lon 90 E on +x, north on +y
    xyz = np.stack([r * np.cos(phi) * np.sin(lam), r * np.sin(phi), r * np.cos(phi) * np.cos(lam)], axis=1).astype("<f4")
    a, b, c, e = ids[:-1, :-1], ids[:-1, 1:], ids[1:, :-1], ids[1:, 1:]
    full = (a >= 0) & (b >= 0) & (c >= 0) & (e >= 0)
    tris = np.concatenate([np.stack([a[full], c[full], b[full]], 1), np.stack([b[full], c[full], e[full]], 1)]).astype("<u4")
    return xyz, d.astype("<f4"), tris


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data-raw/slab2_bundle.json")
    bundle = json.loads(src.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.bin"):
        f.unlink()
    zones, skipped = [], []
    for z in bundle["zones"]:
        dep = next((v for k, v in z["files"].items() if "_dep_" in k and k.endswith(".grd")), None)
        if not dep:
            skipped.append(z["title"])
            continue
        with h5py.File(io.BytesIO(base64.b64decode(dep["b64"])), "r") as h:
            x, y, zz = np.asarray(h["x"]), np.asarray(h["y"]), np.asarray(h["z"], dtype="f8")
        dx = abs(float(x[1] - x[0]))
        k = max(1, round(STEP / dx))
        x, y, zz = x[::k], y[::k], zz[::k, ::k]
        lon = np.where(x > 180, x - 360, x)
        depth = -zz  # Slab2 stores depth as negative km
        xyz, d, tris = mesh(lon, y, depth)
        if len(tris) == 0:
            skipped.append(z["title"])
            continue
        name = z["title"].replace(" Region", "")
        fname = name.lower().replace(" ", "-").replace("/", "-") + ".bin"
        (OUT / fname).write_bytes(xyz.tobytes() + d.tobytes() + tris.tobytes())
        zones.append({"name": name, "file": fname, "nv": int(len(d)), "nt": int(len(tris)), "maxDepthKm": round(float(np.nanmax(d)))})
    zones.sort(key=lambda z: z["name"])
    (OUT / "index.json").write_text(json.dumps({"source": bundle["source"], "stepDeg": STEP, "zones": zones}, indent=0))
    size = sum(f.stat().st_size for f in OUT.glob("*.bin"))
    print(f"{len(zones)} zones, {sum(z['nt'] for z in zones):,} triangles, {size // 1024} KB -> {OUT}; skipped: {skipped or 'none'}")
    if len(zones) < 20:
        raise SystemExit("fewer than 20 zones: check the bundle")


if __name__ == "__main__":
    main()
