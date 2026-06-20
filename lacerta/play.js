/* ============================================================
   Lacerta · a Zamborin Game

   PHASE 4 — finite-stage dogfight.
   A 6-screen-wide arena (7680 × 720). The hero flies freely in any
   direction (climbs, dives, loops). Arrow keys rotate the nose and
   set throttle; the plane always moves forward in its heading. Enemy
   planes chase the hero and try to take it down before the hero
   clears the target list (all apartments + all enemies destroyed).

   Controls: ←/→ rotate, ↑ throttle up, ↓ throttle down, Space fire.
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
  const STAGE_W = W * 6;            // 7680 px — full arena width
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
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => { console.warn('Lacerta: failed to load', src); resolve(null); };
      img.src = src;
    });
  }
  const assets = {
    sky: null, street: null,
    player: null, enemies: [],
    apartments: [], clouds: [],
  };
  loadImage('./assets/sky/sky.jpg').then(img => { assets.sky = img; });
  loadImage('./assets/street/street.png').then(img => { assets.street = img; });
  loadImage('./assets/planes-v2/HeroAircraft1.png').then(img => { assets.player = img; });
  Promise.all([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n =>
    loadImage(`./assets/planes-v2/enemy-aircraft${n}.png`)
  )).then(imgs => { assets.enemies = imgs.filter(Boolean); buildStageIfReady(); });
  Promise.all([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23].map(n =>
    loadImage(`./assets/apartments/apartment${n}.png`)
  )).then(imgs => { assets.apartments = imgs.filter(Boolean); buildStageIfReady(); });
  Promise.all([1, 3, 4, 5, 6, 12].map(id => loadImage(`./assets/clouds/cloud-${id}.png`)))
    .then(imgs => { assets.clouds = imgs.filter(Boolean); });

  // ---------- PALETTE ----------
  const C = { bg: '#020611', text: '#FFFFFF', accent: '#D8523F' };

  // ---------- STAGE GEOMETRY ----------
  // The stage is 6 screens WIDE and 4 screens TALL — the ground band at the
  // bottom of the canvas stays put, and the sky extends 3 screen heights
  // ABOVE the canvas top so planes have room to climb, dive, and loop.
  const STREET_H        = 72;
  const STREET_TOP_Y    = H - STREET_H;
  const APARTMENT_RENDER_H = 192;
  const STAGE_TOP_Y     = -3 * H;        // ceiling sits 3 screens above the canvas
  const STAGE_BOTTOM_Y  = H;             // bottom of the visible canvas
  // Player + enemies are confined to this Y range — never below the apartment
  // tops (no clipping through buildings) and never above the stage ceiling.
  const FLIGHT_Y_MIN = STAGE_TOP_Y + 50;                          // ≈ −2110
  const FLIGHT_Y_MAX = STREET_TOP_Y - APARTMENT_RENDER_H - 10;    // ≈ 446

  // ---------- PLAYER STATE ----------
  // Free 2-D flight: world position (x, y), nose heading in radians (0 = right,
  // -π/2 = up, +π/2 = down), throttle 0..1. The plane always moves forward in
  // its heading direction. Arrow keys rotate / adjust throttle.
  const player = {
    x: 220,
    y: H * 0.45,
    heading: 0,                 // facing right
    throttle: 0.65,
    hp: 100,
    invulnUntil: 0,
    alive: true,
  };
  const MIN_SPEED   = 0.16;     // px / ms at throttle 0
  const MAX_SPEED   = 0.48;     // px / ms at throttle 1
  const TURN_RATE   = 2.4;      // rad / sec — how fast the nose rotates
  const THROTTLE_RATE = 0.55;   // throttle units per second of held key

  function playerSpeed() {
    return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * player.throttle;
  }

  // ---------- CAMERA ----------
  // Camera centres on the hero in BOTH axes, clamped to the stage bounds.
  // The stage is now 4 screens tall (3 screens of sky above the canvas), so
  // cameraY varies from STAGE_TOP_Y at the ceiling to 0 at the ground band.
  let cameraX = 0;
  let cameraY = 0;
  function updateCamera() {
    cameraX = Math.max(0, Math.min(STAGE_W - W, player.x - W / 2));
    cameraY = Math.max(STAGE_TOP_Y, Math.min(0, player.y - H / 2));
  }
  function worldToScreenX(wx) { return wx - cameraX; }
  function worldToScreenY(wy) { return wy - cameraY; }

  // ---------- STAGE LAYOUT ----------
  // Deterministic placement: a row of apartments edge-to-edge across the
  // stage, and a fixed roster of enemy aircraft sleeping at their start
  // positions until the hero comes within wake range.
  const apartments = [];   // { x (centre), w, h, alive, img }
  const enemies    = [];   // { x, y, heading, throttle, hp, alive, img, fireAt, awake }
  let stageBuilt = false;
  function buildStageIfReady() {
    if (stageBuilt) return;
    if (!assets.apartments.length || !assets.enemies.length) return;
    stageBuilt = true;

    // --- Apartments (ground targets) — packed edge-to-edge across the stage.
    let cursor = 180;
    let lastImg = null;
    while (cursor < STAGE_W - 180) {
      const pool = assets.apartments;
      let img;
      do { img = pool[Math.floor(Math.random() * pool.length)]; }
      while (pool.length > 1 && img === lastImg);
      lastImg = img;
      const h = APARTMENT_RENDER_H;
      const w = h * (img.width / img.height);
      apartments.push({ x: cursor + w / 2, w, h, alive: true, img, hp: 2 });
      cursor += w;
    }

    // --- Enemy roster — 8 planes spread across the stage in BOTH axes so
    // the hero meets them at varied altitudes instead of always head-on.
    const N_ENEMIES = 8;
    for (let i = 0; i < N_ENEMIES; i++) {
      const pool = assets.enemies;
      const img = pool[Math.floor(Math.random() * pool.length)];
      const startX = 1200 + (i + 0.5) * (STAGE_W - 1400) / N_ENEMIES;
      // Bias toward the upper sky so the hero (which spawns mid-height) has
      // to climb to engage — gives the player time to settle into the
      // controls before the first interception.
      const yFrac = 0.1 + Math.random() * 0.75;
      const startY = FLIGHT_Y_MIN + yFrac * (FLIGHT_Y_MAX - FLIGHT_Y_MIN);
      enemies.push({
        x: startX, y: startY,
        heading: Math.PI,             // start facing left (toward the hero)
        throttle: 0.45,
        hp: 3,
        alive: true,
        img,
        fireAt: 0,
        awake: false,
      });
    }
  }

  // ---------- INPUT (keys only) ----------
  const keys = Object.create(null);
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
    keys[e.key] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });
  window.addEventListener('blur', () => {
    keys.ArrowLeft = keys.ArrowRight = keys.ArrowUp = keys.ArrowDown = keys[' '] = false;
  });

  // ---------- COMBAT ----------
  const bullets   = [];   // { x, y, vx, vy, owner: 'player'|'enemy', life }
  const particles = [];
  let lastShotAt = 0;
  let heat = 0;
  let overheated = false;
  const FIRE_INTERVAL    = 140;
  const HEAT_PER_SHOT    = 0.07;
  const HEAT_COOL_PER_MS = 0.0006;
  const BULLET_SPEED     = 1.05;   // px / ms
  const BULLET_LIFE_MS   = 1100;
  const PLAYER_HIT_R     = 24;
  const ENEMY_HIT_R      = 36;

  function spawnPlayerBullet() {
    // Muzzle at the plane's nose — translate forward in heading direction.
    const muzzleDist = 26;
    const mx = player.x + Math.cos(player.heading) * muzzleDist;
    const my = player.y + Math.sin(player.heading) * muzzleDist;
    bullets.push({
      x: mx, y: my,
      vx: Math.cos(player.heading) * BULLET_SPEED,
      vy: Math.sin(player.heading) * BULLET_SPEED,
      owner: 'player',
      life: BULLET_LIFE_MS,
    });
  }
  function spawnEnemyBullet(en) {
    const muzzleDist = 24;
    const mx = en.x + Math.cos(en.heading) * muzzleDist;
    const my = en.y + Math.sin(en.heading) * muzzleDist;
    bullets.push({
      x: mx, y: my,
      vx: Math.cos(en.heading) * BULLET_SPEED * 0.78,    // slightly slower than hero rounds
      vy: Math.sin(en.heading) * BULLET_SPEED * 0.78,
      owner: 'enemy',
      life: BULLET_LIFE_MS,
    });
  }

  // Explosions — same vocabulary as before: small spark cluster for non-lethal
  // hits, plus flash + ring + smoke for full ship deaths.
  let cameraShake = 0;
  function spawnExplosion(x, y, big) {
    const sparkColors = ['#FFE38A', '#FF9F33', '#FF5C2C', '#FFD23F', '#FFFFFF'];
    const N = big ? 30 : 8;
    for (let i = 0; i < N; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = (big ? 2.6 : 1.2) + Math.random() * (big ? 4.2 : 2.0);
      const ttl = (big ? 720 : 380) + Math.random() * (big ? 480 : 220);
      particles.push({
        kind: 'spark', x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life0: ttl, life: ttl,
        r0: (big ? 4 : 2.5) + Math.random() * 3,
        color: sparkColors[Math.floor(Math.random() * sparkColors.length)],
      });
    }
    if (!big) return;
    particles.push({ kind: 'flash', x, y, vx: 0, vy: 0, life0: 160, life: 160, r0: 64, color: '#FFFFFF' });
    particles.push({ kind: 'ring',  x, y, vx: 0, vy: 0, life0: 540, life: 540, r0: 92, color: '#FFE38A' });
    for (let i = 0; i < 7; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = 0.25 + Math.random() * 0.55;
      particles.push({
        kind: 'smoke', x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.25,
        life0: 1200 + Math.random() * 700, life: 1200 + Math.random() * 700,
        r0: 9 + Math.random() * 6, color: 'rgba(80, 60, 55, 0.55)',
      });
    }
    cameraShake = Math.max(cameraShake, 7);
  }

  // ---------- CLOUDS ----------
  // Drift across the upper sky band; perspective scaling tied to Y (top of
  // sky = nearest = largest / boldest, near horizon = farthest / faded).
  // Position is in world coords so clouds drift over the stage with parallax.
  const clouds = [];
  let nextCloudAt = 0;
  const MAX_CLOUDS = 8;
  function spawnCloud(now) {
    if (!assets.clouds.length) return;
    const img = assets.clouds[Math.floor(Math.random() * assets.clouds.length)];
    // Place clouds anywhere in the now-tall stage Y range. Depth is rolled
    // independently so size / alpha / parallax don't all snap to one band.
    const yMin = STAGE_TOP_Y + 40;
    const yMax = STREET_TOP_Y - 200;
    const y = yMin + Math.random() * (yMax - yMin);
    const depth = Math.random();                                  // 0 = near, 1 = far
    const targetH  = 140 - depth * 100;                            // 140 near → 40 far
    const alpha    = 0.85 - depth * 0.60;                          // 0.85 near → 0.25 far
    const parallax = 0.32 - depth * 0.26;                          // 0.32 near → 0.06 far
    const worldX = cameraX + W + 200 + Math.random() * 200;
    clouds.push({ img, worldX, y, targetH, alpha, parallax, spawnedCamX: cameraX });
  }
  function updateClouds(now) {
    if (now >= nextCloudAt && clouds.length < MAX_CLOUDS) {
      spawnCloud(now);
      nextCloudAt = now + (1800 + Math.random() * 2400);
    }
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      const sx = c.worldX - (cameraX - c.spawnedCamX) * c.parallax - c.spawnedCamX;
      if (sx < -400) clouds.splice(i, 1);
    }
  }

  // ---------- WIN / LOSE ----------
  let gameOver = false;
  let win = false;
  function targetsRemaining() {
    let n = 0;
    for (const a of apartments) if (a.alive) n++;
    for (const e of enemies)   if (e.alive) n++;
    return n;
  }

  // ---------- HELPERS ----------
  function normalizeAngle(a) {
    while (a >  Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // ---------- UPDATE ----------
  function update(dt, now) {
    if (landscapeLocked || gameOver) return;

    // ----- Player flight -----
    if (keys.ArrowLeft)  player.heading -= TURN_RATE * (dt / 1000);
    if (keys.ArrowRight) player.heading += TURN_RATE * (dt / 1000);
    if (keys.ArrowUp)    player.throttle = Math.min(1, player.throttle + THROTTLE_RATE * dt / 1000);
    if (keys.ArrowDown)  player.throttle = Math.max(0, player.throttle - THROTTLE_RATE * dt / 1000);
    player.heading = normalizeAngle(player.heading);

    const sp = playerSpeed();
    player.x += Math.cos(player.heading) * sp * dt;
    player.y += Math.sin(player.heading) * sp * dt;

    // Stage bounds — soft clamp + lose energy on hit (no instant death yet).
    if (player.x < 30)               { player.x = 30;               player.heading = 0; }
    if (player.x > STAGE_W - 30)     { player.x = STAGE_W - 30;     player.heading = Math.PI; }
    if (player.y < FLIGHT_Y_MIN)     { player.y = FLIGHT_Y_MIN; }
    if (player.y > FLIGHT_Y_MAX)     { player.y = FLIGHT_Y_MAX; }

    updateCamera();
    updateClouds(now);

    // ----- Fire (Space) -----
    heat = Math.max(0, heat - HEAT_COOL_PER_MS * dt);
    if (overheated && heat < 0.30) overheated = false;
    if (keys[' '] && !overheated && (now - lastShotAt) >= FIRE_INTERVAL) {
      spawnPlayerBullet();
      lastShotAt = now;
      heat += HEAT_PER_SHOT;
      if (heat >= 1) { heat = 1; overheated = true; }
    }

    // ----- Enemies (chase + fire) -----
    // Tuned so the hero (TURN_RATE 2.4) significantly out-turns the enemies
    // and can get on their six. Enemies fire only on tight alignment from
    // closer range — they were sitting on the hero's tail and never giving
    // the player a clear shot back.
    const WAKE_RANGE_X = 1.2 * W;          // wake at 1.2 screens (was 1.5)
    const FIRE_RANGE   = 360;              // closer (was 520)
    const ALIGN_RAD    = 0.10;             // ~5.7° (was ~10°)
    const ENEMY_TURN_RATE = 0.9;           // rad / sec (was 1.6) — hero can out-turn easily

    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (!en.alive) continue;

      // Wake up when hero is in range, then chase indefinitely.
      const dx0 = player.x - en.x, dy0 = player.y - en.y;
      const dist = Math.hypot(dx0, dy0);
      if (!en.awake && Math.abs(dx0) < WAKE_RANGE_X) en.awake = true;
      if (!en.awake) continue;

      // Steer toward the hero (limited turn rate).
      const desired = Math.atan2(dy0, dx0);
      const diff = normalizeAngle(desired - en.heading);
      const maxTurn = ENEMY_TURN_RATE * (dt / 1000);
      en.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
      en.heading = normalizeAngle(en.heading);

      // Throttle: cruise speed; close in faster when far away.
      const targetThrottle = dist > 600 ? 0.85 : 0.55;
      en.throttle += (targetThrottle - en.throttle) * (dt / 600);

      const enSp = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * en.throttle;
      en.x += Math.cos(en.heading) * enSp * dt;
      en.y += Math.sin(en.heading) * enSp * dt;

      // Keep enemies inside the sky band too — they bounce off the apartment
      // roofline and the top edge.
      if (en.y < FLIGHT_Y_MIN) { en.y = FLIGHT_Y_MIN; en.heading = -en.heading; }
      if (en.y > FLIGHT_Y_MAX) { en.y = FLIGHT_Y_MAX; en.heading = -en.heading; }
      if (en.x < 30)            { en.x = 30;            en.heading = 0; }
      if (en.x > STAGE_W - 30)  { en.x = STAGE_W - 30;  en.heading = Math.PI; }

      // Fire when nose is on target and within range.
      if (Math.abs(diff) < ALIGN_RAD && dist < FIRE_RANGE && now >= en.fireAt) {
        spawnEnemyBullet(en);
        en.fireAt = now + 900 + Math.random() * 700;
      }
    }

    // ----- Bullets -----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -50 || b.x > STAGE_W + 50 || b.y < -50 || b.y > H + 50) {
        bullets.splice(i, 1);
      }
    }

    // ----- Collisions: player bullets vs enemies + apartments -----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.owner !== 'player') continue;
      let consumed = false;

      for (let j = enemies.length - 1; j >= 0; j--) {
        const en = enemies[j];
        if (!en.alive) continue;
        const dx = b.x - en.x, dy = b.y - en.y;
        if (dx * dx + dy * dy < ENEMY_HIT_R * ENEMY_HIT_R) {
          en.hp -= 1;
          if (en.hp <= 0) { en.alive = false; spawnExplosion(en.x, en.y, true); }
          else            { spawnExplosion(b.x, b.y, false); }
          consumed = true;
          break;
        }
      }
      if (consumed) { bullets.splice(i, 1); continue; }

      for (let j = apartments.length - 1; j >= 0; j--) {
        const a = apartments[j];
        if (!a.alive) continue;
        const top = STREET_TOP_Y - a.h;
        if (b.x >= a.x - a.w / 2 && b.x <= a.x + a.w / 2 && b.y >= top && b.y <= STREET_TOP_Y) {
          a.hp -= 1;
          if (a.hp <= 0) { a.alive = false; spawnExplosion(b.x, top + a.h * 0.35, true); }
          else           { spawnExplosion(b.x, b.y, false); }
          consumed = true;
          break;
        }
      }
      if (consumed) { bullets.splice(i, 1); }
    }

    // ----- Collisions: enemy bullets vs player + enemy ships ramming player -----
    if (now > player.invulnUntil) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.owner !== 'enemy') continue;
        const dx = b.x - player.x, dy = b.y - player.y;
        if (dx * dx + dy * dy < PLAYER_HIT_R * PLAYER_HIT_R) {
          bullets.splice(i, 1);
          player.hp = Math.max(0, player.hp - 8);
          spawnExplosion(b.x, b.y, false);
          player.invulnUntil = now + 320;
          break;
        }
      }
      for (const en of enemies) {
        if (!en.alive) continue;
        const dx = en.x - player.x, dy = en.y - player.y;
        const rr = (PLAYER_HIT_R + ENEMY_HIT_R) * 0.6;
        if (dx * dx + dy * dy < rr * rr) {
          spawnExplosion(en.x, en.y, true);
          en.alive = false;
          player.hp = Math.max(0, player.hp - 22);
          player.invulnUntil = now + 500;
        }
      }
    }
    if (player.hp <= 0) { gameOver = true; win = false; spawnExplosion(player.x, player.y, true); }

    // ----- Particles -----
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      const damp = p.kind === 'smoke' ? 0.94 : (p.kind === 'spark' ? 0.97 : 1);
      p.vx *= damp; p.vy *= damp;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    cameraShake *= Math.pow(0.85, dt / 16);
    if (cameraShake < 0.05) cameraShake = 0;

    // ----- Win check -----
    if (stageBuilt && targetsRemaining() === 0) { gameOver = true; win = true; }
  }

  // ---------- RENDER ----------
  function clearBg() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawSky() {
    if (!assets.sky) return;
    ctx.drawImage(assets.sky, 0, 0, W, H);
  }

  function drawClouds() {
    const sorted = clouds.slice().sort((a, b) => a.y - b.y);
    for (const c of sorted) {
      const aspect = c.img.width / c.img.height;
      const w = c.targetH * aspect;
      const screenX = c.worldX - cameraX * c.parallax;
      const screenY = c.y - cameraY * c.parallax;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.img, screenX - w / 2, screenY - c.targetH / 2, w, c.targetH);
      ctx.restore();
    }
  }

  function drawStreet() {
    // Street is anchored in WORLD coords at STREET_TOP_Y. With the camera
    // following the hero vertically, the street drops out of view when the
    // hero climbs into the upper sky band — which is what we want; the
    // ground reads as a real floor that you fly above.
    const streetScreenY = worldToScreenY(STREET_TOP_Y);
    if (streetScreenY > H) return;                  // ground is below the viewport
    if (!assets.street) {
      ctx.fillStyle = '#252028';
      ctx.fillRect(0, streetScreenY, W, STREET_H);
      return;
    }
    const img = assets.street;
    const tileH = STREET_H;
    const tileW = tileH * (img.width / img.height);
    for (let x = 0; x < W; x += tileW) {
      ctx.drawImage(img, x, streetScreenY, tileW + 1, tileH);
    }
  }

  function drawApartments() {
    for (const a of apartments) {
      if (!a.alive || !a.img) continue;
      const sx = worldToScreenX(a.x);
      if (sx + a.w / 2 < -10 || sx - a.w / 2 > W + 10) continue;
      const top = worldToScreenY(STREET_TOP_Y - a.h);
      if (top > H + 10) continue;
      ctx.drawImage(a.img, sx - a.w / 2, top, a.w, a.h);
    }
  }

  // Propeller — thin light-grey sliver with a small alpha flicker.
  let lastFrameNow = 0;
  function drawPropeller(now, noseX, noseY, height) {
    const flicker = 0.55 + 0.25 * Math.sin(now * 0.09);
    const discW = height * 0.025;
    const discH = height * 0.66;
    ctx.save();
    ctx.translate(noseX, noseY);
    ctx.globalAlpha = flicker;
    ctx.fillStyle = 'rgba(220, 220, 220, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, discW, discH / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draw a plane in plane-local coords with proper rotation. The source PNG
  // points RIGHT in its native orientation. When the heading would put the
  // plane "upside down" (nose pointing left half), we mirror vertically so the
  // canopy stays toward the sky. This matches the classic Sopwith feel where
  // tracking left feels natural rather than inverted.
  function drawAircraft(img, worldX, worldY, heading, targetH) {
    const sx = worldToScreenX(worldX);
    const sy = worldToScreenY(worldY);
    if (sx < -120 || sx > W + 120 || sy < -120 || sy > H + 120) return;
    const aspect = img.width / img.height;
    const targetW = targetH * aspect;
    ctx.save();
    ctx.translate(sx, sy);
    // If heading is in the left half (nose pointing left), apply both a
    // rotation and a vertical flip so the plane stays right-side-up while
    // still pointing in its travel direction.
    const facingLeft = Math.cos(heading) < 0;
    if (facingLeft) {
      // Equivalent transform: mirror around the heading line.
      ctx.rotate(heading);
      ctx.scale(1, -1);
    } else {
      ctx.rotate(heading);
    }
    ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
    drawPropeller(lastFrameNow, targetW / 2 - 4, 0, targetH);
    ctx.restore();
  }

  function drawPlayer(now) {
    if (!assets.player) return;
    // Brief flicker while invulnerable.
    if (now <= player.invulnUntil && Math.floor(now / 60) % 2 === 0) return;
    drawAircraft(assets.player, player.x, player.y, player.heading, 60);
  }

  function drawEnemies() {
    for (const en of enemies) {
      if (!en.alive || !en.img) continue;
      drawAircraft(en.img, en.x, en.y, en.heading, 60);
    }
  }

  function drawBullets() {
    for (const b of bullets) {
      const sx = worldToScreenX(b.x);
      const sy = worldToScreenY(b.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      ctx.save();
      if (b.owner === 'player') {
        ctx.shadowColor = 'rgba(255, 220, 90, 0.9)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = 'rgba(255, 235, 130, 0.95)';
        ctx.fillRect(sx - 7, sy - 2, 14, 4);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx - 3, sy - 0.75, 6, 1.5);
      } else {
        ctx.shadowColor = '#ff5555';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff8888';
        ctx.fillRect(sx - 5, sy - 2, 10, 4);
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = Math.max(0, p.life / p.life0);
      const sx = worldToScreenX(p.x);
      const sy = worldToScreenY(p.y);
      if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
      ctx.save();
      if (p.kind === 'flash') {
        ctx.globalAlpha = Math.pow(t, 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r0 * (1.2 - 0.2 * t), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'ring') {
        const r = p.r0 * (1 - t) + 6;
        ctx.globalAlpha = t * 0.85;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4 * t + 1;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = t * 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, p.r0 * (2.2 - 1.2 * t), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = Math.pow(t, 0.55);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10 * t;
        ctx.fillStyle = p.color;
        const r = (p.r0 || 3) * t + 0.8;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawHUD() {
    ctx.save();
    ctx.font = '700 11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const x = 24, hpY = 22, htY = 42;
    // HP
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, hpY, 200, 10);
    ctx.fillStyle = player.hp > 50 ? '#5DD39E' : player.hp > 25 ? '#FFD23F' : '#FF6B5C';
    ctx.fillRect(x, hpY, 200 * (player.hp / 100), 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('HP', x + 210, hpY + 5);

    // Heat
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, htY, 200, 6);
    ctx.fillStyle = overheated ? '#FF6B5C' : '#FFB347';
    ctx.fillRect(x, htY, 200 * heat, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(overheated ? 'COOLING' : 'HEAT', x + 210, htY + 3);

    // Throttle indicator below
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, htY + 14, 200, 6);
    ctx.fillStyle = '#7DD8FF';
    ctx.fillRect(x, htY + 14, 200 * player.throttle, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('THROTTLE', x + 210, htY + 17);

    // Right-side: targets remaining + minimap.
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textAlign = 'right';
    const rx = W - 24;
    const targets = targetsRemaining();
    ctx.fillStyle = targets > 0 ? '#FF6B5C' : '#5DD39E';
    ctx.fillText('TARGETS  ' + targets, rx, 22);

    // Minimap — small rectangular plan of the whole stage. Width axis is X,
    // height axis is Y (sky at top, ground at bottom). Apartments hug the
    // bottom edge; enemies float at their flight altitude; player is green.
    const STAGE_H_TOTAL = STAGE_BOTTOM_Y - STAGE_TOP_Y;
    const mmX = W * 0.30, mmW = W * 0.40, mmY = 14, mmH = 40;
    const mapWX = (wx) => mmX + (wx / STAGE_W) * mmW;
    const mapWY = (wy) => mmY + ((wy - STAGE_TOP_Y) / STAGE_H_TOTAL) * mmH;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(mmX, mmY, mmW, mmH);
    // Ground line.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(mmX, mapWY(STREET_TOP_Y), mmW, 1);
    for (const a of apartments) {
      if (!a.alive) continue;
      ctx.fillStyle = '#FFB347';
      ctx.fillRect(mapWX(a.x) - 1, mapWY(STREET_TOP_Y) - 2, 2, 2);
    }
    for (const en of enemies) {
      if (!en.alive) continue;
      ctx.fillStyle = '#FF6B5C';
      ctx.fillRect(mapWX(en.x) - 1.5, mapWY(en.y) - 1.5, 3, 3);
    }
    ctx.fillStyle = '#5DD39E';
    ctx.fillRect(mapWX(player.x) - 2, mapWY(player.y) - 2, 4, 4);

    ctx.restore();
  }

  function drawGameOverOverlay() {
    if (!gameOver) return;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 17, 0.66)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = win ? '#5DD39E' : '#FF6B5C';
    ctx.font = '900 64px Inter, sans-serif';
    ctx.fillText(win ? 'STAGE CLEAR' : 'SHOT DOWN', W / 2, H / 2 - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillText('Reload to fly again', W / 2, H / 2 + 28);
    ctx.restore();
  }

  function render(now) {
    lastFrameNow = now;
    clearBg();
    const shaking = cameraShake > 0.05;
    ctx.save();
    if (shaking) {
      const sx = (Math.random() - 0.5) * cameraShake * 2;
      const sy = (Math.random() - 0.5) * cameraShake * 2;
      ctx.translate(sx, sy);
    }
    drawSky();
    drawClouds();
    drawStreet();
    drawApartments();
    drawEnemies();
    drawPlayer(now);
    drawBullets();
    drawParticles();
    ctx.restore();
    drawHUD();
    drawGameOverOverlay();
  }

  // ---------- LOOP ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - lastTime);
    lastTime = now;
    update(dt, now);
    render(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
