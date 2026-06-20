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
    tankBodies: [], tankTurrets: [],   // index-aligned: tankBodies[i] pairs with tankTurrets[i]
    trucks: [],
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
  // Tanks: two variants, each is a (body, turret) pair. The barrel-direction
  // of the source PNG differs between the two — captured in TANK_SPECS below.
  Promise.all([
    loadImage('./assets/tanks/tank1-body.png'),
    loadImage('./assets/tanks/tank1-turret.png'),
    loadImage('./assets/tanks/tank2-body.png'),
    loadImage('./assets/tanks/tank2-turret.png'),
  ]).then(imgs => {
    if (imgs[0] && imgs[1]) { assets.tankBodies.push(imgs[0]); assets.tankTurrets.push(imgs[1]); }
    if (imgs[2] && imgs[3]) { assets.tankBodies.push(imgs[2]); assets.tankTurrets.push(imgs[3]); }
    buildStageIfReady();
  });
  // Trucks (3 variants) — ground targets that drive but don't shoot.
  Promise.all([1, 3, 5].map(n => loadImage(`./assets/trucks/truck${n}.png`)))
    .then(imgs => { assets.trucks = imgs.filter(Boolean); buildStageIfReady(); });

  // ---------- PALETTE ----------
  const C = { bg: '#020611', text: '#FFFFFF', accent: '#D8523F' };

  // ---------- STAGE GEOMETRY ----------
  // The stage is 6 screens WIDE and 4 screens TALL — the ground band at the
  // bottom of the canvas stays put, and the sky extends 3 screen heights
  // ABOVE the canvas top so planes have room to climb, dive, and loop.
  const STREET_H        = 72;
  const STREET_TOP_Y    = H - STREET_H;
  const APARTMENT_RENDER_H = 192;
  // Ground vehicles drive ON the cobblestone road (not on the kerb the
  // apartments sit on). Their wheels sit just above the bottom edge of the
  // canvas and they're rendered at 60 % of the previous size.
  const ROAD_BOTTOM_Y   = H - 8;
  const TANK_BODY_H     = 76;        // 15 % larger than previous 66
  const TANK_TURRET_H   = 25;        // 15 % larger than previous 22
  const TRUCK_H         = 69;        // 15 % larger than previous 60
  const STAGE_TOP_Y     = -3 * H;        // ceiling sits 3 screens above the canvas
  const STAGE_BOTTOM_Y  = H;             // bottom of the visible canvas

  // Per-tank metadata. The two source turret PNGs face opposite directions
  // (tank 1 muzzle on right, tank 2 muzzle on left). The pivot is the
  // BREECH end of the source — where the turret enters the body mount —
  // so when the barrel rotates up to track the hero, the pivot ends up at
  // the BOTTOM of the visible turret. Render order is also reversed (turret
  // drawn BEHIND the body) so the body silhouette covers the breech.
  //   bodyPivotFracX/Y    : turret mount point on the body PNG (0..1)
  //   turretPivotFracX/Y  : pivot location on the turret PNG (0..1) — the
  //                         BREECH end, hidden behind the body
  //   barrelAngleOffset   : added to aim angle so the natural barrel
  //                         direction lines up with +X
  const TANK_SPECS = [
    {
      bodyPivotFracX: 0.36, bodyPivotFracY: 0.30,
      turretPivotFracX: 0.06, turretPivotFracY: 0.50,
      barrelAngleOffset: 0,                          // muzzle already points +X
    },
    {
      bodyPivotFracX: 0.20, bodyPivotFracY: 0.32,
      turretPivotFracX: 0.94, turretPivotFracY: 0.50,
      barrelAngleOffset: Math.PI,                    // muzzle points -X → rotate 180°
    },
  ];
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
    y: H * 0.52,            // mid-height — keeps cameraY at 0 so the full road shows on spawn
    heading: 0,                 // facing right
    throttle: 0.65,
    hp: 100,
    invulnUntil: 0,
    alive: true,
  };
  const MIN_SPEED   = 0.08;     // px / ms at throttle 0  (50 % of previous 0.16)
  const MAX_SPEED   = 0.24;     // px / ms at throttle 1  (50 % of previous 0.48)
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
  const tanks      = [];   // { x, w, h, turretAngle, fireAt, hp, alive, spec, bodyImg, turretImg }
  const trucks     = [];   // { x, w, h, vx, hp, alive, img }
  let stageBuilt = false;
  function buildStageIfReady() {
    if (stageBuilt) return;
    if (!assets.apartments.length || !assets.enemies.length) return;
    if (!assets.tankBodies.length || !assets.trucks.length) return;
    stageBuilt = true;

    // --- Apartments (background scenery) — packed edge-to-edge across the
    // FULL width of the stage so the very left edge is never empty.
    let cursor = -120;                    // start a touch off the left so the strip extends past the bound
    let lastImg = null;
    while (cursor < STAGE_W + 120) {
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

    // Shuffled-deck picker: returns a variant from `pool`, cycling through
    // every entry before repeating, so spawns spread evenly across the
    // available art instead of clustering on one or two random favourites.
    function deckPicker(pool) {
      let deck = [];
      return () => {
        if (deck.length === 0) {
          deck = pool.slice();
          for (let k = deck.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [deck[k], deck[j]] = [deck[j], deck[k]];
          }
        }
        return deck.pop();
      };
    }

    // --- Enemy roster — 8 planes spread across the stage in BOTH axes so
    // the hero meets them at varied altitudes instead of always head-on.
    const N_ENEMIES = 8;
    const pickEnemyImg = deckPicker(assets.enemies);
    for (let i = 0; i < N_ENEMIES; i++) {
      const img = pickEnemyImg();
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
        // Wander offset — refreshed periodically so chasing isn't a perfect
        // pursuit curve. See updateEnemies.
        wanderAngle: (Math.random() - 0.5) * 0.6,
        wanderUntil: 0,
      });
    }

    // --- Ground tanks — 4 stationary turrets spread across the stage.
    const N_TANKS = 4;
    // Deck of variant indices, shuffled, so every spawn cycles through all
    // available tank types before any repeat.
    const tankVariantPicker = deckPicker(assets.tankBodies.map((_, idx) => idx));
    for (let i = 0; i < N_TANKS; i++) {
      const variant = tankVariantPicker();
      const bodyImg = assets.tankBodies[variant];
      const turretImg = assets.tankTurrets[variant];
      const spec = TANK_SPECS[variant] || TANK_SPECS[0];
      const h = TANK_BODY_H;
      const w = h * (bodyImg.width / bodyImg.height);
      const x = 1600 + (i + 0.5) * (STAGE_W - 2000) / N_TANKS + (Math.random() - 0.5) * 200;
      tanks.push({
        x, w, h,
        bodyImg, turretImg, spec,
        turretAngle: -Math.PI / 2,   // start aimed straight up
        fireAt: 0,
        hp: 4,
        alive: true,
      });
    }

    // --- Trucks — 5 driving ground targets that don't shoot.
    const N_TRUCKS = 5;
    const pickTruckImg = deckPicker(assets.trucks);
    for (let i = 0; i < N_TRUCKS; i++) {
      const img = pickTruckImg();
      const h = TRUCK_H;
      const w = h * (img.width / img.height);
      const x = 1100 + (i + 0.5) * (STAGE_W - 1500) / N_TRUCKS + (Math.random() - 0.5) * 240;
      trucks.push({
        x, w, h,
        img,
        vx: (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.04),  // px / ms
        hp: 2,
        alive: true,
        turnPhase: 0,            // 1 → 0 over ~0.6 s after a direction change
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
  // Fire rate / heat tuned for sustained engagements: ~40 shots before
  // overheat, and a < 0.5 s cool-down from overheat back to firing — players
  // shouldn't feel like the gun is permanently broken after a short burst.
  const FIRE_INTERVAL    = 100;        // 10 shots / second
  const HEAT_PER_SHOT    = 0.025;
  const HEAT_COOL_PER_MS = 0.0018;
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
  // Clouds behave like an OBSERVER sees them — the near ones shift slightly
  // with the camera, the far ones are nearly screen-locked. Each cloud is
  // anchored in WORLD space; its rendered screen position is computed using
  // a low parallax factor so even at full-throttle flight the cloud only
  // barely drifts. A tiny constant leftward wind keeps the sky alive.
  const clouds = [];
  let nextCloudAt = 0;
  const MAX_CLOUDS = 7;
  function spawnCloud(now, opts = {}) {
    if (!assets.clouds.length) return;
    const img = assets.clouds[Math.floor(Math.random() * assets.clouds.length)];
    const depth = Math.random();                                   // 0 = near, 1 = far
    const targetH  = 150 - depth * 80;                              // 150 near → 70 far (larger overall)
    const alpha    = 0.92 - depth * 0.30;                           // 0.92 near → 0.62 far (always clearly visible)
    // Parallax: near clouds get a SLIGHT shift with camera (0.18), far ones
    // are practically screen-locked (0.02). Far clouds = "infinitely distant".
    const parallax = 0.18 * (1 - depth) + 0.02;
    // Constant wind drift — slow, leftward, near clouds drift faster.
    const drift    = 0.003 + (1 - depth) * 0.006;                   // px / ms
    // Spawn position: we want the cloud to appear in the upper sky band of
    // the viewport. Solve worldX / worldY so that its initial SCREEN position
    // lands at the desired offset.
    const desiredScreenX = opts.fromLeft
      ? -120 - Math.random() * 200                                  // off-screen left (initial fill)
      : W + 80 + Math.random() * 300;                               // off-screen right (re-spawn)
    const desiredScreenY = 30 + Math.random() * (H * 0.55);          // top half of viewport
    const worldX = desiredScreenX + cameraX * parallax;
    const worldY = desiredScreenY + cameraY * parallax;
    clouds.push({ img, worldX, worldY, parallax, drift, targetH, alpha });
  }
  let cloudsSeeded = false;
  function updateClouds(now, dt) {
    // Pre-seed the sky with a spread of clouds the first time we have assets.
    // (Used to gate on `now < 200`, but performance.now() is already in the
    // thousands by the time the game loop runs, so the seed never fired and
    // the sky stayed cloudless.)
    if (!cloudsSeeded && assets.clouds.length) {
      for (let i = 0; i < MAX_CLOUDS; i++) {
        // Spread initial clouds across the visible width by spawning some
        // from the left and some from the right.
        spawnCloud(now, { fromLeft: i % 2 === 0 });
        // Nudge each cloud's worldX a bit so they're not all stacked.
        const c = clouds[clouds.length - 1];
        c.worldX -= (Math.random() * W * 0.8);
      }
      cloudsSeeded = true;
    }
    if (now >= nextCloudAt && clouds.length < MAX_CLOUDS) {
      spawnCloud(now);
      nextCloudAt = now + (3500 + Math.random() * 4000);
    }
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      c.worldX -= c.drift * dt;                                     // gentle wind
      const sx = c.worldX - cameraX * c.parallax;
      if (sx < -400) clouds.splice(i, 1);
    }
  }

  // ---------- WIN / LOSE ----------
  let gameOver = false;
  let win = false;
  function targetsRemaining() {
    // Apartments are background scenery — only planes, tanks, and trucks
    // count toward stage completion.
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    for (const t of tanks)   if (t.alive) n++;
    for (const k of trucks)  if (k.alive) n++;
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
    updateClouds(now, dt);

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
    // Slower and less laser-focused than before. ~40 % cut on flight speed
    // (cruise / dash throttles both lowered), and a 40 % wander mix in the
    // chase heading so the squadron weaves through the sky instead of riding
    // a perfect pursuit curve onto the hero. Each enemy refreshes its
    // wander offset on its own clock so the swarm desynchronises.
    const WAKE_RANGE_X = 1.2 * W;
    const FIRE_RANGE   = 360;
    const ALIGN_RAD    = 0.10;
    const ENEMY_TURN_RATE = 0.9;
    const ENEMY_WANDER_MIX = 0.40;          // fraction of heading set by wander vs pure chase

    // Cap concurrent awake enemies at 2: only the two closest live enemies
    // within wake range are activated each frame. When one dies, the next
    // closest joins the fight.
    const ACTIVE_ENEMY_CAP = 2;
    const wakeCandidates = enemies
      .filter(e => e.alive && Math.abs(player.x - e.x) < WAKE_RANGE_X)
      .map(e => ({ e, d: Math.hypot(player.x - e.x, player.y - e.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, ACTIVE_ENEMY_CAP)
      .map(o => o.e);
    for (const e of enemies) e.awake = wakeCandidates.includes(e);

    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      if (!en.alive) continue;

      const dx0 = player.x - en.x, dy0 = player.y - en.y;
      const dist = Math.hypot(dx0, dy0);
      if (!en.awake) continue;

      // Refresh wander offset every 0.8-1.6 s — small ±0.6 rad bias added to
      // the pure pursuit heading. ENEMY_WANDER_MIX controls how strongly it
      // pulls the enemy off the hero's line.
      if (now >= en.wanderUntil) {
        en.wanderAngle = (Math.random() - 0.5) * 1.2;       // ±0.6 rad
        en.wanderUntil = now + 800 + Math.random() * 800;
      }
      const pursuit = Math.atan2(dy0, dx0);
      const desired = pursuit + en.wanderAngle * ENEMY_WANDER_MIX;
      const diff = normalizeAngle(desired - en.heading);
      const maxTurn = ENEMY_TURN_RATE * (dt / 1000);
      en.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
      en.heading = normalizeAngle(en.heading);

      // Throttle: cruise / dash both ~40 % lower than the previous values.
      const targetThrottle = dist > 600 ? 0.50 : 0.32;
      en.throttle += (targetThrottle - en.throttle) * (dt / 600);

      const enSp = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * en.throttle;
      en.x += Math.cos(en.heading) * enSp * dt;
      en.y += Math.sin(en.heading) * enSp * dt;

      if (en.y < FLIGHT_Y_MIN) { en.y = FLIGHT_Y_MIN; en.heading = -en.heading; }
      if (en.y > FLIGHT_Y_MAX) { en.y = FLIGHT_Y_MAX; en.heading = -en.heading; }
      if (en.x < 30)            { en.x = 30;            en.heading = 0; }
      if (en.x > STAGE_W - 30)  { en.x = STAGE_W - 30;  en.heading = Math.PI; }

      // Fire when nose is on target (against the PURE pursuit heading, not
      // the wander-biased one) and within range.
      const aimDiff = normalizeAngle(pursuit - en.heading);
      if (Math.abs(aimDiff) < ALIGN_RAD && dist < FIRE_RANGE && now >= en.fireAt) {
        spawnEnemyBullet(en);
        en.fireAt = now + 900 + Math.random() * 700;
      }
    }

    // ----- Tanks (turret tracks the hero, fires when aligned) -----
    const TANK_TURRET_TURN_RATE = 1.4;       // rad / sec
    const TANK_FIRE_RANGE_X = 1.0 * W;        // only fire if hero is within ~1 screen in X
    const TANK_ALIGN_RAD = 0.12;
    for (const t of tanks) {
      if (!t.alive) continue;
      const pivotX = t.x - t.w / 2 + t.spec.bodyPivotFracX * t.w;
      const pivotY = ROAD_BOTTOM_Y - t.h + t.spec.bodyPivotFracY * t.h;
      const desired = Math.atan2(player.y - pivotY, player.x - pivotX);
      const diff = normalizeAngle(desired - t.turretAngle);
      const maxTurn = TANK_TURRET_TURN_RATE * (dt / 1000);
      t.turretAngle += Math.max(-maxTurn, Math.min(maxTurn, diff));

      if (Math.abs(diff) < TANK_ALIGN_RAD &&
          Math.abs(player.x - pivotX) < TANK_FIRE_RANGE_X &&
          now >= t.fireAt) {
        // Muzzle is at the end of the rotated barrel.
        const barrelLen = t.w * 0.55;
        const mx = pivotX + Math.cos(t.turretAngle) * barrelLen;
        const my = pivotY + Math.sin(t.turretAngle) * barrelLen;
        bullets.push({
          x: mx, y: my,
          vx: Math.cos(t.turretAngle) * BULLET_SPEED * 0.82,
          vy: Math.sin(t.turretAngle) * BULLET_SPEED * 0.82,
          owner: 'enemy',
          life: BULLET_LIFE_MS,
        });
        t.fireAt = now + 1400 + Math.random() * 900;
      }
    }

    // ----- Trucks (drive along the street, no shooting) -----
    // Every truck also rolls a random "U-turn" chance, so the player sees
    // direction changes in the middle of the road rather than only at the
    // stage edges. Each direction change kicks off a brief dust-puff and
    // a body-tilt effect (turnPhase animates from 1 → 0).
    for (const k of trucks) {
      if (!k.alive) continue;
      k.x += k.vx * dt;
      if (k.turnPhase > 0) k.turnPhase = Math.max(0, k.turnPhase - dt / 600);
      // Random U-turn — average once every ~6 s while driving.
      if (k.nextTurnAt === undefined) k.nextTurnAt = now + 4000 + Math.random() * 4000;
      let turned = false;
      if (now >= k.nextTurnAt && k.turnPhase <= 0) {
        k.vx = -k.vx;
        k.nextTurnAt = now + 4500 + Math.random() * 4500;
        turned = true;
      }
      if (k.x < 50)            { k.x = 50;            k.vx = Math.abs(k.vx);  turned = true; }
      if (k.x > STAGE_W - 50)  { k.x = STAGE_W - 50;  k.vx = -Math.abs(k.vx); turned = true; }
      if (turned) {
        k.turnPhase = 1;
        // Dust puffs at the wheels.
        for (let p = 0; p < 6; p++) {
          const off = (Math.random() - 0.5) * k.w * 0.7;
          particles.push({
            kind: 'smoke',
            x: k.x + off, y: ROAD_BOTTOM_Y - 6,
            vx: (Math.random() - 0.5) * 0.6 - k.vx * 6,
            vy: -0.2 - Math.random() * 0.4,
            life0: 700, life: 700,
            r0: 4 + Math.random() * 4,
            color: 'rgba(140, 130, 120, 0.55)',
          });
        }
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

      // Apartments are pure background scenery now — bullets pass through
      // them without doing damage. (Used to be destructible targets.)

      // Tanks — body rectangle hit zone (turret rotates so we only check body).
      for (let j = tanks.length - 1; j >= 0; j--) {
        const t = tanks[j];
        if (!t.alive) continue;
        const top = ROAD_BOTTOM_Y - t.h;
        if (b.x >= t.x - t.w / 2 && b.x <= t.x + t.w / 2 && b.y >= top && b.y <= ROAD_BOTTOM_Y) {
          t.hp -= 1;
          if (t.hp <= 0) { t.alive = false; spawnExplosion(b.x, top + t.h * 0.4, true); }
          else           { spawnExplosion(b.x, b.y, false); }
          consumed = true;
          break;
        }
      }
      if (consumed) { bullets.splice(i, 1); continue; }

      // Trucks — body rectangle hit zone.
      for (let j = trucks.length - 1; j >= 0; j--) {
        const k = trucks[j];
        if (!k.alive) continue;
        const top = ROAD_BOTTOM_Y - k.h;
        if (b.x >= k.x - k.w / 2 && b.x <= k.x + k.w / 2 && b.y >= top && b.y <= ROAD_BOTTOM_Y) {
          k.hp -= 1;
          if (k.hp <= 0) { k.alive = false; spawnExplosion(b.x, top + k.h * 0.4, true); }
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
      const screenY = c.worldY - cameraY * c.parallax;
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
    // The cobblestones converge to a vanishing point that sits to the RIGHT
    // of the source PNG's geometric centre (the brightness peak ≈ 0.51 of
    // the source width, but the optical perspective centre is further along).
    // Anchor so this fraction of the source lines up with canvas X = W/2.
    const PERSPECTIVE_FRAC = 0.62;
    const startX = Math.round(W / 2 - PERSPECTIVE_FRAC * tileW);
    ctx.drawImage(img, startX, streetScreenY, tileW + 1, tileH);
    for (let x = startX + tileW; x < W; x += tileW) {
      ctx.drawImage(img, x, streetScreenY, tileW + 1, tileH);
    }
    for (let x = startX - tileW; x > -tileW; x -= tileW) {
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

  // Soft elliptical shadow under a ground vehicle — sits on the road surface
  // and shrinks slightly during a turn (the body lifts ever so slightly).
  function drawGroundShadow(centerX, w, scale = 1) {
    const shadowY = worldToScreenY(ROAD_BOTTOM_Y) - 2;
    if (shadowY < -20 || shadowY > H + 20) return;
    ctx.save();
    ctx.globalAlpha = 0.40;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(centerX, shadowY, (w / 2) * 0.95 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawTrucks() {
    for (const k of trucks) {
      if (!k.alive || !k.img) continue;
      const sx = worldToScreenX(k.x);
      if (sx + k.w / 2 < -10 || sx - k.w / 2 > W + 10) continue;
      // Vehicles ride ON the cobblestone road — bottom flush with the road
      // surface, not the kerb the apartments sit on.
      const bottom = worldToScreenY(ROAD_BOTTOM_Y);
      const top = bottom - k.h;
      if (top > H + 10) continue;
      // Shadow first — wider than the body, slightly soft.
      drawGroundShadow(sx, k.w, 1 - k.turnPhase * 0.10);
      // Turning effect — tilt the body forward into the new direction and
      // lift the rear wheel slightly. turnPhase goes 1 → 0 over ~0.6 s.
      const tiltSign = (k.vx > 0 ? 1 : -1);
      const tilt = k.turnPhase * 0.12 * tiltSign;
      const lift = k.turnPhase * 4;
      ctx.save();
      ctx.translate(sx, top + k.h / 2 - lift);
      ctx.rotate(tilt);
      // Source PNGs face LEFT; mirror when driving right so the cab leads.
      if (k.vx > 0) ctx.scale(-1, 1);
      ctx.drawImage(k.img, -k.w / 2, -k.h / 2, k.w, k.h);
      ctx.restore();
    }
  }

  // Tank render is split into TWO passes: drawTankTurrets() runs BEFORE the
  // body pass so the body silhouette covers the turret's breech end. Only
  // the gun barrel reads above the body, which matches the reference sketch.
  function tankBodyRect(t) {
    const sx = worldToScreenX(t.x);
    const bottom = worldToScreenY(ROAD_BOTTOM_Y);
    const top = bottom - t.h;
    return { sx, top, bottom };
  }
  function drawTankTurrets() {
    for (const t of tanks) {
      if (!t.alive) continue;
      const { sx, top } = tankBodyRect(t);
      if (sx + t.w / 2 < -40 || sx - t.w / 2 > W + 40) continue;
      if (top > H + 40) continue;
      const spec = t.spec;
      // Pivot sits on the body PNG at the spec-defined mount point.
      const pivotSX = sx - t.w / 2 + spec.bodyPivotFracX * t.w;
      const pivotSY = top + spec.bodyPivotFracY * t.h;
      const turretAspect = t.turretImg.width / t.turretImg.height;
      const trH = TANK_TURRET_H;
      const trW = trH * turretAspect;
      ctx.save();
      ctx.translate(pivotSX, pivotSY);
      ctx.rotate(t.turretAngle + spec.barrelAngleOffset);
      const offX = -spec.turretPivotFracX * trW;
      const offY = -spec.turretPivotFracY * trH;
      ctx.drawImage(t.turretImg, offX, offY, trW, trH);
      ctx.restore();
    }
  }
  function drawTankBodies() {
    for (const t of tanks) {
      if (!t.alive) continue;
      const { sx, top } = tankBodyRect(t);
      if (sx + t.w / 2 < -40 || sx - t.w / 2 > W + 40) continue;
      if (top > H + 40) continue;
      drawGroundShadow(sx, t.w);
      ctx.drawImage(t.bodyImg, sx - t.w / 2, top, t.w, t.h);
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
      drawAircraft(en.img, en.x, en.y, en.heading, 42);  // 30 % smaller than the hero (60)
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
    // Apartments aren't targets anymore — dropped from the minimap dots.
    for (const k of trucks) {
      if (!k.alive) continue;
      ctx.fillStyle = '#FFD23F';
      ctx.fillRect(mapWX(k.x) - 1.5, mapWY(STREET_TOP_Y) - 3, 3, 2);
    }
    for (const t of tanks) {
      if (!t.alive) continue;
      ctx.fillStyle = '#FF8A2C';
      ctx.fillRect(mapWX(t.x) - 2, mapWY(STREET_TOP_Y) - 3, 4, 3);
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

  let lastShakeUpdate = 0;
  function render(now) {
    lastFrameNow = now;
    // Decay the camera shake every frame, even when update() is paused on
    // gameOver — otherwise the SHOT DOWN screen vibrates forever because
    // the explosion-on-death set shake to 7 and it never drains.
    const shakeDt = lastShakeUpdate ? Math.min(40, now - lastShakeUpdate) : 16;
    lastShakeUpdate = now;
    cameraShake *= Math.pow(0.85, shakeDt / 16);
    if (cameraShake < 0.05) cameraShake = 0;

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
    drawTankTurrets();      // turret barrel renders behind the body
    drawTrucks();
    drawTankBodies();       // body silhouette covers the turret breech
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
