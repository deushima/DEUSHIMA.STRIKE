p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace('GOLDSRC BROWSER EDITION','GOLDSRC &middot; BROWSER EDITION')
s=s.replace('GoldSrc assets WebGL','GoldSrc assets &middot; WebGL')
s=s.replace('JUGAR TAB MARCADOR B COMPRAR ESC PAUSA','JUGAR &middot; TAB MARCADOR &middot; B COMPRAR &middot; ESC PAUSA')
s=s.replace('DEUSHIMA STRIKE ASSETS CS 1.6','DEUSHIMA STRIKE &middot; ASSETS CS 1.6')
open(p,'w',encoding='utf-8').write(s)
print('ok')
