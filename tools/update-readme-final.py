p=r'.\README.md'
s=open(p,encoding='utf-8').read()
s=s.replace('- **Personajes Kenney**: bots y rivales usan los modelos `Animated Characters Protagonists`\n  (idle/run/jump, skins CT/T) desde `assets/characters/.',
 '- **Personajes Kenney**: bots y rivales usan los modelos `Animated Characters Protagonists`\n  (idle/run/jump, skins CT/T, ~2.2 m, pose de disparo) desde `assets/characters/.')
s=s.replace('- **Nombres de aliados**: etiqueta sobre la cabeza, visible a través de paredes, con barra de vida.',
 '- **Nombres de aliados**: etiqueta sobre la cabeza, visible a través de paredes, con barra de vida.\n- **Aparición aleatoria** en cada ronda del lado TT y CT (no siempre el mismo punto).')
s=s.replace('## Requisitos','## Entrega para texturas\n\nLa carpeta limpia para editar texturas con Astra GPT está en:\n\n```\n.\n```\n\nVer `TEXTURES.md` para el mapa de carpetas.\n\n## Requisitos')
open(p,'w',encoding='utf-8').write(s)
print('ok')
