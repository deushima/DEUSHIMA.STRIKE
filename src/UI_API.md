# UI API — CS 1.6 Browser

Leer `CONTRACTS.md`, `game.js` y `GAMEPLAY_API.md`. La UI **no** simula juego: solo presenta y llama
métodos del `Game`. Todo el DOM se construye desde `src/ui/ui.js` dentro de `#ui-root`; los estilos
viven en `src/ui/ui.css`. No tocar `index.html` ni otros archivos.

## Estética

- Fiel a Counter-Strike 1.6: paneles oscuros semi-transparentes, biseles, tipografía compacta
  `Trebuchet MS`/Tahoma, títulos en mayúsculas con tracking, acentos ámbar/verde, fondo 3D visible
  (la cámara del juego renderiza el mapa detrás).
- HUD: salud/armadura abajo izquierda, munición abajo derecha, dinero arriba izquierda, radar
  arriba izquierda debajo del dinero, timer y score arriba centro, killfeed arriba derecha,
  indicador de ronda/objetivo. Crosshair dinámico, hitmarker, flash, daño direccional.
- Menú principal: título COUNTER-STRIKE, versión 1.6 / Browser Edition, botones JUGAR, OPCIONES,
  CÓMO JUGAR, SALIR. Fondo con viñeta/scanlines y panel lateral con noticias/servidor local.
- Crear partida: mapa (de_dust2 / cs_office), equipo (CT/T/AUTO), dificultad, tamaño de equipo
  (3/4/5), rondas para ganar (5/8/16), botón EMPEZAR.
- Buy menu con columnas/números 1-8, precios, dinero, arma actual, botones de compra.
- Scoreboard TAB con dos equipos, K/D, dinero, ping, vivo/muerto, marcador.
- Resultado de ronda: banner grande "Counter-Terrorists Win" / "Terrorists Win" + razón, se
  mantiene hasta que `game.onRoundStarted` llama `ui.hideRoundResult()`.
- Fin de partida: pantalla con marcador final, estadísticas y botones.
- Loading, fatal error, toasts, consola (~) y mensajes centrales.
- Responsive 1280×720 prioritario; aceptable 1024×768 y mobile apaisado.
- Sin assets externos, sin CDN. CSS + SVG inline + canvas para el radar.

## Interfaz pública

```js
new UI(game); ui.init();
ui.showMainMenu(); ui.showCreateGame(); ui.showOptions(); ui.showLoading(text); ui.hideLoading();
ui.showHUD(); ui.hideHUD(); ui.updateHUD(hud);
ui.showBuyMenu(data); ui.updateBuyMenu(data); ui.closeBuyMenu(); ui.isBuyMenuOpen;
ui.openScoreboard(data); ui.updateScoreboard(data); ui.closeScoreboard(); ui.isScoreboardVisible;
ui.showPauseMenu(); ui.hidePauseMenu();
ui.showRoundBanner(title, subtitle, winner); ui.hideRoundBanner();
ui.showRoundResult(data); ui.hideRoundResult();
ui.showMatchEnd(data);
ui.addKillFeed(entry); ui.showDamage(angleDeg); ui.flash(alpha); ui.flashDamage(alpha);
ui.showActionProgress(label, progress); ui.hideActionProgress();
ui.toast(text); ui.showCenterMessage(text, ms); ui.showKillConfirm(headshot);
ui.showFatalError(text); ui.toggleConsole(); ui.consoleLog(text);
ui.applySettings(settings); ui.isOverlayOpen; ui.dispose();
```

`isOverlayOpen` = true para menú principal, crear partida, opciones, pausa, buy menu, match end.
NO debe ser true por el scoreboard ni por el resultado de ronda. La raíz `#ui-root` tiene
`pointer-events:none`; solo los paneles/botones usan `pointer-events:auto`.

`init()` debe construir el DOM pero **no** eliminar `#boot-screen` (lo elimina el Game al mostrar
el menú). `showMainMenu()` sí debe ocultar/eliminar `#boot-screen` por si acaso.

## Datos de `game.getHudState()`

```js
{
  health, armor, helmet, money, team:'CT'|'T', alive, kills, deaths,
  weapon: {
    name, weaponId, ammo, reserve, slot,
    slots: [{ slot, id, name, ammo, reserve, active }],
    grenades: [{ id, name, count }], hasC4, hasKit, spread, scoped
  },
  round: {
    phase:'freeze'|'live'|'over'|'matchover', round, roundNumber, timeLeft, freezeLeft,
    buyTimeLeft, scoreCT, scoreT, objective, teamAlive:{CT,T},
    bomb:{ planted, site, timeLeft, x, z, defusing, defuseProgress, planting, plantProgress },
    hostages:{ total, rescued, carrying }, message
  },
  radar: {
    mapName, bounds:{minX,maxX,minZ,maxZ},
    players:[{x,z,yaw,team,isPlayer,alive,name,hasBomb}],
    bombsites:[{name,x,z,radius}], bomb:{x,z,site,timeLeft}|null,
    hostages:[{x,z,rescued,following}], rescueZone
  },
  crosshair:{ spread, hidden, sniper, color, size },
  buy:{ canBuy, inZone }, teamAlive, mapName, scores:{CT,T}
}
```

Métodos del game usados por la UI:
`game.startMatch(config)`, `game.quitToMenu()`, `game.pause()`, `game.resume()`,
`game.buyItem(id)`, `game.getBuyMenuData()`, `game.getScoreboardData()`, `game.applySettings(patch)`,
`game.requestPointerLock()`, `game.audio.play(name)`.

Config de `startMatch`:
```js
{ map:'de_dust2'|'cs_office', team:'CT'|'T'|'auto', difficulty:'easy'|'normal'|'hard'|'expert',
  teamSize:5, roundsToWin:8 }
```

## Datos de scoreboard

```js
{
  round, scoreCT, scoreT, phase, mapName, mode,
  teams: { CT: [{name,team,isPlayer,alive,kills,deaths,money,ping,hasBomb,hasKit}], T:[...] }
}
```

## Buy menu

`game.getBuyMenuData()` devuelve `{money, team, canBuy, categories:[{key,name,items:[...]}]}`;
cada item `{id,name,price,team,available,owned,description,icon}`. La UI llama `game.buyItem(id)` y
refresca con `game.getBuyMenuData()`. Al cerrar, `game.closeBuyMenu()` (pide pointer lock).
Abrir/cerrar con B lo maneja Game, pero la UI debe cerrar con el botón CERRAR y con Escape.

## Resultado de ronda

`data` = `{ winner:'CT'|'T', reason:'...', scoreCT, scoreT, round, playerTeam, matchOver }`.
`showMatchEnd(data)` recibe además `teams`, `winner`, `scoreCT`, `scoreT`, `stats`, `matchOver`.

## Requisitos de calidad

- Nada de errores de consola si faltan campos; usar optional chaining y valores por defecto.
- El HUD no debe robar foco ni bloquear el canvas; los overlays sí.
- `updateHUD` se llama ~20 veces/s: no recrear el DOM completo cada vez; cachear nodos.
- Radar en `<canvas>` con fondo oscuro, grilla, sitios A/B, puntos de equipo, flecha del jugador.
- El menú debe mostrar el 3D detrás (no tapar todo con un fondo opaco).
- Textos en español, nombres de armas/mapas originales.
