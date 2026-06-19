/* ============================================================
   Ludo · a Zamborin Game
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE ----------
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  // Canvas dimensions vary by mode. Desktop is square 760×760; mobile is
  // rectangular = viewport size, so we can use the tall portrait area below
  // the (square) board for a roomy stacked HUD instead of a cramped strip.
  let W, H;
  function computeCanvasDims() {
    if (MODE === 'mobile') {
      W = window.innerWidth;
      H = window.innerHeight;
    } else {
      W = 760;
      H = 760;
    }
  }
  computeCanvasDims();
  document.body.style.setProperty('--canvas-w', W + 'px');
  document.body.style.setProperty('--canvas-h', H + 'px');

  // ---------- CANVAS ----------
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

  // ---------- BOARD IMAGE ----------
  const boardImg = new Image();
  let boardReady = false;
  boardImg.onload = () => { boardReady = true; };
  boardImg.src = './ludo-board.svg';

  // ---------- LAYOUT ----------
  // Desktop: board ~86% of canvas, thin HUD strip below.
  // Mobile : board sized to leave generous vertical room for a stacked HUD
  // (turn pill / dice+roll / status, each on its own row).
  let BOARD_DRAW_W, BOARD_DRAW_H, BOARD_X, BOARD_Y, HUD_Y, HUD_H;
  function computeLayout() {
    if (MODE === 'mobile') {
      const sidePad = 12;
      const topPad = 16;
      // Cap board at 55% of the viewport height so we always have ~45% left
      // for a comfortable HUD column.
      const edge = Math.min(W - sidePad * 2, Math.floor(H * 0.55));
      BOARD_DRAW_W = edge;
      BOARD_DRAW_H = edge;
      BOARD_X = (W - edge) / 2;
      BOARD_Y = topPad;
      HUD_Y = BOARD_Y + edge + 24;
      HUD_H = H - HUD_Y - 18;
    } else {
      const FRAC = 0.86;
      BOARD_DRAW_W = Math.floor(W * FRAC);
      BOARD_DRAW_H = BOARD_DRAW_W;
      BOARD_X = (W - BOARD_DRAW_W) / 2;
      BOARD_Y = 16;
      HUD_Y = BOARD_Y + BOARD_DRAW_H + 12;
      HUD_H = H - HUD_Y - 8;
    }
  }
  computeLayout();

  const SVG_VB = 970;
  function svg(x, y) {
    const k = BOARD_DRAW_W / SVG_VB;
    return { x: BOARD_X + x * k, y: BOARD_Y + y * k };
  }
  function tokenR() { return (BOARD_DRAW_W / SVG_VB) * 22; }

  // ---------- PALETTE ----------
  const C = {
    bg:        '#0E1726',
    text:      '#FFFFFF',
    textDim:   '#C5CFE0',
    textMute:  '#8E9CB5',
    accent:    '#D8523F',
    dieFace:   '#FFFFFF',
    dieFace2:  '#F1F3F8',
    dieDot:    '#1a1f2e',
    dieDim:    '#9CA3AF',
  };
  const PLAYERS = {
    red:    { fill: '#ed1c24', glow: '#FF6B5C', name: 'Red'    },
    yellow: { fill: '#fff200', glow: '#FFE38A', name: 'Yellow' },
    green:  { fill: '#39b54a', glow: '#8AECB7', name: 'Green'  },
    blue:   { fill: '#00aeef', glow: '#7DD8FF', name: 'Blue'   },
  };

  // ---------- GEOMETRY ----------
  const PATH_LEN = 52;
  const PATH = [
    [106.33, 422.03], [169.22, 422.03], [232.11, 422.03], [295.00, 422.03], [357.89, 422.03],
    [422.12, 357.89], [422.12, 295.00], [422.12, 232.11], [422.12, 169.22], [422.12, 106.33], [422.12, 43.44],
    [485.08, 43.44], [548.05, 43.44],
    [548.05, 106.33], [548.05, 169.22], [548.05, 232.11], [548.05, 295.00], [548.05, 357.89],
    [612.11, 422.03], [675.00, 422.03], [737.89, 422.03], [800.78, 422.03], [863.66, 422.03], [926.55, 422.03],
    [926.55, 485.01], [926.55, 547.97],
    [863.66, 547.97], [800.78, 547.97], [737.89, 547.97], [675.00, 547.97], [612.11, 547.97],
    [548.05, 612.11], [548.05, 675.00], [548.05, 737.89], [548.05, 800.78], [548.05, 863.66], [548.05, 926.55],
    [485.08, 926.55], [422.12, 926.55],
    [422.12, 863.66], [422.12, 800.78], [422.12, 737.89], [422.12, 675.00], [422.12, 612.11],
    [357.89, 547.97], [295.00, 547.97], [232.11, 547.97], [169.22, 547.97], [106.33, 547.97], [43.44, 547.97],
    [43.44, 485.01], [43.44, 422.03],
  ];
  const START_INDEX = { green: 0, yellow: 13, blue: 26, red: 39 };
  const SAFE_INDICES = new Set([0, 9, 13, 22, 26, 35, 39, 48]);
  const HOME_COL = {
    green:  [[106.33, 485.01], [169.22, 485.01], [232.11, 485.01], [295.00, 485.01], [357.89, 485.01]],
    yellow: [[485.08, 106.33], [485.08, 169.22], [485.08, 232.11], [485.08, 295.00], [485.08, 357.89]],
    blue:   [[863.66, 485.01], [800.78, 485.01], [737.89, 485.01], [675.00, 485.01], [612.11, 485.01]],
    red:    [[485.08, 863.66], [485.08, 800.78], [485.08, 737.89], [485.08, 675.00], [485.08, 612.11]],
  };
  const CENTRE = [485.01, 485.01];
  const BASE_SLOTS = {
    green:  [[130.87, 131.82], [269.56, 131.82], [130.87, 269.65], [269.56, 269.65]],
    yellow: [[699.04, 131.80], [837.74, 131.80], [699.04, 269.64], [837.74, 269.64]],
    blue:   [[699.04, 699.94], [837.74, 699.94], [699.04, 837.77], [837.74, 837.77]],
    red:    [[130.87, 699.95], [269.56, 699.95], [130.87, 837.79], [269.56, 837.79]],
  };

  // ---------- AUDIO ----------
  // Lazy-init on first user gesture (browser autoplay policy).
  let audioCtx = null;
  let soundOn = localStorage.getItem('zamborin-ludo.sound') !== '0';
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { audioCtx = null; }
  }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('zamborin-ludo.sound', on ? '1' : '0'); } catch (_) {}
  }
  function tone(freq, dur, gain, type) {
    if (!soundOn || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  function noiseBurst(dur, freq, q, gain) {
    if (!soundOn || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - (i / data.length);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = audioCtx.createGain();
    g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(audioCtx.destination);
    src.start(t0);
  }
  // Wooden clack — damped low-frequency sine + a 5ms low-passed noise attack.
  // Combined, this reads as "wood on wood" rather than "ceramic on ceramic"
  // because the body is a soft sine pulse rather than band-passed noise.
  function woodClack(freq, dur, gain) {
    if (!soundOn || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    // Body: damped sine.
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    // Tiny low-passed noise burst as the percussive attack — barely audible
    // on its own, but adds a wooden "tk" to the front of the sine pulse.
    const len = Math.max(1, Math.floor(audioCtx.sampleRate * 0.005));
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = freq * 4;
    const ng = audioCtx.createGain();
    ng.gain.value = gain * 0.30;
    src.connect(filt); filt.connect(ng); ng.connect(audioCtx.destination);
    src.start(t0);
  }
  function sfxDiceShake() {
    // Five wooden clacks at slightly random pitches across the 720ms tumble.
    // Lower frequencies + sine body = hollow "rolling in a box" character.
    // Gains bumped again ~40% — clearly audible without overpowering the room.
    woodClack(220, 0.10, 0.16);
    setTimeout(() => woodClack(180, 0.10, 0.13), 100);
    setTimeout(() => woodClack(240, 0.10, 0.14), 220);
    setTimeout(() => woodClack(195, 0.10, 0.12), 340);
    setTimeout(() => woodClack(215, 0.10, 0.10), 470);
  }
  function sfxDiceLand() {
    // Two solid wooden thunks for the final settle — like the cubes coming
    // to rest against each other and then the box floor.
    woodClack(150, 0.22, 0.24);
    setTimeout(() => woodClack(115, 0.28, 0.18), 60);
  }
  // Soft flat per-square move sound — barely-there low sine pulse, very short,
  // so a six-step move sounds like a soft "tk · tk · tk · tk · tk · tk".
  function sfxStep()    { tone(280, 0.04, 0.025, 'sine'); }
  function sfxUnlock()  { tone(660, 0.10, 0.06,  'triangle'); setTimeout(() => tone(880, 0.10, 0.06, 'triangle'), 70); }
  function sfxFinish()  { tone(784, 0.12, 0.07, 'triangle'); setTimeout(() => tone(1047, 0.16, 0.07, 'triangle'), 90); }
  function sfxCapture() {
    noiseBurst(0.10, 240, 1.5, 0.3);
    setTimeout(() => tone(180, 0.18, 0.10, 'square'), 30);
  }
  function sfxWin() {
    tone(523, 0.13, 0.08, 'triangle');
    setTimeout(() => tone(659, 0.13, 0.08, 'triangle'),  90);
    setTimeout(() => tone(784, 0.13, 0.08, 'triangle'), 180);
    setTimeout(() => tone(1047, 0.22, 0.10,'triangle'), 280);
  }

  // ---------- GAME CONFIG ----------
  // The HUMAN always plays RED (bottom-left, closest to the player on a phone
  // held in either hand). The other 1, 2, or 3 colours are AI. Turn order
  // follows the perimeter cycle starting from red, so the player always rolls
  // first: red → green → yellow → blue → red.
  // 2P uses diagonal opposites for fairness (red + yellow); 3P drops blue.
  const HUMAN = 'red';
  const TURN_ORDER_BY_COUNT = {
    2: ['red', 'yellow'],
    3: ['red', 'green', 'yellow'],
    4: ['red', 'green', 'yellow', 'blue'],
  };
  let playerCount = 4;
  let turnOrder = TURN_ORDER_BY_COUNT[4];
  let isAI = {};

  function setPlayerCount(n) {
    playerCount = n;
    turnOrder = TURN_ORDER_BY_COUNT[n];
    isAI = {};
    for (const p of turnOrder) isAI[p] = (p !== HUMAN);
  }

  // ---------- TOKEN STATE ----------
  function freshTokens() {
    const arr = [];
    for (const player of turnOrder) {
      for (let i = 0; i < 4; i++) {
        arr.push({ player, slotIdx: i, status: 'base', boardIdx: -1, homeIdx: -1 });
      }
    }
    return arr;
  }
  let tokens = [];
  function playerTokens(p) { return tokens.filter(t => t.player === p); }
  function allFinished(p)  { return playerTokens(p).every(t => t.status === 'finished'); }

  // ---------- GAME STATE ----------
  let scene = 'menu';                   // 'menu' | 'rolling' | 'choosing' | 'gameOver'
  let activePlayerIdx = 0;
  let dice = [null, null];
  let diceUsed = [false, false];
  let selectedDie = -1;
  let consecutiveDoubles = 0;
  let rollAnim = null;
  let winner = null;
  let captureFlash = null;
  let lastMoveMsg = '';
  let capturedThisRoll = false;
  // AI scheduling — milliseconds-of-time when the next AI action fires.
  let aiActionAt = 0;
  // Monotonically bumped each turn. setTimeout-deferred endTurn calls capture
  // the seq at schedule time and bail when they fire on a different turn —
  // prevents a stale "no legal moves" timer from advancing the player a second
  // time after the AI has already passed via aiMakeOneMove.
  let turnSeq = 0;
  // Move animation — when set, the engine is in the middle of sliding a token
  // through its waypoints. Input is blocked, dice/turn flow paused.
  let animation = null;

  function activePlayer() { return turnOrder[activePlayerIdx]; }

  // ---------- LEGAL MOVES ----------
  function previewMove(token, dieValue) {
    if (token.status === 'finished') return null;
    if (token.status === 'base') {
      // House rule: a piece only leaves base when BOTH dice are 6. The
      // unlocking consumes one die-of-6; the other 6 is then free to either
      // unlock a second piece or advance one already on the board.
      if (dieValue !== 6) return null;
      if (dice[0] !== 6 || dice[1] !== 6) return null;
      return { kind: 'board', idx: START_INDEX[token.player] };
    }
    if (token.status === 'board') {
      const startIdx = START_INDEX[token.player];
      const boardSteps = (token.boardIdx - startIdx + PATH_LEN) % PATH_LEN;
      const total = boardSteps + dieValue;
      if (total <= 50) return { kind: 'board', idx: (token.boardIdx + dieValue) % PATH_LEN };
      if (total <= 55) return { kind: 'home', idx: total - 51 };
      if (total === 56) return { kind: 'finished' };
      return null;
    }
    if (token.status === 'home') {
      const newIdx = token.homeIdx + dieValue;
      if (newIdx < 5)  return { kind: 'home', idx: newIdx };
      if (newIdx === 5) return { kind: 'finished' };
      return null;
    }
    return null;
  }
  function hasAnyLegalMove(dieValue) {
    for (const t of playerTokens(activePlayer())) {
      if (previewMove(t, dieValue)) return true;
    }
    return false;
  }
  function diesUsableMap() {
    const out = [false, false];
    for (let i = 0; i < 2; i++) {
      if (!diceUsed[i] && dice[i] != null && hasAnyLegalMove(dice[i])) out[i] = true;
    }
    return out;
  }

  // ---------- MOVE EXECUTION ----------
  // computePath builds the sequence of SVG-coord waypoints the token visits as
  // it travels its dieValue steps. The animator slides through them in order;
  // arrival at each waypoint triggers a soft step sound.
  function computePath(token, dieValue) {
    const wps = [];
    if (token.status === 'base') {
      const slot = BASE_SLOTS[token.player][token.slotIdx];
      const startCell = PATH[START_INDEX[token.player]];
      wps.push({ x: slot[0],     y: slot[1] });
      wps.push({ x: startCell[0], y: startCell[1] });
      return wps;
    }
    if (token.status === 'board') {
      const startIdx = START_INDEX[token.player];
      let curBoardIdx = token.boardIdx;
      let inHome = false;
      let curHomeIdx = -1;
      wps.push({ x: PATH[curBoardIdx][0], y: PATH[curBoardIdx][1] });
      for (let s = 1; s <= dieValue; s++) {
        if (!inHome) {
          const boardSteps = (curBoardIdx - startIdx + PATH_LEN) % PATH_LEN;
          if (boardSteps + 1 <= 50) {
            curBoardIdx = (curBoardIdx + 1) % PATH_LEN;
            wps.push({ x: PATH[curBoardIdx][0], y: PATH[curBoardIdx][1] });
          } else if (boardSteps + 1 === 51) {
            inHome = true;
            curHomeIdx = 0;
            const hc = HOME_COL[token.player][0];
            wps.push({ x: hc[0], y: hc[1] });
          }
        } else {
          if (curHomeIdx + 1 < 5) {
            curHomeIdx++;
            const hc = HOME_COL[token.player][curHomeIdx];
            wps.push({ x: hc[0], y: hc[1] });
          } else if (curHomeIdx + 1 === 5) {
            wps.push({ x: CENTRE[0], y: CENTRE[1] });
          }
        }
      }
      return wps;
    }
    if (token.status === 'home') {
      let curHomeIdx = token.homeIdx;
      const startHC = HOME_COL[token.player][curHomeIdx];
      wps.push({ x: startHC[0], y: startHC[1] });
      for (let s = 1; s <= dieValue; s++) {
        if (curHomeIdx + 1 < 5) {
          curHomeIdx++;
          const hc = HOME_COL[token.player][curHomeIdx];
          wps.push({ x: hc[0], y: hc[1] });
        } else if (curHomeIdx + 1 === 5) {
          wps.push({ x: CENTRE[0], y: CENTRE[1] });
        }
      }
      return wps;
    }
    return wps;
  }

  function startMoveAnimation(token, dest, dieValue, onComplete) {
    const waypoints = computePath(token, dieValue);
    if (waypoints.length < 2) { onComplete(); return; }
    // Unlock chime fires once at the start, in addition to the step sounds.
    if (token.status === 'base') sfxUnlock();
    animation = {
      token,
      waypoints,
      startTime: performance.now(),
      stepDuration: 220,  // slower so each square is clearly visible
      lastStepPlayed: 0,
      onComplete,
    };
  }

  function tickAnimation(now) {
    if (!animation) return;
    const elapsed = now - animation.startTime;
    const stepDur = animation.stepDuration;
    const totalSteps = animation.waypoints.length - 1;
    const reachedStep = Math.min(totalSteps, Math.floor(elapsed / stepDur));
    while (animation.lastStepPlayed < reachedStep) {
      animation.lastStepPlayed++;
      sfxStep();
    }
    if (animation.lastStepPlayed >= totalSteps) {
      const cb = animation.onComplete;
      animation = null;
      cb();
    }
  }

  function animationPos() {
    if (!animation) return null;
    const elapsed = performance.now() - animation.startTime;
    const stepDur = animation.stepDuration;
    const totalSteps = animation.waypoints.length - 1;
    const fractional = elapsed / stepDur;
    if (fractional >= totalSteps) {
      const wp = animation.waypoints[totalSteps];
      return { x: wp.x, y: wp.y, frac: 1 };
    }
    const idx = Math.floor(fractional);
    const raw = fractional - idx;
    // Snap-step: spend the first 40% of each cell-step moving (with smooth-
    // step ease), then settle on the cell for the remaining 60%. Reads as a
    // distinct "land on each square" rather than a continuous slide.
    const moveT = Math.min(1, raw / 0.40);
    const t = moveT * moveT * (3 - 2 * moveT);
    const from = animation.waypoints[idx];
    const to   = animation.waypoints[Math.min(totalSteps, idx + 1)];
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, frac: t };
  }

  // finalizeMove applies the actual game-state mutations (status change,
  // capture, win check) once the animation has visually delivered the token.
  function finalizeMove(token, dest) {
    if (dest.kind === 'board') {
      token.status = 'board';
      token.boardIdx = dest.idx;
      token.homeIdx = -1;
      if (!SAFE_INDICES.has(dest.idx)) {
        for (const other of tokens) {
          if (other !== token && other.player !== token.player &&
              other.status === 'board' && other.boardIdx === dest.idx) {
            other.status = 'base';
            other.boardIdx = -1;
            other.homeIdx = -1;
            const cell = PATH[dest.idx];
            captureFlash = { svgX: cell[0], svgY: cell[1], t0: performance.now() };
            lastMoveMsg = PLAYERS[activePlayer()].name + ' captured a ' + PLAYERS[other.player].name + ' piece!';
            sfxCapture();
            capturedThisRoll = true;
          }
        }
      }
    } else if (dest.kind === 'home') {
      token.status = 'home';
      token.boardIdx = -1;
      token.homeIdx = dest.idx;
    } else if (dest.kind === 'finished') {
      token.status = 'finished';
      token.boardIdx = -1;
      token.homeIdx = -1;
      lastMoveMsg = PLAYERS[token.player].name + ' got a piece home!';
      sfxFinish();
    }
    if (allFinished(token.player)) {
      winner = token.player;
      scene = 'gameOver';
      sfxWin();
    }
  }

  // ---------- TURN FLOW ----------
  function startTurn() {
    scene = 'rolling';
    dice = [null, null];
    diceUsed = [false, false];
    selectedDie = -1;
    rollAnim = null;
    capturedThisRoll = false;
    aiActionAt = 0;
    turnSeq++;
  }
  function scheduleEndTurn(delay) {
    const seq = turnSeq;
    setTimeout(() => { if (seq === turnSeq) endTurn(); }, delay);
  }
  function performRoll() {
    if (scene !== 'rolling' || winner) return;
    ensureAudio();
    const v1 = 1 + Math.floor(Math.random() * 6);
    const v2 = 1 + Math.floor(Math.random() * 6);
    rollAnim = { t0: performance.now(), duration: 720, finalA: v1, finalB: v2 };
    capturedThisRoll = false;
    sfxDiceShake();
  }
  function commitRoll() {
    dice = [rollAnim.finalA, rollAnim.finalB];
    diceUsed = [false, false];
    selectedDie = -1;
    scene = 'choosing';
    rollAnim = null;
    sfxDiceLand();
    autoSelectIfForced();
    if (!diesUsableMap()[0] && !diesUsableMap()[1]) {
      lastMoveMsg = 'No legal moves — ' + PLAYERS[activePlayer()].name + ' passes.';
      scheduleEndTurn(900);
    } else {
      lastMoveMsg = '';
    }
  }
  function autoSelectIfForced() {
    const usable = diesUsableMap();
    if (usable[0] && !usable[1]) selectedDie = 0;
    else if (!usable[0] && usable[1]) selectedDie = 1;
    else selectedDie = -1;
  }
  function endTurn() {
    if (winner) return;
    // House rule: turns rotate one-per-player clockwise. The ONLY way to
    // earn another roll is a double-six (which also unlocks a base piece).
    // Captures and other doubles do NOT grant a bonus roll.
    const doubleSix = dice[0] === 6 && dice[1] === 6;
    if (doubleSix) {
      consecutiveDoubles++;
      if (consecutiveDoubles >= 3) {
        // Three double-sixes in a row forfeits the bonus and passes the turn.
        consecutiveDoubles = 0;
        advancePlayer();
        return;
      }
      scene = 'rolling';
      dice = [null, null];
      diceUsed = [false, false];
      selectedDie = -1;
      capturedThisRoll = false;
      aiActionAt = 0;
      return;
    }
    consecutiveDoubles = 0;
    advancePlayer();
  }
  function advancePlayer() {
    activePlayerIdx = (activePlayerIdx + 1) % turnOrder.length;
    startTurn();
  }

  // ---------- AI (placeholder — random legal moves) ----------
  // Real personalities (Aggressive / Sprinter / Defender) come in Phase 4.
  function aiTick(now) {
    if (winner || scene === 'menu' || scene === 'gameOver') return;
    if (animation) return;
    if (!isAI[activePlayer()]) return;

    if (scene === 'rolling' && !rollAnim) {
      if (aiActionAt === 0) aiActionAt = now + 650;
      else if (now >= aiActionAt) {
        aiActionAt = 0;
        performRoll();
      }
      return;
    }
    if (scene === 'choosing') {
      if (aiActionAt === 0) aiActionAt = now + 600;
      else if (now >= aiActionAt) {
        aiActionAt = 0;
        aiMakeOneMove();
      }
    }
  }
  function aiMakeOneMove() {
    const moves = [];
    for (let i = 0; i < 2; i++) {
      if (diceUsed[i]) continue;
      for (const t of playerTokens(activePlayer())) {
        const dest = previewMove(t, dice[i]);
        if (dest) moves.push({ token: t, dieIdx: i });
      }
    }
    if (moves.length === 0) { endTurn(); return; }
    const m = moves[Math.floor(Math.random() * moves.length)];
    selectedDie = m.dieIdx;
    handleTokenPick(m.token);
  }

  // ---------- INPUT ----------
  const ROLL_BTN  = { x: 0, y: 0, w: 0, h: 0 };
  const DIE_RECTS = [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }];
  const MENU_BTNS = [{ x: 0, y: 0, w: 0, h: 0, n: 2 }, { x: 0, y: 0, w: 0, h: 0, n: 3 }, { x: 0, y: 0, w: 0, h: 0, n: 4 }];
  const SOUND_BTN = { x: 0, y: 0, w: 0, h: 0 };

  function logical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      lx: ((clientX - rect.left) / rect.width)  * W,
      ly: ((clientY - rect.top)  / rect.height) * H,
    };
  }
  function inRect(r, lx, ly) { return r.w > 0 && lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudio();
    const { lx, ly } = logical(e.clientX, e.clientY);

    // Sound toggle is live in every scene — even mid-animation.
    if (inRect(SOUND_BTN, lx, ly)) {
      setSound(!soundOn);
      if (soundOn) tone(660, 0.06, 0.04, 'sine');
      return;
    }

    if (scene === 'menu') {
      for (const b of MENU_BTNS) {
        if (inRect(b, lx, ly)) { startGame(b.n); return; }
      }
      return;
    }
    if (scene === 'gameOver') {
      scene = 'menu';
      return;
    }

    // Block board / dice input while a piece is animating between squares.
    if (animation) return;

    if (!isAI[activePlayer()]) {
      if (scene === 'rolling') {
        if (!rollAnim && inRect(ROLL_BTN, lx, ly)) performRoll();
        return;
      }
      if (scene === 'choosing') {
        const usable = diesUsableMap();
        for (let i = 0; i < 2; i++) {
          if (inRect(DIE_RECTS[i], lx, ly) && usable[i]) {
            selectedDie = i;
            return;
          }
        }
        const hitToken = findTokenAt(lx, ly);
        if (!hitToken || hitToken.player !== activePlayer()) return;
        handleTokenPick(hitToken);
      }
    }
  });

  function findTokenAt(lx, ly) {
    const r = tokenR() * 1.10;
    for (const t of tokens) {
      const anchor = tokenAnchor(t);
      const pos = svg(anchor.x, anchor.y);
      const dx = lx - pos.x, dy = ly - pos.y;
      if (dx * dx + dy * dy <= r * r) return t;
    }
    return null;
  }

  function handleTokenPick(token) {
    let dieIdx = selectedDie;
    if (dieIdx === -1) {
      const legal = [];
      for (let i = 0; i < 2; i++) {
        if (!diceUsed[i] && previewMove(token, dice[i])) legal.push(i);
      }
      if (legal.length === 0) return;
      if (legal.length === 1) dieIdx = legal[0];
      else dieIdx = dice[legal[0]] >= dice[legal[1]] ? legal[0] : legal[1];
    } else {
      if (diceUsed[dieIdx]) return;
      if (!previewMove(token, dice[dieIdx])) return;
    }
    const dieValue = dice[dieIdx];
    const dest = previewMove(token, dieValue);
    if (!dest) return;
    diceUsed[dieIdx] = true;
    selectedDie = -1;
    startMoveAnimation(token, dest, dieValue, () => {
      finalizeMove(token, dest);
      if (winner) return;
      if (diceUsed[0] && diceUsed[1]) { endTurn(); return; }
      autoSelectIfForced();
      const usable = diesUsableMap();
      if (!usable[0] && !usable[1]) {
        lastMoveMsg = 'No move with remaining die — turn ends.';
        scheduleEndTurn(700);
      }
    });
  }

  // ---------- LIFECYCLE ----------
  function startGame(n) {
    setPlayerCount(n);
    tokens = freshTokens();
    activePlayerIdx = 0;
    winner = null;
    consecutiveDoubles = 0;
    lastMoveMsg = '';
    captureFlash = null;
    aiActionAt = 0;
    startTurn();
  }

  // ---------- RENDER ----------
  function tokenAnchor(t) {
    if (t.status === 'base') {
      const slot = BASE_SLOTS[t.player][t.slotIdx];
      return { x: slot[0], y: slot[1] };
    }
    if (t.status === 'board') {
      const cell = PATH[t.boardIdx];
      return { x: cell[0], y: cell[1] };
    }
    if (t.status === 'home') {
      const cell = HOME_COL[t.player][t.homeIdx];
      return { x: cell[0], y: cell[1] };
    }
    return { x: CENTRE[0], y: CENTRE[1] };
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawEmptyBaseWells() {
    const animatingToken = animation ? animation.token : null;
    for (const player of Object.keys(BASE_SLOTS)) {
      const inGame = turnOrder.indexOf(player) !== -1;
      for (let s = 0; s < 4; s++) {
        // Treat the animating token's slot as empty even though its .status
        // is still 'base' — visually the piece has already left the well.
        const occupied = inGame && tokens.some(t =>
          t.player === player && t.slotIdx === s && t.status === 'base' && t !== animatingToken
        );
        if (occupied) continue;
        const slot = BASE_SLOTS[player][s];
        const pos = svg(slot[0], slot[1]);
        ctx.save();
        // Dim wells for empty slots; further darken slots of inactive players
        // (so the player count is unambiguous on the board).
        ctx.fillStyle = inGame ? 'rgba(0, 0, 0, 0.30)' : 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tokenR() * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawTokens(now) {
    const animatingToken = animation ? animation.token : null;
    const movableSet = new Set();
    if (scene === 'choosing' && !winner && !isAI[activePlayer()] && !animation) {
      for (const t of playerTokens(activePlayer())) {
        for (let i = 0; i < 2; i++) {
          if (!diceUsed[i] && previewMove(t, dice[i])) { movableSet.add(t); break; }
        }
      }
    }
    const pulse = 0.6 + 0.4 * Math.sin(now / 320);

    // Group every non-animating token by its anchor cell so stacked tokens
    // splay slightly instead of overlapping.
    const groups = new Map();
    for (const t of tokens) {
      if (t === animatingToken) continue;
      const a = tokenAnchor(t);
      const k = Math.round(a.x) + '_' + Math.round(a.y);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const stack of groups.values()) {
      stack.forEach((t, i) => {
        const a = tokenAnchor(t);
        const pos = svg(a.x, a.y);
        let dx = 0, dy = 0;
        if (stack.length > 1) {
          const ang = (i / stack.length) * Math.PI * 2;
          dx = Math.cos(ang) * tokenR() * 0.30;
          dy = Math.sin(ang) * tokenR() * 0.30;
        }
        drawTokenAt(pos.x + dx, pos.y + dy, t.player, movableSet.has(t) ? pulse : 0);
      });
    }

    // The animating token rides on top, interpolated between waypoints with
    // a small arc-lift per step so each hop reads as a discrete jump.
    if (animatingToken) {
      const ap = animationPos();
      const canvasPos = svg(ap.x, ap.y);
      // Tiny lift during the move portion of each step — subtle, so the
      // settle-on-cell beat dominates rather than a big jumping arc.
      const lift = Math.sin(ap.frac * Math.PI) * tokenR() * 0.18;
      drawTokenAt(canvasPos.x, canvasPos.y - lift, animatingToken.player, 0);
    }
  }

  function drawTokenAt(cx, cy, player, highlightPulse) {
    const p = PLAYERS[player];
    const r = tokenR();
    ctx.save();
    if (highlightPulse > 0) {
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 12 + 14 * highlightPulse;
    } else {
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = 6;
    }
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.30, cy - r * 0.30, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.40)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawCaptureFlash(now) {
    if (!captureFlash) return;
    const dt = now - captureFlash.t0;
    if (dt > 700) { captureFlash = null; return; }
    const t = dt / 700;
    const pos = svg(captureFlash.svgX, captureFlash.svgY);
    const r = tokenR() * (1 + t * 1.5);
    ctx.save();
    ctx.strokeStyle = '#ff3344';
    ctx.lineWidth = 4 * (1 - t);
    ctx.globalAlpha = 1 - t;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- DICE ----------
  function drawDie(x, y, size, value, opts) {
    const dim = opts && opts.dim;
    const selected = opts && opts.selected;
    const usable = opts && opts.usable;

    // Outer drop shadow for tactile depth.
    ctx.save();
    if (!dim) {
      ctx.shadowColor = selected ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.45)';
      ctx.shadowBlur  = selected ? 14 : 8;
      ctx.shadowOffsetY = selected ? 0 : 3;
    }
    // Gradient face — subtle top-to-bottom highlight for a "real cube" look.
    const grad = ctx.createLinearGradient(x, y, x, y + size);
    if (dim) {
      grad.addColorStop(0, '#D9DDE6');
      grad.addColorStop(1, '#BFC4D0');
    } else {
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(1, C.dieFace2);
    }
    ctx.fillStyle = grad;
    roundRect(x, y, size, size, size * 0.18);
    ctx.fill();
    ctx.restore();

    // Subtle inner border for crispness.
    ctx.strokeStyle = selected ? '#FFFFFF' : (usable ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.18)');
    ctx.lineWidth = selected ? 3 : 1.5;
    roundRect(x, y, size, size, size * 0.18);
    ctx.stroke();

    // Inner highlight stroke for glassy edge.
    if (!dim) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      roundRect(x + 2, y + 2, size - 4, size - 4, size * 0.16);
      ctx.stroke();
    }

    // Dots — smaller (0.108 of side) and spread further apart (0.30) so the
    // six-face never has dots touching each other.
    const dotR = size * 0.108;
    const off  = size * 0.30;
    const cx = x + size / 2, cy = y + size / 2;
    const pat = {
      1: [[0, 0]],
      2: [[-off, -off], [off, off]],
      3: [[-off, -off], [0, 0], [off, off]],
      4: [[-off, -off], [off, -off], [-off, off], [off, off]],
      5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
      6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
    };
    const dots = pat[value] || [];
    ctx.fillStyle = dim ? C.dieDim : C.dieDot;
    for (const [dx, dy] of dots) {
      // Each dot gets a tiny shadow for inset-pip look.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.20)';
      ctx.shadowBlur = 1.5;
      ctx.shadowOffsetY = 0.6;
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // HUD layout — on mobile we stack vertically inside the tall HUD area
  // (turn pill / dice+roll / status). On desktop everything fits a single row.
  function hudRows() {
    if (MODE === 'mobile') {
      const turnY = HUD_Y + 24;
      const diceY = HUD_Y + 90;
      const statusY = HUD_Y + 174;
      return { turnY, diceY, statusY };
    }
    const midY = HUD_Y + HUD_H / 2;
    return { turnY: midY, diceY: midY, statusY: midY };
  }

  function drawRollButton(active) {
    const w = MODE === 'mobile' ? Math.min(260, W * 0.55) : Math.min(220, W * 0.32);
    const h = MODE === 'mobile' ? 56 : Math.min(56, HUD_H * 0.62);
    const rows = hudRows();
    const x = W / 2 - w / 2;
    const y = MODE === 'mobile' ? (rows.diceY - h / 2) : (HUD_Y + (HUD_H - h) / 2);
    ROLL_BTN.x = x; ROLL_BTN.y = y; ROLL_BTN.w = w; ROLL_BTN.h = h;
    ctx.save();
    ctx.fillStyle = active ? C.accent : '#5a5a66';
    ctx.shadowColor = active ? '#FF6B5C' : 'transparent';
    ctx.shadowBlur = active ? 14 : 0;
    roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rollAnim ? 'ROLLING…' : 'ROLL DICE', x + w / 2, y + h / 2 + 1);
  }

  function drawDiceHUD(now) {
    const rows = hudRows();
    const dieSize = MODE === 'mobile' ? 60 : Math.min(56, HUD_H * 0.62);
    const gap = MODE === 'mobile' ? 22 : 14;
    const totalW = dieSize * 2 + gap;
    const baseX = W / 2 - totalW / 2;
    const baseY = MODE === 'mobile' ? (rows.diceY - dieSize / 2) : (HUD_Y + (HUD_H - dieSize) / 2);

    let v1 = dice[0];
    let v2 = dice[1];
    if (rollAnim) {
      const dt = now - rollAnim.t0;
      const settled = dt >= rollAnim.duration;
      v1 = settled ? rollAnim.finalA : 1 + Math.floor(((now / 55) | 0) % 6);
      v2 = settled ? rollAnim.finalB : 1 + Math.floor(((now / 65 + 3) | 0) % 6);
      if (settled) commitRoll();
    }

    const usable = diesUsableMap();
    const humanTurn = !isAI[activePlayer()];

    if (scene === 'rolling' && !rollAnim && humanTurn) {
      drawRollButton(true);
      return;
    }

    for (let i = 0; i < 2; i++) {
      const x = baseX + i * (dieSize + gap);
      const y = baseY;
      DIE_RECTS[i].x = x; DIE_RECTS[i].y = y; DIE_RECTS[i].w = dieSize; DIE_RECTS[i].h = dieSize;
      const val = i === 0 ? v1 : v2;
      const isUsed = diceUsed[i];
      drawDie(x, y, dieSize, val || 1, {
        dim: isUsed,
        selected: humanTurn && !isUsed && selectedDie === i,
        usable: humanTurn && !isUsed && usable[i],
      });
    }
  }

  function drawTurnIndicator() {
    const player = activePlayer();
    const color = PLAYERS[player].fill;
    const rows = hudRows();
    ctx.font = MODE === 'mobile' ? '900 18px Inter, sans-serif' : '800 14px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = MODE === 'mobile' ? 'center' : 'left';
    const aiTag = isAI[player] ? ' (AI)' : '';
    const label = winner ? PLAYERS[winner].name.toUpperCase() + ' WINS' : PLAYERS[player].name.toUpperCase() + aiTag + ' TO MOVE';
    const padX = MODE === 'mobile' ? 22 : 14;
    const w = ctx.measureText(label).width + padX * 2;
    const h = MODE === 'mobile' ? 44 : 32;
    const x = MODE === 'mobile' ? (W / 2 - w / 2) : 16;
    const y = MODE === 'mobile' ? (rows.turnY - h / 2) : (HUD_Y + (HUD_H - h) / 2);
    ctx.save();
    ctx.fillStyle = winner ? PLAYERS[winner].fill : color;
    roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    const labelPlayer = winner ? winner : player;
    ctx.fillStyle = labelPlayer === 'yellow' ? '#1a1a1a' : '#FFFFFF';
    const textX = MODE === 'mobile' ? (W / 2) : (x + padX);
    ctx.fillText(label, textX, y + h / 2 + 1);
  }

  function drawStatusLine() {
    if (!lastMoveMsg) return;
    const rows = hudRows();
    ctx.font = MODE === 'mobile' ? '600 13px Inter, sans-serif' : '500 12px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.textAlign = MODE === 'mobile' ? 'center' : 'right';
    ctx.textBaseline = 'middle';
    const tx = MODE === 'mobile' ? (W / 2) : (W - 16);
    const ty = MODE === 'mobile' ? rows.statusY : (HUD_Y + HUD_H / 2);
    ctx.fillText(lastMoveMsg, tx, ty);
  }

  function drawSoundButton() {
    const size = 22;
    const padding = 10;
    // Top-LEFT of canvas, well clear of the fullscreen close × at top-right.
    const bx = padding;
    const by = padding;
    SOUND_BTN.x = bx; SOUND_BTN.y = by; SOUND_BTN.w = size; SOUND_BTN.h = size;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundRect(bx, by, size, size, 5);
    ctx.fill();
    const cx = bx + size / 2;
    const cy = by + size / 2;
    ctx.fillStyle = soundOn ? C.text : C.textMute;
    ctx.strokeStyle = soundOn ? C.text : C.textMute;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 3);
    ctx.lineTo(cx - 3, cy - 3);
    ctx.lineTo(cx + 1, cy - 5);
    ctx.lineTo(cx + 1, cy + 5);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.lineTo(cx - 6, cy + 3);
    ctx.closePath();
    ctx.fill();
    if (soundOn) {
      ctx.beginPath(); ctx.arc(cx + 3, cy, 2.5, -Math.PI / 3, Math.PI / 3); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 3, cy, 5,   -Math.PI / 3, Math.PI / 3); ctx.stroke();
    } else {
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + size - 4);
      ctx.lineTo(bx + size - 4, by + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWinnerOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(14, 23, 38, 0.84)';
    ctx.fillRect(BOARD_X, BOARD_Y, BOARD_DRAW_W, BOARD_DRAW_H);
    ctx.restore();
    const cx = BOARD_X + BOARD_DRAW_W / 2;
    const cy = BOARD_Y + BOARD_DRAW_H / 2;
    ctx.fillStyle = PLAYERS[winner].fill;
    ctx.font = '900 56px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PLAYERS[winner].name.toUpperCase() + ' WINS', cx, cy - 24);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 16px Inter, sans-serif';
    ctx.fillText('Tap anywhere to return to menu', cx, cy + 28);
  }

  // ---------- MENU ----------
  function drawMenu(now) {
    // Dim the canvas slightly so the menu pops.
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    if (boardReady) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.drawImage(boardImg, BOARD_X, BOARD_Y, BOARD_DRAW_W, BOARD_DRAW_H);
      ctx.restore();
    }
    // Title
    const cx = W / 2;
    const yTitle = H * 0.30;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LUDO', cx, yTitle - 18);
    ctx.fillStyle = C.textDim;
    ctx.font = '500 16px Inter, sans-serif';
    ctx.fillText('You play Red. Choose how many players today.', cx, yTitle + 18);

    // Three big square buttons in a row.
    const btnSize = Math.min(140, Math.min(W, H) * 0.20);
    const btnGap = 22;
    const totalW = btnSize * 3 + btnGap * 2;
    const startX = cx - totalW / 2;
    const btnY = H * 0.46;
    const pulse = 0.85 + 0.15 * Math.sin(now / 380);
    for (let i = 0; i < 3; i++) {
      const n = 2 + i;
      const x = startX + i * (btnSize + btnGap);
      MENU_BTNS[i].x = x; MENU_BTNS[i].y = btnY; MENU_BTNS[i].w = btnSize; MENU_BTNS[i].h = btnSize; MENU_BTNS[i].n = n;
      ctx.save();
      ctx.shadowColor = '#FF6B5C';
      ctx.shadowBlur = 16 * pulse;
      ctx.fillStyle = C.accent;
      roundRect(x, btnY, btnSize, btnSize, 20);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 64px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), x + btnSize / 2, btnY + btnSize / 2 - 8);
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText('PLAYERS', x + btnSize / 2, btnY + btnSize / 2 + 30);
    }

    // Small previewing labels under the buttons telling which colours play.
    const labels = ['You + 1 AI', 'You + 2 AIs', 'You + 3 AIs'];
    ctx.fillStyle = C.textMute;
    ctx.font = '600 12px Inter, sans-serif';
    for (let i = 0; i < 3; i++) {
      const x = startX + i * (btnSize + btnGap) + btnSize / 2;
      ctx.fillText(labels[i], x, btnY + btnSize + 22);
    }
  }

  // ---------- LOOP ----------
  function loop(now) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    if (scene === 'menu') {
      drawMenu(now);
      drawSoundButton();
      requestAnimationFrame(loop);
      return;
    }

    if (boardReady) {
      ctx.drawImage(boardImg, BOARD_X, BOARD_Y, BOARD_DRAW_W, BOARD_DRAW_H);
      drawEmptyBaseWells();
      drawTokens(now);
      drawCaptureFlash(now);
    }
    drawTurnIndicator();
    drawDiceHUD(now);
    drawStatusLine();
    drawSoundButton();
    if (winner) drawWinnerOverlay();

    tickAnimation(now);
    aiTick(now);

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
