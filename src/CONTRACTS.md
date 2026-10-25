# CS16 Browser · Contratos compartidos

Este archivo es la fuente de verdad para la integración. Todos los módulos reciben una
instancia de `Game` y usan su API pública. No editar archivos fuera del scope asignado sin
avisar al Lead.

## Coordenadas y unidades

- Three.js, Y hacia arriba. `1 unidad = 1 metro`. Suelo en `y = 0`.
- Jugador: pies en `player.pos` (Vector3), radio 0.38, altura de pie 1.8, ojos ~1.62.
- Velocidades objetivo: correr 5.6 m/s, caminar (Shift) 3.1, agachado 2.3; salto 5.0; gravedad 18.
- Mapas de ~80 × 80 m, centrados en 0,0. Spawns `y = 0.05`.
- Los colliders son `THREE.Box3` con `.surface` opcional (`'sand'|'stone'|'wood'|'metal'|'dirt'|'glass'`).
- Los `waypoints` son `{ id, x, y, z, links: number[], tags: string[] }`; `y` es el suelo.

## Estructura de archivos / ownership

| Archivo | Dueño | Contenido |
|---|---|---|
| `src/game.js`, `src/main.js`, `src/core/*` | Lead | loop, input, física, jugador, audio, efectos |
| `src/world/maps.js`, `src/world/textures.js` | map-builder | mapas, geometría, colliders, spawns, waypoints |
| `src/weapons.js`, `src/viewmodel.js` | combat-weapons | armas, viewmodel, compra, disparo, granadas |
| `src/bots.js` | bot-ai | bots, navegación, combate, objetivos |
| `src/rounds.js` | round-modes | rondas, economía, bomba, rehenes, match |
| `src/ui/ui.js`, `src/ui/ui.css` | ui-designer | menús, HUD, radar, buy menu, scoreboard |
| `index.html`, `server.mjs` | Lead | shell, servidor estático |

## API de `Game` disponible para todos

Propiedades:

```js
game.canvas          // HTMLCanvasElement
game.renderer        // THREE.WebGLRenderer
game.scene           // THREE.Scene
game.camera          // THREE.PerspectiveCamera
game.input           // Input
game.audio           // AudioEngine
game.effects         // Effects
game.ui              // UI
game.player          // Player
game.weapons         // WeaponSystem
game.bots            // BotManager
game.rounds          // RoundManager
game.map             // MapData (null antes de empezar)
game.state           // 'menu' | 'loading' | 'playing' | 'paused' | 'roundover' | 'matchover'
game.settings        // { sensitivity, volume, fov, resolution, crosshair, language, invertY }
game.time            // segundos de juego acumulados
game.clock
game.matchConfig     // configuración elegida en el menú
```

Métodos:

```js
game.startMatch(config)                 // config: { map, team, difficulty, botsCT, botsT, mode, roundsToWin }
game.quitToMenu()
game.pause() / game.resume()
game.requestPointerLock() / game.releasePointerLock()
game.isPointerLocked()

game.raycastWorld(origin, dir, maxDist) // -> { t, point:Vector3, normal:Vector3, collider } | null
game.raycastShot(origin, dir, maxDist, shooterTeam)
// -> { t, point, normal, type:'world', collider }
//  | { t, point, normal, type:'player', entity:game.player, part:'head'|'chest'|'stomach'|'legs' }
//  | { t, point, normal, type:'bot', entity:bot, part:'head'|'chest'|'stomach'|'legs' }
game.hasLineOfSight(from, to)           // bool, contra colliders
game.damagePlayer(amount, source, part, weaponId) // aplica armadura; devuelve daño real
game.damageBot(bot, amount, source, part, weaponId) // devuelve daño real
game.notifyKill(killer, victim, weaponId, headshot) // feed, stats, economía
game.addKillFeed(entry)                // entry: { killer, victim, weapon, headshot, teamKill }
game.getAliveBots(team) / game.getAliveCounts() // { CT, T }
game.getPlayersForRadar()
game.getHudState()                      // ensambla el HUD de UI
game.getScoreboardData()
game.getBuyMenuData()
game.buyItem(id)                        // delega en weapons; { ok, message }
game.buyZoneFor(team)                   // bool para el jugador
game.showActionProgress(label, progress) / game.hideActionProgress()
game.setRoundBanner(title, subtitle, winner) / game.hideRoundBanner()
game.showRoundResult(data) / game.showMatchEnd(data)
game.flashPlayer(alpha)                 // flashbang en UI
game.toast(text)
game.log(text)                          // consola del juego
game.setCameraShake(amount)
game.spawnPlayer(team, spawn)           // reposiciona al jugador
game.onRoundStarted()                   // rounds avisa al game
game.onRoundEnded(winner, reason, data) // rounds avisa al game
```

`game.canUseWeapons()` -> bool (ronda viva, jugador vivo, sin menús, pointer lock).
`game.canMove()` -> bool.

## `MapData`

`buildMap(game, mapId)` exportado desde `src/world/maps.js` devuelve:

```js
{
  id, name, displayName, mode: 'bomb'|'hostage', description,
  root: THREE.Group,                    // añadido a game.scene, con dispose()
  colliders: THREE.Box3[],              // incluye suelo, paredes, cajas, techos
  spawns: { CT: [{x,y,z,yaw}], T: [...] },
  buyZones: { CT: {min:{x,z}, max:{x,z}}, T: {...} },
  bombsites: [{ name:'A', x, z, radius, min:{x,z}, max:{x,z} }],
  hostageSpawns: [{ id, x, z }],
  rescueZone: { x, z, radius },
  waypoints: [{ id, x, y, z, links, tags }],
  callouts: [{ name, min:{x,z}, max:{x,z} }],
  bounds: { minX, maxX, minZ, maxZ },
  ambient: { skyTop, skyBottom, fog, sunColor, sunIntensity, hemiColor, hemiIntensity },
  dispose()
}
```

Llamar `game.scene.add(data.root)` dentro de `buildMap`. Nunca tocar `game.scene` fuera del root.

## `WeaponSystem` (combat-weapons)

Se instancia como `new WeaponSystem(game)`; `game.weapons = weapons`; llamar `weapons.init()` después
de crear cámara/jugador.

```js
weapons.init()
weapons.resetForMatch(team)                 // pistola inicial + cuchillo, dinero inicial
weapons.resetForRound(team)                 // conserva armas si sobrevivió; sino pistola
weapons.update(dt)                          // lee input, dispara, recarga, cambia armas, granadas
weapons.giveWeapon(id, { silent })
weapons.removeWeapon(id)
weapons.buyItem(id)                         // -> { ok, message }
weapons.hasWeapon(id)
weapons.selectSlot(n)                       // 1 primary, 2 pistol, 3 knife, 4 grenade, 5 c4
weapons.getHudState()
weapons.getBuyMenuData()
weapons.isScoped()
weapons.dropAll()
```

`WEAPONS` debe tener al menos: `knife`, `glock`, `usp`, `deagle`, `mp5`, `ak47`, `m4a1`,
`awp`, `scout`, `xm1014`, `m3`, `m249`, `he`, `flash`, `smoke`, `c4`.
Cada arma: `{ id, name, slot, price, team, damage, fireRate, auto, magazine, reserve, reloadTime,
spread, moveSpread, recoil, range, killReward, headshotMult, icon }`.

## `BotManager` (bot-ai)

```js
new BotManager(game)                        // game.map ya existe
bots.spawnAll(config)                       // crea bots; excluye al jugador
bots.resetRound(roundNumber)                // respawn de todos los bots
bots.update(dt)
bots.aliveCount(team)
bots.getBots()
bots.getBotHitboxes(bot) -> [{ part, box, damageMult }]
bots.damageBot(bot, amount, source, part, weaponId)
bots.onRoundEnd(winner)
bots.dispose()
```

Bot: `{ id, name, team, pos:Vector3, vel:Vector3, yaw, pitch, health, armor, helmet, alive,
weaponId, ammo, magazine, kills, deaths, money, isBot:true, hasBomb, hasKit, group, radius,
height, skill }`.
Los bots deben usar `game.rounds` para leer `phase`, `bomb`, `hostages` y `game.map` para waypoints.
No mutar el jugador salvo `game.damagePlayer`.

## `RoundManager` (round-modes)

```js
new RoundManager(game)                      // game.map y game.bots existen
rounds.startMatch(config)                   // prepara scores, dinero, primera ronda
rounds.update(dt)
rounds.getHudState()
rounds.getScoreboardData()
rounds.onPlayerKilled()
rounds.onBotKilled(bot)
rounds.notifyBombPlanted(site) / notifyBombDefused() / notifyHostageRescued()
rounds.phase                                // 'freeze'|'live'|'over'|'matchover'
rounds.bomb                                 // { planted, plantedBy, site, x,z, timeLeft, defusing, defuseProgress, planting, plantProgress, exploded, defused }
rounds.hostages                             // [{ id, x,z, rescued, following, carrier }]
rounds.matchOver                            // bool
rounds.canControlPlayer()                   // false en freeze/over/matchover
```

Debe llamar `game.onRoundStarted()` y `game.onRoundEnded(winner, reason, data)`. La UI de fin de
ronda y los banners los controla `game.rounds` a través de `game.showRoundResult(...)`.

## `UI` (ui-designer)

`new UI(game)`; `game.ui = ui`; `ui.init()`.

```js
ui.init()                                   // construye DOM, quita #boot-screen
ui.showMainMenu()
ui.showCreateGame()
ui.showOptions()
ui.showLoading(text)
ui.hideAll()
ui.showHUD() / ui.hideHUD()
ui.updateHUD(hud)                           // cada frame
ui.showBuyMenu(data) / ui.closeBuyMenu() / ui.updateBuyMenu(data)
ui.openScoreboard(data) / ui.closeScoreboard()
ui.showPauseMenu() / ui.hidePauseMenu()
ui.showOptions()                            // desde pausa; al cerrar vuelve a pausa
ui.showRoundBanner(title, subtitle, winner)
ui.hideRoundBanner()
ui.showRoundResult(data)
ui.showMatchEnd(data)
ui.addKillFeed(entry)
ui.showDamage(fromAngle)
ui.flash(alpha)                             // flashbang overlay
ui.showActionProgress(label, progress)
ui.hideActionProgress()
ui.toast(text)
ui.setCrosshair(hud.crosshair)
ui.showHitmarker(headshot)
ui.showCenterMessage(text, ms)
ui.isOverlayOpen                            // menú/pausa/buy/resultados
ui.isBuyMenuOpen
ui.isScoreboardVisible
ui.lockedForGameplay                        // true cuando no hay overlay
ui.dispose()
```

Todos los botones de menú llaman a `game.startMatch`, `game.pause`, etc. La UI no simula lógica.

## `AudioEngine` (Lead)

```js
audio.init()                                // en el primer gesto del usuario
audio.play(name, opts)                      // ver lista en src/core/audio.js
audio.startAmbient(mapId) / audio.stopAmbient()
audio.setVolume(v)
audio.setMuted(bool)
```

## `Effects` (Lead)

```js
effects.bulletImpact(point, normal, surface)
effects.tracer(from, to, color)
effects.muzzleFlash(position, dir, scale)
effects.blood(point, dir)
effects.explosion(position)
effects.smokeCloud(position, duration)
effects.shellEject(position, dir)
effects.bombBeepLight(position, color)
effects.update(dt)
effects.dispose()
```

## Controles

WASD mover · ratón mirar · clic disparar · R recargar · 1-5 armas · B comprar · E usar/plantar/desfuse ·
G tirar arma · Ctrl agacharse · Shift caminar · Space saltar · Tab scoreboard · Esc pausa · ` (backtick) consola.

## Reglas de integración

1. No editar archivos de otro dueño. Si necesitas un método nuevo, pídelo al Lead.
2. Importar Three.js siempre con `import * as THREE from '../../vendor/three.module.js';`
   (ajustar `../` según la carpeta).
3. Nada de assets externos ni CDN: todo local/procedural.
4. Nada de librerías nuevas sin aprobación; ya está Three.js vendorizado.
5. Probar sintaxis con `node --check archivo.js` antes de terminar.
6. Dejar un resumen de la API final y cualquier desviación en un mensaje al Lead.
7. Escribir en español los textos de interfaz; nombres de armas/mapas en su forma original.
8. Rendimiento objetivo: < 1200 draw calls, < 250k triángulos. Compartir materiales.
