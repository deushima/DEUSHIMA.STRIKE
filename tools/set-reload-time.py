from pathlib import Path
﻿import re
p = str(Path(__file__).resolve().parents[1] / "src" / "weapons.js")
s=open(p,encoding='utf-8').read()
def repl(m):
    v=float(m.group(1))
    return 'reloadTime: 2.0' if v>0 else m.group(0)
s=re.sub(r'reloadTime:\s*([0-9.]+)', repl, s)
open(p,'w',encoding='utf-8').write(s)
print('done',s.count('reloadTime: 2.0'))
