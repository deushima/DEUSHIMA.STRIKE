p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace('\ufffd\x8f Listo','● Listo').replace('\ufffd Listo','● Listo').replace('R\ufffdPIDO','RÁPIDO')
s=s.replace('\ufffd','')
open(p,'w',encoding='utf-8').write(s)
print('ok')
