/**
 * Duelo 1v1 rÃ¡pido â€” DEUSHIMA STRIKE
 *
 * Reglas:
 *  - sin freeze: la ronda arranca en el instante en que se respawnea
 *  - un kill cierra la ronda
 *  - se espera la animaciÃ³n de muerte/caÃ­da (0.95 s) y arranca la siguiente
 *  - primero a 13 rondas; 12-12 es empate
 *  - sin tiempo de ronda (se define por kill)
 */
import { clamp } from './core/utils.js';

const DEATH_ANIM = 0.95;
const START_BANNER = 900;

export class Duel {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';
    this.roundNumber = 0;
    this.scoreCT = 0;
    this.scoreT = 0;
    this.roundsToWin = 13;
    this.maxRounds = 24;
    this.timeLeft = 0;
    this.freezeLeft = 0;
    this.intermissionLeft = 0;
    this.deathLeft = 0;
    this.matchOver = false;
    this._roundEnded = true;
    this._lastWinner = null;
    this._lastReason = '';
    this._bannerTimer = null;
    this._matchTimer = null;
    this.playerTeam = game.player?.team || 'CT';
    this._botTeam = this.playerTeam === 'CT' ? 'T' : 'CT';
  }

  startMatch(config = {}) {
    this.roundsToWin = clamp(Number(config.roundsToWin) || 13, 1, 30);
    this.maxRounds = Math.max(1, this.roundsToWin * 2 - 2);
    this.roundNumber = 0;
    this.scoreCT = 0;
    this.scoreT = 0;
    this.matchOver = false;
    this._lastWinner = null;
    this.playerTeam = this.game.player.team;
    this._botTeam = this.playerTeam === 'CT' ? 'T' : 'CT';
    this.startRound();
  }

  _givePlayerLoadout() {
    const game = this.game;
    const player = game.player;
    const rifle = player.team === 'CT' ? 'm4a1' : 'ak47';
    const pistol = player.team === 'CT' ? 'usp' : 'glock';
    player.money = 0;
    player.health = 100;
    player.armor = 100;
    player.helmet = true;
    player.alive = true;
    player.spawnProtection = 0.55;
    game.weapons?.resetForMatch?.(player.team);
    game.weapons?.giveWeapon?.(rifle, { silent: true });
    game.weapons?.giveWeapon?.(pistol, { silent: true });
    game.weapons?.giveWeapon?.('knife', { silent: true });
    try { game.weapons?._equip?.(rifle, { silent: true }); } catch { /* ignore */ }
  }

  _giveBotLoadout() {
    const bots = this.game.bots;
    if (!bots) return;
    const rifle = this._botTeam === 'CT' ? 'm4a1' : 'ak47';
    for (const bot of bots.getBots()) {
      bot.health = 100;
      bot.armor = 100;
      bot.helmet = true;
      bot.alive = true;
      bot.state = 'live';
      try {
        bots._giveBotWeapon(bot, rifle);
        bots._syncEquipment?.(bot);
        bots._equipWeaponVisual?.(bot);
      } catch (err) {
        console.warn('[duel] loadout bot', err);
        bot.weaponId = rifle;
      }
      bot.money = 0;
      bot.thinkTimer = 0;
    }
  }

  startRound() {
    if (this.matchOver) return;
    this.roundNumber += 1;
    this.phase = 'live';
    this._roundEnded = false;
    this.deathLeft = 0;
    this.freezeLeft = 0;
    this.timeLeft = 0;
    this._lastWinner = null;
    this._lastReason = '';
    this.game.state = 'playing';
    this.game.ui?.hideAll?.();
    this.game.ui?.showHUD?.();
    this.game.ui?.hideRoundResult?.();
    this.game.ui?.hideRoundBanner?.();
    this._hideBanner();

    const map = this.game.map;
    const spawns = map?.spawns?.[this.playerTeam] || [{ x: 0, y: 0.05, z: 0, yaw: 0 }];
    // Aparición aleatoria dentro del lado del equipo en cada ronda.
    const spawn = spawns[Math.floor(Math.random() * spawns.length)] || spawns[0];
    this.game.player.reset(this.playerTeam, spawn);
    this.game.player.alive = true;
    this._givePlayerLoadout();
    this.game.camera.fov = this.game.settings.fov;
    this.game.camera.updateProjectionMatrix();

    this.game.bots?.resetRound?.(this.roundNumber);
    this._giveBotLoadout();

    this._showBanner(`RONDA ${this.roundNumber}`, `${this.scoreCT}  Â·  ${this.scoreT}`, null, START_BANNER);
    this.game.audio?.play?.('round_start', { volume: 0.45 });
  }

  update(dt) {
    if (this.matchOver) return;
    if (this.phase === 'dying') {
      this.deathLeft = Math.max(0, this.deathLeft - dt);
      if (this.deathLeft <= 0) this._finishDeath();
      return;
    }
    if (this.phase === 'live') {
      // Sin lÃ­mite de tiempo: la ronda se define por eliminaciÃ³n.
    }
  }

  canControlPlayer() {
    return this.phase === 'live' && !this.matchOver && this.game.state === 'playing';
  }

  onPlayerKilled() {
    if (this._roundEnded || this.phase !== 'live') return;
    this._beginDeath(this._botTeam, 'PLAYER DOWN');
  }

  onBotKilled() {
    if (this._roundEnded || this.phase !== 'live') return;
    this._beginDeath(this.playerTeam, 'ENEMY DOWN');
  }

  _beginDeath(winner, reason) {
    this._roundEnded = true;
    this.phase = 'dying';
    this.deathLeft = DEATH_ANIM;
    this._lastWinner = winner;
    this._lastReason = reason;
    this.game.setCameraShake?.(winner === this.playerTeam ? 0.18 : 0.5);
    this.game.flashPlayer?.(winner === this.playerTeam ? 0.08 : 0.22);
    this.game.audio?.play?.(winner === this.playerTeam ? 'round_win' : 'round_lose', { volume: 0.7 });
  }

  _finishDeath() {
    const winner = this._lastWinner;
    this.phase = 'over';
    if (winner === 'CT') this.scoreCT += 1;
    else if (winner === 'T') this.scoreT += 1;

    const reached = this.scoreCT >= this.roundsToWin || this.scoreT >= this.roundsToWin;
    const draw = !reached && this.roundNumber >= this.maxRounds && this.scoreCT === this.scoreT;
    this.matchOver = reached || draw;
    const finalWinner = reached ? (this.scoreCT >= this.roundsToWin ? 'CT' : 'T') : null;

    if (this.matchOver) {
      this._showBanner(
        draw ? 'EMPATE' : finalWinner === this.playerTeam ? 'VICTORIA' : 'DERROTA',
        `${this.scoreCT}  Â·  ${this.scoreT}`,
        draw ? null : finalWinner,
        1600,
      );
      this.game.state = 'matchover';
      this._matchTimer = setTimeout(() => this._endMatch(finalWinner), 950);
    } else {
      // Sin intermission: al tocar el suelo arranca la siguiente ronda.
      this.startRound();
    }
  }

  _endMatch(winner) {
    this._hideBanner();
    this.game.state = 'matchover';
    const data = {
      winner: winner || '',
      draw: !winner,
      scoreCT: this.scoreCT,
      scoreT: this.scoreT,
      round: this.roundNumber,
      playerTeam: this.playerTeam,
      mode: 'duel',
      map: this.game.map?.id || 'aim_1v1',
    };
    try { this.game.showMatchEnd?.(data); } catch (err) { console.warn('[duel] match end', err); }
    this.game.audio?.play?.(winner === this.playerTeam ? 'match_win' : 'match_lose', { volume: 0.8 });
  }

  getHudState() {
    return {
      phase: this.phase,
      round: this.roundNumber,
      roundNumber: this.roundNumber,
      timeLeft: 0,
      freezeLeft: 0,
      buyTimeLeft: 0,
      scoreCT: this.scoreCT,
      scoreT: this.scoreT,
      roundsToWin: this.roundsToWin,
      objective: `DUELO 1V1 Â· PRIMERO A ${this.roundsToWin}`,
      teamAlive: this.game.getAliveCounts?.(),
      bomb: { planted: false },
      hostages: { total: 0, rescued: 0, carrying: 0 },
      message: this.phase === 'dying' ? 'KILL CONFIRMADO' : this.phase === 'over' ? 'RONDA TERMINADA' : '',
      matchOver: this.matchOver,
    };
  }

  getScoreboardData() {
    return this.game.getScoreboardData?.();
  }

  _showBanner(title, subtitle, winner, ms = 1200) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('classic-banner');
    if (!el) return;
    el.innerHTML = `<div class="cb-kicker">DEUSHIMA STRIKE Â· DUELO 1V1</div>
      <div class="cb-title">${title}</div>
      <div class="cb-sub">${subtitle || ''}</div>`;
    el.classList.remove('ct', 't');
    if (winner === 'CT') el.classList.add('ct');
    if (winner === 'T') el.classList.add('t');
    el.classList.add('show');
    this._clearBannerTimer();
    if (ms > 0) this._bannerTimer = setTimeout(() => this._hideBanner(), ms);
  }

  _hideBanner() {
    if (typeof document !== 'undefined') document.getElementById('classic-banner')?.classList.remove('show');
  }

  _clearBannerTimer() {
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = null;
  }

  dispose() {
    this._clearBannerTimer();
    if (this._matchTimer) clearTimeout(this._matchTimer);
    this._matchTimer = null;
    this._hideBanner();
  }
}

