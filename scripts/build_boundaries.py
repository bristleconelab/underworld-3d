"""PB2002 plate-boundary steps -> public/data/pb2002.bin (+ pb2002.json).

Source: Bird, P. (2003) An updated digital model of plate boundaries, Geochem. Geophys. Geosyst. 4(3), 1027,
doi:10.1029/2001GC000252. GeoJSON conversion by Hugo Ahlenius (Nordpil), github.com/fraxen/tectonicplates,
Open Data Commons Attribution License 1.0. File used: GeoJSON/PB2002_steps.json (5,824 steps, each a short segment
with Bird's step class and the relative plate velocity of his PB2002 model).

pb2002.bin, little-endian, 20 bytes per step:
  int16 lon0*100, int16 lat0*100, int16 lon1*100, int16 lat1*100,
  uint8 class index (pb2002.json classes), uint8 0,
  uint16 relative velocity mm/yr*10, uint16 velocity azimuth deg*10,
  int16 divergent component mm/yr*10 (negative = convergence), int16 right-lateral component mm/yr*10,
  uint16 plate-pair index (pb2002.json pairs)

usage: python3 scripts/build_boundaries.py [data-raw/pb2002_steps.json]
(download: https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_steps.json)
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

CLASSES = {
    "SUB": "subduction zone", "OSR": "oceanic spreading ridge", "OTF": "oceanic transform fault",
    "CRB": "continental rift boundary", "CTF": "continental transform fault",
    "CCB": "continental convergent boundary", "OCB": "oceanic convergent boundary",
}


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data-raw/pb2002_steps.json")
    raw = src.read_bytes()
    feats = json.loads(raw)["features"]
    keys = list(CLASSES)
    pairs = sorted({f["properties"]["PLATEBOUND"] for f in feats})
    out = bytearray()
    for f in feats:
        p = f["properties"]
        c = lambda v: int(round(v * 100))
        out += struct.pack("<hhhhBBHHhhH", c(p["STARTLONG"]), c(p["STARTLAT"]), c(p["FINALLONG"]), c(p["FINALLAT"]),
                           keys.index(p["STEPCLASS"]), 0, int(round(p["VELOCITYLE"] * 10)), int(round((p["VELOCITYAZ"] % 360) * 10)),
                           int(round(p["VELOCITYDI"] * 10)), int(round(p["VELOCITYRI"] * 10)), pairs.index(p["PLATEBOUND"]))
    Path("public/data/pb2002.bin").write_bytes(out)
    Path("public/data/pb2002.json").write_text(json.dumps({
        "source": "Bird (2003) PB2002, doi:10.1029/2001GC000252; GeoJSON by H. Ahlenius (Nordpil), github.com/fraxen/tectonicplates, ODC-BY 1.0",
        "sourceSha256": hashlib.sha256(raw).hexdigest(), "stride": 20, "count": len(feats),
        "classes": [[k, CLASSES[k]] for k in keys], "pairs": pairs,
    }, separators=(",", ":")))
    print(f"{len(feats)} steps, {len(pairs)} plate pairs -> public/data/pb2002.bin ({len(out) // 1024} KB)")


if __name__ == "__main__":
    main()
