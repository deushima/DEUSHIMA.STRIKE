from pathlib import Path
from PIL import Image
import glob

base = str(Path(__file__).resolve().parents[1] / "assets" / "cs16" / "ui" / "hud")
files = glob.glob(base + r'\640hud*.png')
print('files', len(files))
for f in files:
    im = Image.open(f).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            lum = max(r, g, b)
            px[x, y] = (255, 255, 255, 255) if lum > 10 else (0, 0, 0, 0)
    im.save(f)
print('done')
