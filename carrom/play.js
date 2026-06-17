/* ============================================================
   Carrom · a Zamborin Game · mechanics V1

   Mechanics layer on top of the locked board renderer:
     • 19 pieces in the classic flower (1 queen + 6 inner + 12 outer)
     • striker placed on the bottom base line, draggable along it,
       flicked by drag-release (slingshot style)
     • simple 2D physics — circle-circle elastic collisions, linear
       friction, rectangular boundary, pocket detection
     • shot counter HUD; pieces removed when pocketed
     • striker resets to the base line at the end of every shot
   Win conditions / scoring / par / share string come in V2.
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE DETECTION ----------
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  // ---------- CANVAS SIZE — SQUARE ----------
  function squareSize() {
    if (MODE === 'desktop') return 600;
    const reserved = 30;
    return Math.min(window.innerHeight - reserved, window.innerWidth - reserved);
  }
  const S = squareSize();
  document.body.style.setProperty('--canvas-w', S + 'px');
  document.body.style.setProperty('--canvas-h', S + 'px');

  // ---------- CANVAS + SHARP-DPR ----------
  const canvas = document.getElementById('game');
  const ctx    = canvas.getContext('2d');
  canvas.setAttribute('width',  String(S));
  canvas.setAttribute('height', String(S));
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const backing = Math.round(S * dpr);
    if (canvas.width  !== backing) canvas.width  = backing;
    if (canvas.height !== backing) canvas.height = backing;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if (MODE === 'mobile') {
    let wasPortrait = window.innerHeight > window.innerWidth;
    window.addEventListener('resize', () => {
      const nowPortrait = window.innerHeight > window.innerWidth;
      if (wasPortrait !== nowPortrait) { wasPortrait = nowPortrait; location.reload(); }
    });
  }

  // ---------- BOARD GEOMETRY (4-fold symmetric) ----------
  const FRAME_INSET  = S * 0.011;
  const SURF_R       = S * 0.019;

  const POCKET_R     = S * 0.042;
  const POCKET_INSET = POCKET_R / Math.SQRT2;

  const BASE_INSET   = S * 0.135;
  const BASE_SPAN    = S * 0.634;
  const BASE_THICK   = S * 0.043;
  const BASE_RADIUS  = BASE_THICK / 2;
  const ANCHOR_R     = S * 0.0176;

  const CENTRE_OUTER = S * 0.1324;
  const CENTRE_INNER = S * 0.0207;

  const POCKETS = [
    [POCKET_INSET,         POCKET_INSET],
    [S - POCKET_INSET,     POCKET_INSET],
    [S - POCKET_INSET, S - POCKET_INSET],
    [POCKET_INSET,     S - POCKET_INSET],
  ];

  // ---------- PALETTE ----------
  const C = {
    frame:       '#0E1726',
    surface:     '#262262',
    pocket:      '#05080F',
    pocketRim:   'rgba(255,255,255,0.10)',
    line:        'rgba(39, 170, 225, 0.55)',   // cyan-blue, dimmed
    anchor:      'rgba(237, 28, 36, 0.55)',   // board markers — dimmed so the queen stays the dominant red
    pieceWhite:  '#F0EBDB',
    pieceWhiteEdge: '#B8B3A2',
    pieceBlack:  '#7C7C8A',        // lighter "gray" black — readable on deep purple
    pieceBlackEdge: '#4A4A55',
    queen:       '#ED1C24',
    queenEdge:   '#A60510',
    pocketFlash: '#FFD23F',        // sunshine yellow ring on pocket
    striker:     '#27AAE1',
    strikerRing: '#FFFFFF',
    aim:         'rgba(255, 210, 63, 0.85)',
    aimSoft:     'rgba(255, 210, 63, 0.35)',
    hud:         '#C5CFE0',
  };

  // ---------- GAME PARAMETERS ----------
  const PIECE_R       = S * 0.026;
  const STRIKER_R     = S * 0.032;             // 10 % smaller than V1
  const PIECE_MASS    = 1.0;
  const STRIKER_MASS  = 1.8;
  const FRICTION      = 0.986;
  const COLLISION_E   = 0.95;
  const BOUNCE_E      = 0.85;
  const MIN_VEL       = 0.07;
  // Catch zone = the full visual pocket. Any body (piece OR striker) whose
  // CENTRE crosses the pocket boundary pockets. Striker (R=0.032) sits well
  // inside the pocket (R=0.042) when caught — comfortable fit.
  const POCKET_CATCH_R = POCKET_R;
  const SUBSTEPS      = 3;

  // Striker rest positions — USER shoots from the bottom base line, AI from
  // the top. Y is selected per turn via strikerRestY().
  const USER_STRIKER_Y   = S - BASE_INSET - BASE_THICK / 2;
  const AI_STRIKER_Y     = BASE_INSET + BASE_THICK / 2;
  const STRIKER_REST_X   = S / 2;
  // Slide range = between the two anchor dots on the bottom base line,
  // INCLUSIVE — so striker centre can sit anywhere from one anchor x to the other.
  const STRIKER_SLIDE_MIN_X = S / 2 - BASE_SPAN / 2 + BASE_RADIUS;
  const STRIKER_SLIDE_MAX_X = S / 2 + BASE_SPAN / 2 - BASE_RADIUS;

  // Inner rectangular boundary used for piece + striker bouncing.
  // Just inside the playing surface, with a small inset so bodies don't graze
  // the visible edge.
  const BORDER       = FRAME_INSET + PIECE_R * 0.4;
  const BOUNDARY = {
    left:   BORDER,
    top:    BORDER,
    right:  S - BORDER,
    bottom: S - BORDER,
  };

  const DRAG_MAX_PX   = S * 0.28;
  const STRIKER_MAX_V = 22;
  const STRIKER_GRAB_R = STRIKER_R * 2.2;  // generous hit radius for fingers

  // ---------- AUDIO ----------
  // Procedural sound synthesis via Web Audio API. No sample files — every
  // tick / thock / thunk is a short oscillator envelope. Lazy AudioContext
  // boot on first user gesture (modern-browser autoplay policy).
  let audioCtx = null;
  let soundsThisFrame = 0;
  const MAX_SOUNDS_PER_FRAME = 5;
  function audio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function impactGain(speed) {
    const t = Math.max(0, Math.min(1, speed / 16));
    return 0.05 + t * 0.30;
  }
  // Build (and cache) one second of white noise we can re-trigger as the
  // "click" half of every wood hit. Generating in-place each time is too
  // expensive for dense collisions.
  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (!noiseBuffer) {
      const ctx = audio();
      if (!ctx) return null;
      const len = Math.floor(ctx.sampleRate * 0.4);
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    }
    return noiseBuffer;
  }
  // Wood click recipe:
  //   1) short filtered-noise burst — the "tick" character of impact
  //   2) overlaid damped sine at the body's resonant frequency — the wood "ring"
  // Both with very fast attack and short decay so it doesn't ring like a chime.
  function playWood(centerFreq, decay, gain, options) {
    if (soundsThisFrame >= MAX_SOUNDS_PER_FRAME) return;
    const ctx = audio();
    if (!ctx) return;
    soundsThisFrame++;
    const opts = options || {};
    const noiseRatio = opts.noiseRatio != null ? opts.noiseRatio : 0.55;
    const Q          = opts.Q != null ? opts.Q : 6;
    const bodyDecay  = decay * (opts.bodyDecay != null ? opts.bodyDecay : 0.7);
    const now        = ctx.currentTime;
    // Slight pitch jitter so successive hits don't sound robotic.
    const jitter     = 1 + (Math.random() - 0.5) * 0.08;
    const freq       = centerFreq * jitter;

    // 1) Noise → band-pass → envelope → out
    const buf = getNoiseBuffer();
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 1.4;
      bp.Q.value = Q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * noiseRatio), now + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      src.connect(bp); bp.connect(env); env.connect(ctx.destination);
      src.start(now);
      src.stop(now + decay + 0.05);
    }

    // 2) Damped body tone at the lower resonance.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.55, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(50, freq * 0.40), now + bodyDecay);
    const oenv = ctx.createGain();
    oenv.gain.setValueAtTime(0.0001, now);
    oenv.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * (1 - noiseRatio)), now + 0.003);
    oenv.gain.exponentialRampToValueAtTime(0.0001, now + bodyDecay);
    osc.connect(oenv); oenv.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + bodyDecay + 0.02);
  }

  function soundPieceCollide(speed) {
    // Light, dry click — small wooden disc on small wooden disc.
    playWood(780, 0.06, impactGain(speed) * 0.60, { noiseRatio: 0.65, Q: 7, bodyDecay: 0.55 });
  }
  function soundStrikerHit(speed) {
    // Heavier "thock" — bigger disc, slightly lower body resonance.
    playWood(520, 0.09, impactGain(speed) * 0.85, { noiseRatio: 0.55, Q: 6, bodyDecay: 0.70 });
  }
  function soundWallBounce(speed) {
    // Wooden rail hit — lowest body, more noise (frame is heavier than discs).
    playWood(340, 0.11, impactGain(speed) * 0.55, { noiseRatio: 0.70, Q: 5, bodyDecay: 0.65 });
  }
  function soundPocket() {
    // "Tlock" then a low wooden drop — wooden disc disappearing into the net.
    playWood(440, 0.10, 0.18, { noiseRatio: 0.55, Q: 6, bodyDecay: 0.70 });
    setTimeout(() => playWood(180, 0.18, 0.14, { noiseRatio: 0.30, Q: 4, bodyDecay: 0.85 }), 70);
  }

  // ---------- STATE ----------
  // Scenes:
  //   'menu'             — pre-game; choose mode + difficulty
  //   'aiming'           — current player can place / flick the striker
  //   'thinking'         — AI is taking its turn (brief delay before firing)
  //   'flying'           — a shot is mid-physics
  //   'board-over'       — current board ended; show result + continue
  //   'tournament-over'  — best-of-3 finished
  let scene       = 'menu';
  let mode        = 'single';    // 'single' | 'bo3'
  let difficulty  = 'medium';    // 'easy' | 'medium' | 'hard'
  let currentPlayer = 'user';    // 'user' | 'ai'
  let userBoards = 0, aiBoards = 0;
  let boardNum   = 1;            // current board number (1..3)
  let lastBoardWinner = null;    // 'user' | 'ai' for board-over screen
  // Per-board counters
  let userPocketed = 0;          // count of WHITE pieces user has pocketed
  let aiPocketed   = 0;          // count of BLACK pieces AI has pocketed
  let queenClaimedBy = null;     // 'user' | 'ai' | null
  let shots = 0;                 // for the current board (HUD)
  let pocketsThisShot = [];      // every piece kind pocketed during the active shot
  let strikerFouledThisShot = false;
  let aiThinkAt = 0;             // timestamp when AI fires
  const AI_THINK_MS = 1000;
  function strikerRestY() { return currentPlayer === 'user' ? USER_STRIKER_Y : AI_STRIKER_Y; }

  const pieces = [];                              // {x,y,vx,vy,r,kind,active}
  const striker = {
    x: STRIKER_REST_X, y: USER_STRIKER_Y, vx: 0, vy: 0,
    r: STRIKER_R, active: true,
  };
  const aim = { dragging: false, mode: null, startX: 0, startY: 0, curX: 0, curY: 0 };
  // mode: 'flick' (touched striker) | 'slide' (touched base line away from striker)
  const flashes = [];                             // { x, y, t0 } — pocket-flash overlays
  // Hit-test rects for menu / board-over screen buttons, refreshed each frame.
  const UI = {
    btnModeSingle: { x: 0, y: 0, w: 0, h: 0 },
    btnModeBo3:    { x: 0, y: 0, w: 0, h: 0 },
    btnDiffEasy:   { x: 0, y: 0, w: 0, h: 0 },
    btnDiffMed:    { x: 0, y: 0, w: 0, h: 0 },
    btnDiffHard:   { x: 0, y: 0, w: 0, h: 0 },
    btnStart:      { x: 0, y: 0, w: 0, h: 0 },
    btnNext:       { x: 0, y: 0, w: 0, h: 0 },
    btnMenu:       { x: 0, y: 0, w: 0, h: 0 },
  };

  // ---------- PIECE SETUP ----------
  // Classic flower: queen at centre, 6 inner ring, 12 outer ring.
  function setupPieces() {
    pieces.length = 0;
    const cx = S / 2, cy = S / 2;
    // Queen
    pieces.push(makePiece(cx, cy, 'queen'));
    // Inner ring — 6 pieces, alternating white/black, all touching the queen.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * PIECE_R * 2;
      const y = cy + Math.sin(a) * PIECE_R * 2;
      pieces.push(makePiece(x, y, i % 2 === 0 ? 'white' : 'black'));
    }
    // Outer ring — 12 pieces, alternating white/black.
    // For 12 pieces at uniform angular spacing (30°), the minimum radius
    // at which adjacent pieces don't overlap is r / sin(15°) ≈ 3.864 r.
    // We use 4r → adjacent pieces have a tiny visible gap (no overlap),
    // and pieces aligned with inner-ring positions are tangent to them.
    const outerR = PIECE_R * 4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2 + Math.PI / 12;
      const x = cx + Math.cos(a) * outerR;
      const y = cy + Math.sin(a) * outerR;
      pieces.push(makePiece(x, y, i % 2 === 0 ? 'white' : 'black'));
    }
  }
  function makePiece(x, y, kind) {
    return { x, y, vx: 0, vy: 0, r: PIECE_R, kind, active: true };
  }

  // ---------- INPUT ----------
  function logical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      lx: ((clientX - rect.left) / rect.width)  * S,
      ly: ((clientY - rect.top)  / rect.height) * S,
    };
  }
  function distSq(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  }
  function onStriker(lx, ly) {
    return distSq(lx, ly, striker.x, striker.y) <= STRIKER_GRAB_R * STRIKER_GRAB_R;
  }
  // The slide zone covers the bottom base line + a generous Y buffer so finger
  // taps near the base line snap the striker to that x position. INCLUSIVE of
  // both anchor dots: striker centre can sit anywhere between (and on) them.
  function inSlideZone(lx, ly) {
    const yMin = S - BASE_INSET - BASE_THICK - PIECE_R;
    const yMax = S - BASE_INSET + PIECE_R;
    if (ly < yMin || ly > yMax) return false;
    return lx >= STRIKER_SLIDE_MIN_X - BASE_RADIUS &&
           lx <= STRIKER_SLIDE_MAX_X + BASE_RADIUS;
  }
  function clampSlide(x) {
    return Math.max(STRIKER_SLIDE_MIN_X, Math.min(STRIKER_SLIDE_MAX_X, x));
  }

  // Two pointer zones:
  //   • on striker     → FLICK   (slingshot drag-release)
  //   • on base line   → SLIDE   (snap striker.x to pointer, drag for live update)
  canvas.addEventListener('pointerdown', e => {
    audio();                                              // wake audio on user gesture
    e.preventDefault();
    const { lx, ly } = logical(e.clientX, e.clientY);
    // Menu / board-over / tournament-over hit-tests run BEFORE the gameplay
    // gate so the user can always click these UI surfaces.
    if (scene === 'menu') {
      if (inRect(UI.btnModeSingle, lx, ly)) { mode = 'single'; return; }
      if (inRect(UI.btnModeBo3,    lx, ly)) { mode = 'bo3';    return; }
      if (inRect(UI.btnDiffEasy,   lx, ly)) { difficulty = 'easy';   return; }
      if (inRect(UI.btnDiffMed,    lx, ly)) { difficulty = 'medium'; return; }
      if (inRect(UI.btnDiffHard,   lx, ly)) { difficulty = 'hard';   return; }
      if (inRect(UI.btnStart,      lx, ly)) { startMatch();          return; }
      return;
    }
    if (scene === 'board-over') {
      if (inRect(UI.btnNext, lx, ly)) { advanceAfterBoard();          return; }
      if (inRect(UI.btnMenu, lx, ly)) { scene = 'menu';               return; }
      return;
    }
    if (scene === 'tournament-over') {
      if (inRect(UI.btnMenu, lx, ly)) { scene = 'menu';               return; }
      return;
    }
    // Gameplay: only the USER may use pointer input. AI auto-shoots.
    if (scene !== 'aiming' || currentPlayer !== 'user') return;
    if (onStriker(lx, ly)) {
      aim.dragging = true;
      aim.mode = 'flick';
      aim.startX = lx; aim.startY = ly;
      aim.curX = lx;   aim.curY = ly;
    } else if (inSlideZone(lx, ly)) {
      aim.dragging = true;
      aim.mode = 'slide';
      striker.x = clampSlide(lx);
    } else {
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', e => {
    if (!aim.dragging) return;
    e.preventDefault();
    const { lx, ly } = logical(e.clientX, e.clientY);
    if (aim.mode === 'flick') {
      aim.curX = lx; aim.curY = ly;
    } else if (aim.mode === 'slide') {
      striker.x = clampSlide(lx);
    }
  });
  canvas.addEventListener('pointercancel', () => { aim.dragging = false; aim.mode = null; });
  canvas.addEventListener('pointerup', e => {
    if (!aim.dragging) return;
    e.preventDefault();
    aim.dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (aim.mode === 'slide') { aim.mode = null; return; }

    // FLICK release — slingshot semantics: drag away → fire opposite.
    const dx = aim.startX - aim.curX;
    const dy = aim.startY - aim.curY;
    const dragDist = Math.sqrt(dx * dx + dy * dy);
    aim.mode = null;
    if (dragDist < 4) return;
    const power = Math.min(1, dragDist / DRAG_MAX_PX);
    const angle = Math.atan2(dy, dx);
    const vx = Math.cos(angle) * STRIKER_MAX_V * power;
    const vy = Math.sin(angle) * STRIKER_MAX_V * power;
    // Striker must travel away from the player's base — UP for the user, DOWN for AI.
    if (currentPlayer === 'user' && vy > -0.5) return;
    if (currentPlayer === 'ai'   && vy <  0.5) return;
    striker.vx = vx;
    striker.vy = vy;
    shots++;
    scene = 'flying';
  });

  // ---------- PHYSICS ----------
  function physicsStep() {
    soundsThisFrame = 0;
    const bodies = [];
    if (striker.active && (striker.vx !== 0 || striker.vy !== 0 || scene === 'flying')) bodies.push(striker);
    for (const p of pieces) if (p.active) bodies.push(p);

    // 1. Integrate
    for (const b of bodies) {
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      const speed2 = b.vx * b.vx + b.vy * b.vy;
      if (speed2 < MIN_VEL * MIN_VEL) { b.vx = 0; b.vy = 0; }
    }
    // 2. Pairwise collisions
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        resolveCollision(bodies[i], bodies[j]);
      }
    }
    // 3. Pocket check (before boundary so pieces don't bounce out of pockets)
    for (const b of bodies) checkPocket(b);
    // 4. Boundary
    for (const b of bodies) if (b.active) bounceBoundary(b);

    // 5. Settle check — when nothing's moving, hand control back.
    if (scene === 'flying') {
      let allStopped = true;
      for (const b of bodies) {
        if (b.active && (b.vx !== 0 || b.vy !== 0)) { allStopped = false; break; }
      }
      if (allStopped) settleShot();
    }
  }
  function settleShot() {
    // Evaluate carrom rules: who pockets what, fouls, queen, win check.
    // Decide next player + scene.
    const ownPocketed = pocketsThisShot.filter(k => k === colorFor(currentPlayer)).length;
    const oppPocketed = pocketsThisShot.filter(k => k === colorFor(opponentOf(currentPlayer))).length;
    const queenInShot = pocketsThisShot.includes('queen');

    // Update per-board counters (counts who pocketed which colour piece)
    for (const k of pocketsThisShot) {
      if (k === 'queen') {
        if (queenClaimedBy === null) queenClaimedBy = currentPlayer;
      } else if (k === 'white') {
        userPocketed++;
      } else if (k === 'black') {
        aiPocketed++;
      }
    }

    // Board win = current player has cleared all 9 of own colour.
    const cleared = (currentPlayer === 'user' && userPocketed >= 9) ||
                    (currentPlayer === 'ai'   && aiPocketed   >= 9);
    if (cleared) {
      lastBoardWinner = currentPlayer;
      if (currentPlayer === 'user') userBoards++; else aiBoards++;
      scene = 'board-over';
      // Reset striker visually
      striker.active = true; striker.vx = 0; striker.vy = 0;
      striker.x = STRIKER_REST_X; striker.y = strikerRestY();
      return;
    }

    // Standard rule simplification: own-colour pocket = continue. Anything else
    // (miss, opponent piece, foul) = turn switches.
    const continueTurn = !strikerFouledThisShot && ownPocketed > 0 && oppPocketed === 0;
    pocketsThisShot.length = 0;
    strikerFouledThisShot = false;

    if (!continueTurn) currentPlayer = opponentOf(currentPlayer);

    striker.active = true;
    striker.vx = 0; striker.vy = 0;
    striker.x = STRIKER_REST_X;
    striker.y = strikerRestY();
    scene = 'aiming';
    if (currentPlayer === 'ai') beginAITurn();
  }
  function colorFor(player)    { return player === 'user' ? 'white' : 'black'; }
  function opponentOf(player)  { return player === 'user' ? 'ai' : 'user'; }

  // ---------- MATCH FLOW ----------
  function inRect(r, lx, ly) { return r.w > 0 && lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h; }
  function newBoard() {
    setupPieces();
    userPocketed = 0; aiPocketed = 0;
    queenClaimedBy = null;
    pocketsThisShot.length = 0;
    strikerFouledThisShot = false;
    flashes.length = 0;
    shots = 0;
    // User always opens a board in V1.
    currentPlayer = 'user';
    striker.active = true; striker.vx = 0; striker.vy = 0;
    striker.x = STRIKER_REST_X; striker.y = strikerRestY();
    scene = 'aiming';
  }
  function startMatch() {
    userBoards = 0; aiBoards = 0;
    boardNum = 1;
    newBoard();
  }
  function tournamentComplete() {
    if (mode === 'single') return true;
    // Best of 3 — first to 2 boards
    return userBoards >= 2 || aiBoards >= 2 || (userBoards + aiBoards >= 3);
  }
  function advanceAfterBoard() {
    if (tournamentComplete()) { scene = 'tournament-over'; return; }
    boardNum++;
    newBoard();
  }

  // ---------- AI ----------
  // Heuristic shot generation. Easy = random-ish, Medium = piece→pocket aim
  // with moderate noise, Hard = best piece→pocket pair with minimal noise.
  function beginAITurn() {
    aiThinkAt = performance.now() + AI_THINK_MS;
    scene = 'thinking';
  }
  function findOwnLiveTargets() {
    const want = colorFor('ai');                            // 'black'
    return pieces.filter(p => p.active && p.kind === want);
  }
  function aiPickShot() {
    const targets = findOwnLiveTargets();
    // If no own pieces remain, fall back to the queen (or any active piece).
    let candidates = targets;
    if (candidates.length === 0) candidates = pieces.filter(p => p.active);
    if (candidates.length === 0) {
      // Nothing to hit — just fire mildly downward for a graceful skip.
      return { x: STRIKER_REST_X, angle: Math.PI / 2 + (Math.random() - 0.5) * 0.4, power: 0.5 };
    }
    // For each candidate × each pocket, compute the aim from the AI base line.
    const aiY = AI_STRIKER_Y;
    const baseXMin = STRIKER_SLIDE_MIN_X, baseXMax = STRIKER_SLIDE_MAX_X;
    const shotsList = [];
    for (const piece of candidates) {
      for (const [px, py] of POCKETS) {
        // Aim target = piece centre + offset toward "away from pocket" by combined radii.
        const dx = piece.x - px, dy = piece.y - py;
        const dd = Math.sqrt(dx*dx + dy*dy);
        if (dd < 0.001) continue;
        const aimX = piece.x + (dx / dd) * (PIECE_R + STRIKER_R);
        const aimY = piece.y + (dy / dd) * (PIECE_R + STRIKER_R);
        // Choose a striker X on the base line such that the line striker→aim
        // points downward (vy > 0).
        let strX = Math.max(baseXMin, Math.min(baseXMax, aimX));
        const ddx = aimX - strX;
        const ddy = aimY - aiY;
        if (ddy < 1) continue;                              // can't fire upward into own base
        const angle = Math.atan2(ddy, ddx);
        // Power scales with the total distance (striker→piece + piece→pocket).
        const dToPiece  = Math.sqrt(ddx*ddx + ddy*ddy);
        const dToPocket = dd;
        const power = Math.min(1, (dToPiece + dToPocket * 0.85) / (S * 0.85));
        // Score = directness of piece→pocket line (closer to "straight on" wins).
        // Score higher when piece is between striker line and pocket.
        let score = 1 - power * 0.35;                       // gentle preference for low-power shots
        score += 0.6 / Math.max(0.5, dToPocket / S);        // closer pocket = higher score
        // Penalise if any other active piece is on the striker→piece line.
        if (lineBlockedByOtherPiece(strX, aiY, aimX, aimY, piece)) score -= 0.7;
        shotsList.push({ strX, angle, power, score });
      }
    }
    if (shotsList.length === 0) {
      return { x: STRIKER_REST_X, angle: Math.PI / 2 + (Math.random() - 0.5) * 0.4, power: 0.55 };
    }
    shotsList.sort((a, b) => b.score - a.score);
    // Pick from the top per difficulty, then add aim noise.
    let pick, noiseDeg, powerNoise;
    if (difficulty === 'easy') {
      pick = shotsList[Math.floor(Math.random() * shotsList.length)];   // any candidate
      noiseDeg = 25;
      powerNoise = 0.35;
      pick.power = 0.5 + Math.random() * 0.3;
    } else if (difficulty === 'medium') {
      pick = shotsList[Math.floor(Math.random() * Math.min(3, shotsList.length))];   // top-3
      noiseDeg = 10;
      powerNoise = 0.15;
    } else { // hard
      pick = shotsList[0];                                  // best
      noiseDeg = 2;
      powerNoise = 0.05;
    }
    pick.angle += (Math.random() - 0.5) * (noiseDeg * Math.PI / 180);
    pick.power  = Math.max(0.25, Math.min(1, pick.power + (Math.random() - 0.5) * powerNoise));
    return pick;
  }
  function lineBlockedByOtherPiece(x0, y0, x1, y1, ignore) {
    const dx = x1 - x0, dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return false;
    for (const p of pieces) {
      if (!p.active || p === ignore) continue;
      // Distance from p to the line segment.
      const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / lenSq));
      const cx = x0 + dx * t, cy = y0 + dy * t;
      const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d2 < (PIECE_R + STRIKER_R * 0.9) ** 2) return true;
    }
    return false;
  }
  function aiFire() {
    const shot = aiPickShot();
    striker.x = Math.max(STRIKER_SLIDE_MIN_X, Math.min(STRIKER_SLIDE_MAX_X, shot.strX));
    striker.y = AI_STRIKER_Y;
    striker.vx = Math.cos(shot.angle) * STRIKER_MAX_V * shot.power;
    striker.vy = Math.sin(shot.angle) * STRIKER_MAX_V * shot.power;
    shots++;
    scene = 'flying';
  }

  function bodyMass(b) { return (b === striker) ? STRIKER_MASS : PIECE_MASS; }
  function resolveCollision(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = a.r + b.r;
    if (dist >= minDist || dist === 0) return;
    const nx = dx / dist, ny = dy / dist;
    const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
    const velAlongNormal = relVx * nx + relVy * ny;
    if (velAlongNormal > 0) return;
    const aMass = bodyMass(a), bMass = bodyMass(b);
    const j = -(1 + COLLISION_E) * velAlongNormal / (1 / aMass + 1 / bMass);
    a.vx -= j * nx / aMass; a.vy -= j * ny / aMass;
    b.vx += j * nx / bMass; b.vy += j * ny / bMass;
    const overlap = (minDist - dist) / 2;
    a.x -= overlap * nx; a.y -= overlap * ny;
    b.x += overlap * nx; b.y += overlap * ny;
    // Sound on collision — louder when striker is involved.
    const speed = Math.abs(velAlongNormal);
    if (speed > 0.5) {
      if (a === striker || b === striker) soundStrikerHit(speed);
      else                                soundPieceCollide(speed);
    }
  }
  function bounceBoundary(b) {
    let hit = 0;
    if (b.x - b.r < BOUNDARY.left)   { hit = Math.max(hit, Math.abs(b.vx)); b.x = BOUNDARY.left   + b.r; b.vx = -b.vx * BOUNCE_E; }
    if (b.x + b.r > BOUNDARY.right)  { hit = Math.max(hit, Math.abs(b.vx)); b.x = BOUNDARY.right  - b.r; b.vx = -b.vx * BOUNCE_E; }
    if (b.y - b.r < BOUNDARY.top)    { hit = Math.max(hit, Math.abs(b.vy)); b.y = BOUNDARY.top    + b.r; b.vy = -b.vy * BOUNCE_E; }
    if (b.y + b.r > BOUNDARY.bottom) { hit = Math.max(hit, Math.abs(b.vy)); b.y = BOUNDARY.bottom - b.r; b.vy = -b.vy * BOUNCE_E; }
    if (hit > 0.5) soundWallBounce(hit);
  }
  function checkPocket(b) {
    if (!b.active) return;
    for (const [px, py] of POCKETS) {
      if (distSq(b.x, b.y, px, py) < POCKET_CATCH_R * POCKET_CATCH_R) {
        b.active = false;
        b.vx = 0; b.vy = 0;
        flashes.push({ x: px, y: py, t0: performance.now() });
        soundPocket();
        // Record what was pocketed so settleShot() can score the turn.
        if (b === striker)      strikerFouledThisShot = true;
        else                    pocketsThisShot.push(b.kind);
        return;
      }
    }
  }

  // ---------- DRAWING ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawBoard() {
    // Frame fill
    ctx.fillStyle = C.frame;
    ctx.fillRect(0, 0, S, S);
    // Playing surface
    ctx.fillStyle = C.surface;
    roundRect(FRAME_INSET, FRAME_INSET, S - FRAME_INSET * 2, S - FRAME_INSET * 2, SURF_R);
    ctx.fill();
    // Pockets — full circles tangent to each canvas corner
    for (const [cx, cy] of POCKETS) {
      ctx.fillStyle = C.pocket;
      ctx.beginPath(); ctx.arc(cx, cy, POCKET_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.pocketRim;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, POCKET_R, 0, Math.PI * 2); ctx.stroke();
    }
    // Base lines
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.4;
    drawBaseLine('top'); drawBaseLine('bottom'); drawBaseLine('left'); drawBaseLine('right');
    // Anchor dots
    drawAnchorDots();
    // Centre concentric circles
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, CENTRE_OUTER, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, CENTRE_INNER, 0, Math.PI * 2); ctx.stroke();
  }
  function drawBaseLine(edge) {
    const halfSpan = BASE_SPAN / 2;
    const mid      = S / 2;
    if (edge === 'top' || edge === 'bottom') {
      const y = (edge === 'top') ? BASE_INSET : S - BASE_INSET - BASE_THICK;
      roundRect(mid - halfSpan, y, BASE_SPAN, BASE_THICK, BASE_RADIUS); ctx.stroke();
    } else {
      const x = (edge === 'left') ? BASE_INSET : S - BASE_INSET - BASE_THICK;
      roundRect(x, mid - halfSpan, BASE_THICK, BASE_SPAN, BASE_RADIUS); ctx.stroke();
    }
  }
  function drawAnchorDots() {
    ctx.fillStyle = C.anchor;
    const halfSpan = BASE_SPAN / 2;
    const mid      = S / 2;
    const dots = [
      // TOP
      [mid - halfSpan + BASE_RADIUS, BASE_INSET + BASE_RADIUS],
      [mid + halfSpan - BASE_RADIUS, BASE_INSET + BASE_RADIUS],
      // BOTTOM
      [mid - halfSpan + BASE_RADIUS, S - BASE_INSET - BASE_RADIUS],
      [mid + halfSpan - BASE_RADIUS, S - BASE_INSET - BASE_RADIUS],
      // LEFT
      [BASE_INSET + BASE_RADIUS, mid - halfSpan + BASE_RADIUS],
      [BASE_INSET + BASE_RADIUS, mid + halfSpan - BASE_RADIUS],
      // RIGHT
      [S - BASE_INSET - BASE_RADIUS, mid - halfSpan + BASE_RADIUS],
      [S - BASE_INSET - BASE_RADIUS, mid + halfSpan - BASE_RADIUS],
    ];
    for (const [x, y] of dots) {
      ctx.beginPath(); ctx.arc(x, y, ANCHOR_R, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPiece(p) {
    if (!p.active) return;
    let body;
    if (p.kind === 'queen')     { body = C.queen; }
    else if (p.kind === 'white'){ body = C.pieceWhite; }
    else                        { body = C.pieceBlack; }
    // Flat disk — solid fill, no border ring. Faint inner concentric ring is
    // the only surface detail, kept at low opacity so it reads as machined
    // texture rather than a visible outline.
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2); ctx.stroke();
  }
  function drawPieces() {
    for (const p of pieces) drawPiece(p);
  }
  function drawStriker() {
    if (!striker.active) return;
    // Solid disk to match the piece style. Faint inner concentric ring for
    // machined-surface detail (same low opacity as pieces). No outer border.
    ctx.fillStyle = C.striker;
    ctx.beginPath(); ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(striker.x, striker.y, striker.r * 0.55, 0, Math.PI * 2); ctx.stroke();
  }
  function drawAim() {
    if (!aim.dragging || aim.mode !== 'flick') return;
    const dx = aim.startX - aim.curX;
    const dy = aim.startY - aim.curY;
    const dragDist = Math.sqrt(dx * dx + dy * dy);
    if (dragDist < 4) return;
    const power = Math.min(1, dragDist / DRAG_MAX_PX);
    const angle = Math.atan2(dy, dx);
    if (Math.sin(angle) > -0.05) return;                    // shot must travel up
    const len = STRIKER_R * 2 + power * S * 0.4;
    const ax = Math.cos(angle), ay = Math.sin(angle);
    const ex = striker.x + ax * len;
    const ey = striker.y + ay * len;
    // Single thin white line — no halo, no dashes.
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(striker.x, striker.y); ctx.lineTo(ex, ey); ctx.stroke();
    // Slim, elegant arrowhead — narrower (0.35 spread) and smaller.
    const head = STRIKER_R * 0.36 + power * STRIKER_R * 0.30;
    const px = -ay, py = ax;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ax * head + px * head * 0.35, ey - ay * head + py * head * 0.35);
    ctx.lineTo(ex - ax * head - px * head * 0.35, ey - ay * head - py * head * 0.35);
    ctx.closePath(); ctx.fill();
    ctx.lineCap = 'butt';
  }
  function drawFlashes(now) {
    const FLASH_MS = 520;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      const age = now - f.t0;
      if (age >= FLASH_MS) { flashes.splice(i, 1); continue; }
      const t = age / FLASH_MS;
      // Expanding ring: from pocket radius out to ~2.4× pocket radius.
      const ringR = POCKET_R * (1 + 1.4 * t);
      const alpha = (1 - t) * 0.95;
      // Bright outer ring
      ctx.strokeStyle = 'rgba(255, 210, 63, ' + alpha + ')';
      ctx.lineWidth = 3 * (1 - t * 0.55);
      ctx.beginPath(); ctx.arc(f.x, f.y, ringR, 0, Math.PI * 2); ctx.stroke();
      // Soft fill burst — fades faster than the ring
      const fillAlpha = (1 - t) * (1 - t) * 0.4;
      ctx.fillStyle = 'rgba(255, 210, 63, ' + fillAlpha + ')';
      ctx.beginPath(); ctx.arc(f.x, f.y, POCKET_R * (1 + t * 0.4), 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHUD() {
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = C.hud;
    ctx.textBaseline = 'middle';
    const y = FRAME_INSET + POCKET_R * 0.55;
    const yBot = S - FRAME_INSET - POCKET_R * 0.55;
    ctx.textAlign = 'left';
    // AI (top): black, count of own pieces remaining (9 - aiPocketed).
    const aiLeft = Math.max(0, 9 - aiPocketed);
    ctx.fillText('AI  ' + aiLeft + (currentPlayer === 'ai' ? '  ◄' : ''), S * 0.18, y);
    ctx.textAlign = 'right';
    if (mode === 'bo3') ctx.fillText('BOARD ' + boardNum + '/3 · ' + userBoards + '–' + aiBoards, S * 0.82, y);
    else                ctx.fillText('SHOTS ' + shots, S * 0.82, y);
    // USER (bottom): white pieces remaining.
    ctx.textAlign = 'left';
    const usrLeft = Math.max(0, 9 - userPocketed);
    ctx.fillText('YOU  ' + usrLeft + (currentPlayer === 'user' ? '  ◄' : ''), S * 0.18, yBot);
    ctx.textAlign = 'right';
    ctx.fillText(difficulty.toUpperCase(), S * 0.82, yBot);
  }

  // ---------- MENU + RESULT SCREENS ----------
  function drawDim(alpha) {
    ctx.fillStyle = 'rgba(7, 10, 22, ' + alpha + ')';
    ctx.fillRect(0, 0, S, S);
  }
  function drawButton(rect, label, primary, selected) {
    const fill = primary ? C.queen : (selected ? '#2D2E66' : '#161734');
    ctx.fillStyle = fill;
    roundRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2);
    ctx.fill();
    if (selected && !primary) {
      ctx.strokeStyle = C.queen;
      ctx.lineWidth = 1.6;
      roundRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, rect.h / 2);
      ctx.stroke();
    }
    ctx.font = '700 13px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5);
  }
  function drawMenu() {
    drawDim(0.82);
    const cx = S / 2;
    const top = S * 0.22;

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 28px Inter, sans-serif';
    ctx.fillText('CARROM', cx, top);
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillStyle = C.hud;
    ctx.fillText('Pick your match and difficulty.', cx, top + 28);

    // MODE row
    const modeY = top + 70;
    const btnW = S * 0.30, btnH = 38, gap = S * 0.02;
    UI.btnModeSingle.x = cx - btnW - gap / 2; UI.btnModeSingle.y = modeY; UI.btnModeSingle.w = btnW; UI.btnModeSingle.h = btnH;
    UI.btnModeBo3.x    = cx + gap / 2;        UI.btnModeBo3.y    = modeY; UI.btnModeBo3.w    = btnW; UI.btnModeBo3.h    = btnH;
    drawButton(UI.btnModeSingle, 'SINGLE GAME', false, mode === 'single');
    drawButton(UI.btnModeBo3,    'BEST OF 3',   false, mode === 'bo3');

    // DIFFICULTY row
    const diffY = modeY + 64;
    const dW = S * 0.20;
    UI.btnDiffEasy.x = cx - dW * 1.5 - gap;  UI.btnDiffEasy.y = diffY; UI.btnDiffEasy.w = dW; UI.btnDiffEasy.h = btnH;
    UI.btnDiffMed.x  = cx - dW / 2;           UI.btnDiffMed.y  = diffY; UI.btnDiffMed.w  = dW; UI.btnDiffMed.h  = btnH;
    UI.btnDiffHard.x = cx + dW / 2 + gap;     UI.btnDiffHard.y = diffY; UI.btnDiffHard.w = dW; UI.btnDiffHard.h = btnH;
    drawButton(UI.btnDiffEasy, 'EASY',   false, difficulty === 'easy');
    drawButton(UI.btnDiffMed,  'MEDIUM', false, difficulty === 'medium');
    drawButton(UI.btnDiffHard, 'HARD',   false, difficulty === 'hard');

    // START
    const startY = diffY + 90;
    const sW = S * 0.40, sH = 52;
    UI.btnStart.x = cx - sW / 2; UI.btnStart.y = startY; UI.btnStart.w = sW; UI.btnStart.h = sH;
    drawButton(UI.btnStart, 'START', true, false);

    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = C.hud;
    ctx.fillText('You play white from the bottom. AI plays black from the top.', cx, startY + sH + 26);
  }
  function drawBoardOver() {
    drawDim(0.85);
    const cx = S / 2;
    const top = S * 0.30;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = lastBoardWinner === 'user' ? C.green : C.queen;
    ctx.fillText(lastBoardWinner === 'user' ? 'BOARD WON' : 'BOARD LOST', cx, top);
    ctx.font = '800 28px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Board ' + boardNum + (mode === 'bo3' ? ' of 3' : ''), cx, top + 40);
    ctx.font = '500 13px Inter, sans-serif';
    ctx.fillStyle = C.hud;
    if (mode === 'bo3') ctx.fillText('Tournament: ' + userBoards + ' – ' + aiBoards, cx, top + 76);
    ctx.fillText('Shots taken: ' + shots, cx, top + 98);

    const btnW = S * 0.45, btnH = 48;
    UI.btnNext.x = cx - btnW / 2; UI.btnNext.y = top + 140; UI.btnNext.w = btnW; UI.btnNext.h = btnH;
    const isFinal = tournamentComplete();
    drawButton(UI.btnNext, isFinal ? 'SEE RESULT' : 'NEXT BOARD', true, false);
    const btnW2 = S * 0.30, btnH2 = 38;
    UI.btnMenu.x = cx - btnW2 / 2; UI.btnMenu.y = top + 200; UI.btnMenu.w = btnW2; UI.btnMenu.h = btnH2;
    drawButton(UI.btnMenu, 'MAIN MENU', false, false);
  }
  function drawTournamentOver() {
    drawDim(0.88);
    const cx = S / 2;
    const top = S * 0.30;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const won = userBoards > aiBoards;
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillStyle = won ? C.green : C.queen;
    ctx.fillText(won ? 'YOU WON' : 'AI WON', cx, top);
    ctx.font = '800 32px Inter, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    if (mode === 'bo3') ctx.fillText(userBoards + ' – ' + aiBoards, cx, top + 48);
    else                ctx.fillText('Match Complete', cx, top + 48);
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillStyle = C.hud;
    ctx.fillText('Difficulty: ' + difficulty.toUpperCase(), cx, top + 88);
    const btnW = S * 0.40, btnH = 48;
    UI.btnMenu.x = cx - btnW / 2; UI.btnMenu.y = top + 140; UI.btnMenu.w = btnW; UI.btnMenu.h = btnH;
    drawButton(UI.btnMenu, 'MAIN MENU', true, false);
  }
  function drawTurnBanner(now) {
    if (scene !== 'thinking' || currentPlayer !== 'ai') return;
    // Subtle banner showing AI is thinking.
    const t = ((now / 600) % 1);
    const dots = '.'.repeat(1 + Math.floor(t * 3));
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = C.queen;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AI THINKING' + dots, S / 2, S / 2 + S * 0.20);
  }

  // ---------- LOOP ----------
  function loop(now) {
    const t = now || performance.now();
    if (scene === 'thinking' && t >= aiThinkAt) aiFire();
    if (scene === 'flying') {
      for (let i = 0; i < SUBSTEPS; i++) physicsStep();
    }
    drawBoard();
    if (scene !== 'menu' && scene !== 'tournament-over') {
      drawPieces();
      drawStriker();
      drawAim();
      drawFlashes(t);
      drawHUD();
      drawTurnBanner(t);
    }
    if (scene === 'menu')              drawMenu();
    else if (scene === 'board-over')   drawBoardOver();
    else if (scene === 'tournament-over') drawTournamentOver();
    requestAnimationFrame(loop);
  }

  // ---------- BOOT ----------
  setupPieces();      // initial render so menu sits over the board layout
  requestAnimationFrame(loop);
})();
