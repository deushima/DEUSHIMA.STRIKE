# ONLINE 1v1 — contrato de integración

Modo nuevo: **Online 1v1 en `aim_1v1`**, host crea sala con código, amigo se une, lobby con READY,
partida a **10 kills**, respawn 2 s, sin economía ni rondas. Host autoritativo.

## Archivos y dueños

| Archivo | Dueño |
|---|---|
| `src/online/session.js` | online-net |
| `src/online/match.js` | online-net |
| `src/online/avatar.js` | online-net |
| `src/world/aim_map.js` | map-builder |
| `src/ui/online-ui.js`, `src/ui/online-ui.css` | ui-designer |
| `game.js`, `weapons.js`, `index.html`, `vercel.json` | Lead |

PeerJS 1.5.4 ya está vendorizado en `vendor/peerjs.min.js` y cargado como script global (`window.Peer`).
No agregar CDNs ni dependencias nuevas.

## Flujo

1. Menú principal → botón **ONLINE 1V1** (lo inserta `OnlineUI`).
2. Home: nombre + **CREAR SALA** o código + **UNIRSE**.
3. Host crea PeerJS con id `cs16aim<CODE>` (`CODE` = 5 chars A-Z/2-9). Recibe código y link
   `?join=CODE`. Espera.
4. Guest crea Peer aleatorio y conecta al id del host. Envía `hello {name}`.
5. Host responde `lobby`:
```js
{
  code, mode: '1v1', map: 'aim_1v1', targetKills: 10,
  host: { name, ready, connected: true },
  guest: { name, ready, connected: true } // null mientras no hay guest
}
```
6. Los dos ven el lobby y el código. `setReady(true/false)`; el host actualiza y difunde `lobby`.
7. Cuando ambos `ready`, el host (tras ~500 ms) envía `start` y emite el evento local:
```js
{
  role: 'host'|'guest', code,
  names: { host: '...', guest: '...' },
  hostTeam: 'CT', guestTeam: 'T',
  startAt: <Date.now()+1500>, targetKills: 10
}
```
8. `Game.startOnlineMatch(startPayload)` carga `aim_1v1`, crea `OnlineMatch` y arranca. Los dos
   clientes ejecutan lo mismo al recibir `start` (host también).
9. Partida host-autoritativa. Primero a 10 kills. Al terminar: `matchEnd` y overlay de resultado.
10. **REVANCHA** (solo host): vuelve al lobby y resetea ready. **SALIR**: cierra sesión y menú.

## `src/online/session.js`

```js
export class OnlineSession {
  constructor(game, handlers = {})
  // handlers: onStatus(status), onLobby(lobby), onStart(payload), onMatchMessage(type,payload),
  //           onClosed(reason), onError(message)
  async host(name)                       // -> { code, link }
  async join(code, name)                 // -> void (resuelve al conectar y recibir lobby)
  setReady(value)                        // true/false
  send(type, payload)                    // mensaje de partida al otro peer
  resetToLobby()                         // solo host: ready=false y difunde lobby
  close(reason = 'Saliste de la sala')
  get role()                             // 'host'|'guest'|null
  get code()
  get lobby()
  get connected()
  get remoteName()
}
```

- `onStatus({phase, message})` fases: `creating`, `waiting`, `connecting`, `connected`, `error`,
  `closed`. La UI muestra mensajes.
- Errores de PeerJS (`unavailable-id`, `peer-unavailable`, `network`, `server-error`, etc.) se
  traducen a español y se emiten en `onError`.
- Host reintenta códigos si `unavailable-id` (hasta 5).
- Guest timeout de conexión 15 s.
- Máximo 2 jugadores: tercera conexión recibe `{t:'full'}` y se cierra.
- `send` durante la partida: host→guest o guest→host.
- `onMatchMessage(type,payload)` se dispara en ambos lados para mensajes de partida.
- `start` lo emite el host a ambos. `resetToLobby` emite `lobby` en ambos.
- Cerrar PeerJS y conexiones en `close()`, limpiar timers.
- No usar `game` para lógica de partida; solo para `toast`/`audio` si hace falta.

Mensajes internos de sesión: `hello`, `lobby`, `ready`, `start`, `full`, `restartLobby`, `ping`.
Mensajes de partida se enrutan por `onMatchMessage`: `state`, `shot`, `shotFx`, `hit`, `kill`,
`respawn`, `snapshot`, `matchEnd`, `pong`, `readyRematch`.

## `src/online/match.js`

```js
export class OnlineMatch {
  constructor(game, session, startPayload)
  start()                                // llamado por Game después de spawnear jugador/armas
  update(dt)
  canControl()                           // false en countdown/muerto/over
  getRemoteEntity()                      // { pos:Vector3, height, radius, team, name, isRemote:true, alive }
  getRemoteHitboxes()                    // game.getPlayerHitboxes(remote)
  notifyLocalShot(shot)                  // ver abajo
  handleMessage(type, payload)
  onKill(killer, victim, weaponId, headshot) // lo llama Game.notifyKill en online
  getHudState()                          // datos para OnlineUI
  getScoreboardData()
  requestRematch()                       // host
  dispose()
}
```

### Estado de partida

- 2 jugadores: host CT, guest T (o lo que diga `startPayload`). `targetKills=10`.
- Countdown 1.5 s (`startAt`), luego `phase='live'`.
- Health 100, armor 100, helmet. Loadout online: rifle del equipo + Desert Eagle + cuchillo,
  munición completa. `Game.setupOnlineLoadout()` lo aplica.
- Respawn 2 s después de morir en el spawn del equipo.
- Kill: host suma score, difunde `kill` y `snapshot`; guest refleja.
- Match end al llegar a 10; `phase='over'`; `matchEnd`.
- `getHudState()`:
```js
{
  phase, scoreHost, scoreGuest, scoreYou, scoreThem,
  targetKills, health, armor, alive, respawnIn,
  ping, names: { host, guest }, role,
  remote: { health, alive, name, team }
}
```
- `Game` ya incluye esto en `getHudState().online`; `OnlineUI` lo consume.
- Ping: `ping` cada 1 s con `t=Date.now()`; el otro responde `pong`; RTT = now-t.

### Disparos y daño

`WeaponSystem._fire` (Lead) va a llamar, después de cada disparo:

```js
game.online.notifyLocalShot({
  origin: THREE.Vector3,       // ojo del tirador
  dir: THREE.Vector3,          // dirección con dispersión
  weaponId: 'ak47',
  hit: null | {                // resultado del raycast local contra el avatar remoto
    entity, part, point: THREE.Vector3
  }
});
```

- **Host**: difunde `shotFx` al guest con `{origin, dir, weaponId, point}`. Si `hit` es del guest,
  aplica daño autoritativo a `guestHealth` (multiplicadores de zona + armadura/casco), emite `hit`
  al guest con `{health, damage, part, headshot, point}`. Si mata: `kill`, score y respawn.
- **Guest**: envía `shot` al host con `{origin, dir, weaponId}`. El host recalcula el raycast desde
  ese origen/dirección contra **su propio jugador** (`game.getPlayerHitboxes(game.player)`) y aplica
  daño con `game.damagePlayer(...)` (esto dispara `notifyKill` → `online.onKill`). Si no impacta,
  envía `hit {miss:true}`.
- **Host recibe `shot` del guest**: reproduce FX remoto; recalcula el impacto contra sí mismo y
  aplica daño; manda `hit`.
- **Guest recibe `shotFx` del host**: reproduce FX remoto (sonido, muzzle, tracer).
- `hit` en guest: actualizar `player.health`, `player.armor`, blood/flash, audio, hitmarker. Si
  `health<=0`, `_localDeath()` sin llamar `notifyKill`.
- `onKill`: host-score++, difunde `kill {victim:'host'|'guest', killer, weapon, headshot}`; agenda
  respawn. En guest, `kill` solo muestra killfeed y muerte local si corresponde.
- `Game.notifyKill` en online delega a `online.onKill` y NO toca rondas/bots.
- El host no debe matar dos veces al mismo jugador en la misma vida.

### Avatar remoto (`src/online/avatar.js`)

- Low-poly procedural (~15 cajas): piernas, torso, chaleco, brazos, cabeza, casco/gorra, arma.
  Colores CT azul/gris, T marrón/oliva; escala 1.8 m.
- `RemoteAvatar(game, {name, team})`:
  - `group`, `pos`, `yaw`, `pitch`, `alive`, `height`, `radius`.
  - `setTarget(pos, yaw, pitch, crouch, alive)`; `update(dt)` interpola posición y yaw.
  - `playHit()`, `playDeath()`, `respawn()`, `dispose()`.
- Sin colisiones con el jugador; solo visual + hitboxes vía `game.getPlayerHitboxes(remoteEntity)`.

### Mensajes de red de partida

```
state        {pos:{x,y,z}, yaw, pitch, crouch, alive}   20 Hz
shot         {origin:{x,y,z}, dir:{x,y,z}, weaponId}    guest→host (host valida)
shotFx       {origin, dir, weaponId, point}             host→guest (solo FX)
hit          {health, armor, damage, part, headshot, point, miss?}
kill         {victim:'host'|'guest', killer:'host'|'guest', weapon, headshot, scoreHost, scoreGuest}
respawn      {who:'host'|'guest', pos, yaw, health}
snapshot     {hostHealth, guestHealth, scoreHost, scoreGuest, phase, respawnHost, respawnGuest} 10 Hz
matchEnd     {winner:'host'|'guest', scoreHost, scoreGuest}
ping/pong    {t}
```

## `src/world/aim_map.js`

```js
export const AIM_MAP_INFO = { id:'aim_1v1', name:'aim_1v1', displayName:'AIM_MAP 1v1', mode:'aim', ... };
export function buildAimMap(game) -> MapData
```

- Arena simétrica ~34×26 m, suelo, muros perimetrales, techo abierto/cielo, 2 spawns enfrentados
  (CT sur, T norte), cajas/barriles/plataformas centrales y coberturas laterales.
- Sin bombsites, sin hostageSpawns, `buyZones` vacíos, `mode:'aim'`, `rescueZone:null`.
- Colliders sólidos, bounds, ambient, `menuCamera` opcional, `waypoints` (aunque no se usen), `dispose()`.
- Estética CS 1.6: arena desértica/industrial low-poly, crates de madera, metal, sol, niebla suave.
- Todos los spawns libres y con vista al centro. 2 spawns por equipo como mínimo.

## `src/ui/online-ui.js` + `online-ui.css`

`OnlineUI` se instancia en `Game` como `game.onlineUI` y se inicializa después de `ui.init()`.

```js
new OnlineUI(game)
onlineUI.init()                    // inyecta botón ONLINE 1V1 en el menú principal
onlineUI.openHome()                // pantalla crear/unirse
onlineUI.showLobby(lobby)
onlineUI.updateLobby(lobby)
onlineUI.showStatus(phase, message)
onlineUI.showError(message)
onlineUI.hide()
onlineUI.showMatchEnd(data)
onlineUI.updateHud(onlineHud)      // cada frame (~10 Hz) durante la partida
onlineUI.isOpen
onlineUI.dispose()
```

- **Botón**: insertar `<button class="menu-btn" data-action="online-play">02 ONLINE 1V1 <span class="mb-hint">MULTIJUGADOR</span></button>`
  después de JUGAR en `.menu-left nav`; renumerar los siguientes índices. Al click: `openHome()`.
  `game.ui.hideAll()` para ocultar menús, overlay a pantalla completa.
- **Home**: dos paneles: CREAR SALA (nombre) y UNIRSE (código 5 + nombre). Botones
  `CREAR SALA`, `UNIRSE`, `VOLVER`. Código desde `?join=CODE` se precarga.
- **Host**: llama `await game.onlineSession.host(name)`, muestra código grande, botón COPIAR CÓDIGO
  y COPIAR LINK (`location.origin + location.pathname + '?join=' + code`), estado "Esperando
  jugador...". Al llegar guest muestra lobby.
- **Join**: llama `await game.onlineSession.join(code, name)`, muestra "CONECTANDO..." y luego lobby.
- **Lobby**: dos slots (host y guest) con nombre y READY/PENDIENTE; código; botón READY / CANCELAR;
  botón SALIR; mensaje "ESPERANDO AL OTRO JUGADOR". Host y guest usan el mismo lobby. Al hacer
  READY: `game.onlineSession.setReady(!localReady)`; el botón muestra "LISTO ✓" o "READY".
- **Errores**: panel con mensaje y VOLVER. Timeout/peer-unavailable.
- **Partida**: `hide()`; `document.documentElement.classList.add('online-match')`.
  - Online HUD propio arriba centro: `HOST 3 : 2 GUEST` (nombres), `PRIMERO A 10`, ping, y
    `RESPAWN 1.8` cuando muere. Ocultar el scorebar/timer original con CSS:
    `html.online-match .hud-top { display:none !important; }`.
  - El resto del HUD (salud, munición, radar, killfeed, crosshair) sigue funcionando.
- **Match end**: overlay con marcador, ganador, botones REVANCHA (solo host) y SALIR. Guest ve
  "ESPERANDO REVANCHA DEL HOST".
- **Salir**: `game.leaveOnline()` (Lead) cierra sesión, saca `online-match`, muestra menú.
- Todos los nombres se insertan con `textContent` (no HTML). Sin assets externos.
- Estética CS 1.6 coherente con `ui.css`: paneles oscuros, biseles, ámbar/verde, Trebuchet MS.

## Game (Lead implementará)

- `game.onlineSession`, `game.onlineUI`, `game.online` (OnlineMatch|null), `game.onlineStartPayload`.
- `Game.startOnlineMatch(payload)`:
  - carga `aim_1v1` (buildAimMap), crea jugador con equipo host/guest, `setupOnlineLoadout()`,
    oculta UI, muestra HUD, crea `OnlineMatch`, `online.start()`, pide pointer lock.
- `setupOnlineLoadout()`: rifle M4A1 (CT) / AK-47 (T), Deagle, cuchillo, armor 100, helmet.
- `leaveOnline(reason)`: dispose match/session, vuelve al menú.
- `game.notifyKill` online → `online.onKill`.
- `game.raycastShot` incluye `game.online.getRemoteHitboxes()` con `type:'remote'`.
- `game.notifyLocalShot`/weapons hook.
- `game.getHudState` incluye `online`; `getScoreboardData` online.
- `game.canMove`/`canUseWeapons` requieren `!online || online.canControl()`.
- `game.update` actualiza online y omite bots/rondas.
- `game.quitToMenu` cierra online.

## Invitación / deploy

- URL de invitación: `?join=CODE`.
- El juego se publica en Vercel como sitio estático. PeerJS usa la nube pública (`0.peerjs.com`).
- Sin TURN propio: redes muy restrictivas pueden necesitar otro proveedor; documentarlo.
