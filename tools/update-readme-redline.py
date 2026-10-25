p=r'.\README.md'
s=open(p,encoding='utf-8').read()
s=s.replace('- **Menú DEUSHIMA STRIKE** con el arte de portada provisto y botones estilo CS 1.6.',
 '- **Menú DEUSHIMA STRIKE** con el arte de portada provisto y botones estilo CS 1.6.\n- **AIM_REDLINE local contra bots** desde el menú (además de AIM_MAP y ASSAULT).')
s=s.replace('- **Mapas**: `aim_1v1`, `ASSAULT · ARENA 1V1`, `de_dust2`, `cs_office` y\n  **`SURF_DEUSHIMA`**.',
 '- **Mapas**: `AIM_REDLINE`, `aim_1v1`, `ASSAULT · ARENA 1V1`, `de_dust2`, `cs_office` y\n  **`SURF_DEUSHIMA`**. AIM_REDLINE está disponible en local y en el online 1v1.')
s=s.replace('## Limitaciones','## Publicado online\n\n**https://cs16-1v1.vercel.app**\n\nEl build público se genera con:\n\n```powershell\nnpm run build:static\nnpm run deploy\n```\n\n`dist/` contiene solo branding propio y personajes Kenney; **no incluye\n`assets/cs16` de Valve**. Por eso el build publicado usa HUD, arma y audio\nprocedurales de respaldo cuando faltan esos archivos. AIM_REDLINE es completamente\nprocedural y se puede jugar online desde la URL publicada.\n\n## Limitaciones')
open(p,'w',encoding='utf-8').write(s)
print('ok')
