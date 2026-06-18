/* ============================================================
   Ludo · a Zamborin Game
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE ----------
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  function computeSize() {
    if (MODE === 'mobile') {
      const reserved = 30;
      return Math.min(window.innerHeight - reserved, window.innerWidth - reserved);
    }
    return 760;
  }
  const S = computeSize();
  document.body.style.setProperty('--canvas-w', S + 'px');
  document.body.style.setProperty('--canvas-h', S + 'px');

  // ---------- CANVAS ----------
  const canvas = document.getElementById('game');
  const ctx    = canvas.getContext('2d');
  canvas.setAttribute('width',  String(S));
  canvas.setAttribute('height', String(S));
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const display = rect.width || S;
    const backing = Math.round(display * dpr);
    if (canvas.width  !== backing) canvas.width  = backing;
    if (canvas.height !== backing) canvas.height = backing;
    const scale = backing / S;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---------- BOARD IMAGE ----------
  const boardImg = new Image();
  let boardReady = false;
  boardImg.onload = () => { boardReady = true; };
  boardImg.src = './ludo-board.svg';

  // ---------- BOARD DRAW REGION + SVG MAPPING ----------
  // The board image is drawn at 86% of canvas height (top-aligned-ish) leaving
  // a HUD strip at the bottom for dice, roll button, and turn indicator.
  const BOARD_FRAC = 0.86;
  const BOARD_DRAW_W = Math.floor(S * BOARD_FRAC);
  const BOARD_DRAW_H = BOARD_DRAW_W;
  const BOARD_X = (S - BOARD_DRAW_W) / 2;
  const BOARD_Y = 16;
  const HUD_Y = BOARD_Y + BOARD_DRAW_H + 12;
  const HUD_H = S - HUD_Y - 8;

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
    dieDot:    '#0E1726',
    dieDim:    '#9CA3AF',
    diceFrame: '#1F2D4A',
  };
  const PLAYERS = {
    red:    { fill: '#ed1c24', glow: '#FF6B5C', name: 'Red'    },
    yellow: { fill: '#fff200', glow: '#FFE38A', name: 'Yellow' },
    green:  { fill: '#39b54a', glow: '#8AECB7', name: 'Green'  },
    blue:   { fill: '#00aeef', glow: '#7DD8FF', name: 'Blue'   },
  };
  // Turn order — anti-clockwise around the board so adjacent corners alternate.
  const TURN_ORDER = ['green', 'yellow', 'blue', 'red'];

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

  // ---------- TOKEN STATE ----------
  function freshTokens() {
    const tokens = [];
    for (const player of TURN_ORDER) {
      for (let i = 0; i < 4; i++) {
        tokens.push({ player, slotIdx: i, status: 'base', boardIdx: -1, homeIdx: -1 });
      }
    }
    return tokens;
  }
  let tokens = freshTokens();
  function playerTokens(p) { return tokens.filter(t => t.player === p); }
  function allFinished(p)  { return playerTokens(p).every(t => t.status === 'finished'); }

  // ---------- GAME STATE ----------
  let scene = 'rolling';                // 'rolling' | 'choosing' | 'gameOver'
  let activePlayerIdx = 0;              // index into TURN_ORDER
  let dice = [null, null];
  let diceUsed = [false, false];
  let selectedDie = -1;                 // -1 | 0 | 1
  let consecutiveDoubles = 0;
  let rollAnim = null;                  // tumbling animation state
  let winner = null;
  let captureFlash = null;              // { svgX, svgY, t0 } — brief red ring at capture site
  let lastMoveMsg = '';                 // small-print status under the dice

  function activePlayer() { return TURN_ORDER[activePlayerIdx]; }

  // ---------- LEGAL MOVES ----------
  // Given a token and a die value, return the destination it would land on (or
  // null if illegal).  Destinations are tagged by where the token would end up.
  function previewMove(token, dieValue) {
    if (token.status === 'finished') return null;
    if (token.status === 'base') {
      if (dieValue === 6) return { kind: 'board', idx: START_INDEX[token.player] };
      return null;
    }
    if (token.status === 'board') {
      const startIdx = START_INDEX[token.player];
      const boardSteps = (token.boardIdx - startIdx + PATH_LEN) % PATH_LEN;
      const total = boardSteps + dieValue;
      if (total <= 50) {
        return { kind: 'board', idx: (token.boardIdx + dieValue) % PATH_LEN };
      }
      if (total <= 55) {
        return { kind: 'home', idx: total - 51 };
      }
      if (total === 56) {
        return { kind: 'finished' };
      }
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
  function executeMove(token, dest) {
    if (dest.kind === 'board') {
      token.status = 'board';
      token.boardIdx = dest.idx;
      token.homeIdx = -1;
      // Capture: any opponent on this cell (and not a safe cell) goes home.
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
            // Capturing grants an extra roll — handled at endTurn() via the
            // capturedThisRoll flag below.
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
    }
    // Win check.
    if (allFinished(token.player)) {
      winner = token.player;
      scene = 'gameOver';
    }
  }

  let capturedThisRoll = false;

  // ---------- TURN FLOW ----------
  function startTurn() {
    scene = 'rolling';
    dice = [null, null];
    diceUsed = [false, false];
    selectedDie = -1;
    rollAnim = null;
    capturedThisRoll = false;
  }

  function performRoll() {
    if (scene !== 'rolling' || winner) return;
    // Begin tumbling animation. Real values land at the end.
    const v1 = 1 + Math.floor(Math.random() * 6);
    const v2 = 1 + Math.floor(Math.random() * 6);
    rollAnim = { t0: performance.now(), duration: 650, finalA: v1, finalB: v2 };
    capturedThisRoll = false;
    // While the animation runs we keep scene = 'rolling'; on completion we
    // commit the values and transition to 'choosing'.
  }

  function commitRoll() {
    dice = [rollAnim.finalA, rollAnim.finalB];
    diceUsed = [false, false];
    selectedDie = -1;
    scene = 'choosing';
    rollAnim = null;
    autoSelectIfForced();
    // If no legal moves at all, hand off after a brief pause.
    if (!diesUsableMap()[0] && !diesUsableMap()[1]) {
      lastMoveMsg = 'No legal moves — ' + PLAYERS[activePlayer()].name + ' passes.';
      setTimeout(endTurn, 900);
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
    // 6 OR double OR capture grants an extra roll. Cap consecutive doubles at
    // 3 to prevent a stuck-spinning state.
    const wasDouble = dice[0] != null && dice[0] === dice[1];
    const rolledSix = dice[0] === 6 || dice[1] === 6;
    const extraRoll = !winner && (capturedThisRoll || wasDouble || rolledSix);

    if (extraRoll) {
      if (wasDouble) consecutiveDoubles++; else consecutiveDoubles = 0;
      if (consecutiveDoubles >= 3) {
        // Three doubles in a row → forfeit turn (classic Ludo penalty).
        consecutiveDoubles = 0;
        advancePlayer();
      } else {
        scene = 'rolling';
        dice = [null, null];
        diceUsed = [false, false];
        selectedDie = -1;
        capturedThisRoll = false;
        return;
      }
    } else {
      consecutiveDoubles = 0;
      advancePlayer();
    }
  }

  function advancePlayer() {
    activePlayerIdx = (activePlayerIdx + 1) % TURN_ORDER.length;
    startTurn();
  }

  // ---------- INPUT ----------
  const ROLL_BTN = { x: 0, y: 0, w: 0, h: 0 };
  const DIE_RECTS = [{ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 0, h: 0 }];

  function logical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      lx: ((clientX - rect.left) / rect.width)  * S,
      ly: ((clientY - rect.top)  / rect.height) * S,
    };
  }
  function inRect(r, lx, ly) { return r.w > 0 && lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const { lx, ly } = logical(e.clientX, e.clientY);

    if (winner) {
      // Tap anywhere on game-over screen → restart.
      restartGame();
      return;
    }

    if (scene === 'rolling') {
      if (!rollAnim && inRect(ROLL_BTN, lx, ly)) performRoll();
      return;
    }

    if (scene === 'choosing') {
      // Die selection
      const usable = diesUsableMap();
      for (let i = 0; i < 2; i++) {
        if (inRect(DIE_RECTS[i], lx, ly) && usable[i]) {
          selectedDie = i;
          return;
        }
      }
      // Token selection — must be active player's, must have a legal move.
      const hitToken = findTokenAt(lx, ly);
      if (!hitToken || hitToken.player !== activePlayer()) return;
      handleTokenPick(hitToken);
      return;
    }
  });

  function findTokenAt(lx, ly) {
    const r = tokenR() * 1.05;
    for (const t of tokens) {
      const anchor = tokenAnchor(t);
      const pos = svg(anchor.x, anchor.y);
      const dx = lx - pos.x, dy = ly - pos.y;
      if (dx * dx + dy * dy <= r * r) return t;
    }
    return null;
  }

  function handleTokenPick(token) {
    // Decide which die to use:
    //   • If a die is already selected → use it (if legal for this token)
    //   • Otherwise auto-pick: prefer a die that's the ONLY legal one for this
    //     token; if both are legal, default to the larger value
    let dieIdx = selectedDie;
    if (dieIdx === -1) {
      const legal = [];
      for (let i = 0; i < 2; i++) {
        if (!diceUsed[i] && previewMove(token, dice[i])) legal.push(i);
      }
      if (legal.length === 0) return;
      if (legal.length === 1) {
        dieIdx = legal[0];
      } else {
        dieIdx = dice[legal[0]] >= dice[legal[1]] ? legal[0] : legal[1];
      }
    } else {
      if (diceUsed[dieIdx]) return;
      const ok = previewMove(token, dice[dieIdx]);
      if (!ok) return;
    }
    const dest = previewMove(token, dice[dieIdx]);
    if (!dest) return;
    executeMove(token, dest);
    diceUsed[dieIdx] = true;
    selectedDie = -1;

    // After the move, either keep choosing (other die still has work) or end turn.
    if (diceUsed[0] && diceUsed[1]) {
      endTurn();
      return;
    }
    autoSelectIfForced();
    // If the remaining die has no legal moves, end turn.
    const usable = diesUsableMap();
    if (!usable[0] && !usable[1]) {
      lastMoveMsg = 'No move with remaining die — turn ends.';
      setTimeout(endTurn, 700);
    }
  }

  function restartGame() {
    tokens = freshTokens();
    activePlayerIdx = 0;
    winner = null;
    consecutiveDoubles = 0;
    lastMoveMsg = '';
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
    // When a token has left its base, its starting well is dimmed so it reads
    // as "already in play." A semi-transparent overlay does the job without
    // touching the SVG.
    for (const player of TURN_ORDER) {
      for (let s = 0; s < 4; s++) {
        const occupied = tokens.some(t =>
          t.player === player && t.slotIdx === s && t.status === 'base'
        );
        if (occupied) continue;
        const slot = BASE_SLOTS[player][s];
        const pos = svg(slot[0], slot[1]);
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, tokenR() * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawTokens(now) {
    // Highlight tokens that can move with the current dice.
    const movableSet = new Set();
    if (scene === 'choosing' && !winner) {
      const player = activePlayer();
      for (const t of playerTokens(player)) {
        for (let i = 0; i < 2; i++) {
          if (!diceUsed[i] && previewMove(t, dice[i])) { movableSet.add(t); break; }
        }
      }
    }
    const pulse = 0.6 + 0.4 * Math.sin(now / 320);

    // Group tokens that share a board cell so we can render them as a small
    // stack (offsetting overlapping tokens slightly).
    const groups = new Map();
    for (const t of tokens) {
      const a = tokenAnchor(t);
      const k = Math.round(a.x) + '_' + Math.round(a.y);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const stack of groups.values()) {
      stack.forEach((t, i) => {
        const a = tokenAnchor(t);
        const pos = svg(a.x, a.y);
        // Small symmetric offset for stacked tokens at the same cell.
        let dx = 0, dy = 0;
        if (stack.length > 1) {
          const ang = (i / stack.length) * Math.PI * 2;
          dx = Math.cos(ang) * tokenR() * 0.30;
          dy = Math.sin(ang) * tokenR() * 0.30;
        }
        drawTokenAt(pos.x + dx, pos.y + dy, t.player, movableSet.has(t) ? pulse : 0);
      });
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
    const r = size * 0.16;
    const dim = opts && opts.dim;
    const selected = opts && opts.selected;
    const usable = opts && opts.usable;

    ctx.save();
    // Body
    ctx.fillStyle = dim ? '#E5E7EB' : C.dieFace;
    ctx.shadowColor = selected ? '#FFFFFF' : 'rgba(0,0,0,0.40)';
    ctx.shadowBlur  = selected ? 16 : 6;
    ctx.shadowOffsetY = selected ? 0 : 3;
    roundRect(x, y, size, size, size * 0.18);
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = selected ? '#FFFFFF' : (usable ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0.25)');
    ctx.lineWidth = selected ? 3 : 1.5;
    roundRect(x, y, size, size, size * 0.18);
    ctx.stroke();

    // Dots
    const dotColor = dim ? C.dieDim : C.dieDot;
    ctx.fillStyle = dotColor;
    const cx = x + size / 2, cy = y + size / 2;
    const off = size * 0.26;
    const pat = {
      1: [[0, 0]],
      2: [[-off, -off], [off, off]],
      3: [[-off, -off], [0, 0], [off, off]],
      4: [[-off, -off], [off, -off], [-off, off], [off, off]],
      5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
      6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
    };
    const dots = pat[value] || [];
    for (const [dx, dy] of dots) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRollButton(active) {
    const w = Math.min(220, S * 0.32);
    const h = Math.min(56, HUD_H * 0.62);
    const x = S / 2 - w / 2;
    const y = HUD_Y + (HUD_H - h) / 2;
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
    // Dice are always rendered to the LEFT of (or in place of) the roll button,
    // so the player sees them throughout the turn.
    const dieSize = Math.min(56, HUD_H * 0.62);
    const gap = 14;
    const totalW = dieSize * 2 + gap;
    const baseX = S / 2 - totalW / 2;
    const baseY = HUD_Y + (HUD_H - dieSize) / 2;

    let v1 = dice[0];
    let v2 = dice[1];
    if (rollAnim) {
      // Tumble — show changing values during the animation, settle on the last frame.
      const dt = now - rollAnim.t0;
      const settled = dt >= rollAnim.duration;
      v1 = settled ? rollAnim.finalA : 1 + Math.floor(((now / 60) | 0) % 6);
      v2 = settled ? rollAnim.finalB : 1 + Math.floor(((now / 70 + 3) | 0) % 6);
      if (settled) commitRoll();
    }

    const usable = diesUsableMap();

    if (scene === 'rolling' && !rollAnim) {
      // Show roll button in the centre, hide the dice for now.
      drawRollButton(true);
      return;
    }

    // Draw dice
    for (let i = 0; i < 2; i++) {
      const x = baseX + i * (dieSize + gap);
      const y = baseY;
      DIE_RECTS[i].x = x; DIE_RECTS[i].y = y; DIE_RECTS[i].w = dieSize; DIE_RECTS[i].h = dieSize;
      const val = i === 0 ? v1 : v2;
      const isUsed = diceUsed[i];
      drawDie(x, y, dieSize, val || 1, {
        dim: isUsed,
        selected: !isUsed && selectedDie === i,
        usable: !isUsed && usable[i],
      });
    }
  }

  function drawTurnIndicator() {
    const player = activePlayer();
    const color = PLAYERS[player].fill;
    // Coloured pill at top-left of HUD strip.
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = winner ? PLAYERS[winner].name + ' WINS' : PLAYERS[player].name.toUpperCase() + ' TO MOVE';
    const padX = 14, padY = 8;
    const w = ctx.measureText(label).width + padX * 2;
    const h = 32;
    const x = 16;
    const y = HUD_Y + (HUD_H - h) / 2;
    ctx.save();
    ctx.fillStyle = winner ? PLAYERS[winner].fill : color;
    roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.restore();
    // Text — pick contrasting color (dark on yellow, white on others).
    ctx.fillStyle = (winner ? winner : player) === 'yellow' ? '#1a1a1a' : '#FFFFFF';
    ctx.fillText(label, x + padX, y + h / 2 + 1);
  }

  function drawStatusLine() {
    if (!lastMoveMsg) return;
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(lastMoveMsg, S - 16, HUD_Y + HUD_H / 2);
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
    ctx.fillText('Tap anywhere to play again', cx, cy + 28);
  }

  // ---------- LOOP ----------
  function loop(now) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, S, S);

    if (boardReady) {
      ctx.drawImage(boardImg, BOARD_X, BOARD_Y, BOARD_DRAW_W, BOARD_DRAW_H);
      drawEmptyBaseWells();
      drawTokens(now);
      drawCaptureFlash(now);
    }
    drawTurnIndicator();
    drawDiceHUD(now);
    drawStatusLine();
    if (winner) drawWinnerOverlay();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- INIT ----------
  startTurn();
})();
