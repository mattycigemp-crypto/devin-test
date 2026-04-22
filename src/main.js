// Nebula Rider — main entry and game state machine.
import * as THREE from 'three';
import { Renderer } from './renderer.js';
import { World } from './world.js';
import { Ship } from './ship.js';
import { Asteroids, Enemies, Bullets, Pickups, Particles } from './entities.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { clamp, rand, randi, chance, tmp } from './utils.js';

const STATE = { LOADING: 'loading', TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas);
    this.scene = this.renderer.scene;
    this.camera = this.renderer.camera;

    this.world = new World(this.scene);
    this.particles = new Particles(this.scene, 2000);
    this.bullets = new Bullets(this.scene);
    this.asteroids = new Asteroids(this.scene);
    this.pickups = new Pickups(this.scene);
    this.enemies = new Enemies(this.scene);
    this.ship = new Ship(this.scene);
    this.hud = new HUD();
    this.input = new Input(this.canvas);
    this.audio = new Audio();

    this.state = STATE.LOADING;
    this.time = 0;
    this.score = 0;
    this.combo = 1;
    this._comboTimer = 0;
    this.wave = 1;
    this._waveTimer = 0;
    this._spawnTimer = 0;
    this._enemySpawnTimer = 4;
    this._pickupTimer = 2;

    this._bindUI();
    this._onResize = () => this.renderer.resize();
    window.addEventListener('resize', this._onResize);

    requestAnimationFrame((t) => this._firstFrame(t));
  }

  _firstFrame(t) {
    this._lastT = t;
    // Hide loading after first render (so the sky has textures computed).
    this.renderer.render(0.016, 0);
    setTimeout(() => {
      this.hud.hide('loading');
      this.hud.show('start');
      this.state = STATE.TITLE;
    }, 600);
    requestAnimationFrame((t2) => this._loop(t2));
  }

  _bindUI() {
    document.getElementById('start-btn').addEventListener('click', () => this.start());
    document.getElementById('restart-btn').addEventListener('click', () => this.start());
    document.getElementById('resume-btn').addEventListener('click', () => this._resume());
    document.getElementById('quit-btn').addEventListener('click', () => {
      this._resume();
      this.quitToTitle();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') {
        if (this.state === STATE.PLAYING) this._pause();
        else if (this.state === STATE.PAUSED) this._resume();
      }
      if (e.code === 'KeyM') {
        this.audio.ensureStarted();
        this.audio.setMuted(!this.audio.muted);
      }
      if (e.code === 'Enter') {
        if (this.state === STATE.TITLE || this.state === STATE.OVER) this.start();
      }
    });
  }

  start() {
    this.audio.ensureStarted();
    this.audio.setIntensity(0.1);
    this.audio.startMusic();

    this.hud.hide('start');
    this.hud.hide('over');
    this.hud.show('hud');
    this.input.setEnabled(true);

    // Reset state
    this.asteroids.clear();
    this.pickups.clear();
    this.enemies.clear();
    for (let i = this.bullets.active.length - 1; i >= 0; i--) this.bullets.kill(this.bullets.active[i]);
    this.ship.reset();
    this.score = 0;
    this.combo = 1;
    this._comboTimer = 0;
    this.wave = 1;
    this._waveTimer = 0;
    this._spawnTimer = 0;
    this._enemySpawnTimer = 6;
    this._pickupTimer = 3;
    this.distance = 0;

    // Seed the scene with a few asteroids and a crystal so there's immediate action.
    for (let i = 0; i < 4; i++) this._spawnAsteroid();
    this._spawnPickup();

    this.hud.hideCombo();
    this.hud.update(this._hudState());
    this.state = STATE.PLAYING;
  }

  quitToTitle() {
    this.state = STATE.TITLE;
    this.input.setEnabled(false);
    this.hud.hide('hud');
    this.hud.hide('pause');
    this.hud.show('start');
    this.audio.stopMusic();
  }

  _pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.setEnabled(false);
    this.hud.show('pause');
  }

  _resume() {
    if (this.state !== STATE.PAUSED) return;
    this.hud.hide('pause');
    this.input.setEnabled(true);
    this.state = STATE.PLAYING;
  }

  _gameOver() {
    this.state = STATE.OVER;
    this.input.setEnabled(false);
    this.audio.explosion(1.6);
    this.renderer.shake(1.2);
    // Big finale burst
    this.particles.burst(this.ship.group.position, 0xff4bff, { count: 120, speed: 30, size: 1.4, life: 1.8 });
    this.particles.burst(this.ship.group.position, 0x5dc8ff, { count: 80, speed: 24, size: 1.0, life: 1.5 });
    this.particles.burst(this.ship.group.position, 0xffcf5b, { count: 60, speed: 18, size: 0.9, life: 1.2 });
    // Delay overlay so the explosion shows.
    setTimeout(() => this.hud.showGameOver(this._hudState()), 1500);
  }

  _hudState() {
    return {
      score: this.score,
      wave: this.wave,
      distance: this.distance,
      hull: this.ship.hull, maxHull: this.ship.maxHull,
      boost: this.ship.boost, maxBoost: this.ship.maxBoost,
      heat: this.ship.heat, maxHeat: this.ship.maxHeat,
    };
  }

  _addScore(n) {
    const mult = Math.min(8, this.combo);
    const added = Math.floor(n * mult);
    this.score += added;
    this.combo += 1;
    this._comboTimer = 2.5;
    this.hud.showCombo(Math.min(8, this.combo));
    return added;
  }

  _spawnWaveContent(dt) {
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      // Spawn asteroids in front of player
      const count = 1 + randi(0, 2) + Math.min(3, Math.floor(this.wave / 2));
      for (let i = 0; i < count; i++) this._spawnAsteroid();
      this._spawnTimer = rand(0.6, 1.2) - Math.min(0.6, this.wave * 0.04);
    }

    this._enemySpawnTimer -= dt;
    if (this.wave >= 2 && this._enemySpawnTimer <= 0) {
      this._spawnEnemy();
      this._enemySpawnTimer = rand(4, 8) - Math.min(3, this.wave * 0.25);
    }

    this._pickupTimer -= dt;
    if (this._pickupTimer <= 0) {
      this._spawnPickup();
      this._pickupTimer = rand(2.5, 5);
    }

    // Advance wave on distance thresholds
    this._waveTimer += dt;
    const waveDuration = 30;
    if (this._waveTimer >= waveDuration) {
      this._waveTimer = 0;
      this.wave += 1;
      this.audio.setIntensity(Math.min(1, this.wave * 0.12));
      this.audio.wave();
      this.hud.pickupToast(`WAVE ${this.wave}`);
    }
  }

  _spawnAsteroid() {
    const fwd = this.ship.forward;
    const basePos = this.ship.group.position.clone().addScaledVector(fwd, 180 + rand(0, 60));
    // Spread around forward cone
    basePos.x += rand(-60, 60);
    basePos.y += rand(-28, 28);
    const radius = rand(1.2, 4.5) * (1 + Math.min(1, this.wave * 0.05));
    // Velocity: drift slightly toward player but mostly ambient.
    const vel = new THREE.Vector3(rand(-2, 2), rand(-1, 1), rand(-8, -2));
    this.asteroids.spawn(basePos, radius, vel);
  }

  _spawnEnemy() {
    const fwd = this.ship.forward;
    const basePos = this.ship.group.position.clone().addScaledVector(fwd, 150 + rand(0, 40));
    basePos.x += rand(-40, 40);
    basePos.y += rand(-15, 15);
    this.enemies.spawn(basePos);
  }

  _spawnPickup() {
    const fwd = this.ship.forward;
    const basePos = this.ship.group.position.clone().addScaledVector(fwd, 120 + rand(0, 40));
    basePos.x += rand(-40, 40);
    basePos.y += rand(-18, 18);
    this.pickups.spawn(basePos);
  }

  _fire(dt) {
    this.ship.fireState(dt);
    if (this.input.firing() && this.ship.canFire() && this.ship.alive) {
      const { pos, dir } = this.ship.muzzleData();
      this.bullets.spawn(pos.clone().addScaledVector(dir, 1.5), dir, 220, true, 5);
      this.ship.registerShot();
      this.audio.laser();
      // Muzzle flash
      this.particles.burst(pos, 0x88eaff, { count: 8, speed: 6, size: 0.5, life: 0.2 });
    }
  }

  _collide() {
    const pp = this.ship.group.position;
    const pr = 1.1; // player radius

    // Player bullets vs asteroids & enemies
    for (let i = this.bullets.active.length - 1; i >= 0; i--) {
      const b = this.bullets.active[i];
      if (!b.userData.friendly) continue;
      const bp = b.position;
      // Asteroids
      let hit = false;
      for (let j = 0; j < this.asteroids.items.length; j++) {
        const a = this.asteroids.items[j];
        if (bp.distanceTo(a.position) < a.userData.radius + 0.4) {
          const dead = this.asteroids.damage(a, b.userData.damage, this.particles);
          this.particles.burst(bp, 0xffffff, { count: 10, speed: 8, size: 0.45, life: 0.35 });
          this.bullets.kill(b);
          if (dead) {
            const gained = this._addScore(Math.ceil(a.userData.maxHp * 20));
            this.hud.pickupToast(`+${gained}`);
            this.audio.explosion(clamp(a.userData.radius / 3, 0.5, 1.3));
            this.renderer.shake(0.25);
            // Chance to drop crystal
            if (chance(0.4)) this.pickups.spawn(a.position.clone());
            this.asteroids.destroy(a, this.particles);
          }
          hit = true; break;
        }
      }
      if (hit) continue;
      // Enemies
      for (let j = 0; j < this.enemies.items.length; j++) {
        const e = this.enemies.items[j];
        if (bp.distanceTo(e.position) < e.userData.radius + 0.4) {
          const dead = this.enemies.damage(e, b.userData.damage);
          this.particles.burst(bp, 0xff88aa, { count: 12, speed: 10, size: 0.55, life: 0.4 });
          this.bullets.kill(b);
          if (dead) {
            const gained = this._addScore(500);
            this.hud.pickupToast(`ENEMY +${gained}`);
            this.audio.explosion(1.0);
            this.renderer.shake(0.45);
            if (chance(0.85)) this.pickups.spawn(e.position.clone());
            this.enemies.destroy(e, this.particles);
          }
          break;
        }
      }
    }

    // Enemy bullets vs player
    for (let i = this.bullets.active.length - 1; i >= 0; i--) {
      const b = this.bullets.active[i];
      if (b.userData.friendly) continue;
      if (b.position.distanceTo(pp) < pr + 0.4) {
        const dead = this.ship.applyDamage(b.userData.damage, this.audio);
        this.hud.flashDamage();
        this.renderer.shake(0.4);
        this.particles.burst(b.position, 0xff4b78, { count: 16, speed: 12, size: 0.6, life: 0.5 });
        this.bullets.kill(b);
        if (dead) { this._gameOver(); return; }
      }
    }

    // Player vs asteroids
    for (let j = this.asteroids.items.length - 1; j >= 0; j--) {
      const a = this.asteroids.items[j];
      if (pp.distanceTo(a.position) < a.userData.radius + pr) {
        const dead = this.ship.applyDamage(clamp(a.userData.radius * 8, 10, 40), this.audio);
        this.hud.flashDamage();
        this.renderer.shake(0.6);
        this.particles.burst(pp, 0xff4bff, { count: 40, speed: 18, size: 0.9, life: 0.8 });
        this.audio.explosion(1.1);
        // Shatter asteroid
        this.asteroids.destroy(a, this.particles);
        this.combo = 1; this.hud.hideCombo();
        if (dead) { this._gameOver(); return; }
      }
    }

    // Player vs enemies (ramming)
    for (let j = this.enemies.items.length - 1; j >= 0; j--) {
      const e = this.enemies.items[j];
      if (pp.distanceTo(e.position) < e.userData.radius + pr) {
        const dead = this.ship.applyDamage(30, this.audio);
        this.hud.flashDamage();
        this.renderer.shake(0.8);
        this.particles.burst(pp, 0xff4b78, { count: 50, speed: 22, size: 1.0, life: 1.0 });
        this.audio.explosion(1.2);
        this.enemies.destroy(e, this.particles);
        this.combo = 1; this.hud.hideCombo();
        if (dead) { this._gameOver(); return; }
      }
    }

    // Player vs pickups
    for (let j = this.pickups.items.length - 1; j >= 0; j--) {
      const p = this.pickups.items[j];
      if (pp.distanceTo(p.position) < p.userData.radius + pr) {
        const gained = this._addScore(p.userData.value);
        this.hud.pickupToast(`CRYSTAL +${gained}`);
        this.audio.pickup();
        // Small hull repair
        this.ship.hull = clamp(this.ship.hull + 6, 0, this.ship.maxHull);
        this.particles.burst(p.position, p.material.color.getHex(), { count: 24, speed: 10, size: 0.6, life: 0.5 });
        this.pickups.remove(p);
      }
    }
  }

  _loop(now) {
    const dt = Math.min(0.05, (now - this._lastT) / 1000);
    this._lastT = now;
    this.time += dt;

    if (this.state === STATE.PLAYING) {
      this.ship.update(dt, this.input, this.camera);
      this._fire(dt);
      this.bullets.update(dt);
      this.asteroids.update(dt, this.ship);
      this.enemies.update(dt, this.ship, this.bullets, this.audio);
      this.pickups.update(dt, this.ship);
      this.particles.update(dt);
      this._spawnWaveContent(dt);
      this._collide();
      this.distance += this.ship.speed * dt;

      // Combo timer
      if (this.combo > 1) {
        this._comboTimer -= dt;
        if (this._comboTimer <= 0) { this.combo = 1; this.hud.hideCombo(); }
      }

      this.hud.update(this._hudState());
    } else if (this.state === STATE.TITLE || this.state === STATE.OVER) {
      // Drift camera slowly on menus for a cinematic feel.
      this.camera.position.x = Math.sin(this.time * 0.2) * 10;
      this.camera.position.y = 2 + Math.sin(this.time * 0.15) * 1.5;
      this.camera.position.z = 20 + Math.cos(this.time * 0.1) * 4;
      this.camera.lookAt(0, 0, 0);
      this.particles.update(dt);
    }

    this.world.update(dt, this.camera);
    this.renderer.render(dt, this.time);
    this.input.endFrame();

    requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('load', () => {
  try {
    window.__game = new Game();
  } catch (err) {
    console.error('Failed to initialize game:', err);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `<div style="max-width:520px; text-align:center; padding:24px;">
        <h2 style="color:#ff4b78; letter-spacing:0.2em;">INITIALIZATION FAILED</h2>
        <pre style="white-space:pre-wrap; color:#8a94c7; font-size:12px;">${String(err && err.stack || err)}</pre>
      </div>`;
    }
  }
});
