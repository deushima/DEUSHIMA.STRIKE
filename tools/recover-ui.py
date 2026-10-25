from pathlib import Path
﻿import os
base = str(Path(__file__).resolve().parents[1] / "src")
paths=[os.path.join(base,'ui','online-ui.js'),os.path.join(base,'ui','ui.js')]
for p in paths:
    lines=open(p,encoding='utf-8').read().splitlines(True)
    out=[]
    for line in lines:
        if any(m in line for m in ('Ã','Â','â')):
            try:
                out.append(line.encode('cp1252').decode('utf-8'))
            except Exception:
                out.append(line)
        else:
            out.append(line)
    open(p,'w',encoding='utf-8').writelines(out)
    print('fixed',p)
