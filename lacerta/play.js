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
  const assets = { sky: null, farStars: null, closerStars: null, tsunami: null, phoenix: null, planets: [] };
  Promise.all([
    loadImage('./assets/skybackground.svg'),
    loadImage('./assets/far-stars.svg'),
    loadImage('./assets/closer-stars.svg'),
    loadImage('./assets/tsunami.svg'),
    loadImage('./assets/phoenix.svg'),
  ]).then(([sky, farStars, closerStars, tsunami, phoenix]) => {
    assets.sky = sky;
    assets.farStars = farStars;
    assets.closerStars = closerStars;
    assets.tsunami = tsunami;
    assets.phoenix = phoenix;
  });
  // Planet pool — a subset of the 11 available. We don't need all of them in
  // memory at once; this picks a varied 5 to drift through the background.
  Promise.all([1, 3, 5, 7, 9].map(id => loadImage(`./assets/planets/planet-${id}.svg`)))
    .then(imgs => { assets.planets = imgs.filter(Boolean); });

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
  const PARALLAX = { sky: 0.04, far: 0.18, close: 0.55 };

  // ---------- AMBIENT PLANET DRIFT ----------
  // Mid-distance planets cross the screen between the two star layers. Each
  // spawns off-screen right, drifts left at its own depth-relative speed,
  // despawns once it leaves the canvas on the left. Adds life to the
  // background without any gameplay consequence (collisions land in Phase 4).
  const planets = [];          // active drifters
  let nextPlanetAt = 0;
  function spawnPlanet(now) {
    if (!assets.planets.length) return;
    const img = assets.planets[Math.floor(Math.random() * assets.planets.length)];
    const yMin = 80, yMax = H - 80;
    planets.push({
      img,
      x: W + 200,
      y: yMin + Math.random() * (yMax - yMin),
      targetH: 70 + Math.random() * 110,            // 70..180 tall (smaller = deeper)
      depthSpeed: 0.18 + Math.random() * 0.22,      // 0.18..0.40x world rate (slower)
      alpha: 0.45 + Math.random() * 0.20,           // 0.45..0.65 (atmospheric fade)
      spawnedWorldX: player.worldX,
    });
  }
  const MAX_PLANETS = 2;
  function updatePlanets(now) {
    // Spawn less often AND cap how many can be on screen at once, so planets
    // feel like the occasional sighting rather than a parade.
    if (now >= nextPlanetAt && planets.length < MAX_PLANETS) {
      spawnPlanet(now);
      nextPlanetAt = now + (9000 + Math.random() * 7000);  // every 9..16s
    }
    for (let i = planets.length - 1; i >= 0; i--) {
      const p = planets[i];
      p.x = (W + 200) - (player.worldX - p.spawnedWorldX) * p.depthSpeed;
      if (p.x < -300) planets.splice(i, 1);
    }
  }
  function drawPlanets() {
    for (const p of planets) {
      const aspect = p.img.width / p.img.height;
      const w = p.targetH * aspect;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.drawImage(p.img, p.x - w / 2, p.y - p.targetH / 2, w, p.targetH);
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
    // Space can fire too — convenient for keyboard-only players / accessibility.
    if (e.key === ' ') isFiring = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    if (e.key === ' ') isFiring = false;
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
  const PLAYER_HIT_R = 22;            // collision radius approximations
  const ENEMY_HIT_R  = 28;

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
    enemies.push({
      kind:  'phoenix',
      hueShift: 60,                    // +60deg → reddish/orange
      x: W + 80,
      y: 90 + Math.random() * (H - 180),
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

    // World scroll + ambient planets.
    player.worldX += BASE_SPEED * player.throttle * dt;
    updatePlanets(now);

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
    if (!assets.tsunami) return;
    const img = assets.tsunami;
    // Render the ship at ~55 tall on the 720 canvas (~7.6% of canvas height).
    const targetH = 55;
    const targetW = targetH * (img.width / img.height);
    ctx.save();
    ctx.translate(player.screenX, player.y);
    // Tsunami's SVG points LEFT in its viewBox. The side-scroller has the
    // player flying right with enemies entering from the right, so we mirror
    // her horizontally. The bank-on-pitch rotation has its sign inverted
    // post-mirror so an ascending input still tips the nose UP.
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
    if (!assets.phoenix) return;
    const img = assets.phoenix;
    // Match the player's render height so enemies read as the same class
    // of ship rather than tiny darts.
    const targetH = 60;
    const targetW = targetH * (img.width / img.height);
    for (const en of enemies) {
      ctx.save();
      ctx.translate(en.x, en.y);
      // Bank into vertical motion.
      ctx.rotate(Math.max(-0.4, Math.min(0.4, en.vy * 0.4)));
      ctx.filter = `hue-rotate(${en.hueShift}deg) saturate(1.05)`;
      // Phoenix.svg points LEFT (same convention as Tsunami); enemies face LEFT
      // toward the player, so no horizontal flip needed.
      ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
      ctx.restore();
    }
    ctx.filter = 'none';
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

    drawParallaxLayer(assets.sky,         PARALLAX.sky);
    drawParallaxLayer(assets.farStars,    PARALLAX.far,   'screen');
    drawPlanets();
    drawParallaxLayer(assets.closerStars, PARALLAX.close, 'screen');
    drawExhaustTrail(now);
    // Player render — blink during invuln frames so hits are felt.
    if (now <= playerInvulnUntil && Math.floor(now / 60) % 2 === 0) {
      // skip drawing this frame
    } else {
      drawPlayer();
    }
    drawEnemies();
    drawBullets();
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
