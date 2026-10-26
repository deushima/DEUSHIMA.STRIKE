# Balística, Dust Short y recoil progresivo — 26/10/2026

## Resultado y procedencia

La configuración de armas jugables procede del `weapons.vdata` público de CS2, build **1.41.9.2**, `ClientVersion=2000935`, commit de GameTracking-CS2 `04d3e4a67ac60168d0e79594c69a2116bb3b7278` (22/10/2026). SHA-256 del archivo: `cc04aa26fd8d4a34119df7c4b7f4f29c7ebe0c7862ce78e0a2a753642502ba0a`. El importador [`scripts/import-cs2-weapons.mjs`](../scripts/import-cs2-weapons.mjs) resuelve herencia de KV3 y genera [`src/combat/cs2-data.js`](../src/combat/cs2-data.js). [Archivo fuente público](https://github.com/SteamTracking/GameTracking-CS2/blob/04d3e4a67ac60168d0e79594c69a2116bb3b7278/game/csgo/pak01_dir/scripts/weapons.vdata); [extracción contrastada](https://cs2.gs/about/).

| ID del juego | Definición CS2 | Daño | Cabeza | Armor ratio | Range modifier | RPM | Cargador | Estado |
|---|---|---:|---:|---:|---:|---:|---:|---|
| ak47 | weapon_ak47 | 36 | 4 | 1.55 | .98 | 600 | 30 | jugable |
| m4a1 | weapon_m4a1 (**M4A4**) | 33 | 4 | 1.4 | .97 | 667 | 30 | jugable |
| m4a1s | weapon_m4a1_silencer | 38 | 3.475 | 1.4 | .94 | 600 | 20 | diagnóstico, sin modelo jugable |
| glock | weapon_glock | 30 | 4 | .94 | .85 | 400 | 20 | jugable |
| usp | weapon_usp_silencer | 35 | 4 | 1.01 | .91 | 353 | 12 | jugable |
| deagle | weapon_deagle | 53 | 3.9 | 1.864 | .85 | 267 | 7 | jugable |
| mp5 | weapon_mp5sd | 28 | 4 | 1.25 | .87 | 750 | 30 | jugable |
| scout | weapon_ssg08 | 88 | 4 | 1.7 | .98 | 48 | 10 | jugable |
| awp | weapon_awp | 115 | 4 | 1.95 | .99 | 41 | 5 | jugable |
| m3 | weapon_nova | 26 por perdigón | 4 | 1 | .70 | 68 | 8 | jugable, 9 perdigones |
| xm1014 | weapon_xm1014 | 20 por perdigón | 4 | 1.6 | .70 | 171 | 7 | jugable, 6 perdigones |
| m249 | weapon_m249 | 32 | 4 | 1.6 | .97 | 750 | 100 | jugable |

El HUD conserva «M4A1» por compatibilidad con su modelo sin silenciador. Su perfil balístico es **M4A4**, no M4A1-S. Cuchillo, HE, flash, humo y C4 conservan su mecánica local; no se presentan como perfiles CS2 certificados.

## Daño y hitboxes

El motor usa 40 unidades CS por metro del mundo. Conserva precisión de coma flotante hasta aplicar `floor` una vez al daño de HP y armadura. Kevlar protege torso, abdomen y brazos; el casco protege cabeza; las piernas quedan sin protección. La armadura insuficiente conserva su rama de agotamiento. Se comprobaron 7.200 combinaciones de perfiles, zonas, distancias de 0 a 4.000 unidades, 0/1/4/99/100 puntos de armadura y casco presente/ausente. A 0 unidades: AK pecho 36/27 HP sin/con kevlar, cabeza 144/111 sin/con casco; M4A4 33/23 y 132/92; M4A1-S 38/26 y 132/92. Tres impactos AK al pecho protegido dejan 19 HP y 88 armor tanto en Player, BotManager como en el host online. La cabeza teórica sobre 100 se informa antes del clamp y puede implicar overkill. La cuantización y armor loss se contrastaron con [mediciones publicadas](https://memorin.app/mechanics/bullet-damage), pero la implementación de armadura insuficiente no es una certificación de equivalencia exacta.

Los avatares CT SAS y T Leet usan sus triángulos deformados por huesos para contacto; el peso de skin de la cara tocada determina cabeza, pecho, estómago, cada brazo y cada pierna. La geometría de armas/accesorios se excluye. Pruebas de idle, carrera, duck, salto y caída en ambos modelos alcanzaron las partes visibles y descartaron rayos por encima del cráneo. El cuello se clasifica aparte y se asigna a daño de pecho como adaptación local: su multiplicador exacto en CS2 sigue sin verificarse. `?debugHitboxes` abre colores, huesos, punto, normal y motivo de rechazo solo en localhost; no aparece en producción.

## Recoil y regla propia del juego

Se importaron trayectorias angulares publicadas de 30 disparos AK, 30 M4A4 y 20 M4A1-S desde [Imbaboost](https://imbaboost.com/tools/cs2-recoil-patterns), medición declarada del 09/10/2026 para build 1.41.9.0, resolución 0,001°, sin seed de medición. SHA-256 de la extracción: `fb898ade7bcbc315288ce3f2395429239c7b3dd1f975af1343bc913c5fe9e7cc`. El motor usa esas coordenadas en balas reales y aim punch, no solo en la animación del arma. También se contrastaron [CSDB spray trainer](https://csdb.gg/spray-trainer/) y [recoil patterns](https://csdb.gg/recoil-patterns/); sus RNG y algoritmos internos no están publicados.

**Ajuste posterior pedido por el usuario:** se retiró la regla de cinco tiros rectos. El patrón medido comienza desde el inicio de la ráfaga: el primer punto de AK/M4 es cero en la referencia, el segundo ya se eleva y los posteriores recorren el resto. Todas las balas, incluida la primera, mantienen la dispersión natural de su arma, postura y movimiento; las escopetas conservan la apertura de perdigones. La penalización de inaccuracy por disparar ahora se recupera entre disparos y deja de acumularse casi sin límite durante una ráfaga. La recuperación tras pausas y el cambio de arma conservan estado por arma. Cuchillo y granadas no usan este sistema de proyectiles. El banco local `/dev/combat-lab.html` permite separar patrón de dispersión y queda fuera de `dist`.

Los 30/30/20 impactos del `WeaponSystem` real en pared de 25 m se probaron a 30, 60, 120 y 144 FPS, con y sin frames perdidos. Con dispersión desactivada solo en el banco, el error de implementación frente a los puntos medidos es < 2×10⁻¹³°. Con dispersión real activada y el jugador quieto, el RMS alrededor de la trayectoria es **0,449° AK**, **0,361° M4A4** y **0,423° M4A1-S**; antes de este ajuste superaba 5°–7° por la acumulación de inaccuracy y el desplazamiento de cinco tiros. Véanse los nuevos SVG, CSV y JSON en [`qa-20261026/recoil-restored`](./qa-20261026/recoil-restored/); los archivos del directorio padre documentan la regla anterior. El RNG de spread y la recuperación siguen siendo aproximaciones reproducibles, no clones verificados de Source 2. Para las otras armas, el recoil desde el primer tiro deriva de parámetros de `weapons.vdata` con una escala local.

## Sin daño por caída

El aterrizaje conserva sonido y respuesta visual, pero no reduce HP, armor ni causa muerte. Si un jugador sale del volumen del mapa, reaparece en el spawn de su equipo con su HP, armor y munición intactos. El host descarta reportes de muerte etiquetados `fall`. Pruebas con aterrizajes desde 20 m, llamada directa al daño por caída, rescate desde el vacío y rechazo de paquetes `fall` pasan en offline, online y deathmatch.

## Dust Short original

El GLB original `assets/maps/dust_short.glb` se conserva: SHA-256 `806e89c103447b3e275c112e323882cb3e1c1e25e2d43cb4aff9d13112f8b57c`. Escala anterior 40 → **96** (factor lineal 2,4; área 5,76). Bounding box visual completo anterior **88,653×16,674×106,414 m** → actual **212,768×40,017×255,393 m**; incluye decorado distante. Una abertura de 0,910 m pasa a 2,184 m ante personajes de 1,8 m. Se mantienen 9 materiales, 9 draw calls y los 24.742 triángulos originales. Los 5.942 AABB aproximados fueron sustituidos por colisión finita sobre cada triángulo, con barrido y ejes separadores completos; se corrigió también una tolerancia de unión de suelo que admitía atravesar una pared delgada.

Las marcas de las capturas se traducen a **CT (19,2; 3,679; −1,2), yaw −90°** en el corredor adoquinado y **TT (30,6; 3,413; 18), yaw −45°** en el patio de tierra junto al neumático. Son candidatos únicos por equipo, validados con soporte triangulado, cabeza libre, volumen sin penetración y grafo bidireccional de 88 nodos y 130 aristas físicas. La ruta CT→TT y TT→CT alcanzó el spawn rival en 8,48–9,14 s en seis ensayos de **60 s continuos**, con chequeos de apoyo e intersección durante toda la simulación. Además, CT caminó 8,64 m con W y se detuvo contra la pared real; TT avanzó hasta (37,822; 3,414; 10,778) sin caer. Capturas y trazas en [`qa-20261026`](./qa-20261026/).

## Integración y límites

`npm test` cubre los demás mapas, Dust2, movimiento, menús, animación, armas, daños, online y deathmatch. Dos clientes PeerJS reales en `http://127.0.0.1:8095/` cargaron Dust Short: CT recorrió el grafo hasta TT; dos disparos M4A4 al pecho dejaron al invitado 54 HP/92 armor; un AK desde el invitado dejó al host 73 HP/96 armor. Las vistas del host e invitado coincidieron. Un paquete forjado de AWP desde (999,999,999) fue rechazado; el kill CT, marcador y respawn a ronda 2 coincidieron; el cambio de M4 a Desert Eagle apareció en ambos. En la RTX 3060 local se midieron medianas de 6,1 ms y p95 de 6,1–6,2 ms por cuadro en ambas pestañas WebGL activas; no predice otros equipos.

Limitaciones conocidas: no hay penetración de materiales; una pared sólida siempre ocluye. El multiplicador de cuello, reglas de heavy armor, RNG y recuperación exactos de Source 2, lag compensation y la recarga por cartucho de escopeta no están certificados como CS2. M4A1-S existe en datos y banco diagnóstico, sin modelo jugable. En el navegador integrado, pointer lock produjo `WrongDocumentError`; se probaron input y física con la bandera de lock del entorno de QA. Firefox no pudo verificarse en este entorno. El HUD vectorial de respaldo carga cuando falta el atlas opcional.
