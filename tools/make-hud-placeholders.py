from pathlib import Path
﻿from PIL import Image
import os
base = str(Path(__file__).resolve().parents[1] / "assets" / "cs16" / "ui" / "hud")
for name in ['640hud8','640hud9','crosshairs']:
    p=os.path.join(base,name+'.png')
    if not os.path.exists(p):
        Image.new('RGBA',(256,256),(0,0,0,0)).save(p)
        print('created',p)
