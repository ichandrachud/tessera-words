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
  const assets = { sky: null, farStars: null, closerStars: null, tsunami: null, planets: [] };
  Promise.all([
    loadImage('./assets/skybackground.svg'),
    loadImage('./assets/far-stars.svg'),
    loadImage('./assets/closer-stars.svg'),
    loadImage('./assets/tsunami.svg'),
  ]).then(([sky, farStars, closerStars, tsunami]) => {
    assets.sky = sky;
    assets.farStars = farStars;
    assets.closerStars = closerStars;
    assets.tsunami = tsunami;
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

  // ---------- INPUT ----------
  // Desktop: arrow keys for pitch + throttle.
  // Mobile (later, Phase 5): touch zones / drag.
  const keys = Object.create(null);
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys[e.key] = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  function readInput() {
    let p = 0;
    if (keys.ArrowUp)   p -= 1;
    if (keys.ArrowDown) p += 1;
    player.pitchInput = p;

    if (keys.ArrowRight) player.throttle = Math.min(THROTTLE_MAX, player.throttle + 0.012);
    if (keys.ArrowLeft)  player.throttle = Math.max(THROTTLE_MIN, player.throttle - 0.012);
  }

  // ---------- UPDATE ----------
  function update(dt) {
    if (landscapeLocked) return;            // paused while user re-orients device

    readInput();

    // Vertical motion — pitch input nudges vy with momentum, springs back
    // toward 0 when released. Position clamped within a safe band.
    player.vy += player.pitchInput * PITCH_ACCEL * dt;
    player.vy = Math.max(-VY_MAX, Math.min(VY_MAX, player.vy));
    if (player.pitchInput === 0) player.vy *= Math.pow(PITCH_DAMP, dt / 16);
    player.y += player.vy * dt;
    const yMin = 90;
    const yMax = H - 90;
    if (player.y < yMin) { player.y = yMin; player.vy = 0; }
    if (player.y > yMax) { player.y = yMax; player.vy = 0; }

    // Visual bank tracks vy direction so the ship leans into its motion.
    const targetPitch = Math.max(-1, Math.min(1, player.vy / VY_MAX));
    player.pitch += (targetPitch - player.pitch) * 0.10;

    // World scroll — accumulator drives the parallax + (later) wave spawns.
    player.worldX += BASE_SPEED * player.throttle * dt;
    updatePlanets(performance.now());
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

  function render(now) {
    clearBg();
    drawParallaxLayer(assets.sky,         PARALLAX.sky);
    drawParallaxLayer(assets.farStars,    PARALLAX.far,   'screen');
    drawPlanets();
    drawParallaxLayer(assets.closerStars, PARALLAX.close, 'screen');
    drawExhaustTrail(now);
    drawPlayer();
  }

  // ---------- LOOP ----------
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(40, now - lastTime);   // cap to avoid huge jumps on tab-resume
    lastTime = now;
    update(dt);
    render(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
