p=r'.\README.md'
lines=open(p,encoding='utf-8').read().splitlines(True)
out=[]
for line in lines:
    if any(m in line for m in ('Ã','Â','â')):
        try: out.append(line.encode('cp1252').decode('utf-8'))
        except Exception: out.append(line)
    else: out.append(line)
s=''.join(out)
s=s.replace('- **Viewmodels originales** de AK-47, M4A1, AWP, Deagle, USP, Glock y más.',
 '- **Personajes Kenney**: bots y rivales usan los modelos `Animated Characters Protagonists`\n  (idle/run/jump, skins CT/T) desde `assets/characters/`.\n- **Nombres de aliados**: etiqueta sobre la cabeza, visible a través de paredes, con barra de vida.\n- **Viewmodels originales** de AK-47, M4A1, AWP, Deagle, USP, Glock y más.')
s=s.replace('TEXTURES.md                  guía de texturas para Astra GPT','TEXTURES.md                  guía de texturas para Astra GPT')
open(p,'w',encoding='utf-8').write(s)
print('ok')
