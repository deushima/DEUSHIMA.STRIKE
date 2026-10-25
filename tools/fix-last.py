p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
s=s.replace('ALMAC\ufffdN','ALMACÉN').replace('C\ufffdMO','CÓMO').replace('<b class="ok"> Listo</b>','<b class="ok">● Listo</b>')
# Contextual leftovers
import re
s=re.sub(r'([A-Za-z])\ufffd([A-Za-z])', r'\1\2', s)
open(p,'w',encoding='utf-8').write(s)
print('remaining',s.count('\ufffd'))
