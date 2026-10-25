p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace('GOLDSRC  BROWSER EDITION','GOLDSRC &middot; BROWSER EDITION')
s=s.replace('GoldSrc assets  WebGL','GoldSrc assets &middot; WebGL')
s=s.replace('<b>ENTER</b> JUGAR  <b>TAB</b> MARCADOR  <b>B</b> COMPRAR  <b>ESC</b> PAUSA','<b>ENTER</b> JUGAR &middot; <b>TAB</b> MARCADOR &middot; <b>B</b> COMPRAR &middot; <b>ESC</b> PAUSA')
open(p,'w',encoding='utf-8').write(s)
print('ok')
