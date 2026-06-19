/* ============================================================
   Lacerta · a Zamborin Game

   PHASE 1 — engine bring-up.
   Side-scrolling 16:9 canvas with a three-layer parallax starfield
   (skybackground / far-stars / closer-stars), one player ship
   (Tsunami) under keyboard control, and a rotate-device prompt
   on portrait-mobile.

   No enemies, weapons, hazards, AI, audio, or HUD yet — those land
   in phases 2-7.

   Logical canvas: 1280×720. chrome.css's auto-focus formula scales
   to fit any viewport (mobile landscape ends up ~693×390 etc.) but
   the gameplay code always thinks in 1280×720 logical pixels.
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE ----------
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  // ---------- CANVAS DIMS (FIXED 16:9) ----------
  const W = 1280;
  const H = 720;
  document.body.style.setProperty('--canvas-w', W + 'px');
  document.body.style.setProperty('--canvas-h', H + 'px');

  const canvas = document.getElementById('game');
  const ctx    = canvas.getContext('2d');
  canvas.setAttribute('width',  String(W));
  canvas.setAttribute('height', String(H));
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const displayW = rect.width  || W;
    const displayH = rect.height || H;
    const backingW = Math.round(displayW * dpr);
    const backingH = Math.round(displayH * dpr);
    if (canvas.width  !== backingW) canvas.width  = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
    const scale = Math.min(backingW / W, backingH / H);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---------- ROTATE LOCK (mobile portrait) ----------
  // Lacerta is landscape-only on phones — show the rotate prompt + freeze
  // gameplay when the device is held vertically.
  let landscapeLocked = false;
  function updateOrientation() {
    if (MODE !== 'mobile') {
      document.body.classList.remove('portrait-lock');
      landscapeLocked = false;
      return;
    }
    const portrait = window.innerHeight > window.innerWidth;
    landscapeLocked = portrait;
    document.body.classList.toggle('portrait-lock', portrait);
  }
  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  window.addEventListener('orientationchange', updateOrientation);

  // ---------- ASSETS ----------
  // Background layers + the player ship for Phase 1. The rest of the roster
  // (enemies, planets, asteroids, ombule) loads in later phases.
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => { console.warn('Lacerta: failed to load', src); resolve(null); };
      img.src = src;
    });
  }
  const assets = { sky: null, player: null, enemies: [], houses: [], clouds: [] };
  // Sky + player + enemy pool.
  loadImage('./assets/sky/sky.jpg').then(img => { assets.sky = img; });
  // Player aircraft — plane2 is a sensible default; easy to swap to another.
  loadImage('./assets/planes/plane2.png').then(img => { assets.player = img; });
  // Enemy pool — the remaining planes. We'll randomly pick one on each spawn,
  // and hue-rotate them later for class variety.
  Promise.all([3, 4, 5, 6, 7, 8, 9].map(n => loadImage(`./assets/planes/plane${n}.png`)))
    .then(imgs => { assets.enemies = imgs.filter(Boolean); });
  // House pool — drawn-in-Midjourney scenery. For now treated as gun towers
  // (active targets); a future categorisation can split into towers + pure
  // scenery once you tag which is which.
  Promise.all([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21].map(n =>
    loadImage(`./assets/houses/house-${n}.png`)
  )).then(imgs => { assets.houses = imgs.filter(Boolean); });
  // Cloud pool — 6 transparent-background PNGs that drift across the sky.
  Promise.all([1, 3, 4, 5, 6, 12].map(id => loadImage(`./assets/clouds/cloud-${id}.png`)))
    .then(imgs => { assets.clouds = imgs.filter(Boolean); });

  // ---------- PALETTE ----------
  const C = {
    bg:     '#020611',   // ink-deep space (fallback while sky loads)
    text:   '#FFFFFF',
    accent: '#D8523F',
  };

  // ---------- PLAYER STATE ----------
  // The player ship sits at a FIXED screen X; the world scrolls under it.
  // Pitch is its vertical velocity input (−1 up, +1 down, with momentum).
  // Throttle controls world scroll speed.
  const player = {
    screenX:    W * 0.12,      // anchored close to the left edge — maximum room for enemies coming in from the right
    y:          H / 2,
    vy:         0,
    pitch:      0,              // visual bank angle (−1..+1)
    pitchInput: 0,              // pulled from keyboard each frame
    throttle:   1,              // 0.5 .. 1.8 — multiplier on base scroll
    worldX:     0,              // cumulative world distance scrolled
  };
  // Physics constants tuned for a casual side-scroller — sharper than a
  // sim, gentler than an arcade shoot-em-up.
  const PITCH_ACCEL  = 0.0008;  // how fast the ship gains pitch input
  const PITCH_DAMP   = 0.92;    // bleed-off when input is released
  const VY_MAX       = 0.55;
  const BANK_FACTOR  = 0.32;    // radians per unit pitch (subtle)
  const BASE_SPEED   = 0.32;    // world units per ms at throttle 1.0
  const THROTTLE_MIN = 0.55;
  const THROTTLE_MAX = 1.75;

  // Parallax speed multipliers — sky barely moves, far-stars slow, close-stars fast.
  const PARALLAX = { sky: 0.04, far: 0.18, close: 0.55, ground: 0.85 };

  // ---------- TERRAIN + GROUND STATIONS ----------
  // Flat slate/cream surface in the same palette as the building art —
  // procedurally drawn, no asset. Has a soft vertical gradient (warmer cream
  // at the top edge → cooler slate at the bottom), a thin definition line
  // at the horizon, and tile-based procedural specks that scroll with the
  // world to break up the otherwise-flat plane.
  // Ground is now hidden — houses line the bottom of the canvas as a
  // continuous skyline, each with 5 % of its height extending below the
  // canvas edge so they read as continuing off-screen.
  const TERRAIN_BASE_Y = H;            // bombs treat the canvas bottom as ground
  const HOUSE_UNDERLAP = 0.05;         // fraction of house height that sits below the canvas
  const HOUSE_RENDER_H = 220;

  // Per-tile detail pattern. One tile is 800 logical px wide; we generate a
  // fixed deterministic set of specks within it, then repeat tiles across
  // the canvas as the world scrolls. Same texture every time the player
  // revisits a stretch — looks consistent.
  const DETAIL_TILE_W = 800;
  const detailTile = [];
  (function buildDetailTile() {
    // Cheap LCG so the pattern is deterministic between sessions.
    let seed = 0xC0FFEE;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };
    for (let i = 0; i < 70; i++) {
      detailTile.push({
        x: rnd() * DETAIL_TILE_W,
        yOff: 12 + rnd() * (H - TERRAIN_BASE_Y - 24),
        r: 0.7 + rnd() * 1.6,
        color: rnd() < 0.5 ? '#7a6c5c' : '#a99c87',
        alpha: 0.25 + rnd() * 0.45,
      });
    }
    // A few faint horizontal scuff marks — long thin streaks read as pavement.
    for (let i = 0; i < 12; i++) {
      detailTile.push({
        x: rnd() * DETAIL_TILE_W,
        yOff: 18 + rnd() * (H - TERRAIN_BASE_Y - 30),
        kind: 'streak',
        len: 14 + rnd() * 32,
        color: '#766a58',
        alpha: 0.18 + rnd() * 0.18,
      });
    }
  })();

  // Now that the ground is flat, terrainHeightAt is constant — keeps the
  // bomb / station code unchanged.
  function terrainHeightAt(_worldX) { return TERRAIN_BASE_Y; }

  function drawTerrain() {
    // Terrain band hidden — houses now line the canvas bottom as the skyline.
    // detailTile is kept loaded in case we want to revive it later.
  }

  // Ground stations live in WORLD-X space; they slide left as the world
  // scrolls past at the same rate as the terrain (PARALLAX.ground).
  // A new station spawns off-screen-right periodically; passes off-screen
  // left if you don't bomb it in time. MG cannot damage them — bombs only.
  const stations = [];  // { worldX, hp, alive }
  let nextStationAt = 0;
  function spawnStation(now) {
    const worldX = player.worldX * PARALLAX.ground + W + 80;
    // Pick a house PNG from the pool — varies the skyline. Each station
    // keeps the same image for its whole life so it doesn't morph on scroll.
    const pool = assets.houses;
    const img = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    stations.push({ worldX, hp: 1, alive: true, img });
  }
  function updateStations(now, dt) {
    // Spawn cadence accelerated so the bottom of the canvas reads as a
    // continuous skyline rather than discrete buildings dotted along it.
    if (now >= nextStationAt) {
      spawnStation(now);
      nextStationAt = now + 380 + Math.random() * 320;     // every 0.38..0.70s (packed skyline)
    }
    for (let i = stations.length - 1; i >= 0; i--) {
      const s = stations[i];
      const screenX = s.worldX - player.worldX * PARALLAX.ground;
      if (screenX < -260) stations.splice(i, 1);
    }
  }
  function stationScreenX(s) {
    return s.worldX - player.worldX * PARALLAX.ground;
  }
  function drawStations() {
    for (const s of stations) {
      if (!s.alive || !s.img) continue;
      const sx = stationScreenX(s);
      if (sx < -200 || sx > W + 200) continue;
      // Anchor each house so 5 % of its height extends BELOW the canvas
      // bottom — the buildings read as continuing off-screen, a city
      // viewed from above.
      const targetH = HOUSE_RENDER_H;
      const targetW = targetH * (s.img.width / s.img.height);
      const bottom = H + targetH * HOUSE_UNDERLAP;        // 5 % below the canvas
      const top    = bottom - targetH;
      ctx.drawImage(s.img, sx - targetW / 2, top, targetW, targetH);
    }
  }

  // ---------- BOMBS ----------
  const bombs = [];         // { x, y, vx, vy }
  const BOMB_GRAVITY = 0.026;   // px / ms² applied to vy
  let bombCount = 12;       // initial supply for the battleground
  let lastBombAt = 0;
  const BOMB_INTERVAL = 280;    // ms between bomb drops
  function dropBomb(now) {
    if (bombCount <= 0) return;
    if (now - lastBombAt < BOMB_INTERVAL) return;
    bombs.push({
      x: player.screenX, y: player.y + 6,
      // Bombs carry a small forward velocity from the ship.
      vx: 2.0, vy: 0,
    });
    bombCount--;
    lastBombAt = now;
  }
  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.vy += BOMB_GRAVITY * dt;
      b.x  += b.vx * (dt / 16);
      b.y  += b.vy * (dt / 16);
      // World scroll pushes the bomb leftward too — same parallax as ground.
      b.x  -= BASE_SPEED * player.throttle * dt * PARALLAX.ground / 16;

      // House collision — bombs now detonate ON contact with a building
      // instead of falling all the way to the canvas bottom.
      let exploded = false;
      for (const s of stations) {
        if (!s.alive || !s.img) continue;
        const sx = stationScreenX(s);
        const targetH = HOUSE_RENDER_H;
        const targetW = targetH * (s.img.width / s.img.height);
        const top = H + targetH * HOUSE_UNDERLAP - targetH;
        const left = sx - targetW / 2;
        const right = sx + targetW / 2;
        if (b.x >= left && b.x <= right && b.y >= top) {
          bombExplode(b.x, Math.max(b.y, top + 24));
          bombs.splice(i, 1);
          exploded = true;
          break;
        }
      }
      if (exploded) continue;

      // Fallback: bomb hit the canvas bottom (between buildings).
      if (b.y >= H) {
        bombExplode(b.x, H);
        bombs.splice(i, 1);
        continue;
      }
      // Off-screen left/right despawn.
      if (b.x < -30 || b.x > W + 80) bombs.splice(i, 1);
    }
  }
  function bombExplode(x, y) {
    spawnExplosion(x, y, true);   // big drama
    // Kill any station within ~50px of the impact point.
    for (let i = stations.length - 1; i >= 0; i--) {
      const s = stations[i];
      if (!s.alive) continue;
      const sx = stationScreenX(s);
      const sy = terrainHeightAt(s.worldX) - 12;
      const dx = sx - x, dy = sy - y;
      if (dx * dx + dy * dy < 50 * 50) {
        s.alive = false;
        stations.splice(i, 1);
        spawnExplosion(sx, sy, true);
      }
    }
  }
  function drawBombs() {
    for (const b of bombs) {
      // Spinning bomb: stretched ellipse, dark with a yellow tail.
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd278';
      ctx.beginPath();
      ctx.ellipse(0, -8, 1.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- AMBIENT CLOUD DRIFT ----------
  // Clouds drift slowly across the upper half of the canvas at varied
  // depth-speeds. Smaller/slower clouds read as far away; larger/faster
  // ones feel close. Replaces the old planet drift now that we've moved
  // from deep space to a daytime alien sky.
  const clouds = [];           // active drifters
  let nextCloudAt = 0;
  function spawnCloud(now) {
    if (!assets.clouds.length) return;
    const img = assets.clouds[Math.floor(Math.random() * assets.clouds.length)];
    // Keep clouds in the sky band — never below the terrain horizon and
    // never crowding the player's flight envelope.
    const yMin = 30, yMax = Math.max(yMin + 1, TERRAIN_BASE_Y - 60);
    clouds.push({
      img,
      x: W + 300,
      y: yMin + Math.random() * (yMax - yMin),
      targetH: 45 + Math.random() * 55,             // 45..100 tall (smaller = farther)
      depthSpeed: 0.05 + Math.random() * 0.10,      // 0.05..0.15x world rate (very slow)
      alpha: 0.35 + Math.random() * 0.20,           // 0.35..0.55 (atmospheric fade)
      spawnedWorldX: player.worldX,
    });
  }
  const MAX_CLOUDS = 4;
  function updateClouds(now) {
    if (now >= nextCloudAt && clouds.length < MAX_CLOUDS) {
      spawnCloud(now);
      nextCloudAt = now + (3500 + Math.random() * 4500);  // every 3.5..8s
    }
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      c.x = (W + 300) - (player.worldX - c.spawnedWorldX) * c.depthSpeed;
      if (c.x < -400) clouds.splice(i, 1);
    }
  }
  function drawClouds() {
    for (const c of clouds) {
      const aspect = c.img.width / c.img.height;
      const w = c.targetH * aspect;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.img, c.x - w / 2, c.y - c.targetH / 2, w, c.targetH);
      ctx.restore();
    }
  }

  // ---------- INPUT (hybrid scheme: mouse for altitude, keys for throttle) ----------
  // Mouse Y over the canvas → ship target altitude (smooth follow with lag).
  // Left-click / touch → primary fire (forward gun, heat-managed).
  // → ← arrow keys → throttle (faster / slower world scroll).
  // Touch on mobile mirrors mouse for both follow + fire.
  let mouseY = H / 2;
  let mouseActive = false;          // true once the user moves the mouse over the canvas
  let isFiring = false;
  const keys = Object.create(null);

  function canvasYFromClient(clientY) {
    const rect = canvas.getBoundingClientRect();
    return (clientY - rect.top) / rect.height * H;
  }

  canvas.addEventListener('mousemove', (e) => {
    mouseY = canvasYFromClient(e.clientY);
    mouseActive = true;
  });
  canvas.addEventListener('mouseenter', () => { mouseActive = true; });
  canvas.addEventListener('mouseleave', () => { mouseActive = false; isFiring = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { isFiring = true; e.preventDefault(); }
  });
  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) isFiring = false;
  });
  // Touch support — single finger drives both Y and fire.
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0]; if (!t) return;
    mouseY = canvasYFromClient(t.clientY);
    mouseActive = true;
    isFiring = true;
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0]; if (!t) return;
    mouseY = canvasYFromClient(t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend',    () => { isFiring = false; });
  canvas.addEventListener('touchcancel', () => { isFiring = false; });
  window.addEventListener('blur',        () => { isFiring = false; });

  // Throttle keys still work.
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys[e.key] = true;
    // Space drops bombs — the ground-attack weapon.
    if (e.key === ' ') dropBomb(performance.now());
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
  });

  function readThrottle() {
    if (keys.ArrowRight) player.throttle = Math.min(THROTTLE_MAX, player.throttle + 0.012);
    if (keys.ArrowLeft)  player.throttle = Math.max(THROTTLE_MIN, player.throttle - 0.012);
  }

  // ---------- COMBAT STATE ----------
  // Bullets, enemies, explosion particles. Bullets are owned by either the
  // player or an enemy; collision rules differ.
  const bullets = [];     // { x, y, vx, vy, owner: 'player'|'enemy' }
  const enemies = [];     // { x, y, vx, vy, hp, fireAt, kind, hueShift }
  const particles = [];   // { x, y, vx, vy, life, life0, color }
  let lastShotAt = 0;
  let heat = 0;                       // 0..1 — overheats at 1, forced cool to 0.3
  let overheated = false;
  let nextEnemyAt = 0;
  const FIRE_INTERVAL = 140;          // ms between player shots
  const HEAT_PER_SHOT = 0.07;
  const HEAT_COOL_PER_MS = 0.0006;
  const MAX_BULLET_X = W + 100;
  const PLAYER_HIT_R = 25;            // collision radius approximations
  const ENEMY_HIT_R  = 42;            // larger now that enemies match player length

  let playerHP = 100;
  let playerInvulnUntil = 0;

  function spawnPlayerBullet() {
    bullets.push({
      x: player.screenX + 30, y: player.y,
      vx: 12, vy: 0,
      owner: 'player',
    });
  }
  function spawnEnemyBullet(en) {
    // Aim from enemy toward the player's current position (lead = none for now).
    const dx = player.screenX - en.x;
    const dy = player.y       - en.y;
    const d  = Math.max(1, Math.hypot(dx, dy));
    const speed = 6.5;
    bullets.push({
      x: en.x - 26, y: en.y,
      vx: dx / d * speed, vy: dy / d * speed,
      owner: 'enemy',
    });
  }
  function spawnEnemy(now) {
    // Pool of enemy plane PNGs — each spawn picks one at random so the
    // sky reads as a varied squadron rather than identical units.
    const pool = assets.enemies;
    const img = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    enemies.push({
      kind: 'plane',
      img,
      x: W + 80,
      y: 90 + Math.random() * (H - 220),
      vx: -1.6 - Math.random() * 0.6,
      vy: (Math.random() - 0.5) * 0.4,
      hp: 3,
      fireAt: now + 700 + Math.random() * 800,
    });
  }
  // Explosions come in two flavours:
  //   • big=true  — full ship death: bright flash, expanding shock ring,
  //                 28 fast hot sparks, slow drifting smoke.
  //   • big=false — non-lethal bullet hit: small spark burst only.
  function spawnExplosion(x, y, big) {
    const sparkColors = ['#FFE38A', '#FF9F33', '#FF5C2C', '#FFD23F', '#FFFFFF'];
    const N = big ? 30 : 8;
    for (let i = 0; i < N; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = (big ? 2.6 : 1.2) + Math.random() * (big ? 4.2 : 2.0);
      const ttl = (big ? 720 : 380) + Math.random() * (big ? 480 : 220);
      particles.push({
        kind:  'spark',
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life0: ttl, life: ttl,
        r0: (big ? 4 : 2.5) + Math.random() * 3,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      });
    }
    if (!big) return;

    // Hot white flash — only the first 140ms; sells the initial pop.
    particles.push({
      kind: 'flash', x, y, vx: 0, vy: 0,
      life0: 160, life: 160, r0: 64, color: '#FFFFFF',
    });
    // Expanding shock ring — grows over its lifetime, thins as it expands.
    particles.push({
      kind: 'ring', x, y, vx: 0, vy: 0,
      life0: 540, life: 540, r0: 92, color: '#FFE38A',
    });
    // Slow smoke puffs — drift up and outward, fade over ~1.5s.
    for (let i = 0; i < 7; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = 0.25 + Math.random() * 0.55;
      particles.push({
        kind: 'smoke',
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.25,
        life0: 1200 + Math.random() * 700,
        life:  1200 + Math.random() * 700,
        r0: 9 + Math.random() * 6,
        color: 'rgba(80, 60, 55, 0.55)',
      });
    }
    // Camera shake — small drama bump on big kills.
    cameraShake = Math.max(cameraShake, 7);
  }
  let cameraShake = 0;

  // ---------- UPDATE ----------
  function update(dt, now) {
    if (landscapeLocked) return;            // paused while user re-orients device

    readThrottle();

    // Vertical motion — mouse Y as soft target with momentum-style follow.
    // Keyboard ↑/↓ also nudges player.y for keyboard-only / accessibility play.
    const yMin = 60, yMax = H - 60;
    if (mouseActive) {
      const target = Math.max(yMin, Math.min(yMax, mouseY));
      const followLerp = 0.18;             // higher = snappier
      const prevY = player.y;
      player.y += (target - player.y) * followLerp * (dt / 16);
      // Derive a frame-rate-normalised vy from the actual y delta so the bank
      // animation still tracks how fast the ship is climbing/diving.
      player.vy = (player.y - prevY) / Math.max(1, dt / 16);
    } else {
      // Keyboard fallback.
      let p = 0;
      if (keys.ArrowUp)   p -= 1;
      if (keys.ArrowDown) p += 1;
      player.vy += p * PITCH_ACCEL * dt;
      player.vy = Math.max(-VY_MAX, Math.min(VY_MAX, player.vy));
      if (p === 0) player.vy *= Math.pow(PITCH_DAMP, dt / 16);
      player.y += player.vy * dt;
    }
    if (player.y < yMin) { player.y = yMin; player.vy = 0; }
    if (player.y > yMax) { player.y = yMax; player.vy = 0; }

    // Bank tracks vy direction (subtle).
    const targetPitch = Math.max(-1, Math.min(1, player.vy / 8));
    player.pitch += (targetPitch - player.pitch) * 0.12;

    // World scroll + ambient clouds.
    player.worldX += BASE_SPEED * player.throttle * dt;
    updateClouds(now);

    // Fire — heat-managed.
    heat = Math.max(0, heat - HEAT_COOL_PER_MS * dt);
    if (overheated && heat < 0.30) overheated = false;
    if (isFiring && !overheated && (now - lastShotAt) >= FIRE_INTERVAL) {
      spawnPlayerBullet();
      lastShotAt = now;
      heat += HEAT_PER_SHOT;
      if (heat >= 1) { heat = 1; overheated = true; }
    }

    // Bullets — move and despawn off-screen.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * (dt / 16);
      b.y += b.vy * (dt / 16);
      if (b.x < -40 || b.x > MAX_BULLET_X || b.y < -40 || b.y > H + 40) {
        bullets.splice(i, 1);
      }
    }

    // Enemies — spawn timer + per-enemy motion + occasional shots.
    // Cap simultaneous enemies AND lengthen the cadence so each one feels
    // like a real engagement rather than a swarm.
    const MAX_ENEMIES = 2;
    if (now >= nextEnemyAt && enemies.length < MAX_ENEMIES) {
      spawnEnemy(now);
      nextEnemyAt = now + 4200 + Math.random() * 2400;  // every 4.2..6.6s
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      en.x += en.vx * (dt / 16);
      en.y += en.vy * (dt / 16);
      // Gentle sinusoidal weave so they don't fly arrow-straight.
      en.vy += (Math.random() - 0.5) * 0.04;
      en.vy = Math.max(-0.9, Math.min(0.9, en.vy));
      if (en.y < 70)     { en.y = 70;     en.vy = Math.abs(en.vy); }
      if (en.y > H - 70) { en.y = H - 70; en.vy = -Math.abs(en.vy); }

      if (now >= en.fireAt && en.x < W - 30) {
        spawnEnemyBullet(en);
        en.fireAt = now + 1100 + Math.random() * 900;
      }
      if (en.x < -100) enemies.splice(i, 1);
    }

    // Collisions: player bullets vs enemies.
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.owner !== 'player') continue;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const en = enemies[j];
        const dx = b.x - en.x, dy = b.y - en.y;
        if (dx * dx + dy * dy < ENEMY_HIT_R * ENEMY_HIT_R) {
          bullets.splice(i, 1);
          en.hp -= 1;
          if (en.hp <= 0) {
            spawnExplosion(en.x, en.y, true);   // ship death — big drama
            enemies.splice(j, 1);
          } else {
            spawnExplosion(b.x, b.y, false);    // non-lethal hit spark
          }
          break;
        }
      }
    }

    // Collisions: enemy bullets vs player + enemy ship body vs player.
    if (now > playerInvulnUntil) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.owner !== 'enemy') continue;
        const dx = b.x - player.screenX, dy = b.y - player.y;
        if (dx * dx + dy * dy < PLAYER_HIT_R * PLAYER_HIT_R) {
          bullets.splice(i, 1);
          playerHP = Math.max(0, playerHP - 8);
          spawnExplosion(b.x, b.y, false);     // small spark on hit
          playerInvulnUntil = now + 320;       // brief i-frames
          break;
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i];
        const dx = en.x - player.screenX, dy = en.y - player.y;
        if (dx * dx + dy * dy < (PLAYER_HIT_R + ENEMY_HIT_R) * (PLAYER_HIT_R + ENEMY_HIT_R) * 0.55) {
          spawnExplosion(en.x, en.y, true);    // ramming kill — big drama
          enemies.splice(i, 1);
          playerHP = Math.max(0, playerHP - 18);
          playerInvulnUntil = now + 500;
        }
      }
    }

    // Particles — drift, decay.
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      // Smoke decelerates faster (heavier air); sparks coast longer.
      const damp = p.kind === 'smoke' ? 0.94 : (p.kind === 'spark' ? 0.97 : 1);
      p.vx *= damp; p.vy *= damp;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    // Camera shake decay — exponential drop, ~85% retained per 16ms.
    cameraShake *= Math.pow(0.85, dt / 16);
    if (cameraShake < 0.05) cameraShake = 0;

    // Ground systems
    updateStations(now, dt);
    updateBombs(dt);
  }

  // ---------- RENDER ----------
  function clearBg() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
  }

  // drawParallaxLayer — tile an image horizontally at the layer's scroll rate.
  // The image is scaled to canvas height; tiled across as many widths as the
  // viewport needs (usually 2-3 copies, sometimes more for narrow layers).
  //
  // `blend` lets star layers use 'screen' compositing so the dark halos baked
  // into the SVG's radial gradients drop out against the sky underneath. The
  // SVGs declare mix-blend-mode internally, but canvas rasterises them on a
  // transparent buffer first — that blend never sees the sky. Doing it here
  // at the compositor level is the correct fix.
  function drawParallaxLayer(img, factor, blend) {
    if (!img) return;
    const layerScale = H / img.height;
    const layerW = img.width * layerScale;
    const offset = (player.worldX * factor) % layerW;
    ctx.save();
    if (blend) ctx.globalCompositeOperation = blend;
    let x = -offset;
    while (x < W) {
      ctx.drawImage(img, x, 0, layerW, H);
      x += layerW;
    }
    ctx.restore();
  }

  function drawPlayer() {
    if (!assets.player) return;
    const img = assets.player;
    // Render the player aircraft at ~75 tall. The new PNG planes have more
    // visible detail (rivets, panels, propellers) than the old vector ships,
    // so a slightly larger render reads well without dominating the screen.
    const targetH = 52;
    const targetW = targetH * (img.width / img.height);
    ctx.save();
    ctx.translate(player.screenX, player.y);
    // The Midjourney plane PNGs all point LEFT — mirror horizontally so the
    // player faces right (toward incoming enemies). Rotation sign flipped
    // post-mirror so ascending input still tips the nose UP.
    ctx.scale(-1, 1);
    ctx.rotate(-player.pitch * BANK_FACTOR);
    ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  // Subtle exhaust trail — two short fading streaks behind the engine. Pure
  // canvas, no asset; gives the ship a sense of forward motion at standstill.
  function drawExhaustTrail(now) {
    // Offsets scaled for the 55-tall ship; long/short streaks both fade in.
    const len = 18 + 12 * player.throttle;
    const px = player.screenX - 30;
    const py = player.y + player.pitch * 4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(px - len, py, px, py);
    g.addColorStop(0, 'rgba(216, 82, 63, 0)');
    g.addColorStop(1, 'rgba(255, 200, 120, 0.85)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px - len, py - 1);
    ctx.lineTo(px, py - 1);
    ctx.moveTo(px - len * 0.85, py + 3);
    ctx.lineTo(px, py + 3);
    ctx.stroke();
    ctx.restore();
  }

  function drawBullets() {
    for (const b of bullets) {
      ctx.save();
      if (b.owner === 'player') {
        // Light-yellow tracer with a hot white core — reads instantly
        // against the deep-blue background.
        ctx.shadowColor = 'rgba(255, 220, 90, 0.9)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = 'rgba(255, 235, 130, 0.95)';
        ctx.fillRect(b.x - 7, b.y - 2, 14, 4);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(b.x - 3, b.y - 0.75, 6, 1.5);
      } else {
        // Red enemy bolt — short blob with a slight glow.
        ctx.shadowColor = '#ff5555';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff8888';
        ctx.fillRect(b.x - 5, b.y - 2, 10, 4);
      }
      ctx.restore();
    }
  }

  function drawEnemies() {
    for (const en of enemies) {
      if (!en.img) continue;
      // Render enemies at the same nominal height as the player (75 tall).
      // Each enemy carries its own PNG (chosen at spawn), so the pool gives
      // visual variety without per-frame hue-rotate.
      const targetH = 52;
      const targetW = targetH * (en.img.width / en.img.height);
      ctx.save();
      ctx.translate(en.x, en.y);
      // Bank into vertical motion.
      ctx.rotate(Math.max(-0.4, Math.min(0.4, en.vy * 0.4)));
      // PNG planes point LEFT in their source — enemies face LEFT toward the
      // player, so no horizontal flip needed (player is the one mirrored).
      ctx.drawImage(en.img, -targetW / 2, -targetH / 2, targetW, targetH);
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = Math.max(0, p.life / p.life0);   // 1 = fresh, 0 = dead
      ctx.save();
      if (p.kind === 'flash') {
        // Bright disc that fades very quickly.
        ctx.globalAlpha = Math.pow(t, 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r0 * (1.2 - 0.2 * t), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        // Expanding stroked ring — outer shock front.
        const r = p.r0 * (1 - t) + 6;
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * t + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'smoke') {
        // Soft dark puff drifting and growing as it fades.
        ctx.globalAlpha = t * 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r0 * (2.2 - 1.2 * t), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Spark — bright glowing dot that fades and shrinks.
        ctx.globalAlpha = Math.pow(t, 0.55);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10 * t;
        ctx.fillStyle = p.color;
        const r = (p.r0 || 3) * t + 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawHUD() {
    // HP bar — top-left, 200×10. Heat bar — directly below, 200×6.
    ctx.save();
    ctx.font = '700 11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const x = 24, hpY = 22, htY = 42;
    // HP background + fill
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, hpY, 200, 10);
    ctx.fillStyle = playerHP > 50 ? '#5DD39E' : playerHP > 25 ? '#FFD23F' : '#FF6B5C';
    ctx.fillRect(x, hpY, 200 * (playerHP / 100), 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('HP', x + 210, hpY + 5);

    // Heat background + fill
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, htY, 200, 6);
    ctx.fillStyle = overheated ? '#FF6B5C' : '#FFB347';
    ctx.fillRect(x, htY, 200 * heat, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(overheated ? 'COOLING' : 'HEAT', x + 210, htY + 3);

    ctx.restore();

    // Right-side counters: bombs remaining + ground stations remaining.
    ctx.save();
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const rx = W - 24;

    // Bomb icon — small black ellipse + yellow flicker
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.ellipse(rx - 36, 22, 5, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd278';
    ctx.beginPath(); ctx.ellipse(rx - 36, 14, 2, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bombCount > 0 ? '#FFFFFF' : '#FF6B5C';
    ctx.fillText('× ' + bombCount, rx, 22);

    // Ground station counter
    const stationsAlive = stations.filter(s => s.alive).length;
    ctx.fillStyle = stationsAlive > 0 ? '#FF6B5C' : '#5DD39E';
    ctx.beginPath(); ctx.rect(rx - 58, 38, 16, 10); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillText('GROUND  ' + stationsAlive, rx, 44);

    ctx.restore();
  }

  // drawSky — single full-canvas stretch of sky.jpg. We deliberately do NOT
  // tile horizontally because the source image's left/right edges don't
  // match (a visible seam ran down the middle of the canvas). The clouds
  // provide the parallax sense of motion; the sky itself can be static.
  function drawSky() {
    if (!assets.sky) return;
    ctx.drawImage(assets.sky, 0, 0, W, H);
  }

  function render(now) {
    clearBg();
    // Apply camera shake — small random offset for a few frames after a big
    // explosion. Save/restore the whole scene block as a pair so the matrix
    // stays balanced regardless of shake state.
    const shaking = cameraShake > 0.05;
    ctx.save();
    if (shaking) {
      const sx = (Math.random() - 0.5) * cameraShake * 2;
      const sy = (Math.random() - 0.5) * cameraShake * 2;
      ctx.translate(sx, sy);
    }

    drawSky();
    drawClouds();
    drawTerrain();
    drawStations();
    drawExhaustTrail(now);
    // Player render — blink during invuln frames so hits are felt.
    if (now <= playerInvulnUntil && Math.floor(now / 60) % 2 === 0) {
      // skip drawing this frame
    } else {
      drawPlayer();
    }
    drawEnemies();
    drawBullets();
    drawBombs();
    drawParticles();

    ctx.restore();
    // HUD sits OUTSIDE the shake transform so the bars stay rock-steady.
    drawHUD();
  }

  // ---------- LOOP ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - lastTime);   // cap to avoid huge jumps on tab-resume
    lastTime = now;
    update(dt, now);
    render(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
