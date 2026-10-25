p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read()
import re
s=re.sub(r'<b class="ok">.*?Listo</b>','<b class="ok">● Listo</b>',s)
open(p,'w',encoding='utf-8').write(s)
print('ok')
