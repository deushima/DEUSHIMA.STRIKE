p=r'.\src\ui\classic.js'
lines=open(p,encoding='utf-8').read().splitlines(True)
out=[]
for line in lines:
    if any(m in line for m in ('Ã','Â','â')):
        try:
            fixed=line.encode('latin1').decode('utf-8')
            out.append(fixed)
        except Exception:
            out.append(line)
    else:
        out.append(line)
open(p,'w',encoding='utf-8').writelines(out)
print('done')
