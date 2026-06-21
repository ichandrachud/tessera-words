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

  // ---------- MISSIONS ----------
  // Linear campaign — each mission picks a world and a briefing story.
  // After STAGE CLEAR the page redirects to the next mission's URL so the
  // briefing scene replays with the new story.
  const MISSIONS = [
    {
      world: 'city',
      story: 'Empyrean has fallen under siege. Enemy planes claim the sky, tanks roll unchallenged through the streets, and gun towers crown half the rooftops. The city is shutting down — civilians shelter in basements, listening for engines that aren’t theirs. You are the last sortie in the air. Wheels up.',
    },
    {
      world: 'ocean',
      story: 'The blockade has reached our coast. A flotilla of armed cutters slipped into our waters overnight, their deck guns tracking every fishing boat in the harbour. There is no fleet left to meet them. Your wingmen have orders to escort civilians to shore — you are flying alone, into open water. Sink them.',
    },
  ];
  const URL_PARAMS = new URLSearchParams(window.location.search);
  // 1-indexed in the URL for player-friendliness. mission=2 means MISSIONS[1].
  const MISSION_INDEX = Math.max(0, Math.min(MISSIONS.length - 1,
    (parseInt(URL_PARAMS.get('mission'), 10) || 1) - 1));
  const CURRENT_MISSION = MISSIONS[MISSION_INDEX];
  // Allow ?world= to override the mission's default world (useful for
  // quick visual iteration without bumping the mission number).
  const WORLD_OVERRIDE = URL_PARAMS.get('world');
  const WORLD = ['ocean', 'night-city', 'night-ocean', 'city'].includes(WORLD_OVERRIDE)
    ? WORLD_OVERRIDE
    : CURRENT_MISSION.world;
  const IS_OCEAN = WORLD === 'ocean' || WORLD === 'night-ocean';
  const IS_NIGHT = WORLD === 'night-city' || WORLD === 'night-ocean';
  document.body.classList.add('world-' + WORLD);

  // ---------- CANVAS DIMS (FIXED 16:9) ----------
  const W = 1280;
  const H = 720;
  const STAGE_W = W * 6;            // 7680 px — full arena width
  // Canvas display size — fits within the shared .page container (max-width
  // 1100 px). The LOGICAL coordinate system stays 1280 × 720; resizeCanvas
  // applies a uniform scale so the content fills the smaller display rect.
  // Without this, the 1280-wide canvas overflowed the 1100-wide page and
  // got clipped on the right, making the title-screen content read as
  // shifted right.
  const CANVAS_DISP_W = 1024;
  const CANVAS_DISP_H = Math.round(CANVAS_DISP_W * H / W);   // 576, preserves 16:9
  document.body.style.setProperty('--canvas-w', CANVAS_DISP_W + 'px');
  document.body.style.setProperty('--canvas-h', CANVAS_DISP_H + 'px');

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
      img.onerror = () => { console.warn('Empyrean: failed to load', src); resolve(null); };
      img.src = src;
    });
  }
  const assets = {
    sky: null, street: null,
    player: null, enemies: [],
    apartments: [], clouds: [],
    tankBodies: [], tankTurrets: [],   // index-aligned: tankBodies[i] pairs with tankTurrets[i]
    trucks: [],
    militaryBodies: [], militaryBodiesBurnt: [],   // index-aligned: alive/burnt pairs
    militaryTurret: null, militaryTurretBurnt: null,
  };
  loadImage('./assets/sky/sky.jpg').then(img => { assets.sky = img; });
  loadImage('./assets/street/street2.jpg').then(img => { assets.street = img; });
  loadImage('./assets/planes-v2/Tsunami.png').then(img => { assets.player = img; });

  // ---------- OCEAN WORLD ASSETS ----------
  // Loaded only when WORLD === 'ocean' so the city stage isn't slowed down
  // by sprites it never uses. buildStageIfReady checks for these specifically
  // when the world is ocean.
  if (IS_OCEAN) {
    loadImage('./assets/ocean/water.jpg').then(img => { assets.water = img; });
    loadImage('./assets/ocean/ship-turret.png').then(img => { assets.shipTurret = img; });
    Promise.all([1, 2, 3, 4, 5].map(n =>
      loadImage(`./assets/ocean/enemy-ship-0${n}.png`)
    )).then(imgs => { assets.ships = imgs.filter(Boolean); buildStageIfReady(); });
  }

  // ---------- NIGHT-SKY ASSETS ----------
  // Deep-blue gradient background; the stars themselves are drawn
  // procedurally in drawNightSky (the legacy SVG star layers baked in dark
  // radial-gradient centres that read as a dark halo around each star).
  if (IS_NIGHT) {
    loadImage('./assets/skybackground.svg').then(img => { assets.skyNight = img; });
  }

  // ---------- MISSION 1 — AIRCRAFT LINEUP ----------
  // Player choice: 4 planes + 1 chopper. Stats are gameplay values used by the
  // aircraft-select screen (and, downstream, by the live game).
  const MISSION_1_AIRCRAFT = [
    { name: 'Tsunami', file: './assets/planes-v2/Tsunami.png', hp: 100, speed: 100, bombs: 4, kind: 'plane',   blurb: 'Balanced strike fighter.' },
    { name: 'Cyclone', file: './assets/planes-v2/Cyclone.png', hp:  80, speed: 130, bombs: 3, kind: 'plane',   blurb: 'Fast attacker, light armour.' },
    { name: 'Tempest', file: './assets/planes-v2/Tempest.png', hp: 150, speed:  80, bombs: 5, kind: 'plane',   blurb: 'Heavy bomber, slow but tough.' },
    { name: 'Zephyr',  file: './assets/planes-v2/Zephyr.png',  hp:  70, speed: 140, bombs: 2, kind: 'plane',   blurb: 'Light & nimble, fragile.' },
    { name: 'Hornet',  file: './assets/choppers/Hornet.png',   hp: 110, speed:  70, bombs: 4, kind: 'chopper', blurb: 'Hovers; close-range support.' },
  ];
  // Stat-bar normalisation maxes — keeps bar widths comparable across aircraft.
  const STAT_MAX = { hp: 200, speed: 150, bombs: 6 };
  // Load sprite for each entry. We mutate the manifest entry so render code
  // can just read `aircraft.image`. Missing images render as a placeholder.
  for (const a of MISSION_1_AIRCRAFT) {
    loadImage(a.file).then(img => { a.image = img; });
  }

  // ---------- MISSION 1 — BOMB LINEUP ----------
  // Five distinct payloads. Stats drive both the carousel readout and live
  // gameplay (damage = HP per hit on ground targets, blast = AoE radius in
  // world-px, speedMult = horizontal/vertical velocity multiplier on drop).
  const MISSION_1_BOMBS = [
    { name: 'Lance',   file: './assets/bombs/Lance.png',   damage: 1, blast:   0, speedMult: 1.4, blurb: 'Piercing dart. Fast, surgical.' },
    { name: 'Anvil',   file: './assets/bombs/Anvil.png',   damage: 3, blast:   0, speedMult: 0.7, blurb: 'Heavy single-target. Sinks ships in one.' },
    { name: 'Bellows', file: './assets/bombs/Bellows.png', damage: 1, blast: 110, speedMult: 1.0, blurb: 'Airburst spread. Wide damage zone.' },
    { name: 'Pyre',    file: './assets/bombs/Pyre.png',    damage: 2, blast:  70, speedMult: 0.9, blurb: 'Incendiary. Splash + extra punch.' },
    { name: 'Dart',    file: './assets/bombs/Dart.png',    damage: 1, blast:   0, speedMult: 1.6, blurb: 'Light, fastest. Best for moving targets.' },
  ];
  const BOMB_STAT_MAX = { damage: 3, blast: 120, speedMult: 1.6 };
  for (const b of MISSION_1_BOMBS) {
    loadImage(b.file).then(img => { b.image = img; });
  }

  // ---------- BONUS PICKUPS ----------
  // Floating in-air pickups. medical-kit restores 20 % health; gasoline
  // adds 15 % to the plane's speed multiplier (stacks). 2-3 of each per
  // stage. Sprite height is capped at half the plane's height so they
  // read as a collectible, not another aircraft.
  loadImage('./assets/bonuses/medical-kit.png').then(img => { assets.medicalKit = img; });
  loadImage('./assets/bonuses/gasoline.png').then(img => { assets.gasoline = img; });
  const BONUS_H = 36;                 // pixel height in world space
  const BONUS_PICKUP_R = 32;          // pickup radius (centre-to-centre)
  const BONUS_HP_GAIN = 20;           // medical-kit restore amount
  const BONUS_SPEED_GAIN = 0.15;      // gasoline speed multiplier add
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
  // Military buildings — five variants of fortified houses, each with an
  // alive / burnt pair. A shared turret model sits on top and tracks the
  // hero. Bomb or sustained gunfire knocks the building over: alive→burnt,
  // and from then on it emits smoke + embers.
  const MILITARY_IDS = [8, 13, 18, 20, 24];
  Promise.all(MILITARY_IDS.flatMap(n => [
    loadImage(`./assets/military/house-${n}.png`),
    loadImage(`./assets/military/house-${n}-burnt.png`),
  ])).then(imgs => {
    for (let i = 0; i < MILITARY_IDS.length; i++) {
      const a = imgs[i * 2], b = imgs[i * 2 + 1];
      if (a && b) { assets.militaryBodies.push(a); assets.militaryBodiesBurnt.push(b); }
    }
    buildStageIfReady();
  });
  Promise.all([
    loadImage('./assets/military/apartment-turret.png'),
    loadImage('./assets/military/apartment-turret-burnt.png'),
  ]).then(([a, b]) => {
    assets.militaryTurret = a;
    assets.militaryTurretBurnt = b;
    buildStageIfReady();
  });

  // ---------- PALETTE ----------
  const C = { bg: '#020611', text: '#FFFFFF', accent: '#D8523F' };

  // ---------- AUDIO ----------
  // Procedural Web Audio synth — no asset downloads. Initialised lazily on
  // the first user input (browsers block AudioContext until a gesture).
  let audioCtx = null, masterGain = null, soundOn = true;
  let engineNodes = null, vehicleAmbient = null;
  let lastGunSfxAt = 0, lastHitSfxAt = 0;

  function ensureAudio() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = soundOn ? 0.45 : 0.0;
    masterGain.connect(audioCtx.destination);
    // Engine + vehicle ambient hold off until the player actually starts the
    // game (intro screen stays silent). startGameAudio() spins them up.
  }
  function startGameAudio() {
    if (!audioCtx) return;
    startEngine();
    startVehicleAmbient();
  }
  function setSoundOn(v) {
    soundOn = v;
    if (masterGain) masterGain.gain.setTargetAtTime(v ? 0.45 : 0.0, audioCtx.currentTime, 0.05);
  }

  // White-noise buffer (looped) — reused for any noise-based voice.
  function makeNoiseSource(durationSec = 2) {
    const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * durationSec), audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  // Plane engine — dull, low-pitched drone with audible piston "clicks" at
  // the propeller-blade rate. Two voices:
  //   • Tonal pad : sawtooth fundamental + soft octave harmonic through a
  //     low low-pass filter. Provides the warm "wahhh" body.
  //   • Click track : short low-frequency noise bursts scheduled at the
  //     blade rate. Each click is a tiny lowpassed thump (~40 ms decay).
  //     This is what reads as "engine" rather than "fan".
  // Both voices scale with player.throttle.
  let engineClickTimer = null;
  function startEngine() {
    if (engineNodes || !audioCtx) return;
    const t = audioCtx.currentTime;
    const fund = audioCtx.createOscillator();
    fund.type = 'sawtooth';
    fund.frequency.value = 80;
    const harm = audioCtx.createOscillator();
    harm.type = 'sawtooth';
    harm.frequency.value = 160;
    const harmGain = audioCtx.createGain();
    harmGain.gain.value = 0.14;                      // dialled back so the body is darker
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;                        // much duller than before (was 380)
    lp.Q.value = 0.7;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.04;
    // Subtle continuous tremolo for warmth (the strong "chuff" now comes
    // from the click track instead of the LFO).
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 10;
    const lfoDepth = audioCtx.createGain();
    lfoDepth.gain.value = 0.012;
    lfo.connect(lfoDepth).connect(gain.gain);
    fund.connect(lp);
    harm.connect(harmGain).connect(lp);
    lp.connect(gain).connect(masterGain);
    fund.start(t);
    harm.start(t);
    lfo.start(t);
    engineNodes = { fund, harm, lp, gain, lfo };
    // Kick off the click train.
    scheduleEngineClick();
  }
  // One short piston-pop. Re-schedules itself based on current throttle so
  // the click rate speeds up / slows down with RPM.
  function scheduleEngineClick() {
    if (!audioCtx) return;
    const playClick = () => {
      if (!audioCtx || !engineNodes) return;
      const t = audioCtx.currentTime;
      const noise = makeNoiseSource(0.06);
      noise.loop = false;
      const lp = audioCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      lp.Q.value = 1.2;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.028, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      noise.connect(lp).connect(g).connect(masterGain);
      noise.stop(t + 0.07);
      // Next click — interval scales with throttle (idle = ~95 ms, full = ~38 ms)
      const interval = 95 - player.throttle * 57;
      engineClickTimer = setTimeout(playClick, interval);
    };
    if (!engineClickTimer) engineClickTimer = setTimeout(playClick, 60);
  }
  function updateEngine() {
    if (!engineNodes) return;
    const t = player.throttle;
    const ct = audioCtx.currentTime;
    // Fundamental 60 → 130 Hz with throttle; harmonic tracks at 2× the fundamental.
    const f0 = 60 + t * 70;
    engineNodes.fund.frequency.setTargetAtTime(f0, ct, 0.08);
    engineNodes.harm.frequency.setTargetAtTime(f0 * 2, ct, 0.08);
    // LFO speed scales gently with throttle.
    engineNodes.lfo.frequency.setTargetAtTime(8 + t * 6, ct, 0.10);
    // Filter stays dull across the throttle range.
    engineNodes.lp.frequency.setTargetAtTime(220 + t * 120, ct, 0.10);
    // Master gain — quiet at idle, fuller at full throttle.
    engineNodes.gain.gain.setTargetAtTime(0.030 + t * 0.045, ct, 0.10);
  }

  // Proximity rumble for tanks + trucks — low band-pass noise whose gain
  // ramps as the hero gets close to the nearest ground vehicle.
  function startVehicleAmbient() {
    if (vehicleAmbient || !audioCtx) return;
    const src = makeNoiseSource();
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 90;
    bp.Q.value = 0.8;
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    src.connect(bp).connect(gain).connect(masterGain);
    vehicleAmbient = { bp, gain };
  }
  function updateVehicleAmbient() {
    if (!vehicleAmbient) return;
    let minDist = Infinity;
    for (const k of trucks) {
      if (!k.alive) continue;
      const d = Math.hypot(player.x - k.x, player.y - (ROAD_BOTTOM_Y - k.h / 2));
      if (d < minDist) minDist = d;
    }
    for (const t of tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(player.x - t.x, player.y - (ROAD_BOTTOM_Y - t.h / 2));
      if (d < minDist) minDist = d;
    }
    // Fade in inside 360 px, out beyond 700 px.
    const proximity = Math.max(0, Math.min(1, 1 - (minDist - 360) / 340));
    vehicleAmbient.gain.gain.setTargetAtTime(proximity * 0.08, audioCtx.currentTime, 0.18);
  }

  // ----- One-shot SFX -----
  function sfxGun(now) {
    if (!audioCtx) return;
    // Throttle so a held trigger doesn't crackle (10 / sec firing rate).
    if (now - lastGunSfxAt < 70) return;
    lastGunSfxAt = now;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.05);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.07);
  }
  function sfxHit(now) {
    if (!audioCtx) return;
    if (now - lastHitSfxAt < 40) return;          // pile-ups don't stack
    lastHitSfxAt = now;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.05);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }
  function sfxBoom(big) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    // Filtered noise burst — body of the explosion.
    const dur = big ? 0.7 : 0.28;
    const noise = makeNoiseSource(dur);   // one-shot via loop:false-after-stop
    noise.loop = false;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(big ? 1800 : 900, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + dur);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(big ? 0.35 : 0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(lp).connect(g).connect(masterGain);
    noise.stop(t + dur + 0.02);
    // Low-end thump on big booms.
    if (big) {
      const sub = audioCtx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(95, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + 0.45);
      const sg = audioCtx.createGain();
      sg.gain.setValueAtTime(0.42, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      sub.connect(sg).connect(masterGain);
      sub.start(t);
      sub.stop(t + 0.6);
    }
  }

  // ---------- STAGE GEOMETRY ----------
  // The stage is 6 screens WIDE and 4 screens TALL — the ground band at the
  // bottom of the canvas stays put, and the sky extends 3 screen heights
  // ABOVE the canvas top so planes have room to climb, dive, and loop.
  const STREET_H        = 72;
  const STREET_TOP_Y    = H - STREET_H;
  const APARTMENT_RENDER_H = 150;       // ~21 % of 720 canvas — matches reference
  // Ground vehicles drive ON the cobblestone road (not on the kerb the
  // apartments sit on). Their wheels sit just above the bottom edge of the
  // canvas and they're rendered at 60 % of the previous size.
  const ROAD_BOTTOM_Y   = H - 8;
  // ----- Ocean ground geometry -----
  // Waterline sits where the top of the apartment band would have been, so
  // ships have plenty of empty sky above them and the sky band still feels
  // generous. The water surface visually extends down to ROAD_BOTTOM_Y.
  const OCEAN_WATERLINE_Y = STREET_TOP_Y - APARTMENT_RENDER_H;
  const SHIP_BODY_H = 120;          // ~17 % of canvas — leaves the superstructure clearly visible
  const SHIP_TURRET_H = 28;         // a touch larger than the building turret
  const SHIP_HP = 3;                // 3 bomb hits to sink — "more than 2 bombs to destroy completely"
  // The ground-target's bottom-most y. City buildings rest on the street;
  // ocean ships rest on the waterline.
  const GROUND_TARGET_Y = IS_OCEAN ? OCEAN_WATERLINE_Y : STREET_TOP_Y;
  const TANK_BODY_H     = 60;        // ~8 % of canvas — matches reference vehicle scale
  const TANK_TURRET_H   = 20;
  const TRUCK_H         = 54;        // ~7.5 % of canvas
  // Military buildings render at the same height as regular apartments so
  // they blend into the skyline silhouette, with a turret stack on top.
  const MILITARY_BODY_H   = 150;
  const MILITARY_TURRET_H = 64;
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
    throttle: 0,                  // default = no throttle → cruise at MIN_SPEED; → adds up to +30 %
    hp: 100,
    maxHp: 100,
    invulnUntil: 0,
    alive: true,
    kind: 'plane',              // 'plane' or 'chopper' — set when an aircraft is chosen
    facing: 1,                  // chopper-only: +1 = faces right, -1 = faces left (sprite flipped)
    speedMult: 1,               // bonus stacking — +0.15 per gasoline pickup
  };
  // Chopper movement: always upright, fixed speed in 8 directions. Roughly
  // matches a plane's cruise speed (no throttle band).
  const CHOPPER_SPEED = 0.075;  // px / ms
  // Hero speed band — MIN_SPEED is the default cruise (throttle = 0).
  // Pressing → throttles up; full throttle is +30 % above default.
  const MIN_SPEED   = 0.1025;   // px / ms — default cruise speed (was 0.082, +25 %)
  const MAX_SPEED   = 0.1338;   // px / ms — full throttle (+30 % above MIN, was 0.107)
  // Enemy planes use their own band — they don't track player throttle.
  const ENEMY_MIN_SPEED = 0.0264;
  const ENEMY_MAX_SPEED = 0.0792;
  const TURN_RATE   = 2.4;      // rad / sec — how fast the nose rotates
  const THROTTLE_RATE = 0.55;   // throttle units per second of held key

  // Mobile has no acceleration ramp (touch = full throttle) and a smaller
  // visible canvas, so motion reads slower. A flat 1.3x multiplier brings
  // it back in line with the desktop feel.
  const MOBILE_SPEED_BOOST = MODE === 'mobile' ? 1.3 : 1;
  // Slower turn rate on mobile so the plane "leads" the touch target by a
  // beat — gives bullets time to fire forward of the new direction instead
  // of snapping to wherever the finger just landed.
  const MOBILE_TURN_RATE = 1.4;          // rad / sec
  function playerSpeed() {
    return (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * player.throttle) * player.speedMult * MOBILE_SPEED_BOOST;
  }

  // ---------- CAMERA ----------
  // Camera centres on the hero in BOTH axes, clamped to the stage bounds.
  // The stage is now 4 screens tall (3 screens of sky above the canvas), so
  // cameraY varies from STAGE_TOP_Y at the ceiling to 0 at the ground band.
  let cameraX = 0;
  let cameraY = 0;
  function updateCamera() {
    // Lead the camera in the direction the plane is heading so the player
    // sees on-coming targets a moment earlier. The lead component eases
    // toward the new direction so heading changes don't jerk the camera.
    const desiredLeadX = Math.cos(player.heading) * CAMERA_LEAD_X;
    const desiredLeadY = Math.sin(player.heading) * CAMERA_LEAD_Y;
    cameraLeadX += (desiredLeadX - cameraLeadX) * CAMERA_LEAD_SMOOTH;
    cameraLeadY += (desiredLeadY - cameraLeadY) * CAMERA_LEAD_SMOOTH;
    cameraX = Math.max(0, Math.min(STAGE_W - W, player.x + cameraLeadX - W / 2));
    cameraY = Math.max(STAGE_TOP_Y, Math.min(0, player.y + cameraLeadY - H / 2));
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
  const militaryBuildings = []; // { x, w, h, alive, hp, bodyImg, burntImg, turretAngle, fireAt, lastSmokeAt }
  const bonuses = [];           // { x, y, kind: 'medical'|'gasoline', img, alive, bobPhase }
  // The apartment-turret source PNG points UP by default. Pivot at the
  // BREECH (bottom of source) and add π/2 to the aim angle so atan2 = 0
  // (right) rotates the upright turret 90° CW.
  const MILITARY_TURRET_SPEC = {
    bodyPivotFracX: 0.50, bodyPivotFracY: 0.06,    // turret sits centred on top of the building
    turretPivotFracX: 0.50, turretPivotFracY: 0.94, // breech end of the turret source
    barrelAngleOffset: Math.PI / 2,                 // source muzzle points up
  };
  let stageBuilt = false;
  function buildStageIfReady() {
    if (stageBuilt) return;
    if (!assets.enemies.length) return;
    if (IS_OCEAN) {
      if (!assets.water || !assets.ships || !assets.ships.length || !assets.shipTurret) return;
    } else {
      if (!assets.apartments.length) return;
      if (!assets.tankBodies.length || !assets.trucks.length) return;
      if (!assets.militaryBodies.length || !assets.militaryTurret) return;
    }
    stageBuilt = true;
    if (IS_OCEAN) {
      buildOceanStage();
      return;
    }

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

    // --- Trucks — 5 ground targets. Most are PARKED on the kerb; a couple
    // patrol up and down the street. Which two move is randomised but the
    // count is fixed so the stage doesn't read as either deserted or chaotic.
    const N_TRUCKS = 5;
    const N_MOVING_TRUCKS = 2;
    const movingIdxSet = new Set();
    while (movingIdxSet.size < N_MOVING_TRUCKS) movingIdxSet.add(Math.floor(Math.random() * N_TRUCKS));
    const pickTruckImg = deckPicker(assets.trucks);
    for (let i = 0; i < N_TRUCKS; i++) {
      const img = pickTruckImg();
      const h = TRUCK_H;
      const w = h * (img.width / img.height);
      const x = 1100 + (i + 0.5) * (STAGE_W - 1500) / N_TRUCKS + (Math.random() - 0.5) * 240;
      const moving = movingIdxSet.has(i);
      const vx = moving
        ? (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.04)
        : 0;
      trucks.push({
        x, w, h,
        img,
        vx,
        parked: !moving,
        hp: 2,
        alive: true,
        turnPhase: 0,            // 1 → 0 over ~0.6 s after a direction change
      });
    }

    // --- Military buildings — 5 fortified houses spread across the stage,
    // each with a turret on top that tracks the hero. Built strong: bombs
    // kill instantly, hero bullets chip 1 hp each (hp = 6 → ~6 hits or one
    // bomb). When killed, body + turret swap to burnt sprites and the
    // building emits smoke + embers for the rest of the stage.
    const N_MILITARY = 5;
    const pickMilBody = deckPicker(assets.militaryBodies.map((_, i) => i));
    for (let i = 0; i < N_MILITARY; i++) {
      const variant = pickMilBody();
      const bodyImg = assets.militaryBodies[variant];
      const burntImg = assets.militaryBodiesBurnt[variant];
      const h = MILITARY_BODY_H;
      const w = h * (bodyImg.width / bodyImg.height);
      const x = 700 + (i + 0.5) * (STAGE_W - 1100) / N_MILITARY + (Math.random() - 0.5) * 280;
      militaryBuildings.push({
        x, w, h,
        bodyImg, burntImg,
        alive: true,
        hp: 6,
        turretAngle: -Math.PI / 2,    // start aimed straight up (default source orientation)
        fireAt: 0,
        lastSmokeAt: 0,
        kind: 'building',
        groundY: STREET_TOP_Y,
      });
    }
    spawnBonuses();
  }

  // Spread 2-3 medical-kit and 2-3 gasoline pickups across the stage at
  // random altitudes inside the flyable band.  Called by both the city and
  // ocean stage builders.
  function spawnBonuses() {
    function addOne(kind) {
      const x = 800 + Math.random() * (STAGE_W - 1600);
      const y = FLIGHT_Y_MIN + 60 + Math.random() * (FLIGHT_Y_MAX - FLIGHT_Y_MIN - 120);
      bonuses.push({
        x, y, kind,
        img: null,                       // resolved at draw time so we don't race the asset load
        alive: true,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
    const nMed = 2 + Math.floor(Math.random() * 2);   // 2 or 3
    const nGas = 2 + Math.floor(Math.random() * 2);   // 2 or 3
    for (let i = 0; i < nMed; i++) addOne('medical');
    for (let i = 0; i < nGas; i++) addOne('gasoline');
  }

  // Ocean stage — water + 5 stationary enemy ships acting as ground targets.
  // Reuses the militaryBuildings array so the existing turret-tracking,
  // bullet-collision and bomb-damage code paths "just work" with kind:'ship'
  // entries.  No apartments / tanks / trucks in this world.
  function buildOceanStage() {
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
    // Enemy planes — same count + behaviour as the city stage.
    const N_ENEMIES = 8;
    const pickEnemyImg = deckPicker(assets.enemies);
    for (let i = 0; i < N_ENEMIES; i++) {
      const img = pickEnemyImg();
      const startX = 1200 + (i + 0.5) * (STAGE_W - 1400) / N_ENEMIES;
      const yFrac = 0.1 + Math.random() * 0.75;
      const startY = FLIGHT_Y_MIN + yFrac * (FLIGHT_Y_MAX - FLIGHT_Y_MIN);
      enemies.push({
        x: startX, y: startY,
        heading: Math.PI,
        throttle: 0.45,
        hp: 3,
        alive: true,
        img,
        fireAt: 0,
        awake: false,
        wanderAngle: (Math.random() - 0.5) * 0.6,
        wanderUntil: 0,
      });
    }
    // Ships — 5 stationary vessels spread across the stage.
    const N_SHIPS = 5;
    const pickShipIdx = deckPicker(assets.ships.map((_, i) => i));
    for (let i = 0; i < N_SHIPS; i++) {
      const bodyImg = assets.ships[pickShipIdx()];
      const h = SHIP_BODY_H;
      const w = h * (bodyImg.width / bodyImg.height);
      const x = 700 + (i + 0.5) * (STAGE_W - 1100) / N_SHIPS + (Math.random() - 0.5) * 240;
      militaryBuildings.push({
        x, w, h,
        bodyImg,
        burntImg: null,           // ships don't have a burnt variant — they just sink/explode
        alive: true,
        hp: SHIP_HP,
        turretAngle: -Math.PI / 2,
        fireAt: 0,
        lastSmokeAt: 0,
        kind: 'ship',
        groundY: OCEAN_WATERLINE_Y,
      });
    }
    spawnBonuses();
  }

  // ---------- INPUT ----------
  // Desktop = keyboard (←/→ rotate, ↑/↓ throttle, Space fire, B bomb).
  // Mobile  = single-finger virtual stick (touch + drag = rotate / throttle,
  //           holding fires, double-tap drops a bomb).
  const keys = Object.create(null);
  let bombRequest = false;             // set by 'B' keydown or mobile double-tap
  let advanceRequested = false;        // set by Space / Enter edge-press or button tap; used to step through pre-play scenes
  let paused = false;                  // toggled by P / Esc while scene === 'playing'
  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    ensureAudio();                                 // wake the audio context on first key
    keys[e.key] = true;
    // Scene-specific keyboard shortcuts. Done here (not in update()) so each
    // key press maps to exactly one action — no held-key auto-repeat.
    if (scene === 'select') {
      if (e.key === 'ArrowLeft') {
        aircraftIndex = (aircraftIndex - 1 + MISSION_1_AIRCRAFT.length) % MISSION_1_AIRCRAFT.length;
      } else if (e.key === 'ArrowRight') {
        aircraftIndex = (aircraftIndex + 1) % MISSION_1_AIRCRAFT.length;
      } else if (e.key === ' ' || e.key === 'Enter') {
        aircraftChosen = MISSION_1_AIRCRAFT[aircraftIndex];
      }
    } else if (scene === 'bombs') {
      if (e.key === 'ArrowLeft') {
        bombIndex = (bombIndex - 1 + MISSION_1_BOMBS.length) % MISSION_1_BOMBS.length;
      } else if (e.key === 'ArrowRight') {
        bombIndex = (bombIndex + 1) % MISSION_1_BOMBS.length;
      } else if (e.key === ' ' || e.key === 'Enter') {
        bombChosen = MISSION_1_BOMBS[bombIndex];
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      advanceRequested = true;
    }
    if (e.key === 'b' || e.key === 'B') bombRequest = true;
    if (e.key === 'm' || e.key === 'M') setSoundOn(!soundOn);
    // Pause/resume — only meaningful once gameplay has started.
    if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && scene === 'playing') {
      paused = !paused;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });
  window.addEventListener('blur', () => {
    keys.ArrowLeft = keys.ArrowRight = keys.ArrowUp = keys.ArrowDown = keys[' '] = false;
  });

  // --- Mobile touch ---
  // One finger anywhere on the canvas:
  //   • Hold = continuous fire.
  //   • Drag relative to where the touch started → virtual joystick that
  //     drives the same `keys.Arrow*` flags the keyboard sets, so the
  //     downstream update logic doesn't change.
  //   • Double-tap (two quick releases) drops a bomb.
  // Mobile uses an absolute touch-target model: wherever the finger is on
  // the canvas, the plane / chopper steers toward that point. Far more
  // forgiving than the old drag-vector stick, which required precise
  // continuous input to hold a heading.
  let touchTarget = null;              // { x, y } in canvas-logical coords; null when no finger down
  let lastTapAt = 0;
  function canvasFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width  * W,
      y: (clientY - rect.top)  / rect.height * H,
    };
  }
  // Try to expand into the OS's fullscreen mode on the first user gesture.
  // This collapses the mobile address bar entirely, which dvh-based sizing
  // can't do on its own. Safari iOS supports it from 16.4+, Chrome Android
  // earlier. Wrapped in try/catch because some browsers reject silently.
  function tryEnterFullscreen() {
    if (MODE !== 'mobile') return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitEnterFullscreen;
    if (!req) return;
    try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (_) { /* nothing */ }
  }
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    ensureAudio();                                  // wake the audio context on first touch
    tryEnterFullscreen();
    const t = e.changedTouches[0];
    if (!t) return;
    const p = canvasFromClient(t.clientX, t.clientY);
    // Intro: any tap advances. Briefing: only a tap on the Accept Mission button advances.
    if (scene === 'intro') {
      advanceRequested = true;
      return;
    }
    if (scene === 'briefing') {
      if (acceptButtonRect && inRect(acceptButtonRect, p.x, p.y)) advanceRequested = true;
      return;
    }
    if (scene === 'select') {
      if (selectPrevRect && inRect(selectPrevRect, p.x, p.y)) {
        aircraftIndex = (aircraftIndex - 1 + MISSION_1_AIRCRAFT.length) % MISSION_1_AIRCRAFT.length;
      } else if (selectNextRect && inRect(selectNextRect, p.x, p.y)) {
        aircraftIndex = (aircraftIndex + 1) % MISSION_1_AIRCRAFT.length;
      } else if (selectChooseRect && inRect(selectChooseRect, p.x, p.y)) {
        aircraftChosen = MISSION_1_AIRCRAFT[aircraftIndex];
      }
      return;
    }
    if (scene === 'bombs') {
      if (bombPrevRect && inRect(bombPrevRect, p.x, p.y)) {
        bombIndex = (bombIndex - 1 + MISSION_1_BOMBS.length) % MISSION_1_BOMBS.length;
      } else if (bombNextRect && inRect(bombNextRect, p.x, p.y)) {
        bombIndex = (bombIndex + 1) % MISSION_1_BOMBS.length;
      } else if (bombEquipRect && inRect(bombEquipRect, p.x, p.y)) {
        bombChosen = MISSION_1_BOMBS[bombIndex];
      }
      return;
    }
    if (paused) { paused = false; return; }           // tap during pause = resume; swallow this touch so it doesn't also fire
    touchTarget = p;
    keys[' '] = true;                                 // fire while held
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t || !touchTarget) return;
    touchTarget = canvasFromClient(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchTarget = null;
    keys[' '] = false;
    const now = performance.now();
    if (now - lastTapAt < 320) {
      bombRequest = true;
      lastTapAt = 0;                                  // consume so next single tap resets the timer
    } else {
      lastTapAt = now;
    }
  }, { passive: false });
  canvas.addEventListener('touchcancel', () => {
    touchTarget = null;
    keys[' '] = false;
  });

  // Desktop click — used for the intro [Start] button and the briefing
  // [Accept Mission] button. Both share the same hit-test pattern.
  let startButtonRect = null;    // populated by drawIntro each frame
  let startButtonHover = false;
  let acceptButtonRect = null;   // populated by drawBriefing each frame
  let acceptButtonHover = false;
  // Aircraft-select carousel state — populated by drawSelect each frame.
  let aircraftIndex = 0;                  // 0..MISSION_1_AIRCRAFT.length-1
  let aircraftChosen = null;              // set by Choose button -> consumed in update()
  let selectPrevRect = null;              // left arrow hit area
  let selectNextRect = null;              // right arrow hit area
  let selectChooseRect = null;            // Choose button hit area
  let selectPrevHover = false;
  let selectNextHover = false;
  let selectChooseHover = false;
  // Bomb-select carousel state — same shape as aircraft-select but for the
  // bomb-load step that runs after the aircraft is chosen.
  let bombIndex = 0;
  let bombChosen = null;
  let bombPrevRect = null;
  let bombNextRect = null;
  let bombEquipRect = null;
  let bombPrevHover = false;
  let bombNextHover = false;
  let bombEquipHover = false;
  // The bomb the player equipped for the live game (set when bomb-select
  // hands off to playing; consumed by dropBomb).
  let equippedBomb = MISSION_1_BOMBS[0];
  function inRect(r, x, y) {
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  canvas.addEventListener('click', (e) => {
    const p = canvasFromClient(e.clientX, e.clientY);
    if (scene === 'intro' && startButtonRect && inRect(startButtonRect, p.x, p.y)) {
      advanceRequested = true;
      return;
    }
    if (scene === 'briefing' && acceptButtonRect && inRect(acceptButtonRect, p.x, p.y)) {
      advanceRequested = true;
      return;
    }
    if (scene === 'select') {
      if (selectPrevRect && inRect(selectPrevRect, p.x, p.y)) {
        aircraftIndex = (aircraftIndex - 1 + MISSION_1_AIRCRAFT.length) % MISSION_1_AIRCRAFT.length;
      } else if (selectNextRect && inRect(selectNextRect, p.x, p.y)) {
        aircraftIndex = (aircraftIndex + 1) % MISSION_1_AIRCRAFT.length;
      } else if (selectChooseRect && inRect(selectChooseRect, p.x, p.y)) {
        aircraftChosen = MISSION_1_AIRCRAFT[aircraftIndex];
      }
    } else if (scene === 'bombs') {
      if (bombPrevRect && inRect(bombPrevRect, p.x, p.y)) {
        bombIndex = (bombIndex - 1 + MISSION_1_BOMBS.length) % MISSION_1_BOMBS.length;
      } else if (bombNextRect && inRect(bombNextRect, p.x, p.y)) {
        bombIndex = (bombIndex + 1) % MISSION_1_BOMBS.length;
      } else if (bombEquipRect && inRect(bombEquipRect, p.x, p.y)) {
        bombChosen = MISSION_1_BOMBS[bombIndex];
      }
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    const p = canvasFromClient(e.clientX, e.clientY);
    let hovering = false;
    startButtonHover = acceptButtonHover = selectPrevHover = selectNextHover = selectChooseHover = false;
    bombPrevHover = bombNextHover = bombEquipHover = false;
    if (scene === 'intro') {
      startButtonHover = !!(startButtonRect && inRect(startButtonRect, p.x, p.y));
      hovering = startButtonHover;
    } else if (scene === 'briefing') {
      acceptButtonHover = !!(acceptButtonRect && inRect(acceptButtonRect, p.x, p.y));
      hovering = acceptButtonHover;
    } else if (scene === 'select') {
      selectPrevHover   = !!(selectPrevRect   && inRect(selectPrevRect,   p.x, p.y));
      selectNextHover   = !!(selectNextRect   && inRect(selectNextRect,   p.x, p.y));
      selectChooseHover = !!(selectChooseRect && inRect(selectChooseRect, p.x, p.y));
      hovering = selectPrevHover || selectNextHover || selectChooseHover;
    } else if (scene === 'bombs') {
      bombPrevHover  = !!(bombPrevRect  && inRect(bombPrevRect,  p.x, p.y));
      bombNextHover  = !!(bombNextRect  && inRect(bombNextRect,  p.x, p.y));
      bombEquipHover = !!(bombEquipRect && inRect(bombEquipRect, p.x, p.y));
      hovering = bombPrevHover || bombNextHover || bombEquipHover;
    }
    canvas.style.cursor = hovering ? 'pointer' : '';
  });

  // ---------- COMBAT ----------
  const bullets   = [];   // { x, y, vx, vy, owner: 'player'|'enemy', life }
  const bombs     = [];   // { x, y, vx, vy }     — gravity-pulled black dots
  const particles = [];
  let lastShotAt = 0;
  let lastBombAt = 0;
  const BOMB_COOLDOWN = 450;        // ms between bomb drops
  const BOMB_GRAVITY  = 0.0009;     // px / ms²
  const BOMB_RADIUS   = 6;          // visual + collision radius
  // Fire rate — unlimited bullets, throttled only by FIRE_INTERVAL. The heat
  // / overheat stamina meter was removed because it kept reading as "the gun
  // stopped firing" no matter how generously it was tuned.
  const FIRE_INTERVAL    = 100;        // 10 shots / second
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

  // Bombs fall straight down with gravity, inheriting a small forward push
  // from the hero's velocity so the drop arcs slightly in the direction of
  // flight. Visually a plain black dot for now — will be replaced with a
  // bespoke sprite.
  function dropBomb(now) {
    if (now - lastBombAt < BOMB_COOLDOWN) return;
    lastBombAt = now;
    const sp = playerSpeed();
    const mult = equippedBomb ? equippedBomb.speedMult : 1;
    bombs.push({
      x: player.x,
      y: player.y + 14,
      vx: Math.cos(player.heading) * sp * 0.6 * mult,
      vy: Math.sin(player.heading) * sp * 0.6 * mult + 0.05,
      type: equippedBomb,
    });
  }

  // Explosions — same vocabulary as before: small spark cluster for non-lethal
  // hits, plus flash + ring + smoke for full ship deaths.
  let cameraShake = 0;
  function spawnExplosion(x, y, big) {
    sfxBoom(big);
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
    // Reference image shows a few large near-clouds (~15 % canvas height) at
    // the top of the sky and a scatter of small, faded distant clouds dotted
    // through the lower sky. Use a SKEWED depth distribution so most clouds
    // are far (small / faded), with the occasional near one to anchor the
    // composition. Math.pow(rand, 0.5) biases away from 0 → far clouds are
    // the common case.
    const depth = Math.pow(Math.random(), 0.55);                    // 0 near, 1 far; biased toward far
    const targetH  = 180 - depth * 145;                             // 180 near → 35 far
    const alpha    = 0.95 - depth * 0.55;                           // 0.95 near → 0.40 far
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
  // Scene state — 'intro' (mission briefing + controls), 'playing' (live
  // game loop), or the gameOver flag below (set when the hero dies / clears
  // the stage). The intro is dismissed by the first Space / Tap.
  let scene = 'splash';
  let splashStartedAt = 0;             // first-frame timestamp for the splash hold
  const SPLASH_MIN_MS = 3000;          // hold the splash for at least this long
  loadImage('./splash.jpg').then(img => { assets.splash = img; });
  let gameOver = false;
  // Game-feel ROUND 1 state ------------------------------------------------
  // Hit-pause: when set, update() short-circuits until `now >= frozenUntil`.
  // Sold by every impact: 30-50 ms for bullets, 100-150 ms for bombs / big
  // collisions. Render keeps ticking so the player sees the frozen moment.
  let frozenUntil = 0;
  function hitpause(now, ms) { frozenUntil = Math.max(frozenUntil, now + ms); }
  // Camera lead: smooth offset added to the camera target in the direction
  // the plane is heading. Lets the player see incoming threats earlier.
  let cameraLeadX = 0, cameraLeadY = 0;
  const CAMERA_LEAD_X = 160;             // ~12.5% of W
  const CAMERA_LEAD_Y = 70;
  const CAMERA_LEAD_SMOOTH = 0.07;       // exponential ease per frame
  // Lives system — player starts with this many (incl. the one currently in
  // the air). Each death consumes one and respawns; game over fires only when
  // all lives are gone.
  const STARTING_LIVES = 4;
  let livesRemaining = STARTING_LIVES;
  let win = false;
  function targetsRemaining() {
    // Apartments are background scenery — only planes, tanks, and trucks
    // count toward stage completion.
    let n = 0;
    for (const e of enemies) if (e.alive) n++;
    for (const t of tanks)   if (t.alive) n++;
    for (const k of trucks)  if (k.alive) n++;
    for (const mb of militaryBuildings) if (mb.alive) n++;
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
    if (landscapeLocked) return;
    // Splash — held for at least SPLASH_MIN_MS, after which any input
    // (or simply the timer expiring) advances to the intro.
    if (scene === 'splash') {
      if (!splashStartedAt) splashStartedAt = now;
      const elapsed = now - splashStartedAt;
      if (elapsed >= SPLASH_MIN_MS) {
        scene = 'intro';
        advanceRequested = false;       // don't let a hold-over Space jump straight past intro
        bombRequest = false;
      }
      return;
    }
    // Intro screen — wait for the first Space, B, or Tap. Then start the
    // game-audio voices and hand control over to the normal loop.
    if (scene === 'intro') {
      if (advanceRequested) {
        scene = 'briefing';
        advanceRequested = false;
        bombRequest = false;
      }
      return;
    }
    if (scene === 'briefing') {
      if (advanceRequested) {
        scene = 'select';
        advanceRequested = false;
      }
      return;
    }
    if (scene === 'select') {
      if (aircraftChosen) {
        // Wire the chosen sprite + kind into the live game, then advance to
        // bomb-select.  Audio waits until after bombs are equipped.
        if (aircraftChosen.image) assets.player = aircraftChosen.image;
        player.kind = aircraftChosen.kind;
        player.heading = 0;
        player.throttle = 0;
        player.facing = 1;
        scene = 'bombs';
        aircraftChosen = null;
      }
      return;
    }
    if (scene === 'bombs') {
      if (bombChosen) {
        equippedBomb = bombChosen;
        scene = 'playing';
        bombChosen = null;
        startGameAudio();
      }
      return;
    }
    if (gameOver) return;
    if (paused) return;       // freeze all gameplay updates while paused
    if (now < frozenUntil) return;   // hit-pause: brief freeze on impact moments

    if (player.kind === 'chopper') {
      // ----- Chopper flight -----
      player.heading = 0;
      player.throttle = 0;
      let vx = 0, vy = 0;
      if (MODE === 'mobile' && touchTarget) {
        // Mobile: chase the finger's position in world coords.
        const wx = touchTarget.x + cameraX;
        const wy = touchTarget.y + cameraY;
        vx = wx - player.x;
        vy = wy - player.y;
      } else {
        // Desktop: ← / → translate horizontally; ↑ / ↓ vertical.
        if (keys.ArrowRight) vx += 1;
        if (keys.ArrowLeft)  vx -= 1;
        if (keys.ArrowUp)    vy -= 1;
        if (keys.ArrowDown)  vy += 1;
      }
      if (vx > 0) player.facing = 1;
      else if (vx < 0) player.facing = -1;
      const mag = Math.hypot(vx, vy);
      if (mag > 4) {
        const inv = 1 / mag;
        const sp = CHOPPER_SPEED * player.speedMult * MOBILE_SPEED_BOOST;
        player.x += vx * inv * sp * dt;
        player.y += vy * inv * sp * dt;
      }
      // Hard clamp inside the stage (no ricochet — choppers just stop).
      if (player.x < 30)             player.x = 30;
      if (player.x > STAGE_W - 30)   player.x = STAGE_W - 30;
      if (player.y < FLIGHT_Y_MIN)   player.y = FLIGHT_Y_MIN;
      if (player.y > FLIGHT_Y_MAX)   player.y = FLIGHT_Y_MAX;
    } else {
      // ----- Plane flight -----
      if (MODE === 'mobile' && touchTarget) {
        // Mobile: nose drifts toward the finger at a gentle rate (instead of
        // snapping), so bullets keep flying forward of the plane's current
        // heading rather than instantly diverting to the new touch point.
        // Throttle pegs to full while a finger is down.
        const wx = touchTarget.x + cameraX;
        const wy = touchTarget.y + cameraY;
        const desired = Math.atan2(wy - player.y, wx - player.x);
        const diff = normalizeAngle(desired - player.heading);
        const maxTurn = MOBILE_TURN_RATE * (dt / 1000);
        player.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
        player.throttle = 1;
      } else {
        // Desktop: ↑ / ↓ steer ; ← / → adjust throttle.
        if (keys.ArrowUp)    player.heading -= TURN_RATE * (dt / 1000);
        if (keys.ArrowDown)  player.heading += TURN_RATE * (dt / 1000);
        if (keys.ArrowRight) player.throttle = Math.min(1, player.throttle + THROTTLE_RATE * dt / 1000);
        if (keys.ArrowLeft)  player.throttle = Math.max(0, player.throttle - THROTTLE_RATE * dt / 1000);
      }
      player.heading = normalizeAngle(player.heading);

      const sp = playerSpeed();
      player.x += Math.cos(player.heading) * sp * dt;
      player.y += Math.sin(player.heading) * sp * dt;

      // Stage-edge reflection — bounce instead of stalling against the wall.
      if (player.x < 30) {
        player.x = 30;
        player.heading = normalizeAngle(Math.PI - player.heading);
      } else if (player.x > STAGE_W - 30) {
        player.x = STAGE_W - 30;
        player.heading = normalizeAngle(Math.PI - player.heading);
      }
      if (player.y < FLIGHT_Y_MIN) {
        player.y = FLIGHT_Y_MIN;
        player.heading = normalizeAngle(-player.heading);
      } else if (player.y > FLIGHT_Y_MAX) {
        player.y = FLIGHT_Y_MAX;
        player.heading = normalizeAngle(-player.heading);
      }
    }

    updateCamera();
    updateClouds(now, dt);
    updateEngine();
    updateVehicleAmbient();

    // ----- Bonus pickups -----
    // Each pickup hovers in place with a subtle vertical bob. Player overlap
    // (pickup radius) consumes the pickup and applies its effect.
    for (const bo of bonuses) {
      if (!bo.alive) continue;
      bo.bobPhase += dt * 0.003;
      const yBob = Math.sin(bo.bobPhase) * 4;
      const dx = player.x - bo.x;
      const dy = player.y - (bo.y + yBob);
      if (dx * dx + dy * dy <= BONUS_PICKUP_R * BONUS_PICKUP_R) {
        bo.alive = false;
        if (bo.kind === 'medical') {
          player.hp = Math.min(player.maxHp, player.hp + BONUS_HP_GAIN);
        } else if (bo.kind === 'gasoline') {
          player.speedMult += BONUS_SPEED_GAIN;
        }
        // Little spark cluster for feedback.
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = 0.4 + Math.random() * 0.6;
          particles.push({
            kind: 'spark', x: bo.x, y: bo.y + yBob,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life0: 500, life: 500, r0: 2 + Math.random() * 2,
            color: bo.kind === 'medical' ? '#FFFFFF' : '#FFD23F',
          });
        }
      }
    }

    // ----- Fire (Space) -----
    if (keys[' '] && (now - lastShotAt) >= FIRE_INTERVAL) {
      spawnPlayerBullet();
      sfxGun(now);
      lastShotAt = now;
      // Recoil — push the plane back against the firing direction by a couple
      // of pixels and give the camera a tiny flinch. Sells the gun's weight.
      player.x -= Math.cos(player.heading) * 2.4;
      player.y -= Math.sin(player.heading) * 2.4;
      cameraShake = Math.max(cameraShake, 1.6);
    }

    // ----- Bomb (B key on desktop / double-tap on mobile) -----
    if (bombRequest) {
      dropBomb(now);
      bombRequest = false;
    }

    // ----- Bombs (gravity + ground/vehicle collision) -----
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.vy += BOMB_GRAVITY * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Tank hit?
      let hit = false;
      for (const t of tanks) {
        if (!t.alive) continue;
        const top = ROAD_BOTTOM_Y - t.h;
        if (b.x >= t.x - t.w / 2 && b.x <= t.x + t.w / 2 && b.y >= top) {
          t.alive = false;
          spawnExplosion(b.x, top + t.h * 0.4, true);
          hitpause(now, 120);
          hit = true; break;
        }
      }
      // Truck hit?
      if (!hit) {
        for (const k of trucks) {
          if (!k.alive) continue;
          const top = ROAD_BOTTOM_Y - k.h;
          if (b.x >= k.x - k.w / 2 && b.x <= k.x + k.w / 2 && b.y >= top) {
            k.alive = false;
            spawnExplosion(b.x, top + k.h * 0.4, true);
            hitpause(now, 120);
            hit = true; break;
          }
        }
      }
      // Ground target hit?  Buildings die in one bomb (their reinforced
      // walls were already chipped by bullet hits).  Ships absorb several
      // bombs before sinking — each hit chips `bomb.type.damage` HP.
      // Bombs with `blast > 0` also damage other ground targets within
      // that radius (one extra HP each, ignores armour).
      if (!hit) {
        const dmg = (b.type && b.type.damage) || 1;
        const blast = (b.type && b.type.blast) || 0;
        for (const mb of militaryBuildings) {
          if (!mb.alive) continue;
          const top = mb.groundY - mb.h;
          if (b.x >= mb.x - mb.w / 2 && b.x <= mb.x + mb.w / 2 && b.y >= top) {
            if (mb.kind === 'ship') {
              mb.hp -= dmg;
              mb.flashUntil = now + 60;
              if (mb.hp <= 0) {
                mb.alive = false;
                spawnExplosion(b.x, top + mb.h * 0.4, true);
                hitpause(now, 120);
              } else {
                spawnExplosion(b.x, b.y, true);
                hitpause(now, 70);
              }
            } else {
              mb.alive = false;
              spawnExplosion(b.x, top + mb.h * 0.3, true);
              hitpause(now, 120);
            }
            // Blast splash: clip other ground targets within the radius.
            if (blast > 0) {
              for (const other of militaryBuildings) {
                if (other === mb || !other.alive) continue;
                const ox = other.x, oy = other.groundY - other.h / 2;
                if (Math.hypot(ox - b.x, oy - b.y) <= blast) {
                  if (other.kind === 'ship') {
                    other.hp -= 1;
                    if (other.hp <= 0) { other.alive = false; spawnExplosion(other.x, oy, true); }
                  } else {
                    other.alive = false; spawnExplosion(other.x, oy, true);
                  }
                }
              }
            }
            hit = true; break;
          }
        }
      }
      // Ground impact (street top) — small explosion, no target.
      if (!hit && b.y >= ROAD_BOTTOM_Y) {
        spawnExplosion(b.x, ROAD_BOTTOM_Y - 4, false);
        hit = true;
      }
      // Out of world?
      if (!hit && (b.x < -50 || b.x > STAGE_W + 50)) hit = true;
      if (hit) bombs.splice(i, 1);
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

      const enSp = ENEMY_MIN_SPEED + (ENEMY_MAX_SPEED - ENEMY_MIN_SPEED) * en.throttle;
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

      // Telegraph the shot: when aim + range are both satisfied and the
      // cooldown has elapsed, start a 250 ms windup. The muzzle pulse is
      // rendered during this window and the actual bullet leaves the barrel
      // only after the windup expires.
      const tankReady = Math.abs(diff) < TANK_ALIGN_RAD &&
                        Math.abs(player.x - pivotX) < TANK_FIRE_RANGE_X &&
                        now >= t.fireAt;
      if (tankReady && !t.windupUntil) {
        t.windupUntil = now + 250;
      }
      if (t.windupUntil && now >= t.windupUntil) {
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
        t.windupUntil = 0;
      }
    }

    // ----- Military buildings (alive: track + fire ; burnt: emit smoke + embers) -----
    // Building cannons have a hard circular firing radius — beyond it they
    // still track but don't shoot.  Keeps the player safe at altitude /
    // distance and gives each gun tower a defined threat bubble.
    const MIL_TURRET_TURN_RATE = 1.1;       // rad / sec — slower than tanks (taller mount)
    const MIL_FIRE_RADIUS = 640;            // px — distance from pivot at which the gun can fire
    const MIL_FIRE_RADIUS_SQ = MIL_FIRE_RADIUS * MIL_FIRE_RADIUS;
    const MIL_ALIGN_RAD = 0.10;
    for (const mb of militaryBuildings) {
      const pivotX = mb.x;                                                // turret centred on body
      const pivotY = mb.groundY - mb.h + MILITARY_TURRET_SPEC.bodyPivotFracY * mb.h;
      if (mb.alive) {
        const desired = Math.atan2(player.y - pivotY, player.x - pivotX);
        const diff = normalizeAngle(desired - mb.turretAngle);
        const maxTurn = MIL_TURRET_TURN_RATE * (dt / 1000);
        mb.turretAngle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        const dxToPlayer = player.x - pivotX;
        const dyToPlayer = player.y - pivotY;
        const distSqToPlayer = dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer;
        const milReady = Math.abs(diff) < MIL_ALIGN_RAD &&
                         distSqToPlayer < MIL_FIRE_RADIUS_SQ &&
                         now >= mb.fireAt;
        if (milReady && !mb.windupUntil) {
          mb.windupUntil = now + 250;
        }
        if (mb.windupUntil && now >= mb.windupUntil) {
          const barrelLen = MILITARY_TURRET_H * 0.65;
          const mx = pivotX + Math.cos(mb.turretAngle) * barrelLen;
          const my = pivotY + Math.sin(mb.turretAngle) * barrelLen;
          bullets.push({
            x: mx, y: my,
            vx: Math.cos(mb.turretAngle) * BULLET_SPEED * 0.85,
            vy: Math.sin(mb.turretAngle) * BULLET_SPEED * 0.85,
            owner: 'enemy',
            life: BULLET_LIFE_MS,
          });
          mb.fireAt = now + 1700 + Math.random() * 1100;
          mb.windupUntil = 0;
        }
      } else {
        // Burnt — continuous smoke from the roof + occasional bright embers.
        if (now - mb.lastSmokeAt > 140) {
          mb.lastSmokeAt = now;
          const px = mb.x + (Math.random() - 0.5) * mb.w * 0.5;
          const py = mb.groundY - mb.h + 6 + Math.random() * 10;
          particles.push({
            kind: 'smoke', x: px, y: py,
            vx: (Math.random() - 0.5) * 0.35,
            vy: -0.35 - Math.random() * 0.35,
            life0: 1800 + Math.random() * 800,
            life:  1800 + Math.random() * 800,
            r0: 6 + Math.random() * 7,
            color: 'rgba(50, 45, 42, 0.55)',
          });
          // Roughly 1-in-3 puffs also spawns a bright ember spark.
          if (Math.random() < 0.35) {
            particles.push({
              kind: 'spark', x: px, y: py,
              vx: (Math.random() - 0.5) * 0.8,
              vy: -0.5 - Math.random() * 0.6,
              life0: 600 + Math.random() * 400,
              life:  600 + Math.random() * 400,
              r0: 1.2 + Math.random() * 1.6,
              color: Math.random() < 0.5 ? '#FFB347' : '#FF6B2C',
            });
          }
        }
      }
    }

    // ----- Trucks (drive along the street, no shooting) -----
    // Each truck holds its initial heading and never U-turns mid-road. When
    // it reaches a stage edge it wraps around to the opposite side, still
    // moving in the same direction — so the player only ever sees a truck
    // travelling forward.
    for (const k of trucks) {
      if (!k.alive) continue;
      if (k.parked) continue;        // parked trucks don't drive or turn
      k.x += k.vx * dt;
      // Wrap on the side the truck is heading off, so it re-enters from the
      // opposite edge and keeps driving in the same direction.
      if (k.vx > 0 && k.x > STAGE_W + k.w) k.x = -k.w;
      else if (k.vx < 0 && k.x < -k.w)     k.x = STAGE_W + k.w;
    }

    // ----- Bullets -----
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      // Despawn against the full STAGE bounds, not the canvas. The stage
      // extends up to STAGE_TOP_Y = −2160 (3 screens above the canvas),
      // so the old `b.y < -50` check was killing any bullet fired above
      // the apartment line — i.e. almost every bullet the hero ever fires.
      if (b.life <= 0
          || b.x < -50 || b.x > STAGE_W + 50
          || b.y < STAGE_TOP_Y - 50 || b.y > STAGE_BOTTOM_Y + 50) {
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
          en.flashUntil = now + 60;                  // white pop on the sprite
          sfxHit(now);
          if (en.hp <= 0) {
            en.alive = false; spawnExplosion(en.x, en.y, true);
            hitpause(now, 90);
          } else {
            spawnExplosion(b.x, b.y, false);
            hitpause(now, 35);
          }
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
          t.flashUntil = now + 60;
          sfxHit(now);
          if (t.hp <= 0) {
            t.alive = false; spawnExplosion(b.x, top + t.h * 0.4, true);
            hitpause(now, 80);
          } else {
            spawnExplosion(b.x, b.y, false);
            hitpause(now, 25);
          }
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
          k.flashUntil = now + 60;
          sfxHit(now);
          if (k.hp <= 0) {
            k.alive = false; spawnExplosion(b.x, top + k.h * 0.4, true);
            hitpause(now, 80);
          } else {
            spawnExplosion(b.x, b.y, false);
            hitpause(now, 25);
          }
          consumed = true;
          break;
        }
      }
      if (consumed) { bullets.splice(i, 1); continue; }

      // Military buildings — only the ALIVE ones take damage. Burnt ones
      // are just smouldering scenery; bullets pass through them.
      for (let j = militaryBuildings.length - 1; j >= 0; j--) {
        const mb = militaryBuildings[j];
        if (!mb.alive) continue;
        const top = mb.groundY - mb.h;
        if (b.x >= mb.x - mb.w / 2 && b.x <= mb.x + mb.w / 2 && b.y >= top && b.y <= mb.groundY) {
          mb.hp -= 1;
          mb.flashUntil = now + 60;
          sfxHit(now);
          if (mb.hp <= 0) {
            mb.alive = false;
            spawnExplosion(b.x, top + mb.h * 0.3, true);
            hitpause(now, 80);
          } else {
            spawnExplosion(b.x, b.y, false);
            hitpause(now, 25);
          }
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
          hitpause(now, 60);
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
          hitpause(now, 150);
        }
      }
    }
    if (player.hp <= 0) {
      spawnExplosion(player.x, player.y, true);
      livesRemaining -= 1;
      if (livesRemaining <= 0) {
        gameOver = true; win = false;
      } else {
        // Respawn — full HP, brief invuln, back to a safe start position.
        player.hp = player.maxHp;
        player.invulnUntil = now + 1500;
        player.x = 220;
        player.y = H * 0.52;
        player.heading = 0;
        player.throttle = 0;
        player.facing = 1;
      }
    }

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
    if (IS_NIGHT) { drawNightSky(); return; }
    if (!assets.sky) return;
    ctx.drawImage(assets.sky, 0, 0, W, H);
  }

  // Procedurally-generated starscape. A single deterministic tile of white
  // dots is rasterised into an offscreen canvas once, then tiled across the
  // viewport with parallax. White-on-transparent — no dark halo.
  let starTileFar = null;
  let starTileClose = null;
  function buildStarTile(seed0, count, maxR) {
    const tileW = 1280;
    const tileH = H;
    const c = document.createElement('canvas');
    c.width = tileW;
    c.height = tileH;
    const g = c.getContext('2d');
    g.fillStyle = '#FFFFFF';
    // Tiny LCG for deterministic placement (no Math.random — same tile
    // every time so we don't get re-shuffles on resize).
    let s = seed0 | 0;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < count; i++) {
      const x = rand() * tileW;
      const y = rand() * tileH;
      const r = 0.3 + rand() * maxR;
      const a = 0.35 + rand() * 0.6;
      g.globalAlpha = a;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    return c;
  }
  function drawNightSky() {
    if (assets.skyNight) {
      ctx.drawImage(assets.skyNight, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#0b0f24';
      ctx.fillRect(0, 0, W, H);
    }
    if (!starTileFar) {
      // +20% density on both layers (was 220 / 90).
      starTileFar   = buildStarTile(0x5eed1a7,  264, 0.7);   // smaller / dimmer
      starTileClose = buildStarTile(0xc0ffee23, 108, 1.4);   // fewer / brighter
    }
    // Stars sit "at infinity" — no parallax, screen-locked to the viewport so
    // flight reads as motion through air, not through the star field.
    function tileLayer(tile) {
      const tw = tile.width;
      for (let x = 0; x < W; x += tw) {
        ctx.drawImage(tile, x, 0);
      }
    }
    tileLayer(starTileFar);
    tileLayer(starTileClose);
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

  // Procedural road specks — a deterministic pool of small dots that repeat
  // every ROAD_SPECK_TILE world-pixels. The base street texture is rendered
  // STATIC (no tiling, so no seams), and the motion illusion comes from the
  // specks scrolling left at world speed.
  const ROAD_SPECK_TILE = 480;
  const ROAD_SPECKS = (() => {
    // Cheap LCG so the pattern is deterministic between sessions.
    let seed = 0xA1B2C3;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF; };
    const arr = [];
    for (let i = 0; i < 18; i++) {
      arr.push({
        x: rnd() * ROAD_SPECK_TILE,
        yOff: 8 + rnd() * (STREET_H - 16),
        r: 0.6 + rnd() * 1.1,
        alpha: 0.18 + rnd() * 0.22,
        warm: rnd() < 0.4,                    // mix of pale + warm specks
      });
    }
    return arr;
  })();

  function drawStreet() {
    // Ocean stages substitute the road for a water surface. Same anchor pattern
    // (parallax-scrolled with the camera), no motion specks.
    if (IS_OCEAN) { drawWater(); return; }
    // Street is anchored at STREET_TOP_Y. With the camera following the hero
    // vertically, the street drops out of view when the hero climbs into the
    // upper sky band — the ground reads as a real floor that you fly above.
    const streetScreenY = worldToScreenY(STREET_TOP_Y);
    if (streetScreenY > H) return;
    if (!assets.street) {
      ctx.fillStyle = '#252028';
      ctx.fillRect(0, streetScreenY, W, STREET_H);
    } else {
      // PIN one render that fills the canvas width exactly (no tiling = no
      // seam line). The source PNG (8192 × 485) is wider than the canvas at
      // STREET_H = 72, so the small horizontal stretch (~5 %) is invisible.
      ctx.drawImage(assets.street, 0, streetScreenY, W, STREET_H);
    }
    // Motion specks — scroll at world speed (parallax 1.0) so the road reads
    // as moving with the buildings without re-tiling the texture itself.
    const startTile = Math.floor(cameraX / ROAD_SPECK_TILE) - 1;
    const endTile   = Math.floor((cameraX + W) / ROAD_SPECK_TILE) + 1;
    for (let t = startTile; t <= endTile; t++) {
      const tileX0 = t * ROAD_SPECK_TILE;
      for (const s of ROAD_SPECKS) {
        const sx = (tileX0 + s.x) - cameraX;
        if (sx < -4 || sx > W + 4) continue;
        ctx.save();
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = s.warm ? '#bba07c' : '#dadada';
        ctx.beginPath();
        ctx.arc(sx, streetScreenY + s.yOff, s.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Open-water surface for the ocean world. Spans from the waterline down
  // to the bottom of the canvas, full width, scrolling with the camera so
  // ships rest on a moving surface rather than a static panel.
  function drawWater() {
    const waterTopScreenY = worldToScreenY(OCEAN_WATERLINE_Y);
    if (waterTopScreenY > H) return;
    const waterH = H - waterTopScreenY;
    if (assets.water) {
      const img = assets.water;
      const renderH = waterH + 4;       // tiny overdraw so antialiasing doesn't leave a seam
      const renderW = renderH * (img.width / img.height);
      // Tile horizontally with a horizontal parallax of 1.0 (same as ground).
      const offset = -((cameraX * 1.0) % renderW);
      const startX = offset > 0 ? offset - renderW : offset;
      for (let x = startX; x < W; x += renderW) {
        ctx.drawImage(img, x, waterTopScreenY, renderW, renderH);
      }
    } else {
      // Fallback solid teal while the texture loads.
      ctx.fillStyle = '#1f8a8c';
      ctx.fillRect(0, waterTopScreenY, W, waterH);
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

  // Military buildings render in two passes like tanks: turret (behind) +
  // body (in front), so only the barrel sticks above the building. When
  // burnt, swap to the burnt body sprite and skip the turret entirely
  // (smoke + embers come from the update loop's particle emission).
  function drawMilitaryTurrets() {
    // Either turret sprite is enough — city stages won't have ship turrets
    // loaded and vice versa.
    if (!assets.militaryTurret && !assets.shipTurret) return;
    for (const mb of militaryBuildings) {
      if (!mb.alive) continue;
      const sx = worldToScreenX(mb.x);
      if (sx + mb.w / 2 < -40 || sx - mb.w / 2 > W + 40) continue;
      const bodyTop = worldToScreenY(mb.groundY - mb.h);
      if (bodyTop > H + 40) continue;
      const spec = MILITARY_TURRET_SPEC;
      const pivotSX = sx + (spec.bodyPivotFracX - 0.5) * mb.w;
      const pivotSY = bodyTop + spec.bodyPivotFracY * mb.h;
      // Ocean ships use a different turret sprite, sized larger so the deck
      // gun reads as a deck gun rather than a rooftop SAM.
      const img = (mb.kind === 'ship' && assets.shipTurret) ? assets.shipTurret : assets.militaryTurret;
      const trH = (mb.kind === 'ship') ? SHIP_TURRET_H : MILITARY_TURRET_H;
      const trW = trH * (img.width / img.height);
      ctx.save();
      ctx.translate(pivotSX, pivotSY);
      ctx.rotate(mb.turretAngle + spec.barrelAngleOffset);
      const offX = -spec.turretPivotFracX * trW;
      const offY = -spec.turretPivotFracY * trH;
      ctx.drawImage(img, offX, offY, trW, trH);
      // Telegraph windup — yellow muzzle pulse, growing as the shot approaches.
      if (mb.windupUntil && mb.windupUntil > lastFrameNow) {
        const remaining = (mb.windupUntil - lastFrameNow) / 250;
        const pulse = 0.55 + 0.45 * Math.sin(lastFrameNow * 0.06);
        ctx.globalAlpha = (1 - remaining) * 0.85;
        ctx.fillStyle = '#FFD23F';
        ctx.beginPath();
        ctx.arc(0, -spec.turretPivotFracY * trH + trH * 0.15, 4 + 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }
  function drawMilitaryBodies() {
    for (const mb of militaryBuildings) {
      const sx = worldToScreenX(mb.x);
      if (sx + mb.w / 2 < -40 || sx - mb.w / 2 > W + 40) continue;
      const top = worldToScreenY(mb.groundY - mb.h);
      if (top > H + 40) continue;
      // Ships skip the destroyed render — they sink and disappear. Buildings
      // swap to a burnt sprite so the silhouette persists.
      const img = mb.alive ? mb.bodyImg : mb.burntImg;
      if (!img) continue;
      ctx.drawImage(img, sx - mb.w / 2, top, mb.w, mb.h);
      if (mb.flashUntil && mb.flashUntil > lastFrameNow) {
        drawHitFlash(img, sx - mb.w / 2, top, mb.w, mb.h, (mb.flashUntil - lastFrameNow) / 60);
      }
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

  // Spinning-spoke overlay drawn on top of each wheel position. The truck
  // PNGs all have a left wheel ~22 % from the cab side and a right wheel
  // ~78 %, with the hub roughly 78 % of the body height down — those are
  // the values we use to place the overlay. Two short white tick marks
  // rotate at a rate proportional to the truck's velocity, reading as
  // motion blur on a turning hub. Drawn in plane-LOCAL coords so the
  // sprite-mirror flip above also flips the spokes correctly.
  function drawWheelSpin(k, now) {
    if (k.vx === 0) return;
    const speed = Math.abs(k.vx);
    // Rotation rate: 1 px/ms gives ~3 full turns / second.
    const angle = (now * speed * 0.018 * Math.sign(k.vx)) % (Math.PI * 2);
    const r = k.h * 0.13;
    const wheelOffsetsX = [-k.w * 0.28, k.w * 0.28];
    const wheelY = k.h * 0.32;
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 245, 245, 0.55)';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    for (const wx of wheelOffsetsX) {
      ctx.save();
      ctx.translate(wx, wheelY);
      ctx.rotate(angle);
      // Two perpendicular spokes — quick wagon-wheel read.
      ctx.beginPath();
      ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
      ctx.moveTo(0, -r); ctx.lineTo(0, r);
      ctx.stroke();
      ctx.restore();
    }
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
      // Source PNGs face RIGHT; mirror when driving left so the cab leads.
      if (k.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(k.img, -k.w / 2, -k.h / 2, k.w, k.h);
      if (k.flashUntil && k.flashUntil > lastFrameNow) {
        drawHitFlash(k.img, -k.w / 2, -k.h / 2, k.w, k.h, (k.flashUntil - lastFrameNow) / 60);
      }
      drawWheelSpin(k, lastFrameNow);
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
      // Telegraph: pulsing yellow muzzle flicker while the windup is active.
      if (t.windupUntil && t.windupUntil > lastFrameNow) {
        const remaining = (t.windupUntil - lastFrameNow) / 250;     // 1 → 0
        const pulse = 0.55 + 0.45 * Math.sin(lastFrameNow * 0.06);
        ctx.globalAlpha = (1 - remaining) * 0.85;                    // fade-IN as fire approaches
        ctx.fillStyle = '#FFD23F';
        ctx.beginPath();
        ctx.arc(0, -spec.turretPivotFracY * trH + trH * 0.2, 4 + 3 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
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
      if (t.flashUntil && t.flashUntil > lastFrameNow) {
        drawHitFlash(t.bodyImg, sx - t.w / 2, top, t.w, t.h, (t.flashUntil - lastFrameNow) / 60);
      }
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

  // Rotor — long horizontal blur disc above the chopper, same alpha flicker
  // as the propeller so the visual language matches.
  function drawRotor(now, rotorCX, rotorCY, width) {
    const flicker = 0.55 + 0.25 * Math.sin(now * 0.09);
    const discW = width * 0.95;
    const discH = width * 0.025;
    ctx.save();
    ctx.translate(rotorCX, rotorCY);
    ctx.globalAlpha = flicker;
    ctx.fillStyle = 'rgba(220, 220, 220, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, discW / 2, discH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Hit-flash overlay: redraw the sprite as a pure-white silhouette over the
  // existing draw, fading from full to zero over the flash window. Uses
  // ctx.filter to recolour the sprite without touching the surrounding sky.
  function drawHitFlash(img, x, y, w, h, alpha) {
    if (!alpha || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.filter = 'brightness(0) invert(1)';
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  // Draw a plane or chopper in world coords. Planes rotate with heading and
  // get a nose propeller; choppers stay upright and get a horizontal rotor,
  // optionally mirrored to face their direction of travel.
  function drawAircraft(img, worldX, worldY, heading, targetH, kind, facing, flashAlpha) {
    const sx = worldToScreenX(worldX);
    const sy = worldToScreenY(worldY);
    if (sx < -120 || sx > W + 120 || sy < -120 || sy > H + 120) return;
    const aspect = img.width / img.height;
    const targetW = targetH * aspect;
    ctx.save();
    ctx.translate(sx, sy);
    if (kind === 'chopper') {
      if (facing === -1) ctx.scale(-1, 1);
      ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
      drawHitFlash(img, -targetW / 2, -targetH / 2, targetW, targetH, flashAlpha);
      drawRotor(lastFrameNow, 0, -targetH * 0.36, targetW);
    } else {
      if (Math.cos(heading) < 0) {
        ctx.scale(-1, 1);
        ctx.rotate(heading - Math.PI);
      } else {
        ctx.rotate(heading);
      }
      ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
      drawHitFlash(img, -targetW / 2, -targetH / 2, targetW, targetH, flashAlpha);
      drawPropeller(lastFrameNow, targetW / 2 - 4, 0, targetH);
    }
    ctx.restore();
  }

  function drawBonuses(now) {
    for (const bo of bonuses) {
      if (!bo.alive) continue;
      const img = bo.kind === 'medical' ? assets.medicalKit : assets.gasoline;
      if (!img) continue;
      const aspect = img.width / img.height;
      const targetH = BONUS_H;
      const targetW = targetH * aspect;
      const yBob = Math.sin(bo.bobPhase) * 4;
      const sx = worldToScreenX(bo.x);
      const sy = worldToScreenY(bo.y + yBob);
      if (sx < -targetW || sx > W + targetW || sy < -targetH || sy > H + targetH) continue;
      ctx.drawImage(img, sx - targetW / 2, sy - targetH / 2, targetW, targetH);
    }
  }

  function drawPlayer(now) {
    if (!assets.player) return;
    // Brief flicker while invulnerable.
    if (now <= player.invulnUntil && Math.floor(now / 60) % 2 === 0) return;
    drawAircraft(assets.player, player.x, player.y, player.heading, 72, player.kind, player.facing);
  }

  function drawEnemies() {
    for (const en of enemies) {
      if (!en.alive || !en.img) continue;
      const flash = (en.flashUntil && en.flashUntil > lastFrameNow)
        ? (en.flashUntil - lastFrameNow) / 60
        : 0;
      drawAircraft(en.img, en.x, en.y, en.heading, 54, undefined, undefined, flash);
    }
  }

  function drawBullets() {
    // Glowing circles — omnidirectional, so they read correctly regardless
    // of the hero's heading (the old horizontal-rect tracers looked wrong
    // when fired from a banking or inverted plane).
    for (const b of bullets) {
      const sx = worldToScreenX(b.x);
      const sy = worldToScreenY(b.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      ctx.save();
      if (b.owner === 'player') {
        // Halo
        ctx.shadowColor = 'rgba(255, 220, 90, 0.95)';
        ctx.shadowBlur = 12;
        ctx.fillStyle = 'rgba(255, 230, 120, 0.95)';
        ctx.beginPath(); ctx.arc(sx, sy, 3.6, 0, Math.PI * 2); ctx.fill();
        // Hot white core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.shadowColor = 'rgba(255, 80, 80, 0.95)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff8888';
        ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffd0d0';
        ctx.beginPath(); ctx.arc(sx, sy, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBombs() {
    // Use the equipped bomb's sprite — fall back to a black dot if the
    // sprite isn't loaded yet (rare; first-frame after Equip).
    for (const b of bombs) {
      const sx = worldToScreenX(b.x);
      const sy = worldToScreenY(b.y);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const img = b.type && b.type.image;
      if (img) {
        // Cap the bomb's longest visible dimension at half the plane height
        // (player sprite renders at 72 px tall → cap = 36). Bomb PNGs are
        // very wide (Lance is ~5:1) so this prevents them dwarfing the plane.
        const cap = 36;
        const aspect = img.width / img.height;
        const targetW = aspect >= 1 ? cap : cap * aspect;
        const targetH = aspect >= 1 ? cap / aspect : cap;
        // Point the bomb roughly in the direction it's flying.
        const angle = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(sx, sy, BOMB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
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

  // Cartoon heart — two semicircle bumps on top, V-point at the bottom.
  // Filled lives = solid red with a dark outline; spent lives = thin white
  // outline only.
  function drawHeart(x, y, size, filled) {
    const r = size * 0.28;
    const topY = y + r;
    ctx.beginPath();
    ctx.arc(x + r, topY, r, Math.PI, 0, false);
    ctx.arc(x + size - r, topY, r, Math.PI, 0, false);
    ctx.lineTo(x + size / 2, y + size);
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = '#FF4D5A';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(20, 26, 36, 0.75)';
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
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

    // Throttle (replaces the old HEAT bar — heat / overheat removed)
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, htY, 200, 6);
    ctx.fillStyle = '#7DD8FF';
    ctx.fillRect(x, htY, 200 * player.throttle, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('THROTTLE', x + 210, htY + 3);

    // Right-side: targets + lives chip + minimap.
    // Targets readout sits in a dark translucent pill so the text always
    // passes AA contrast regardless of what the sky / scene behind looks
    // like.
    const rxEdge = W - 24;
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    const targets = targetsRemaining();
    const tText = 'TARGETS  ' + targets;
    const tW = ctx.measureText(tText).width;
    const chipPadX = 12, chipH = 26;
    const chipW = Math.ceil(tW + chipPadX * 2);
    const chipX = rxEdge - chipW;
    const chipY = 10;
    ctx.fillStyle = 'rgba(20, 26, 36, 0.78)';
    roundRect(chipX, chipY, chipW, chipH, 13);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = targets > 0 ? '#FFFFFF' : '#A5F3C7';   // white on near-black > 16:1
    ctx.fillText(tText, chipX + chipPadX, chipY + chipH / 2 + 1);

    // Lives — a row of small hearts under the targets chip. Filled red for
    // lives remaining; outlined for lives spent.
    const heartSize = 18;
    const heartGap = 5;
    const heartsY = chipY + chipH + 8;
    for (let i = 0; i < STARTING_LIVES; i++) {
      // Right-align: index 0 sits closest to the right edge.
      const hx = rxEdge - (i + 1) * heartSize - i * heartGap;
      drawHeart(hx, heartsY, heartSize, i < livesRemaining);
    }

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

  // On STAGE CLEAR we auto-route to the next mission's briefing after a
  // brief hold. On SHOT DOWN the player has to reload (no auto-restart).
  const GAME_OVER_HOLD_MS = 2600;
  let gameOverAt = 0;                       // performance.now() at the moment gameOver flipped on
  let advanceQueued = false;

  function drawGameOverOverlay() {
    if (!gameOver) return;
    if (!gameOverAt) gameOverAt = lastFrameNow;

    // Auto-advance once the hold is up. On the last mission we loop back to
    // mission 1 so the game stays playable.
    if (win && !advanceQueued && (lastFrameNow - gameOverAt) > GAME_OVER_HOLD_MS) {
      advanceQueued = true;
      const nextMissionNumber = (MISSION_INDEX + 1) >= MISSIONS.length ? 1 : (MISSION_INDEX + 2);
      const url = window.location.pathname + '?mission=' + nextMissionNumber;
      setTimeout(() => { window.location.href = url; }, 60);
    }

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 17, 0.66)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const isLastMission = MISSION_INDEX + 1 >= MISSIONS.length;
    const headline = !win ? 'SHOT DOWN'
      : isLastMission ? 'CAMPAIGN COMPLETE' : 'MISSION COMPLETE';
    ctx.fillStyle = win ? '#5DD39E' : '#FF6B5C';
    ctx.font = '900 56px Inter, sans-serif';
    ctx.fillText(headline, W / 2, H / 2 - 18);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 18px Inter, sans-serif';
    const sub = !win ? 'Reload to fly again'
      : isLastMission ? 'Looping back to Mission 1…' : 'Next mission incoming…';
    ctx.fillText(sub, W / 2, H / 2 + 28);
    ctx.restore();
  }

  // Intro / mission briefing screen — backdrop is the live day scene (sky +
  // street + buildings) with everything else stripped out (no planes, no
  // vehicles, no clouds, no HUD). Title + mission + controls layered on top.
  // Splash screen — full-canvas hand-painted opener with the Empyrean
  // wordmark baked into the image. Held for SPLASH_MIN_MS before the
  // intro screen takes over.
  function drawSplash(now) {
    // Match the splash background fill to the page chrome so any aspect-
    // ratio gap reads as deliberate framing, not a missing image.
    ctx.fillStyle = '#0a1322';
    ctx.fillRect(0, 0, W, H);
    if (assets.splash) {
      const img = assets.splash;
      // Cover-fit the splash inside the canvas — preserve aspect, fill
      // either width or height, centre the rest.
      const canvasAspect = W / H;
      const imgAspect = img.width / img.height;
      let drawW, drawH;
      if (imgAspect > canvasAspect) {
        drawH = H;
        drawW = H * imgAspect;
      } else {
        drawW = W;
        drawH = W / imgAspect;
      }
      ctx.drawImage(img, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);
    }
  }

  function drawIntro(now) {
    // Day-scene backdrop. Each draw function early-returns if its asset hasn't
    // loaded yet, so a fallback fill covers the brief gap before they arrive.
    clearBg();
    drawSky();
    drawStreet();
    drawApartments();
    drawMilitaryBodies();


    const cx = W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ----- Controls block -----
    // Single inline row with the d-pad arrows fanning above + below the
    // left-cluster, and the whole composition centred in the SKY band of
    // the canvas (above the building skyline). Keycap outlines are medium
    // grey, instructional copy is dark grey.
    const KEY_H    = 48;                  // keycap height — sized so the d-pad fits without overlap
    const KEY_PAD  = 14;
    const KEY_STROKE = 'rgba(130, 130, 130, 0.85)';
    const LABEL_COLOR = '#1a2030';        // dark instructional copy
    function measureKey(label, font) {
      ctx.font = font;
      const m = ctx.measureText(label);
      return Math.max(KEY_H, Math.ceil(m.width) + KEY_PAD * 2);
    }
    // Custom arrow glyph — single shared path, just rotated per direction —
    // so all four arrows ALWAYS render at the exact same weight.
    function drawArrowGlyph(cx2, cy2, dir) {
      ctx.save();
      ctx.translate(cx2, cy2);
      if (dir === 'right') ctx.rotate(Math.PI / 2);
      if (dir === 'down')  ctx.rotate(Math.PI);
      if (dir === 'left')  ctx.rotate(-Math.PI / 2);
      // Default orientation = pointing UP.
      ctx.strokeStyle = '#1a2030';
      ctx.fillStyle   = '#1a2030';
      ctx.lineWidth   = 2.4;
      ctx.lineCap     = 'square';
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.lineTo(0, -3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(-7, -1);
      ctx.lineTo(7, -1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const ARROW_DIR = { '↑': 'up', '↓': 'down', '←': 'left', '→': 'right' };

    function drawKey(label, x, y, font) {
      const w = measureKey(label, font);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      roundRect(x, y - KEY_H / 2, w, KEY_H, 8);
      ctx.fill();
      ctx.strokeStyle = KEY_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 5, y - KEY_H / 2 + 2);
      ctx.lineTo(x + w - 5, y - KEY_H / 2 + 2);
      ctx.stroke();
      const arrowDir = ARROW_DIR[label];
      if (arrowDir) {
        drawArrowGlyph(x + w / 2, y, arrowDir);
      } else {
        ctx.font = font;
        ctx.fillStyle = '#1a2030';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w / 2, y + 1);
      }
      return w;
    }
    function drawText(text, x, y, font, color) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y);
      return ctx.measureText(text).width;
    }

    const keyFont  = '800 22px Inter, sans-serif';
    const textFont = '600 19px Inter, sans-serif';

    // Centre the WHOLE unit (↑ row → press-space prompt) on the vertical
    // midpoint of the sky band — the centre of empty blue between the
    // canvas top and the apartment roof-line.
    const SKY_TOP    = 20;
    const SKY_BOTTOM = STREET_TOP_Y - APARTMENT_RENDER_H - 20;
    const skyCenterY = (SKY_TOP + SKY_BOTTOM) / 2;
    // Composition is now three centred rows:
    //   midY        — top row (Steer / Adjust speed inline)
    //   midY + 80   — action row (Space / B / M)
    //   midY + 150  — press-space prompt
    // Top of composition: midY − KEY_H/2 ; bottom: midY + 150 + ~12 px text.
    // Composition now has four bands: two instruction rows, the [Start]
    // button, and the hint line below it. The card wraps all four.
    const startBtnW = 200;
    const startBtnH = 52;
    // compHeight = (row1 top) → (hint baseline)
    //            = (KEY_H/2) + 150 + (startBtnH/2) + 26 + 8
    const compHeight = (KEY_H / 2) + 150 + (startBtnH / 2) + 26 + 8;
    const midY = Math.round(skyCenterY - compHeight / 2 + KEY_H / 2);
    const startBtnCenterY = midY + 150;
    const startBtnY = Math.round(startBtnCenterY - startBtnH / 2);
    const hintCenterY = startBtnCenterY + startBtnH / 2 + 26;

    // ----- Instruction card — same surface treatment as the briefing card so
    // the two screens read as part of the same chrome family. -----
    {
      const cardW = 720;
      const cardPadTop = 32;
      const cardPadBot = 28;
      const compTop = midY - KEY_H / 2;
      const compBottom = hintCenterY + 8;
      const cardX = Math.round(cx - cardW / 2);
      const cardY = compTop - cardPadTop;
      const cardH = (compBottom - compTop) + cardPadTop + cardPadBot;

      ctx.save();
      ctx.shadowColor = 'rgba(2, 6, 17, 0.35)';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      roundRect(cardX, cardY, cardW, cardH, 14);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(20, 26, 36, 0.12)';
      roundRect(cardX, cardY, cardW, cardH, 14);
      ctx.stroke();
      ctx.restore();
    }

    // Helper: lay out a row of segments (mix of keys, text labels, gaps)
    // CENTRED horizontally on the canvas. Returns useful X anchors for
    // anything that needs to land relative to a specific key.
    function layoutCenteredRow(segments, y) {
      const widths = [];
      let totalW = 0;
      for (const s of segments) {
        let w = 0;
        if (s.kind === 'key')  w = measureKey(s.value, keyFont);
        else if (s.kind === 'text') { ctx.font = textFont; w = ctx.measureText(s.value).width; }
        else                  w = s.value;
        widths.push(w);
        totalW += w;
      }
      let xCur = Math.round(cx - totalW / 2);
      const anchors = {};
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        const w = widths[i];
        if (s.kind === 'key')  { drawKey(s.value, xCur, y, keyFont); anchors[s.value] = xCur + w / 2; }
        else if (s.kind === 'text') drawText(s.value, xCur, y + 1, textFont, LABEL_COLOR);
        xCur += w;
      }
      return anchors;
    }

    if (MODE === 'mobile') {
      // Mobile has no keys, no separate throttle. Drag = fly, hold = fire,
      // double-tap = bomb. Plain centred text reads cleaner than fake keycaps.
      ctx.font = '600 20px Inter, sans-serif';
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Tap where you want to fly', cx, midY);
      ctx.fillText('Hold to fire    Double-tap to drop a bomb', cx, midY + 60);
    } else {
      // Row 1 — single line: 'Steer using [↑] [↓]   Adjust speed with [←] [→]'
      // ↑ / ↓ steer (rotate the nose), ← / → adjust throttle.
      layoutCenteredRow([
        { kind: 'text', value: 'Steer using' },
        { kind: 'gap',  value: 14 },
        { kind: 'key',  value: '↑' },
        { kind: 'gap',  value: 10 },
        { kind: 'key',  value: '↓' },
        { kind: 'gap',  value: 42 },
        { kind: 'text', value: 'Adjust speed with' },
        { kind: 'gap',  value: 14 },
        { kind: 'key',  value: '←' },
        { kind: 'gap',  value: 10 },
        { kind: 'key',  value: '→' },
      ], midY);

      // Row 2 — actions: Space / B / M each followed by their label, centred.
      layoutCenteredRow([
        { kind: 'key',  value: 'Space' },
        { kind: 'gap',  value: 10 },
        { kind: 'text', value: 'to fire' },
        { kind: 'gap',  value: 30 },
        { kind: 'key',  value: 'B' },
        { kind: 'gap',  value: 10 },
        { kind: 'text', value: 'to drop a bomb' },
        { kind: 'gap',  value: 30 },
        { kind: 'key',  value: 'M' },
        { kind: 'gap',  value: 10 },
        { kind: 'text', value: 'mute' },
      ], midY + 80);
    }

    // ----- Start button — matches the briefing's [Accept Mission] button -----
    const startBtnX = Math.round(cx - startBtnW / 2);
    startButtonRect = { x: startBtnX, y: startBtnY, w: startBtnW, h: startBtnH };

    const startPulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    ctx.save();
    ctx.fillStyle = '#cc2200';
    roundRect(startBtnX, startBtnY, startBtnW, startBtnH, 10);
    ctx.fill();
    ctx.lineWidth = 1.5;
    const startBorderAlpha = startButtonHover ? 0.95 : 0.45 + 0.25 * startPulse;
    ctx.strokeStyle = `rgba(120, 20, 0, ${startBorderAlpha.toFixed(2)})`;
    roundRect(startBtnX, startBtnY, startBtnW, startBtnH, 10);
    ctx.stroke();
    if (startButtonHover) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      roundRect(startBtnX, startBtnY, startBtnW, startBtnH, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Start', startBtnX + startBtnW / 2, startBtnY + startBtnH / 2 + 1);
    ctx.restore();

    // ----- Hint below button — muted dark grey on white, > 4.5:1 contrast -----
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(20, 26, 36, 0.72)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const isMobileStart = MODE === 'mobile';
    ctx.fillText(isMobileStart ? 'tap the button to start' : 'press the Start button or space to start', cx, hintCenterY);

  }

  // Mission 1 briefing — same day-scene backdrop, dimmed by a vignette, with
  // the mission story stacked above an [Accept Mission] button. Story is a
  // single prose paragraph; drawBriefing word-wraps it to the column width.
  // Mission story is pulled from the active mission (see MISSIONS at top).
  const MISSION_1_STORY = CURRENT_MISSION.story;

  // Word-wrap helper for the briefing paragraph: returns an array of lines,
  // each no wider than `maxWidth` at the currently-set ctx.font.
  function wrapParagraph(text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const next = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        if (line) lines.push(line);
        line = words[i];
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBriefing(now) {
    // ----- Backdrop (same as intro, no planes / vehicles / clouds) -----
    clearBg();
    drawSky();
    drawStreet();
    drawApartments();
    drawMilitaryBodies();

    const cx = W / 2;

    // Card geometry. The whole briefing UI sits inside an opaque white card
    // so body text passes AA contrast (≥ 4.5:1) over the daylight backdrop.
    const cardPad = 40;
    const cardW = 720;
    const colW = cardW - cardPad * 2;          // text column = card interior

    // Pre-wrap the paragraph so we can size the card height to actual content.
    ctx.font = '500 20px Inter, sans-serif';
    const storyLines = wrapParagraph(MISSION_1_STORY, colW);

    const headerH = 38;
    const headerGap = 28;
    const lineH = 30;
    const storyH = storyLines.length * lineH;
    const btnGap = 28;
    const btnH = 56;
    const hintGap = 22;
    const hintH = 18;
    const contentH = headerH + headerGap + storyH + btnGap + btnH + hintGap + hintH;
    const cardH = contentH + cardPad * 2;
    const cardX = Math.round(cx - cardW / 2);
    const cardY = Math.round((H - cardH) / 2);

    // ----- Card surface — opaque white with a soft outline so text on it
    // sits in a controlled, AA-compliant context. -----
    ctx.save();
    // Subtle drop shadow under the card.
    ctx.shadowColor = 'rgba(2, 6, 17, 0.35)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();
    // Hairline border, drawn without the shadow.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 26, 36, 0.12)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.stroke();
    ctx.restore();

    // ----- Header -----
    const headerBaselineY = cardY + cardPad + headerH / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 32px Inter, sans-serif';
    ctx.fillStyle = '#0E1424';                 // contrast > 18:1 on white
    ctx.fillText('Your Mission', cx, headerBaselineY);

    // ----- Story body — single left-aligned paragraph -----
    const colX = cardX + cardPad;
    const storyTopY = cardY + cardPad + headerH + headerGap;
    ctx.font = '500 20px Inter, sans-serif';
    ctx.fillStyle = '#1a2030';                 // contrast ≈ 16:1 on white
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < storyLines.length; i++) {
      ctx.fillText(storyLines[i], colX, storyTopY + i * lineH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ----- Accept Mission button — dark surface, white label for clear CTA -----
    const btnW = 240;
    const btnX = Math.round(cx - btnW / 2);
    const btnY = storyTopY + storyH + btnGap;
    acceptButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH };

    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    ctx.save();
    // Body — hero-plane red. Solid #cc2200 keeps white label at ≈5.5:1 (AA).
    ctx.fillStyle = '#cc2200';
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.fill();
    // Border darkens hero-red slightly for the rim, and brightens on hover.
    ctx.lineWidth = 1.5;
    const borderAlpha = acceptButtonHover ? 0.95 : 0.45 + 0.25 * pulse;
    ctx.strokeStyle = `rgba(120, 20, 0, ${borderAlpha.toFixed(2)})`;
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.stroke();
    // Hover lift: a soft inner highlight on hover for affordance.
    if (acceptButtonHover) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      roundRect(btnX, btnY, btnW, btnH, 10);
      ctx.fill();
    }
    // Label — white on hero red = contrast ≈ 5.5:1 (AA).
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Accept Mission', btnX + btnW / 2, btnY + btnH / 2 + 1);
    ctx.restore();

    // ----- Hint below button — muted dark grey on white, still > 4.5:1 -----
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(20, 26, 36, 0.72)';  // contrast ≈ 9:1 on white
    const isMobile = MODE === 'mobile';
    ctx.fillText(isMobile ? 'tap the button to begin' : 'press space or click the button to begin', cx, btnY + btnH + hintGap + hintH / 2);
  }

  // Aircraft-select carousel — one aircraft per slide, navigated with the
  // arrow keys (or the on-screen ◀ / ▶ buttons / tap). Choose locks the
  // selection in and advances to playing.
  function drawSelect(now) {
    // ----- Backdrop (same as the briefing scene) -----
    clearBg();
    drawSky();
    drawStreet();
    drawApartments();
    drawMilitaryBodies();

    const cx = W / 2;
    const aircraft = MISSION_1_AIRCRAFT[aircraftIndex];

    // ----- Card geometry -----
    const cardW   = 760;
    const cardPad = 36;
    const headerH = 32;
    const headerGap = 22;
    const spriteSlotH = 132;            // height reserved for the sprite
    const nameH   = 26;
    const nameGap = 14;
    const statRowH = 26;
    const statRowGap = 10;
    const statsBlockH = statRowH * 3 + statRowGap * 2;
    const statsGap = 22;
    const dotsH   = 14;
    const dotsGap = 22;
    const btnH    = 52;
    const btnGap  = 18;
    const contentH = headerH + headerGap + spriteSlotH + nameGap + nameH + statsGap + statsBlockH + dotsGap + dotsH + btnGap + btnH;
    const cardH   = contentH + cardPad * 2;
    const cardX   = Math.round(cx - cardW / 2);
    const cardY   = Math.round((H - cardH) / 2);

    // ----- Card surface -----
    ctx.save();
    ctx.shadowColor = 'rgba(2, 6, 17, 0.35)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 26, 36, 0.12)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.stroke();
    ctx.restore();

    // ----- Header -----
    let y = cardY + cardPad + headerH / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 28px Inter, sans-serif';
    ctx.fillStyle = '#0E1424';
    ctx.fillText('Choose your aircraft', cx, y);
    y += headerH / 2 + headerGap;

    // ----- Carousel row: ◀ arrow | sprite | ▶ arrow -----
    const arrowW = 56, arrowH = 56;
    const spriteAreaTop = y;
    const arrowCenterY = spriteAreaTop + spriteSlotH / 2;
    const arrowMargin = cardPad + 8;
    const prevX = cardX + arrowMargin;
    const nextX = cardX + cardW - arrowMargin - arrowW;
    selectPrevRect = { x: prevX, y: arrowCenterY - arrowH / 2, w: arrowW, h: arrowH };
    selectNextRect = { x: nextX, y: arrowCenterY - arrowH / 2, w: arrowW, h: arrowH };

    drawCarouselArrow(selectPrevRect, 'left',  selectPrevHover);
    drawCarouselArrow(selectNextRect, 'right', selectNextHover);

    // ----- Aircraft sprite (centred between the arrows) -----
    if (aircraft.image) {
      const img = aircraft.image;
      const slotW = 240;
      const slotH = spriteSlotH;
      const scale = Math.min(slotW / img.width, slotH / img.height);
      const drawW = img.width  * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, Math.round(cx - drawW / 2), Math.round(spriteAreaTop + (slotH - drawH) / 2), drawW, drawH);
    } else {
      // Placeholder while sprite is still loading.
      ctx.fillStyle = 'rgba(20, 26, 36, 0.08)';
      roundRect(Math.round(cx - 120), spriteAreaTop + 10, 240, spriteSlotH - 20, 10);
      ctx.fill();
    }
    y = spriteAreaTop + spriteSlotH + nameGap;

    // ----- Name + kind tag -----
    ctx.font = '700 22px Inter, sans-serif';
    ctx.fillStyle = '#0E1424';
    ctx.fillText(aircraft.name, cx, y + nameH / 2);
    y += nameH + statsGap;

    // ----- Stat bars (HP / Speed / Bombs) -----
    const statsBlockX = cardX + cardPad + 80;       // indent leaves room for label
    const statsBlockW = cardW - (cardPad + 80) * 2;
    const labelW = 64;
    const valueW = 44;
    const barX = statsBlockX + labelW;
    const barW = statsBlockW - labelW - valueW - 12;
    const STATS = [
      { key: 'hp',    label: 'Health' },
      { key: 'speed', label: 'Speed'  },
      { key: 'bombs', label: 'Bombs'  },
    ];
    for (let i = 0; i < STATS.length; i++) {
      const s = STATS[i];
      const val = aircraft[s.key];
      const max = STAT_MAX[s.key];
      const pct = Math.max(0, Math.min(1, val / max));
      const rowY = y + i * (statRowH + statRowGap) + statRowH / 2;
      // Label (left-aligned)
      ctx.font = '600 15px Inter, sans-serif';
      ctx.fillStyle = '#1a2030';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, statsBlockX, rowY);
      // Track
      const trackH = 10;
      ctx.fillStyle = 'rgba(20, 26, 36, 0.10)';
      roundRect(barX, rowY - trackH / 2, barW, trackH, 5);
      ctx.fill();
      // Fill
      ctx.fillStyle = '#cc2200';
      roundRect(barX, rowY - trackH / 2, Math.max(4, barW * pct), trackH, 5);
      ctx.fill();
      // Value (right-aligned)
      ctx.font = '700 15px Inter, sans-serif';
      ctx.fillStyle = '#0E1424';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), statsBlockX + statsBlockW, rowY);
    }
    ctx.textAlign = 'center';
    y += statsBlockH + dotsGap;

    // ----- Dots indicator -----
    const dotR = 5;
    const dotGap = 14;
    const totalDotsW = MISSION_1_AIRCRAFT.length * (dotR * 2) + (MISSION_1_AIRCRAFT.length - 1) * dotGap;
    let dotX = Math.round(cx - totalDotsW / 2 + dotR);
    const dotsCenterY = y + dotsH / 2;
    for (let i = 0; i < MISSION_1_AIRCRAFT.length; i++) {
      ctx.beginPath();
      ctx.arc(dotX, dotsCenterY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i === aircraftIndex ? '#cc2200' : 'rgba(20, 26, 36, 0.22)';
      ctx.fill();
      dotX += dotR * 2 + dotGap;
    }
    y += dotsH + btnGap;

    // ----- Choose button -----
    const btnW = 240;
    const btnX = Math.round(cx - btnW / 2);
    const btnY = y;
    selectChooseRect = { x: btnX, y: btnY, w: btnW, h: btnH };

    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    ctx.save();
    ctx.fillStyle = '#cc2200';
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.fill();
    ctx.lineWidth = 1.5;
    const borderAlpha = selectChooseHover ? 0.95 : 0.45 + 0.25 * pulse;
    ctx.strokeStyle = `rgba(120, 20, 0, ${borderAlpha.toFixed(2)})`;
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.stroke();
    if (selectChooseHover) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      roundRect(btnX, btnY, btnW, btnH, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Choose', btnX + btnW / 2, btnY + btnH / 2 + 1);
    ctx.restore();
    // No hint line below the Choose button — the carousel arrows and the
    // button itself are self-explanatory.
  }

  // Bomb-select carousel — same chrome / layout language as drawSelect, but
  // for the bomb-load step that runs after the aircraft is chosen. Shows the
  // bomb sprite, name + blurb, three stat bars (Damage / Blast / Speed),
  // dots indicator, and an Equip button.
  function drawBombSelect(now) {
    clearBg();
    drawSky();
    if (!IS_NIGHT) drawClouds();
    drawStreet();
    drawApartments();
    drawMilitaryBodies();

    const cx = W / 2;
    const bomb = MISSION_1_BOMBS[bombIndex];

    const cardW   = 760;
    const cardPad = 36;
    const headerH = 32;
    const headerGap = 22;
    const spriteSlotH = 132;
    const nameH   = 26;
    const nameGap = 14;
    const blurbGap = 6;
    const blurbH = 18;
    const statRowH = 26;
    const statRowGap = 10;
    const statsBlockH = statRowH * 3 + statRowGap * 2;
    const statsGap = 22;
    const dotsH   = 14;
    const dotsGap = 22;
    const btnH    = 52;
    const btnGap  = 18;
    const contentH = headerH + headerGap + spriteSlotH + nameGap + nameH + blurbGap + blurbH + statsGap + statsBlockH + dotsGap + dotsH + btnGap + btnH;
    const cardH   = contentH + cardPad * 2;
    const cardX   = Math.round(cx - cardW / 2);
    const cardY   = Math.round((H - cardH) / 2);

    // ----- Card surface -----
    ctx.save();
    ctx.shadowColor = 'rgba(2, 6, 17, 0.35)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 26, 36, 0.12)';
    roundRect(cardX, cardY, cardW, cardH, 14);
    ctx.stroke();
    ctx.restore();

    // ----- Header -----
    let y = cardY + cardPad + headerH / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 28px Inter, sans-serif';
    ctx.fillStyle = '#0E1424';
    ctx.fillText('Choose your bomb', cx, y);
    y += headerH / 2 + headerGap;

    // ----- Carousel arrows -----
    const arrowW = 56, arrowH = 56;
    const spriteAreaTop = y;
    const arrowCenterY = spriteAreaTop + spriteSlotH / 2;
    const arrowMargin = cardPad + 8;
    const prevX = cardX + arrowMargin;
    const nextX = cardX + cardW - arrowMargin - arrowW;
    bombPrevRect = { x: prevX, y: arrowCenterY - arrowH / 2, w: arrowW, h: arrowH };
    bombNextRect = { x: nextX, y: arrowCenterY - arrowH / 2, w: arrowW, h: arrowH };
    drawCarouselArrow(bombPrevRect, 'left',  bombPrevHover);
    drawCarouselArrow(bombNextRect, 'right', bombNextHover);

    // ----- Bomb sprite -----
    if (bomb.image) {
      const img = bomb.image;
      const slotW = 200;
      const slotH = spriteSlotH;
      const scale = Math.min(slotW / img.width, slotH / img.height);
      const drawW = img.width  * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, Math.round(cx - drawW / 2), Math.round(spriteAreaTop + (slotH - drawH) / 2), drawW, drawH);
    } else {
      ctx.fillStyle = 'rgba(20, 26, 36, 0.08)';
      roundRect(Math.round(cx - 100), spriteAreaTop + 10, 200, spriteSlotH - 20, 10);
      ctx.fill();
    }
    y = spriteAreaTop + spriteSlotH + nameGap;

    // ----- Name + blurb -----
    ctx.font = '700 22px Inter, sans-serif';
    ctx.fillStyle = '#0E1424';
    ctx.fillText(bomb.name, cx, y + nameH / 2);
    y += nameH + blurbGap;
    ctx.font = '500 14px Inter, sans-serif';
    ctx.fillStyle = 'rgba(20, 26, 36, 0.72)';
    ctx.fillText(bomb.blurb, cx, y + blurbH / 2);
    y += blurbH + statsGap;

    // ----- Stat bars -----
    const statsBlockX = cardX + cardPad + 80;
    const statsBlockW = cardW - (cardPad + 80) * 2;
    const labelW = 64;
    const valueW = 44;
    const barX = statsBlockX + labelW;
    const barW = statsBlockW - labelW - valueW - 12;
    const STATS = [
      { key: 'damage',    label: 'Damage' },
      { key: 'blast',     label: 'Blast'  },
      { key: 'speedMult', label: 'Speed'  },
    ];
    for (let i = 0; i < STATS.length; i++) {
      const s = STATS[i];
      const val = bomb[s.key];
      const max = BOMB_STAT_MAX[s.key];
      const pct = Math.max(0, Math.min(1, val / max));
      const rowY = y + i * (statRowH + statRowGap) + statRowH / 2;
      ctx.font = '600 15px Inter, sans-serif';
      ctx.fillStyle = '#1a2030';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, statsBlockX, rowY);
      const trackH = 10;
      ctx.fillStyle = 'rgba(20, 26, 36, 0.10)';
      roundRect(barX, rowY - trackH / 2, barW, trackH, 5);
      ctx.fill();
      ctx.fillStyle = '#cc2200';
      roundRect(barX, rowY - trackH / 2, Math.max(4, barW * pct), trackH, 5);
      ctx.fill();
      ctx.font = '700 15px Inter, sans-serif';
      ctx.fillStyle = '#0E1424';
      ctx.textAlign = 'right';
      // Blast renders as a px count; the others as plain numbers.
      const display = s.key === 'speedMult' ? val.toFixed(1) + 'x' : String(val);
      ctx.fillText(display, statsBlockX + statsBlockW, rowY);
    }
    ctx.textAlign = 'center';
    y += statsBlockH + dotsGap;

    // ----- Dots indicator -----
    const dotR = 5;
    const dotGap = 14;
    const totalDotsW = MISSION_1_BOMBS.length * (dotR * 2) + (MISSION_1_BOMBS.length - 1) * dotGap;
    let dotX = Math.round(cx - totalDotsW / 2 + dotR);
    const dotsCenterY = y + dotsH / 2;
    for (let i = 0; i < MISSION_1_BOMBS.length; i++) {
      ctx.beginPath();
      ctx.arc(dotX, dotsCenterY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = i === bombIndex ? '#cc2200' : 'rgba(20, 26, 36, 0.22)';
      ctx.fill();
      dotX += dotR * 2 + dotGap;
    }
    y += dotsH + btnGap;

    // ----- Equip button -----
    const btnW = 240;
    const btnX = Math.round(cx - btnW / 2);
    const btnY = y;
    bombEquipRect = { x: btnX, y: btnY, w: btnW, h: btnH };
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    ctx.save();
    ctx.fillStyle = '#cc2200';
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.fill();
    ctx.lineWidth = 1.5;
    const borderAlpha = bombEquipHover ? 0.95 : 0.45 + 0.25 * pulse;
    ctx.strokeStyle = `rgba(120, 20, 0, ${borderAlpha.toFixed(2)})`;
    roundRect(btnX, btnY, btnW, btnH, 10);
    ctx.stroke();
    if (bombEquipHover) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
      roundRect(btnX, btnY, btnW, btnH, 10);
      ctx.fill();
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Equip', btnX + btnW / 2, btnY + btnH / 2 + 1);
    ctx.restore();
  }

  // Single rounded-square carousel arrow with a chevron glyph.
  function drawCarouselArrow(rect, dir, hovering) {
    ctx.save();
    // Button surface — light fill, dark chevron. Same hero-red on hover.
    if (hovering) {
      ctx.fillStyle = '#cc2200';
    } else {
      ctx.fillStyle = 'rgba(20, 26, 36, 0.08)';
    }
    roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hovering ? 'rgba(120, 20, 0, 0.85)' : 'rgba(20, 26, 36, 0.18)';
    roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    ctx.stroke();
    // Chevron
    const cx2 = rect.x + rect.w / 2;
    const cy2 = rect.y + rect.h / 2;
    ctx.strokeStyle = hovering ? '#FFFFFF' : '#1a2030';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (dir === 'left') {
      ctx.moveTo(cx2 + 6, cy2 - 9);
      ctx.lineTo(cx2 - 6, cy2);
      ctx.lineTo(cx2 + 6, cy2 + 9);
    } else {
      ctx.moveTo(cx2 - 6, cy2 - 9);
      ctx.lineTo(cx2 + 6, cy2);
      ctx.lineTo(cx2 - 6, cy2 + 9);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Helper used by drawIntro for the rounded-rect cards.
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  let lastShakeUpdate = 0;
  function render(now) {
    lastFrameNow = now;
    // Splash screen — full-canvas hand-painted opener, held for SPLASH_MIN_MS
    // before the controls card appears.
    if (scene === 'splash') {
      drawSplash(now);
      return;
    }
    // Intro / mission briefing — short-circuit before all the gameplay
    // rendering. drawIntro paints its own background, so we skip clearBg too.
    if (scene === 'intro') {
      drawIntro(now);
      return;
    }
    if (scene === 'briefing') {
      drawBriefing(now);
      return;
    }
    if (scene === 'select') {
      drawSelect(now);
      return;
    }
    if (scene === 'bombs') {
      drawBombSelect(now);
      return;
    }
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
    if (!IS_NIGHT) drawClouds();   // night worlds keep the sky clear of clouds
    drawStreet();
    drawApartments();
    drawMilitaryTurrets();  // military turret behind the building silhouette
    drawMilitaryBodies();   // military building (alive or burnt) on top
    drawTankTurrets();      // turret barrel renders behind the body
    drawTrucks();
    drawTankBodies();       // body silhouette covers the turret breech
    drawBonuses(now);
    drawEnemies();
    drawPlayer(now);
    drawBullets();
    drawBombs();
    drawParticles();
    ctx.restore();
    drawHUD();
    drawGameOverOverlay();
    if (paused && !gameOver) drawPauseOverlay();
  }

  function drawPauseOverlay() {
    ctx.save();
    // Dim everything underneath. Bright enough to read the HUD through it.
    ctx.fillStyle = 'rgba(2, 6, 17, 0.62)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 56px Inter, sans-serif';
    ctx.fillText('Paused', W / 2, H / 2 - 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.font = '600 16px Inter, sans-serif';
    const isMobile = MODE === 'mobile';
    ctx.fillText(isMobile ? 'tap to resume' : 'press P or Esc to resume', W / 2, H / 2 + 34);
    ctx.restore();
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
