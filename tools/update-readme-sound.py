p=r'.\README.md'
s=open(p,encoding='utf-8').read()
s=s.replace('`dist/` contiene solo branding propio y personajes Kenney; **no incluye\n`assets/cs16` de Valve**. Por eso el build publicado usa HUD, arma y audio\nprocedurales de respaldo cuando faltan esos archivos. AIM_REDLINE es completamente\nprocedural y se puede jugar online desde la URL publicada.',
 '`dist/` contiene branding propio, personajes Kenney y **los sonidos de CS**\n(`assets/cs16/sound`). No incluye texturas/modelos/HUD de Valve, por eso\nel build publicado usa HUD y arma procedurales de respaldo. AIM_REDLINE es\ncompletamente procedural y se puede jugar online desde la URL publicada.')
open(p,'w',encoding='utf-8').write(s)
print('ok')
