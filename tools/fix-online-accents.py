p=r'.\src\ui\online-ui.js'
s=open(p,encoding='utf-8').read()
repl={'CÃ“DIGO':'CÓDIGO','INVÃLIDO':'INVÁLIDO','PULSÃ':'PULSÁ','ESTÃ':'ESTÁ','MENÃš':'MENÚ','CONEXIÃ“N':'CONEXIÓN','PODÃ‰S':'PODÉS','Â·':'&middot;','RÃPIDO':'RÁPIDO','Ãºltimo':'último','SESIÃ“N':'SESIÓN'}
for a,b in repl.items(): s=s.replace(a,b)
open(p,'w',encoding='utf-8').write(s)
print('ok')
