// Asteroids, enemies, bullets, pickups, particles — pooled for performance.
import * as THREE from 'three';
import { clamp, rand, randi, chance, pick, tmp, prng } from './utils.js';

// ---------- Particle System ----------
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.velocities = new Float32Array(max * 3);
    this.ages = new Float32Array(max);
    this.lives = new Float32Array(max);
    this.alive = new Uint8Array(max);
    this._head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying vec3 vCol;
        uniform float uPixelRatio;
        void main() {
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vCol;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.0, d);
          a = pow(a, 1.4);
          gl_FragColor = vec4(vCol, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(pos, vel, color, size, life) {
    let i;
    for (let tries = 0; tries < this.max; tries++) {
      i = this._head;
      this._head = (this._head + 1) % this.max;
      if (!this.alive[i]) break;
    }
    const p = i * 3;
    this.positions[p + 0] = pos.x;
    this.positions[p + 1] = pos.y;
    this.positions[p + 2] = pos.z;
    this.velocities[p + 0] = vel.x;
    this.velocities[p + 1] = vel.y;
    this.velocities[p + 2] = vel.z;
    this.colors[p + 0] = color.r;
    this.colors[p + 1] = color.g;
    this.colors[p + 2] = color.b;
    this.sizes[i] = size;
    this.ages[i] = 0;
    this.lives[i] = life;
    this.alive[i] = 1;
  }

  burst(pos, color, opts = {}) {
    const count = opts.count ?? 40;
    const speed = opts.speed ?? 12;
    const size = opts.size ?? 0.7;
    const life = opts.life ?? 1.1;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(
        rand(-1, 1), rand(-1, 1), rand(-1, 1)
      ).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      const hue = new THREE.Color().copy(c).offsetHSL(rand(-0.08, 0.08), 0, rand(-0.15, 0.15));
      this.spawn(pos, v, hue, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6));
    }
  }

  update(dt) {
    const pos = this.positions, vel = this.velocities, col = this.colors, sz = this.sizes;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) { sz[i] = 0; continue; }
      const a = this.ages[i] += dt;
      if (a >= this.lives[i]) { this.alive[i] = 0; sz[i] = 0; continue; }
      const base = i * 3;
      pos[base + 0] += vel[base + 0] * dt;
      pos[base + 1] += vel[base + 1] * dt;
      pos[base + 2] += vel[base + 2] * dt;
      // Drag
      vel[base + 0] *= 0.95;
      vel[base + 1] *= 0.95;
      vel[base + 2] *= 0.95;
      // Fade
      const k = 1 - a / this.lives[i];
      col[base + 0] *= 0.995;
      col[base + 1] *= 0.995;
      col[base + 2] *= 0.998;
      sz[i] *= 0.985;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ---------- Bullets ----------
export class Bullets {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    this._geo = new THREE.CapsuleGeometry(0.12, 1.2, 6, 12);
    this._geo.rotateX(Math.PI / 2);
  }

  _make(friendly) {
    const color = friendly ? 0x5dc8ff : 0xff4b78;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this._geo, mat);
    mesh.userData = { kind: friendly ? 'playerBullet' : 'enemyBullet', color };
    // Point light for bloom pop
    const light = new THREE.PointLight(color, 1.4, 6, 1.5);
    mesh.add(light);
    return mesh;
  }

  spawn(pos, dir, speed, friendly, damage) {
    let m = this.pool.pop();
    if (!m || (m.userData.kind === 'playerBullet') !== friendly) m = this._make(friendly);
    m.position.copy(pos);
    m.lookAt(pos.clone().add(dir));
    m.userData.vel = dir.clone().multiplyScalar(speed);
    m.userData.life = 2.5;
    m.userData.age = 0;
    m.userData.damage = damage;
    m.userData.friendly = friendly;
    m.visible = true;
    this.scene.add(m);
    this.active.push(m);
    return m;
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      b.position.addScaledVector(b.userData.vel, dt);
      b.userData.age += dt;
      if (b.userData.age >= b.userData.life) {
        this.scene.remove(b);
        this.pool.push(b);
        this.active.splice(i, 1);
      }
    }
  }

  kill(b) {
    const i = this.active.indexOf(b);
    if (i >= 0) this.active.splice(i, 1);
    this.scene.remove(b);
    this.pool.push(b);
  }
}

// ---------- Asteroids ----------
function makeAsteroidGeometry(radius, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const rng = prng(seed);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i), ny = pos.getY(i), nz = pos.getZ(i);
    const n = 0.35 * (rng() - 0.5) + 0.18 * Math.sin(nx * 3 + ny * 2) + 0.12 * Math.sin(nz * 4);
    pos.setXYZ(i, nx * (1 + n * 0.5), ny * (1 + n * 0.5), nz * (1 + n * 0.5));
  }
  geo.computeVertexNormals();
  return geo;
}

export class Asteroids {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this._seedCounter = 1;

    // Shared materials
    this._mats = [
      new THREE.MeshStandardMaterial({ color: 0x40345a, metalness: 0.25, roughness: 0.8, emissive: 0x1a0a36, emissiveIntensity: 0.6, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x2a3a66, metalness: 0.2, roughness: 0.85, emissive: 0x081430, emissiveIntensity: 0.6, flatShading: true }),
      new THREE.MeshStandardMaterial({ color: 0x5c2a66, metalness: 0.15, roughness: 0.9, emissive: 0x2a0a3a, emissiveIntensity: 0.7, flatShading: true }),
    ];
  }

  spawn(pos, radius, velocity) {
    const geo = makeAsteroidGeometry(radius, this._seedCounter++);
    const mat = pick(this._mats);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData = {
      radius,
      hp: Math.ceil(radius * 2.2),
      maxHp: Math.ceil(radius * 2.2),
      vel: velocity.clone(),
      spin: new THREE.Vector3(rand(-1.2, 1.2), rand(-1.2, 1.2), rand(-1.2, 1.2)),
    };

    // Crystal veins — inner glowing mesh with slight offset.
    if (chance(0.45)) {
      const crystalMat = new THREE.MeshBasicMaterial({
        color: pick([0x5dc8ff, 0xff4bff, 0x7cffcb, 0xffcf5b]),
        transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const crystal = new THREE.Mesh(geo.clone().scale(0.6, 0.6, 0.6), crystalMat);
      mesh.add(crystal);
    }

    this.scene.add(mesh);
    this.items.push(mesh);
    return mesh;
  }

  damage(asteroid, amount, particles) {
    asteroid.userData.hp -= amount;
    // Flash
    const mat = asteroid.material;
    mat.emissiveIntensity = 2.5;
    setTimeout(() => { if (mat.emissiveIntensity > 0.7) mat.emissiveIntensity = 0.7; }, 80);
    return asteroid.userData.hp <= 0;
  }

  destroy(asteroid, particles) {
    particles.burst(asteroid.position, 0xff8bff, {
      count: 50, speed: 16, size: 0.9, life: 1.3,
    });
    particles.burst(asteroid.position, 0x5dc8ff, {
      count: 30, speed: 10, size: 0.6, life: 1.0,
    });
    this.scene.remove(asteroid);
    const i = this.items.indexOf(asteroid);
    if (i >= 0) this.items.splice(i, 1);
    // Dispose geometry (it's unique per asteroid from cloning)
    asteroid.geometry.dispose();
  }

  update(dt, player) {
    const playerPos = player.group.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const a = this.items[i];
      a.position.addScaledVector(a.userData.vel, dt);
      a.rotation.x += a.userData.spin.x * dt;
      a.rotation.y += a.userData.spin.y * dt;
      a.rotation.z += a.userData.spin.z * dt;
      // Despawn if left behind
      const dz = a.position.z - playerPos.z;
      if (dz > 120 || a.position.distanceToSquared(playerPos) > 90000) {
        this.scene.remove(a);
        a.geometry.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const a of this.items) { this.scene.remove(a); a.geometry.dispose(); }
    this.items.length = 0;
  }
}

// ---------- Pickups (energy crystals) ----------
export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this._geo = new THREE.OctahedronGeometry(0.6, 0);
    this._geo.scale(0.7, 1.3, 0.7);
    this._mats = [
      new THREE.MeshBasicMaterial({ color: 0x7cffcb, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: 0x5dc8ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
      new THREE.MeshBasicMaterial({ color: 0xffcf5b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    ];
  }

  spawn(pos) {
    const mat = pick(this._mats);
    const mesh = new THREE.Mesh(this._geo, mat);
    mesh.position.copy(pos);
    mesh.userData = {
      kind: 'crystal',
      value: 250,
      radius: 0.9,
      spin: rand(2, 4),
      bob: rand(0, Math.PI * 2),
      vel: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-5, 5)),
    };
    const light = new THREE.PointLight(mat.color.getHex(), 1.2, 6, 2);
    mesh.add(light);
    this.scene.add(mesh);
    this.items.push(mesh);
    return mesh;
  }

  update(dt, player) {
    const playerPos = player.group.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.position.addScaledVector(p.userData.vel, dt);
      p.rotation.y += p.userData.spin * dt;
      p.rotation.x += p.userData.spin * 0.5 * dt;
      p.userData.bob += dt * 3;
      p.position.y += Math.sin(p.userData.bob) * 0.02;

      // Magnet: attract when close
      const d = p.position.distanceTo(playerPos);
      if (d < 18) {
        const dir = tmp.v0.copy(playerPos).sub(p.position).normalize();
        const strength = (18 - d) * 6;
        p.userData.vel.addScaledVector(dir, strength * dt);
        p.userData.vel.multiplyScalar(0.92);
      }
      // Despawn far behind
      if (p.position.z - playerPos.z > 120 || d > 350) {
        this.scene.remove(p);
        this.items.splice(i, 1);
      }
    }
  }

  remove(p) {
    this.scene.remove(p);
    const i = this.items.indexOf(p);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear() {
    for (const p of this.items) this.scene.remove(p);
    this.items.length = 0;
  }
}

// ---------- Enemies ----------
export class Enemies {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this._geo = new THREE.ConeGeometry(0.8, 2.0, 5);
    this._geo.rotateX(-Math.PI / 2);
    this._mat = new THREE.MeshStandardMaterial({
      color: 0x400010, emissive: 0xff2244, emissiveIntensity: 2.2,
      metalness: 0.3, roughness: 0.4, flatShading: true,
    });
  }

  spawn(pos) {
    const mesh = new THREE.Mesh(this._geo, this._mat);
    mesh.position.copy(pos);
    mesh.userData = {
      hp: 12, maxHp: 12,
      radius: 1.2,
      vel: new THREE.Vector3(0, 0, 0),
      shootCd: rand(1, 2.2),
      state: 'approach',
      pattern: pick(['weave', 'dive', 'strafe']),
      phase: rand(0, Math.PI * 2),
    };
    const light = new THREE.PointLight(0xff3355, 2.5, 10, 1.8);
    mesh.add(light);
    this.scene.add(mesh);
    this.items.push(mesh);
    return mesh;
  }

  update(dt, player, bullets, audio) {
    const pp = player.group.position;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      const ud = e.userData;
      ud.phase += dt;
      const toPlayer = tmp.v0.copy(pp).sub(e.position);
      const dist = toPlayer.length();

      // AI: approach, then weave around player
      const desiredDir = tmp.v1.copy(toPlayer).normalize();
      let lateral = tmp.v2.set(Math.cos(ud.phase * 1.8), Math.sin(ud.phase * 1.3), 0);
      if (ud.pattern === 'dive') lateral.set(Math.sin(ud.phase * 2) * 0.6, Math.cos(ud.phase * 2) * 0.8, 0);
      if (ud.pattern === 'strafe') lateral.set(Math.sin(ud.phase * 2.2), 0, Math.cos(ud.phase * 1.5) * 0.3);

      const speed = 32 + Math.min(20, Math.max(0, (dist - 30) * 0.6));
      ud.vel.lerp(desiredDir.multiplyScalar(speed).add(lateral.multiplyScalar(14)), 0.05);

      e.position.addScaledVector(ud.vel, dt);
      e.lookAt(pp);

      // Firing
      ud.shootCd -= dt;
      if (ud.shootCd <= 0 && dist < 90 && dist > 14 && player.alive) {
        ud.shootCd = rand(1.1, 2.0);
        const dir = tmp.v1.copy(pp).sub(e.position).normalize();
        // Lead target slightly
        dir.addScaledVector(player.forward, 0.05).normalize();
        bullets.spawn(e.position.clone().addScaledVector(dir, 1.2), dir, 70, false, 14);
        if (audio) audio.laser();
      }

      // Despawn if left far behind
      if (e.position.z - pp.z > 180) {
        this.scene.remove(e);
        this.items.splice(i, 1);
      }
    }
  }

  damage(enemy, amount) {
    enemy.userData.hp -= amount;
    return enemy.userData.hp <= 0;
  }

  destroy(enemy, particles) {
    particles.burst(enemy.position, 0xff3355, { count: 60, speed: 20, size: 1.0, life: 1.3 });
    particles.burst(enemy.position, 0xffcf5b, { count: 30, speed: 14, size: 0.7, life: 0.9 });
    this.scene.remove(enemy);
    const i = this.items.indexOf(enemy);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear() {
    for (const e of this.items) this.scene.remove(e);
    this.items.length = 0;
  }
}
