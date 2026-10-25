p=r'.\README.md'
lines=open(p,encoding='utf-8').read().splitlines(True)
out=[]
for line in lines:
    if any(m in line for m in ('Ã','Â','â')):
        try: out.append(line.encode('cp1252').decode('utf-8'))
        except Exception: out.append(line)
    else: out.append(line)
s=''.join(out)
s=s.replace('- Online: lobby/READY/partida/revancha sin errores de navegador.',
 '- AIM_REDLINE local contra bots: movimiento, disparo, navegación y combate verificados.\n- Online: lobby/READY/partida/revancha; los tres mapas AIM_REDLINE/AIM_MAP/ASSAULT cargan en ambos clientes.\n- Publicado: `https://cs16-1v1.vercel.app` verificado con dos Chrome reales.')
open(p,'w',encoding='utf-8').write(s)
print('ok')
