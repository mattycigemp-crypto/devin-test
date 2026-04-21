// HUD updates.
import { fmtInt, clamp } from './utils.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      score: document.getElementById('score'),
      wave: document.getElementById('wave'),
      distance: document.getElementById('distance'),
      hull: document.getElementById('hull-bar'),
      boost: document.getElementById('boost-bar'),
      heat: document.getElementById('heat-bar'),
      damage: document.getElementById('damage-vignette'),
      pickups: document.getElementById('pickups'),
      combo: document.getElementById('combo'),
      comboX: document.getElementById('combo-x'),
      start: document.getElementById('start-screen'),
      pause: document.getElementById('pause-screen'),
      over: document.getElementById('gameover-screen'),
      loading: document.getElementById('loading'),
      finalScore: document.getElementById('final-score'),
      finalWave: document.getElementById('final-wave'),
      finalDistance: document.getElementById('final-distance'),
    };
    this._comboTimer = 0;
  }

  show(name) { this.el[name]?.classList.remove('hidden'); }
  hide(name) { this.el[name]?.classList.add('hidden'); }

  update(state) {
    this.el.score.textContent = fmtInt(state.score);
    this.el.wave.textContent = state.wave;
    this.el.distance.innerHTML = `${fmtInt(state.distance / 100)}<span class="unit"> km</span>`;
    const hullPct = clamp((state.hull / state.maxHull) * 100, 0, 100);
    this.el.hull.style.width = `${hullPct}%`;
    const boostPct = clamp((state.boost / state.maxBoost) * 100, 0, 100);
    this.el.boost.style.width = `${boostPct}%`;
    const heatPct = clamp((state.heat / state.maxHeat) * 100, 0, 100);
    this.el.heat.style.width = `${heatPct}%`;
  }

  flashDamage() {
    this.el.damage.classList.add('hit');
    setTimeout(() => this.el.damage.classList.remove('hit'), 220);
  }

  showCombo(mult) {
    if (mult <= 1) { this.el.combo.classList.add('hidden'); return; }
    this.el.comboX.textContent = `x${mult}`;
    this.el.combo.classList.remove('hidden');
    // Retrigger pop animation
    this.el.combo.style.animation = 'none';
    // eslint-disable-next-line no-unused-expressions
    this.el.combo.offsetHeight;
    this.el.combo.style.animation = '';
  }

  hideCombo() { this.el.combo.classList.add('hidden'); }

  pickupToast(text) {
    const el = document.createElement('div');
    el.className = 'pickup-toast';
    el.textContent = text;
    this.el.pickups.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  showGameOver(state) {
    this.el.finalScore.textContent = fmtInt(state.score);
    this.el.finalWave.textContent = state.wave;
    this.el.finalDistance.textContent = `${fmtInt(state.distance / 100)} km`;
    this.show('over');
  }
}
