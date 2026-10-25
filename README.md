# DEUSHIMA STRIKE

Reconstrucción local en browser de **Counter-Strike 1.6** con identidad propia:
**DEUSHIMA STRIKE**. Usa los assets reales de la instalación GoldSrc, un menú con
arte original, HUD clásico, armas originales y duelos AIM rápidos para jugar solo o con amigos.

![Menú DEUSHIMA STRIKE](screenshots/deushima-menu.png)

## Características

- **Menú DEUSHIMA STRIKE** con el arte de portada provisto y botones estilo CS 1.6.
- **AIM_REDLINE local contra bots** desde el menú (además de AIM_MAP y ASSAULT).
- **HUD original**: `640hud*.spr`, números, iconos, radar, daño direccional y crosshair.
- **385 sonidos originales** + efecto de recarga propio: armas, pasos, radio, dolor/muerte, C4 y UI.
- **Recarga unificada**: todas las armas usan el mismo sonido, tardan **2 s** y
  recargan automáticamente al vaciar el cargador.
- **Personajes Quaternius (CC0), placeholder V3**: soldados CT/T temporales con animaciones `Idle`, `Walk`, `Run_Gun`, `Duck`, `Jump` y `Death`. Los objetivos finales Leet Krew A / SAS Blue están documentados y bloqueados hasta verificar derechos de redistribución (`docs/v3-asset-manifest.json`).
- **Nombres de aliados**: etiqueta sobre la cabeza, visible a través de paredes, con barra de vida.
- **Aparición aleatoria** en cada ronda del lado TT y CT (no siempre el mismo punto).
- **Viewmodels originales** de AK-47, M4A1, AWP, Deagle, USP, Glock y más.
- **Pausa/configuración estilo CS 1.6**: Ratón, Teclado, Audio, Vídeo, Juego.
- **Pantalla completa** desde el menú y protección contra cierres accidentales
  (`Ctrl+W`, `Ctrl+R`, `Ctrl+T`, etc.; aviso antes de cerrar la pestaña).
- **Mira limpia**: sin el punto central.
- **Duelo 1v1 rápido**:
  - sin freeze: arranca en el instante;
  - un kill cierra la ronda;
  - animación de muerte/caída y siguiente ronda automática al tocar el suelo;
  - primero a **13 rondas**; **12-12 es empate**;
  - **spawn aleatorio** en cada ronda del lado CT y del lado T.
- **Mapas AIM**: `AIM_REDLINE`, `AIM_FORGE`, `aim_1v1` y `ASSAULT · ARENA 1V1`.
- **Online 1v1 / 2v2** con PeerJS y host autoritativo: lobby privado, código/link, READY, equipos CT/T, rondas, reconexión, revancha y hasta cuatro jugadores.
- **CS16_1V1_AUTOBHOP** por defecto: mantener Space encadena saltos; el air-strafe conserva y puede ganar momentum sin clamp artificial a la velocidad del arma.
- **Drops/pickups**: G tira el arma actual al piso con ammo preservada; el host decide propiedad y pickup para evitar duplicaciones.
- **Sprites nuevos** de `assets/cs16/ui/hud` integrados (daño, iconos, HUD).

## Capturas

| Menú | Duelo |
|---|---|
| ![Menú](screenshots/deushima-menu.png) | ![Duelo](screenshots/deushima-duel.png) |

| Assault | AIM |
|---|---|
| ![Assault](screenshots/deushima-assault.png) | ![AIM](screenshots/deushima-duel.png) |

![Pausa / configuración](screenshots/deushima-settings.png)

| AIM_REDLINE CT | AIM_REDLINE T |
|---|---|
| ![AIM_REDLINE CT](screenshots/deushima-redline-ct.png) | ![AIM_REDLINE T](screenshots/deushima-redline-t.png) |

| Personajes Quaternius | Nombres de aliados |
|---|---|
| ![Personajes](screenshots/deushima-characters.png) | ![Tags](screenshots/deushima-ally-tags.png) |

## Entrega para texturas

La carpeta limpia para editar texturas con Astra GPT está en:

```
.
```

Ver `TEXTURES.md` para el mapa de carpetas.

## Requisitos

- Windows + Chrome/Edge actualizado.
- Node.js 20+.
- Copia legítima de Counter-Strike 1.6 en Steam.

## Extraer assets

La carpeta `Counter-Strike Source` **no** es CS 1.6. La instalación GoldSrc está en:

```
<CS16_SOURCE_DIR>
```

```powershell
cd cs16-classic
python tools/extract-assets.py --source "<DIRECTORIO_LOCAL_CS16>"
python tools/convert-smds.py
python tools/fix-hud-alpha.py
python tools/install-user-sprites.py
```

Los assets generados viven en `assets/cs16/` y no se publican.

## Ejecutar

```powershell
node server.mjs
```

Abrir **http://127.0.0.1:8095/**. El servidor escucha en `0.0.0.0` para LAN.

## Controles

| Tecla | Acción |
|---|---|
| WASD | Moverse |
| Mouse | Apuntar |
| Click izq. | Disparar |
| Click der. | Zoom AWP |
| R | Recargar |
| 1 / 2 / 3 | Primaria / secundaria / cuchillo |
| Shift | Caminar |
| Ctrl | Agacharse |
| Space | Saltar / autobhop manteniendo apretado |
| G | Tirar arma actual |
| B | Comprar |
| Tab | Marcador |
| Esc | Pausa / configuración |


## Arquitectura

```
index.html
server.mjs                   servidor estático
src/main.js                  bootstrap
src/game.js                  motor, cámara, mapas, input, loop
src/duel.js                  1v1 rápido a 13, muerte y auto-ronda
src/characters.js            placeholders Quaternius GLB + animaciones/aim pose
src/core/movement-presets.js presets GoldSrc V3
src/ui/name-tags.js          nombres de aliados a través de paredes
src/ui/shortcut-guard.js     protección de atajos del navegador
src/core/player.js           movimiento AIM, strafe aéreo y bhop
src/classic-viewmodel.js     viewmodels GoldSrc
src/ui/classic.js/css        menú, HUD, pausa/settings DEUSHIMA
src/world/aim_map.js         arena 1v1
src/world/forge_map.js       AIM_FORGE 1v1/2v2
src/world/dropped-weapons.js drops físicos
src/world/assault_map.js     arena Assault
src/world/wad.js             texturas WAD originales
tools/extract-assets.py      extracción GoldSrc
tools/convert-smds.py        MDL/SMD → JSON
```

## Verificación

```powershell
node tests/assets-check.mjs
node tests/duel-logic.test.mjs
node tests/online-e2e.mjs       # 2/4 Chrome + PeerJS
node tools/browser-test.mjs      # click real, HUD, mapas
```

Estado verificado:

- HUD 102 entradas, 385 sonidos, 33 modelos.
- Duelo: sin freeze, retardo de muerte, auto-ronda, primero a 13 y empate 12-12.
- Assault/aim/dust2 cargan con texturas WAD.
- AIM_REDLINE local contra bots: movimiento, disparo, navegación y combate verificados.
- Online: lobby/READY/partida/revancha 1v1/2v2, host autoritativo, drops/pickups y AIM_REDLINE/AIM_FORGE/AIM_MAP/ASSAULT.
- Publicado: `https://cs16-1v1.vercel.app` verificado con dos Chrome reales.

## Publicado online

**https://cs16-1v1.vercel.app**

El build público se valida con:

```powershell
npm run build:static
```

`main` es la fuente de verdad. Un push a GitHub dispara el deployment de producción en Vercel.

`dist/` contiene branding propio, placeholders Quaternius CC0 y **los sonidos de CS**
(`assets/cs16/sound`). No incluye texturas/modelos/HUD de Valve, por eso
el build publicado usa HUD y arma procedurales de respaldo. AIM_REDLINE es
completamente procedural y se puede jugar online desde la URL publicada.

## Limitaciones

- El online usa **PeerJS P2P con host autoritativo** para ronda, salud, inventario, drops y pickups. No hay servidor dedicado anti-cheat.
- El online lleva a 13 kills/rondas, pero no implementa el empate 12-12.
- Los mapas son layouts propios inspirados en CS; **no son los BSP originales**.
- Los viewmodels usan la malla original en pose estática; las animaciones de arma son
  procedurales.
- **Assets de Valve solo para uso personal**. No publicar `assets/cs16` en Vercel/Git.




