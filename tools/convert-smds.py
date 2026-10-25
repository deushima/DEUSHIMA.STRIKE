#!/usr/bin/env python3
"""Convierte los SMD decompilados por decompmdl a JSON compacto + PNG de texturas."""
import json
import math
import re
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "cs16" / "models_src"
OUT = ROOT / "assets" / "cs16" / "models"


def parse_smd(path: Path):
    mats = {}
    material = None
    verts = []
    in_tri = False

    def flush():
        nonlocal verts, material
        if not material or len(verts) < 3:
            verts = []
            return
        entry = mats.setdefault(material, {"positions": [], "normals": [], "uvs": []})
        for v in verts[:3]:
            entry["positions"].extend([v[0], v[1], v[2]])
            entry["normals"].extend([v[3], v[4], v[5]])
            entry["uvs"].extend([v[6], 1.0 - v[7]])  # SMD V is top-down
        verts = []

    for raw in path.read_text(encoding="latin-1").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line == "triangles":
            in_tri = True
            material = None
            verts = []
            continue
        if not in_tri:
            continue
        if line == "end":
            flush()
            in_tri = False
            continue
        parts = line.split()
        if len(parts) >= 9:
            try:
                vals = [float(x) for x in parts[1:9]]
            except ValueError:
                continue
            if len(vals) == 8:
                verts.append(vals)
                if len(verts) == 3:
                    flush()
        else:
            flush()
            material = parts[0]
    flush()
    return mats


def convert_texture(src: Path, dst: Path):
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGBA")
    im.save(dst)


def bounds_for(mats):
    lo = [math.inf, math.inf, math.inf]
    hi = [-math.inf, -math.inf, -math.inf]
    for m in mats.values():
        p = m["positions"]
        for i in range(0, len(p), 3):
            for k in range(3):
                lo[k] = min(lo[k], p[i + k])
                hi[k] = max(hi[k], p[i + k])
    return {"min": lo, "max": hi, "size": [hi[i] - lo[i] for i in range(3)]}


def convert_viewmodel(name: str):
    src_dir = SRC / name
    candidates = list(src_dir.rglob("*.smd"))
    root_smds = [p for p in candidates if "anims" not in p.parts]
    if not root_smds:
        return None
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    combined = {}
    for smd in root_smds:
        for mat, geo in parse_smd(smd).items():
            g = combined.setdefault(mat, {"positions": [], "normals": [], "uvs": []})
            for k in ("positions", "normals", "uvs"):
                g[k].extend(geo[k])
    tex_dir = next(iter(src_dir.rglob("maps_8bit")), None) or next(iter(src_dir.rglob("maps")), None)
    materials = []
    for mat in sorted(combined):
        stem = Path(mat).stem
        tex_src = None
        if tex_dir:
            for ext in (".bmp", ".png"):
                cand = tex_dir / (stem + ext)
                if cand.exists():
                    tex_src = cand
                    break
        tex_rel = None
        if tex_src:
            tex_rel = f"{name}/{stem}.png"
            convert_texture(tex_src, OUT / tex_rel)
        entry = combined[mat]
        materials.append({"name": stem, "texture": tex_rel, **entry})
    data = {"name": name, "materials": materials, "bounds": bounds_for(combined)}
    (OUT / f"{name}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data


def convert_player(name: str):
    src_dir = SRC / "player" / name
    smds = [p for p in src_dir.rglob("*.smd") if "anims" not in p.parts and p.stem not in ("bomb",)]
    if not smds:
        return None
    # preferir el body principal (mismo nombre que el modelo)
    primary = [p for p in smds if p.stem == name] or smds
    out_dir = OUT / f"player_{name}"
    out_dir.mkdir(parents=True, exist_ok=True)
    combined = {}
    for smd in primary:
        for mat, geo in parse_smd(smd).items():
            g = combined.setdefault(mat, {"positions": [], "normals": [], "uvs": []})
            for k in ("positions", "normals", "uvs"):
                g[k].extend(geo[k])
    tex_dir = next(iter(src_dir.rglob("maps_8bit")), None) or next(iter(src_dir.rglob("maps")), None)
    materials = []
    for mat in sorted(combined):
        stem = Path(mat).stem
        tex_src = None
        if tex_dir:
            for ext in (".bmp", ".png"):
                cand = tex_dir / (stem + ext)
                if cand.exists():
                    tex_src = cand
                    break
        tex_rel = None
        if tex_src:
            tex_rel = f"player_{name}/{stem}.png"
            convert_texture(tex_src, OUT / tex_rel)
        entry = combined[mat]
        materials.append({"name": stem, "texture": tex_rel, **entry})
    data = {"name": f"player_{name}", "materials": materials, "bounds": bounds_for(combined)}
    (OUT / f"player_{name}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    viewmodels = []
    players = []
    for child in sorted(SRC.glob("v_*")):
        if child.is_dir():
            data = convert_viewmodel(child.name)
            if data:
                viewmodels.append({"id": child.name, "bounds": data["bounds"], "materials": [m["name"] for m in data["materials"]]})
                print("VM", child.name, data["bounds"]["size"])
    for child in sorted((SRC / "player").glob("*")):
        if child.is_dir():
            data = convert_player(child.name)
            if data:
                players.append({"id": child.name, "bounds": data["bounds"], "materials": [m["name"] for m in data["materials"]]})
                print("PL", child.name, data["bounds"]["size"])
    (OUT / "manifest.json").write_text(json.dumps({"viewmodels": viewmodels, "players": players}, indent=2), encoding="utf-8")
    print("OK", len(viewmodels), "viewmodels,", len(players), "players")


if __name__ == "__main__":
    main()
