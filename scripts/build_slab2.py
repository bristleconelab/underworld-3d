"""Slab2 depth grids -> public/data/plates/: one triangle mesh per subduction zone, on the unit sphere.

Source: Hayes, G., 2018, Slab2 - A Comprehensive Subduction Zone Geometry Model: U.S. Geological Survey data release,
https://doi.org/10.5066/F7PV6JNV (public domain / CC0). The *_dep_*.grd files (GMT netCDF-4: x = lon 0..360,
y = lat, z = depth in km, negative down, NaN outside the slab) arrive as data-raw/slab2_bundle.json (base64), collected
in the browser because ScienceBase answers scripts with a bot check. Only the dep grids are in the bundle; Slab2's
dip/str/thk/unc grids are not, so dip and down-dip azimuth are computed here from the depth gradient (the same
definition Slab2 uses) and thickness/uncertainty are not shown.

Per zone file (little-endian): float32 xyz * nv, float32 depth_km * nv, float32 dip_deg * nv, float32 dipAz_deg * nv
(direction of increasing depth, clockwise from north; strike = dipAz - 90), uint32 triangle indices * nt*3.
Grids are thinned to about STEP degrees. A cell becomes two triangles when all four corners are inside the slab and
one triangle when three are, so the edges follow the slab outline instead of a staircase.

index.json also lists, for each Atlas slab whose top reaches the upper mantle (< 660 km), the nearest Slab2 zone
within MATCH_KM of its midpoint or surface record and the mean down-dip azimuth there (used to cut the section
along dip).

usage: uv run --with h5py --with numpy python scripts/build_slab2.py [data-raw/slab2_bundle.json]
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
from pathlib import Path

import h5py
import numpy as np

STEP = 0.2  # degrees
MATCH_KM = 400.0
OUT = Path("public/data/plates")
R_KM = 6371.0


def gradient(lon: np.ndarray, lat: np.ndarray, dep: np.ndarray):
    """d(depth)/d(east), d(depth)/d(north) in km/km on a lon/lat grid with NaN outside; one-sided at the edges."""
    lam, phi = np.radians(lon), np.radians(lat)
    dx = R_KM * np.cos(phi)[:, None] * np.diff(lam)[None, :]          # [ny, nx-1]
    dy = R_KM * np.diff(phi)[:, None]                                   # [ny-1, 1]
    fx = np.diff(dep, axis=1) / dx
    fy = np.diff(dep, axis=0) / dy
    gx = np.full(dep.shape + (2,), np.nan)
    gx[:, 1:, 0], gx[:, :-1, 1] = fx, fx
    gy = np.full(dep.shape + (2,), np.nan)
    gy[1:, :, 0], gy[:-1, :, 1] = fy, fy
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            return np.nanmean(gx, axis=2), np.nanmean(gy, axis=2)


def mesh(lon: np.ndarray, lat: np.ndarray, dep: np.ndarray, dip: np.ndarray, az: np.ndarray):
    ok = np.isfinite(dep)
    ids = -np.ones(dep.shape, dtype=np.int64)
    ids[ok] = np.arange(ok.sum())
    la, lo = np.meshgrid(lat, lon, indexing="ij")
    d = dep[ok]
    r = 1 - d / R_KM
    phi, lam = np.radians(la[ok]), np.radians(lo[ok])
    # same convention as src/science/geodesy.ts toXYZ: lon 0 on +z, lon 90 E on +x, north on +y
    xyz = np.stack([r * np.cos(phi) * np.sin(lam), r * np.sin(phi), r * np.cos(phi) * np.cos(lam)], axis=1).astype("<f4")
    a, b, c, e = ids[:-1, :-1], ids[:-1, 1:], ids[1:, :-1], ids[1:, 1:]
    A, B, C, E = a >= 0, b >= 0, c >= 0, e >= 0
    full = A & B & C & E
    tris = [np.stack([a[full], c[full], b[full]], 1), np.stack([b[full], c[full], e[full]], 1)]
    # three corners inside: keep the one triangle they make (same winding as above)
    for m, t in (((~A) & B & C & E, (b, c, e)), (A & (~B) & C & E, (a, c, e)), (A & B & (~C) & E, (a, e, b)), (A & B & C & (~E), (a, c, b))):
        tris.append(np.stack([t[0][m], t[1][m], t[2][m]], 1))
    tri = np.concatenate(tris).astype("<u4")
    dipv = np.nan_to_num(dip[ok], nan=0.0).astype("<f4")
    azv = np.nan_to_num(az[ok], nan=-1.0).astype("<f4")
    return xyz, d.astype("<f4"), dipv, azv, tri, lo[ok], la[ok]


def gc_km(lon1, lat1, lon2, lat2):
    p1, p2, dl = np.radians(lat1), np.radians(lat2), np.radians(lon2 - lon1)
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data-raw/slab2_bundle.json")
    raw = src.read_bytes()
    bundle = json.loads(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.bin"):
        f.unlink()
    zones, skipped, verts = [], [], {}
    for z in bundle["zones"]:
        dep = next((v for k, v in z["files"].items() if "_dep_" in k and k.endswith(".grd")), None)
        if not dep:
            skipped.append(z["title"])
            continue
        with h5py.File(io.BytesIO(base64.b64decode(dep["b64"])), "r") as h:
            x, y, zz = np.asarray(h["x"], dtype="f8"), np.asarray(h["y"], dtype="f8"), np.asarray(h["z"], dtype="f8")
        lon_full = np.where(x > 180, x - 360, x)
        depth_full = -zz  # Slab2 stores depth as negative km
        gx, gy = gradient(x, y, depth_full)  # use the unwrapped 0..360 longitudes for differences
        dip_full = np.degrees(np.arctan(np.hypot(gx, gy)))
        az_full = np.degrees(np.arctan2(gx, gy)) % 360
        dx = abs(float(x[1] - x[0]))
        k = max(1, round(STEP / dx))
        sl = (slice(None, None, k), slice(None, None, k))
        xyz, d, dipv, azv, tris, vlon, vlat = mesh(lon_full[::k], y[::k], depth_full[sl], dip_full[sl], az_full[sl])
        if len(tris) == 0:
            skipped.append(z["title"])
            continue
        name = z["title"].replace(" Region", "")
        fname = name.lower().replace(" ", "-").replace("/", "-") + ".bin"
        (OUT / fname).write_bytes(xyz.tobytes() + d.tobytes() + dipv.tobytes() + azv.tobytes() + tris.tobytes())
        verts[name] = (vlon, vlat, azv)
        zones.append({"name": name, "file": fname, "nv": int(len(d)), "nt": int(len(tris)), "maxDepthKm": round(float(np.nanmax(d))),
                      "dipMedianDeg": round(float(np.median(dipv[d > 0])), 1)})
    zones.sort(key=lambda z: z["name"])

    # cross-reference with the Atlas slabs that reach the upper mantle
    slabs = json.loads(Path("public/data/slabs.json").read_text())["slabs"]
    atlas = {}
    for s in slabs:
        if s["top"][0] >= 660:
            continue
        best = None
        for zn, (vlon, vlat, azv) in verts.items():
            for (plon, plat) in [s["mid"][:2]] + ([s["surface"]] if s["surface"] else []):
                dist = gc_km(plon, plat, vlon, vlat)
                if dist.min() <= MATCH_KM and (best is None or dist.min() < best[1]):
                    near = (dist <= MATCH_KM) & (azv >= 0)
                    a = np.radians(azv[near])
                    mean_az = float(np.degrees(np.arctan2(np.sin(a).mean(), np.cos(a).mean())) % 360) if near.any() else None
                    resultant = float(np.hypot(np.sin(a).mean(), np.cos(a).mean())) if near.any() else 0
                    best = (zn, float(dist.min()), mean_az, resultant)
        if best:
            atlas[s["abbr"]] = {"zone": best[0], "distKm": round(best[1]), "dipAz": None if best[2] is None else round(best[2], 1),
                                "azConsistency": round(best[3], 2)}
    (OUT / "index.json").write_text(json.dumps({
        "source": bundle["source"], "sourceSha256": hashlib.sha256(raw).hexdigest(), "stepDeg": STEP,
        "layout": "f32 xyz*nv | f32 depth_km*nv | f32 dip_deg*nv | f32 dipAz_deg*nv (-1 = undefined) | u32 tri*nt*3",
        "zones": zones, "atlas": atlas, "matchKm": MATCH_KM,
    }, indent=0))
    size = sum(f.stat().st_size for f in OUT.glob("*.bin"))
    print(f"{len(zones)} zones, {sum(z['nt'] for z in zones):,} triangles, {size // 1024} KB -> {OUT}; skipped: {skipped or 'none'}; "
          f"{len(atlas)} Atlas slabs matched to a Slab2 zone")
    if len(zones) < 20:
        raise SystemExit("fewer than 20 zones: check the bundle")


if __name__ == "__main__":
    main()
