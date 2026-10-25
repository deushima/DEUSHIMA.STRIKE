# Movimiento V3.1 — verificación local

Base preservada: `f4237f9`. Preset predeterminado: `CS16_1V1_AUTOBHOP`.
Unidades: 40 unidades GoldSrc = 1 unidad de mundo. Física de Player a 100 Hz;
el render sigue independiente. No depende de `settings.autoBhop` ni localStorage.

## Fuentes fijadas y ecuaciones

- ReGameDLL_CS `4a50c42e85fd3778c2b7d24731c7d30c83bbab01`:
  https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/pm_shared/pm_shared.cpp
- ReHLDS `550f2d62f13f4ebeb029c1d9d1c212133202611d`:
  https://github.com/rehlds/ReHLDS/blob/550f2d62f13f4ebeb029c1d9d1c212133202611d/rehlds/engine/sv_phys.cpp
- Configuración de servidor: https://rehlds.dev/docs/regamedll-cs/settings/

Implementación independiente de las ecuaciones; no se copió código GPL.
Con `p = dot(velocityXZ,wishDir)`:

- Suelo: `max(0,min(wishSpeed-p,5*wishSpeed*dt))`.
- Aire: `max(0,min(min(wishSpeed,0.75)-p,10*wishSpeed*dt))`.
- Fricción: `max(0,speed-max(speed,1.875)*4*dt)`; factor 2 en borde sin soporte.
- Gravedad: 20 unidades de mundo/s², dividida alrededor del desplazamiento.
- Salto: 6.70820393 unidades/s; escalón: 0.45; guardia absoluta: 50 por componente.

El arma define wishspeed, no un límite a la velocidad acumulada. El preset
principal elimina recorte clásico y stamina deliberadamente: autobhop en
ReGameDLL no elimina stamina por sí solo. El diagnóstico `CS16_VANILLA` requiere
pulsación y reproduce el recorte clásico, pero no emula stamina completa.
No se afirma equivalencia completa con un servidor GoldSrc.

## Correcciones

- Aceleración aérea también en el tick de despegue.
- Space mantenido produce el siguiente impulso en el tick de aterrizaje.
- El sondeo de suelo no captura cuerpos que todavía ascienden.
- Cada subpaso usa la velocidad restante tras colisiones.
- Hull agachado cambia después de comprobar espacio; ojos interpolados aparte.
- Soporte de rampas convexas finitas: superficie, lados, cara inferior,
  deslizamiento en pendientes no caminables y raycast. Se conectan mediante
  `map.slopes`; los mapas existentes conservan su geometría AABB.

Se conservó la geometría física existente, idéntica para ambos equipos:
radio 0.38, alto 1.8/1.32, ojos 1.62/1.12. Es una adaptación del proyecto,
no el hull exacto de todas las variantes GoldSrc (duck engine 36u/GameDLL 50u).
No hay solucionador BSP/brush general; las rampas admitidas tienen planta rectangular.

## Pruebas realizadas

- `movement.test.mjs`: velocidad por arma, walk, diagonales, contrastrafe,
  jump held, suelta, comparación diagnóstica, clearance, escalones y paredes.
- `movement-real-world.test.mjs`: 30 impulsos sobre PhysicsWorld real a
  30/60/144 FPS simulados; ningún impulso en aire; momentum conservado;
  A/D coordinados durante 20 saltos y curvas exactamente iguales con entradas
  aplicadas por tick. W+Space sin incremento artificial. Reset CT/T y cuatro mapas.
- `slope-collision.test.mjs`: ascenso/descenso sobre plano real, caída, cara lateral,
  deslizamiento en rampa empinada, raycast y limpieza al cambiar mapa.
- Dos navegadores PeerJS reales en AIM_FORGE: ambos superaron 30 saltos y
  recibieron identidad/estado del otro; suelta de Space detuvo ambas cadenas.
  Estado saliente retrasado 120/135 ms, manteniendo orden. No equivale a pérdida
  de paquetes ni a una prueba de Internet de larga distancia.
- Cuatro clientes: entrada 2v2, spawn, personajes, equipo, drop/pickup con ammo,
  daño, fin por equipo, nueva ronda y revancha sin errores reales de navegador.

Las pruebas de FPS son simulaciones deterministas, no una afirmación de render
real a 144 FPS en este hardware. Las curvas se generan en
`tests/artifacts/movement/real-world-curves.json`.

## Red y autoridad

Los mensajes incluyen equipo, identidad comunitaria, posición, velocidad, yaw,
pitch, grounded, crouch, jump state/count/held, physics tick, preset, arma,
reload e inventario; disparos conservan sus mensajes existentes. El receptor
elige la identidad desde el equipo autorizado. Predicción visual acotada a 80 ms.
La autoridad de inventario/drop/pickup se preserva. Movimiento sigue simulado
por su propietario; el host no ejecuta un servidor de movimiento anticheat.
Las poses cosméticas no animan las hitboxes ni cambian la dirección de disparo.

HUD opcional: `http://127.0.0.1:8095/?movementDebug=1`.
