from pathlib import Path
﻿from PIL import Image
import os
base = str(Path(__file__).resolve().parents[1])
src=os.path.join(base,'analysis','new_sprites')
out=os.path.join(base,'assets','cs16','ui','hud')
for name in ['640hud8','640hud9','640hud21','640hud22']:
    p=os.path.join(src,name,'bmp',name+'.bmp')
    im=Image.open(p).convert('RGBA')
    px=im.load()
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a=px[x,y]
            lum=max(r,g,b)
            px[x,y]=(255,255,255,255) if lum>10 else (0,0,0,0)
    im.save(os.path.join(out,name+'.png'))
    print('installed',name,im.size)
