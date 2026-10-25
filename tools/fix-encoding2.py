p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
pairs=[('Ã³','ó'),('Ã“','Ó'),('Ã­','í'),('Ã¡','á'),('Ã©','é'),('Ãº','ú'),('Ã±','ñ'),('Ã‰','É'),('Ã','Á'),('Ã¼','ü'),('Â·','·'),('Â¿','¿'),('Â¡','¡'),('Â',''),('COUNTER-STRIKE 1.6','DEUSHIMA STRIKE')]
for a,b in pairs: s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s)
print('ok')
