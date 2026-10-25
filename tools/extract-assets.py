#!/usr/bin/env python3
"""
Extractor de assets de Counter-Strike 1.6 (GoldSrc) para cs16-classic.

Uso:
  python tools/extract-assets.py --source "<CS16_SOURCE_DIR>"

Genera assets/cs16/:
  sound/**, ui/** (menú, HUD, iconos), textures/wad/**, maps/overviews/**, models_src/**
  manifests JSON.

IMPORTANTE: los assets son propiedad de Valve. Este script es para uso personal a partir de
una copia legítima del juego. No redistribuir ni publicar los assets generados.
"""
import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path('assets/cs16/original') # Override with --source for local Steam assets

HUD_SPRITES = [f"640hud{i}" for i in range(1, 21)] + [
    "radar640", "radaropaque640", "sniper_scope", "ch_sniper", "ch_sniper2",
    "muzzleflash1", "muzzleflash2", "muzzleflash3", "muzzleflash4",
    "c4", "defuser", "ic4", "ihostage", "iplayervip", "radio", "left", "left2",
    "smokepuff", "wall_puff1", "wall_puff2", "wall_puff3", "wall_puff4",
    "pistol_smoke1", "pistol_smoke2", "rifle_smoke1", "rifle_smoke2", "rifle_smoke3",
]

VIEWMODELS = [
    "v_ak47", "v_m4a1", "v_awp", "v_deagle", "v_usp", "v_glock18", "v_knife",
    "v_mp5", "v_xm1014", "v_m3", "v_scout", "v_sg552", "v_sg550", "v_aug",
    "v_famas", "v_galil", "v_m249", "v_mac10", "v_p90", "v_tmp", "v_ump45",
    "v_elite", "v_fiveseven", "v_p228",
]

PLAYER_MODELS = ["gign", "terror", "gsg9", "urban", "sas", "arctic", "guerilla", "leet"]

WADS = ["cs_dust.wad", "cs_assault.wad", "cs_office.wad", "cstrike.wad"]


def ensure(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    return path


def copy_sounds(src: Path, out: Path):
    sound_src = src / "sound"
    sound_out = ensure(out / "sound")
    manifest = []
    for p in sound_src.rglob("*.wav"):
        rel = p.relative_to(sound_src)
        dst = sound_out / rel
        ensure(dst.parent)
        if not dst.exists() or dst.stat().st_size != p.stat().st_size:
            shutil.copy2(p, dst)
        manifest.append(str(rel).replace("\\", "/"))
    (out / "sound" / "manifest.json").write_text(
        json.dumps({"files": sorted(manifest)}, indent=2), encoding="utf-8"
    )
    # Sonidos de UI del motor GoldSrc (menú original de Half-Life/CS 1.6).
    valve_ui = src.parent / "valve" / "sound" / "UI"
    if valve_ui.exists():
        ui_out = ensure(sound_out / "ui")
        for p in valve_ui.glob("*.wav"):
            shutil.copy2(p, ui_out / p.name)
    return len(manifest)


def convert_tga(src: Path, dst: Path):
    im = Image.open(src).convert("RGBA")
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst)
    return im.size


def copy_ui_assets(src: Path, out: Path):
    ui = ensure(out / "ui")
    icons = ensure(ui / "icons")
    count = 0
    # Iconos del menú de compra / clases
    for p in (src / "gfx" / "vgui").glob("*.tga"):
        convert_tga(p, icons / (p.stem + ".png"))
        count += 1
    # Logos, menú, diagonal y fondos
    for rel, name in [
        ("resource/game_menu.tga", "game_menu.png"),
        ("resource/game_menu_mouseover.tga", "game_menu_mouseover.png"),
        ("resource/logo_game.tga", "logo_game.png"),
        ("resource/UI/diagonal.tga", "diagonal.png"),
        ("gfx/vgui/CS_logo.tga", "CS_logo.png"),
    ]:
        p = src / rel
        if p.exists():
            convert_tga(p, ui / name)
            count += 1
    for p in (src / "resource" / "background").glob("*.tga"):
        convert_tga(p, ui / "background" / (p.stem + ".png"))
        count += 1
    # Layouts y strings para referencia/estilos
    raw = ensure(ui / "res")
    for p in (src / "resource").rglob("*.res"):
        rel = p.relative_to(src / "resource")
        dst = raw / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
    for p in (src / "resource").glob("*.txt"):
        shutil.copy2(p, raw / p.name)
    return count


def parse_hud_txt(src: Path, out: Path):
    """Convierte hud.txt (sección 640) en un JSON práctico para el HUD."""
    path = src / "sprites" / "hud.txt"
    items = {}
    best = {}
    for raw in path.read_text(encoding="latin-1").splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        name, size, sprite, x, y, w, h = parts[:7]
        size = int(size)
        entry = {
            "sprite": sprite.replace(".spr", ""),
            "x": int(x), "y": int(y), "w": int(w), "h": int(h), "size": size,
        }
        # Preferimos la variante 640
        if name not in best or size > best[name]["size"]:
            best[name] = entry
    items = {k: v for k, v in best.items() if v["size"] == 640}
    (out / "ui" / "hud.json").write_text(json.dumps(items, indent=2), encoding="utf-8")
    return len(items)


def extract_sprite(tool: Path, spr: Path, work: Path, png: Path, kind="hud"):
    outdir = work / spr.stem
    if outdir.exists():
        shutil.rmtree(outdir)
    ensure(outdir)
    subprocess.run([str(tool), str(spr), str(outdir)], check=True, stdout=subprocess.DEVNULL)
    bmp = next(outdir.rglob("*.bmp"), None)
    if not bmp:
        return None
    im = Image.open(bmp)
    im = im.convert("RGBA")
    if kind == "radar":
        # radar: conservar color, negro = transparente
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if r + g + b < 8:
                    px[x, y] = (r, g, b, 0)
    elif kind == "color":
        pass
    else:
        # HUD aditivo: usar luminancia como alpha; el color se tinta en canvas
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                lum = max(r, g, b)
                px[x, y] = (lum, lum, lum, lum)
    png.parent.mkdir(parents=True, exist_ok=True)
    im.save(png)
    return im.size


def parse_wad(path: Path, out_dir: Path):
    data = path.read_bytes()
    magic, count, infotable = struct.unpack_from("<4sii", data, 0)
    if magic != b"WAD3":
        return 0
    textures = []
    out_dir = ensure(out_dir)
    for i in range(count):
        fp, disksize, size, typ, comp, pad, name = struct.unpack_from(
            "<iiiBBH16s", data, infotable + i * 16
        )
        if typ not in (0x40, 0x43):
            continue
        if fp < 0 or fp + 40 > len(data):
            continue
        txname = data[fp:fp + 16].split(b"\0")[0].decode("latin1")
        width, height, o1, o2, o3, o4 = struct.unpack_from("<IIIIII", data, fp + 16)
        if not width or not height or width > 4096 or height > 4096:
            continue
        if fp + o1 + width * height > len(data):
            continue
        raw = data[fp + o1:fp + o1 + width * height]
        if len(raw) != width * height:
            continue
        pal_off = fp + o1 + (width * height // 64) * 85 + 2
        if pal_off + 768 > len(data):
            continue
        pal = data[pal_off:pal_off + 768]
        if len(pal) != 768:
            continue
        im = Image.frombytes("P", (width, height), raw)
        im.putpalette(pal)
        im = im.convert("RGBA")
        if txname.startswith("{"):
            px = im.load()
            for y in range(height):
                for x in range(width):
                    if px[x, y][3] == 255 and px[x, y][0] == 255 and px[x, y][1] == 0 and px[x, y][2] == 255:
                        px[x, y] = (0, 0, 0, 0)
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in txname)
        im.save(out_dir / (safe + ".png"))
        textures.append({"name": txname, "file": safe + ".png", "width": width, "height": height})
    return textures


def extract_textures(src: Path, out: Path):
    all_tex = []
    for wadname in WADS:
        wad = src / wadname
        if not wad.exists():
            continue
        out_dir = ensure(out / "textures" / "wad" / wad.stem)
        textures = parse_wad(wad, out_dir)
        all_tex.append({"wad": wadname, "count": len(textures), "textures": textures})
        print(f"  WAD {wadname}: {len(textures)} texturas")
    for p in (src / "overviews").glob("*.bmp"):
        im = Image.open(p).convert("RGBA")
        dst = ensure(out / "ui" / "overviews") / (p.stem + ".png")
        im.save(dst)
    (out / "textures" / "wad" / "manifest.json").write_text(
        json.dumps(all_tex, indent=2), encoding="utf-8"
    )


def decompile_models(tool: Path, src: Path, out: Path):
    work = ensure(out / "models_src")
    done = 0
    for name in VIEWMODELS:
        mdl = src / "models" / (name + ".mdl")
        if not mdl.exists():
            continue
        d = work / name
        if d.exists():
            shutil.rmtree(d)
        ensure(d)
        print("  MDL", name)
        try:
            subprocess.run([str(tool), str(mdl), str(d)], check=True, stdout=subprocess.DEVNULL)
            done += 1
        except subprocess.CalledProcessError:
            print("    fallo", name)
    for name in PLAYER_MODELS:
        mdl = src / "models" / "player" / name / (name + ".mdl")
        if not mdl.exists():
            continue
        d = work / "player" / name
        if d.exists():
            shutil.rmtree(d)
        ensure(d)
        print("  PLAYER", name)
        try:
            subprocess.run([str(tool), str(mdl), str(d)], check=True, stdout=subprocess.DEVNULL)
            done += 1
        except subprocess.CalledProcessError:
            print("    fallo", name)
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(DEFAULT_SOURCE))
    ap.add_argument("--out", default=str(ROOT / "assets" / "cs16"))
    ap.add_argument("--skip-models", action="store_true")
    args = ap.parse_args()

    src = Path(args.source)
    out = Path(args.out)
    if not (src / "sound").exists() or not (src / "sprites").exists():
        print(f"ERROR: no parece una instalación de CS 1.6: {src}")
        return 1
    tool = ROOT / "tools" / "bin" / "decompmdl.exe"
    if not tool.exists():
        print(f"ERROR: falta {tool}")
        return 1
    work = ensure(ROOT / ".tmp" / "extract")
    ensure(out)

    print(f"Fuente: {src}")
    print(f"Destino: {out}")
    n = copy_sounds(src, out)
    print(f"Sonidos copiados: {n}")
    n = copy_ui_assets(src, out)
    print(f"Imágenes/TGA de UI: {n}")
    n = parse_hud_txt(src, out)
    print(f"Elementos HUD parseados: {n}")

    print("Sprites...")
    for name in HUD_SPRITES:
        spr = src / "sprites" / (name + ".spr")
        if not spr.exists():
            continue
        kind = "radar" if name.startswith("radar") else "hud"
        png = out / "ui" / "hud" / (name + ".png")
        try:
            size = extract_sprite(tool, spr, work, png, kind)
            print(f"  {name} {size}")
        except Exception as e:
            print(f"  ERROR {name}: {e}")

    # Algunos HUD sprites no existen como .spr sueltos; generamos placeholders
    # transparentes para evitar 404 al precargar el manifiesto.
    for name in ("640hud8", "640hud9", "crosshairs"):
        png = out / "ui" / "hud" / (name + ".png")
        if not png.exists():
            Image.new("RGBA", (256, 256), (0, 0, 0, 0)).save(png)

    print("Texturas WAD...")
    extract_textures(src, out)

    if not args.skip_models:
        print("Modelos (SMD/BMP)...")
        n = decompile_models(tool, src, out)
        print(f"Modelos decompilados: {n}")

    manifest = {
        "source": str(src),
        "generated": True,
        "note": "Assets de Valve para uso personal. No redistribuir.",
        "sound": "sound/manifest.json",
        "hud": "ui/hud.json",
        "textures": "textures/wad/manifest.json",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
