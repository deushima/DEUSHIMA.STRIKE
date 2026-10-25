# Gameplay API — bots + rondas + armas

Complementa `CONTRACTS.md`. `game.js` ya está implementado: leerlo antes de escribir.

## BotManager (`src/bots.js`)

```js
export class BotManager {
  constructor(game)
  spawnAll({ botsCT, botsT, difficulty, teamSize })
  resetRound(roundNumber)          // respawn de todos, limpia hasBomb/hasKit/muerte
  setBombCarrier(bot)              // marca bot.hasBomb=true; el resto false
  update(dt)
  getBots()
  getBotHitboxes(bot)              // [{ part, box:THREE.Box3, damageMult }]
  damageBot(bot, amount, source, part, weaponId) // devuelve daño aplicado
  aliveCount(team)
  dispose()
}
```

Reglas:

- `game.notifyKill(killer, bot, weaponId, headshot)` es el ÚNICO lugar que incrementa
  `kills/deaths` y avisa a rondas. `damageBot` NO debe incrementar `deaths` ni llamar
  `rounds.onBotKilled`.
- `damageBot` aplica armadura/helmet del bot, efectos (`game.effects.blood`), audio de impacto,
  y si `health <= 0` marca `alive=false`, reproduce muerte, llama `game.notifyKill(...)`.
- Bots enemigos del jugador y entre sí. No friendly fire.
- Para disparar: `game.raycastShot(ojo, dirConError, rango, bot.team)`; si `type==='player'`
  -> `game.damagePlayer(dañoBase, bot, hit.part, bot.weaponId)`; si `type==='bot'` ->
  `game.damageBot(hit.entity, dañoBase, bot, hit.part, bot.weaponId)`. Usar tracer/muzzle flash.
- Navegación por `game.map.waypoints` (A* o Dijkstra). Movimiento con `game.physics.moveBody(botBody, dt)`;
  `botBody` = `{ pos, vel, radius:0.38, height:1.8, stepHeight:0.4, onGround }` y aplicar gravedad.
- Leer objetivos de `game.rounds`:
  - `rounds.phase` (`freeze`|`live`|`over`|`matchover`)
  - `rounds.bomb` = `{ planted, x, z, site, timeLeft }`
  - `rounds.siteTarget` = `'A'|'B'`
  - `rounds.hostages` = `[{ id, x, z, rescued, following, carrier }]`
  - `rounds.bombCarrier` (bot o `game.player`)
- T: portador de bomba va a `siteTarget`; al llegar se detiene y rondas planta automáticamente.
  Resto de T escolta/defiende. Si bomba plantada, defender alrededor de `bomb`.
- CT: si bomba plantada, ir a la bomba (rondas desfusea automáticamente si un CT está cerca);
  si no, repartirse A/B. En `cs_office`, ir a rehenes y luego a `rescueZone`.
- En `freeze` no avanzar (mirar/animar quieto).
- Dificultad: `easy|normal|hard|expert` afecta precisión, tiempo de reacción, cadencia de ráfaga y
  velocidad de giro. Los bots no deben ser aimbots perfectos.
- Modelo low-poly procedural: cabeza, torso, piernas, brazos, arma, colores de equipo (CT azul
  oscuro/gris, T marrón/oliva). Animación de caminar, muerte (caer) y cuerpo visible 5-8 s.
- `ping` estable inventado (5-90) y `money` para scoreboard.
- Al morir el jugador, los bots siguen jugando la ronda.

## RoundManager (`src/rounds.js`)

```js
export class RoundManager {
  constructor(game)
  startMatch(config)
  update(dt)
  getHudState()
  canControlPlayer()
  onPlayerKilled()
  onBotKilled(bot)
  dispose()
  // campos públicos
  phase; roundNumber; scoreCT; scoreT; bomb; hostages; siteTarget; bombCarrier;
  matchOver; buyTimeLeft;
}
```

### Flujo

- `startMatch(config)`: scores 0-0, roundNumber=1, dinero inicial $800, loss streaks 0,
  luego `startRound()`.
- `startRound()`:
  1. `phase='freeze'`, freezeTime=6, buyTimeLeft=15, timeLeft=roundTime (115).
  2. Elegir spawns (`game.map.spawns`), respawnear jugador con `game.spawnPlayer(team, spawn)`.
  3. `game.weapons.resetForRound(team)` (si murió, ya se hizo `dropAll`, recibe pistola).
  4. `game.bots.resetRound(roundNumber)`.
  5. Elegir `siteTarget` A/B.
  6. Bomba: si el jugador es T, `player.hasBomb=true`, `bombCarrier=player`; si no, elegir un bot T
     vivo, `bombCarrier=bot`, `game.bots.setBombCarrier(bot)`.
  7. Rehenes: en `cs_office`, crear 2 rehenes en `map.hostageSpawns`, `following=null`.
  8. `game.onRoundStarted({ round: roundNumber })`.
- `update(dt)`:
  - freeze: descontar; al llegar a 0 `phase='live'`; los jugadores no se mueven durante freeze.
  - buyTimeLeft desciende desde 15.
  - live: timeLeft desciende. En modo bomb si llega a 0 y no hay bomba plantada -> CT gana.
    En hostage si llega a 0 -> T gana.
  - bomba plantada: timer 40s, beeps con `game.audio.play('bomb_beep')`, al explotar -> T gana.
  - defuse: si CT (jugador con E o bot cerca) completa 10s (5s con kit) -> CT gana.
  - plant: jugador T con bomba dentro del sitio mantiene E 3.2s (barra UI); bots T con bomba se
    plantan automáticamente al estar quietos en el sitio 1s. Al plantar: `bomb={planted:true,...}`,
    `player.hasBomb=false`, sonido, +$300 al plantador y +$800 al equipo T si pierde (aproximado).
  - rehenes: CT a menos de 2 m mantiene E para escoltar; el rehén sigue al portador. Al llegar a
    `rescueZone` se rescatan. Todos rescatados -> CT gana.
  - `onPlayerKilled()` / `onBotKilled(bot)` -> `checkRoundEnd()`.
- `checkRoundEnd()`:
  - bomba explotada/defusada; CT sin vivos -> T; T sin vivos y bomba NO plantada -> CT;
    tiempo agotado; rehenes rescatados.
  - Importante: si la bomba está plantada, la ronda NO termina por que no queden T.
  - Al terminar: `phase='over'`, sumar score, economía (win $3250, loss bonus 1400+500*streak,
    máximo 3400), `game.onRoundEnded(winner, reason, data)`, intermission 5s.
  - Si un equipo llegó a `roundsToWin` o se agotaron las rondas: `matchOver=true`, intermission y
    `game.showMatchEnd(data)`.
  - `data`: `{ scoreCT, scoreT, round, winner, reason, playerTeam, matchOver }`.
- `getHudState()` debe devolver exactamente:
```js
{
  phase, round, roundNumber, timeLeft, freezeLeft, buyTimeLeft,
  scoreCT, scoreT, objective, teamAlive: {CT,T},
  bomb: { planted, site, timeLeft, x, z, defusing, defuseProgress, planting, plantProgress },
  hostages: { total, rescued, carrying },
  message
}
```
- `canControlPlayer()`: true solo en `live` y jugador vivo (y sin matchOver).
- La UI usa `game.showActionProgress(label, 0..1)` para plantar/desfusear/escoltar.
- Para el HUD del jugador: `game.getHudState()` ya toma `roundHud.objective`, etc.
- `dispose()`: limpiar malla de bomba, rehenes y timers.

## WeaponSystem (`src/weapons.js`)

- `getHudState()`:
```js
{
  name, weaponId, ammo, reserve, slot, slots:[{slot,id,name,ammo,reserve,active}],
  grenades:[{id,name,count}], hasC4, hasKit, spread, scoped
}
```
- `getBuyMenuData()`:
```js
{
  money, team, categories: [{key:'1', name:'Pistolas', items:[
    {id, name, price, team, available, owned, description, icon}
  ]}]
}
```
- `getKillReward(weaponId)`, `getName(weaponId)`, `dispose()`, `dropAll()`, `setVisible(bool)`.
- `buyItem(id)` valida dinero/equipo/slots, descuenta `game.player.money`, devuelve `{ok,message}`.
- El daño que pasa a `game.damagePlayer/damageBot` es daño BASE; el game ya aplica multiplicador
  por zona (head x4, stomach x1.25, legs x0.75).
- El viewmodel va como hijo de `game.camera` y debe ocultarse cuando `!game.canUseWeapons()` y en
  `dispose()`. No bloquear el menú (la cámara se usa en preview).
- Armas mínimas: knife, glock, usp, deagle, mp5, ak47, m4a1, awp, scout, xm1014, m3, m249,
  he, flash, smoke, c4. Precios/daños aproximados a CS 1.6.
- Compras CS 1.6: 1 pistolas, 2 escopetas, 3 SMG, 4 rifles, 5 ametralladoras, 6 munición primaria,
  7 munición secundaria, 8 equipamiento. En este juego se puede simplificar munición.
- `B` abre/cierra compra (game lo maneja). Las teclas 1-8 y clics los maneja la UI.
