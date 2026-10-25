p=r'.\src\ui\classic.js'
b=open(p,'rb').read()
s=b.decode('utf-8','replace')
# The file contains UTF-8 bytes that were decoded as Windows-1252 once; reverse it.
try:
    s2=s.encode('cp1252','strict').decode('utf-8','strict')
except Exception as e:
    print('strict failed',e)
    s2=s.encode('cp1252','ignore').decode('utf-8','ignore')
open(p,'w',encoding='utf-8').write(s2)
print('done')
