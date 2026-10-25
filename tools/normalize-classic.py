p=r'.\src\ui\classic.js'
s=open(p,encoding='utf-8').read().replace('\r\n','\n')
while '\n\n' in s:
    s=s.replace('\n\n','\n')
open(p,'w',encoding='utf-8',newline='\n').write(s)
print('lines',s.count('\n')+1)
