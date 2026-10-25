p=r'.\README.md'
s=open(p,encoding='utf-8').read()
s=s.replace('- **Pausa/configuración estilo CS 1.6**: Ratón, Teclado, Audio, Vídeo, Juego.',
 '- **Pausa/configuración estilo CS 1.6**: Ratón, Teclado, Audio, Vídeo, Juego.\n- **Pantalla completa** desde el menú y protección contra cierres accidentales\n  (`Ctrl+W`, `Ctrl+R`, `Ctrl+T`, etc.; aviso antes de cerrar la pestaña).\n- **Mira limpia**: sin el punto central.')
s=s.replace('src/ui/name-tags.js          nombres de aliados a través de paredes','src/ui/name-tags.js          nombres de aliados a través de paredes\nsrc/ui/shortcut-guard.js     protección de atajos del navegador')
open(p,'w',encoding='utf-8').write(s)
print('ok')
