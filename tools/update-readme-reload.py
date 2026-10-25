p=r'.\README.md'
s=open(p,encoding='utf-8').read()
s=s.replace('- **385 sonidos originales**: armas, recargas, pasos, radio, dolor/muerte, C4 y UI.',
 '- **385 sonidos originales** + efecto de recarga propio: armas, pasos, radio, dolor/muerte, C4 y UI.\n- **Recarga unificada**: todas las armas usan el mismo sonido, tardan **2 s** y\n  recargan automáticamente al vaciar el cargador.')
open(p,'w',encoding='utf-8').write(s)
print('ok')
