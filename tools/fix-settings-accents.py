p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
repl={'VDEO':'VÍDEO','Vdeo':'Vídeo','Ratn':'Ratón','aceleracin':'aceleración','RATN':'RATÓN','Sensibilidad de zoom':'Sensibilidad de zoom','Ao':'Año'}
for a,b in repl.items(): s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s)
print('ok')
