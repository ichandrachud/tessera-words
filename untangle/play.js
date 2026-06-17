/* ============================================================
   Untangle · a Zamborin Game

   Drag the dots so no two edges cross. Each press-drag-release that
   actually moves a vertex counts as 1 move. Par = number of vertices
   the level generator perturbed when scrambling the planar layout.

   Endless level progression: tiers ramp from TUTORIAL (5 dots) up to
   MASTER (12 dots) and then keep generating progressively harder
   MASTER-tier puzzles forever. Highest level is saved locally.
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE DETECTION ----------
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  function buildMobileCFG() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const HUD_H        = 70;
    const BANNER_H     = 50;
    const BOTTOM_PAD   = 22;
    const HINT_AREA    = 36;
    const GRID_TOP_GAP = 8;
    const SIDE_PAD     = 12;
    document.body.style.setProperty('--canvas-w', vw + 'px');
    document.body.style.setProperty('--canvas-h', vh + 'px');
    return {
      W: vw, H: vh, HUD_H,
      PLAY_X: SIDE_PAD,
      PLAY_Y: HUD_H + GRID_TOP_GAP,
      PLAY_W: vw - SIDE_PAD * 2,
      PLAY_H: vh - HUD_H - GRID_TOP_GAP - HINT_AREA - BANNER_H - BOTTOM_PAD,
      VERTEX_R: 14,
      VERTEX_HIT: 28,
      BANNER_W: 320, BANNER_H,
      BANNER_Y: vh - BANNER_H - BOTTOM_PAD,
    };
  }
  const CFG = MODE === 'mobile' ? buildMobileCFG() : (() => {
    const W = 760, H = 600, HUD_H = 70;
    document.body.style.setProperty('--canvas-w', W + 'px');
    document.body.style.setProperty('--canvas-h', H + 'px');
    return {
      W, H, HUD_H,
      PLAY_X: 44,
      PLAY_Y: HUD_H + 8,
      PLAY_W: W - 88,
      PLAY_H: H - HUD_H - 8 - 36 - 8,
      VERTEX_R: 12,
      VERTEX_HIT: 22,
      BANNER_W: 0, BANNER_H: 0,
      BANNER_Y: H,
    };
  })();

  if (MODE === 'mobile') {
    let wasPortrait = window.innerHeight > window.innerWidth;
    window.addEventListener('resize', () => {
      const nowPortrait = window.innerHeight > window.innerWidth;
      if (wasPortrait !== nowPortrait) { wasPortrait = nowPortrait; location.reload(); }
    });
  }

  // ---------- CANVAS + SHARP-DPR ----------
  const canvas = document.getElementById('game');
  const ctx    = canvas.getContext('2d');
  const W = CFG.W, H = CFG.H;
  canvas.setAttribute('width', String(W));
  canvas.setAttribute('height', String(H));
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const backingW = Math.round(W * dpr);
    const backingH = Math.round(H * dpr);
    if (canvas.width !== backingW)  canvas.width  = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---------- GEOMETRY ----------
  const HUD_H     = CFG.HUD_H;
  const PLAY_X    = CFG.PLAY_X;
  const PLAY_Y    = CFG.PLAY_Y;
  const PLAY_W    = CFG.PLAY_W;
  const PLAY_H    = CFG.PLAY_H;
  const PLAY_CX   = PLAY_X + PLAY_W / 2;
  const PLAY_CY   = PLAY_Y + PLAY_H / 2;
  const VERTEX_R  = CFG.VERTEX_R;
  const VERTEX_HIT = CFG.VERTEX_HIT;
  const MARGIN    = VERTEX_R + 8;
  const BANNER_W  = CFG.BANNER_W;
  const BANNER_H  = CFG.BANNER_H;
  const BANNER_X  = Math.floor((W - BANNER_W) / 2);
  const BANNER_Y  = CFG.BANNER_Y;

  // ---------- PALETTE — Dark Portal ----------
  const C = {
    bg:         '#131F36',
    playfield:  '#1A2A45',
    text:       '#FFFFFF',
    textDim:    '#C5CFE0',
    textMute:   '#8E9CB5',
    accent:     '#D8523F',
    accentHi:   '#FF6B5C',
    aligned:    '#5DD39E',
    panel:      '#1A2A45',
    panel2:     '#22355A',
    line:       'rgba(255, 255, 255, 0.08)',
    edgeOK:     '#7E94B5',
    edgeCross:  '#FF6B5C',
    vertexDrag: '#FFD23F',
    crossDot:   '#FFD23F',
    overlay:    'rgba(14, 23, 38, 0.92)',
  };

  const VERTEX_PALETTE = [
    '#E84855', '#3D5AFE', '#FFD23F', '#00897B',
    '#D85B0E', '#7E57C2', '#5DD39E', '#C2185B',
    '#4ECDC4', '#F4A261', '#B084CC', '#FF6B9D',
  ];

  // ---------- SEEDED PRNG ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  let rng = Math.random;

  // ---------- LEVEL CURVE ----------
  // Each level is a fixed (N, edges, perturbPct, name). Past level 38 the
  // tier stays MASTER but the seed advances, so the puzzles keep changing.
  function tierForLevel(level) {
    if (level <= 2)  return { name: 'TUTORIAL', N: 5,  edges: 7,  perturbPct: 0.45 };
    if (level <= 4)  return { name: 'BASIC',    N: 6,  edges: 9,  perturbPct: 0.55 };
    if (level <= 7)  return { name: 'EASY',     N: 7,  edges: 11, perturbPct: 0.60 };
    if (level <= 11) return { name: 'MEDIUM',   N: 8,  edges: 13, perturbPct: 0.65 };
    if (level <= 16) return { name: 'HARD',     N: 9,  edges: 15, perturbPct: 0.70 };
    if (level <= 22) return { name: 'HARDER',   N: 10, edges: 17, perturbPct: 0.75 };
    if (level <= 30) return { name: 'EXPERT',   N: 11, edges: 19, perturbPct: 0.80 };
    return                  { name: 'MASTER',   N: 12, edges: 21, perturbPct: 0.85 };
  }

  function levelSeedString(level) {
    return 'zamborin-untangle-level-' + level;
  }

  // ---------- GRAPH GENERATION ----------
  function chordsCrossOnCircle(a, b, c, d) {
    if (a > b) { const t = a; a = b; b = t; }
    if (c > d) { const t = c; c = d; d = t; }
    if (a === c || a === d || b === c || b === d) return false;
    const cIn = c > a && c < b;
    const dIn = d > a && d < b;
    return cIn !== dIn;
  }
  function generateGraphTopology(N, targetEdges) {
    const edges = [];
    const seen  = new Set();
    const key   = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
    function addEdge(a, b) {
      const k = key(a, b);
      if (seen.has(k)) return false;
      seen.add(k);
      edges.push([Math.min(a, b), Math.max(a, b)]);
      return true;
    }
    for (let i = 0; i < N; i++) addEdge(i, (i + 1) % N);
    let attempts = 0;
    while (edges.length < targetEdges && attempts < targetEdges * 30) {
      attempts++;
      const a = Math.floor(rng() * N);
      const b = Math.floor(rng() * N);
      if (a === b || seen.has(key(a, b))) continue;
      let crosses = false;
      for (const [c, d] of edges) if (chordsCrossOnCircle(a, b, c, d)) { crosses = true; break; }
      if (!crosses) addEdge(a, b);
    }
    return edges;
  }

  // ---------- LINE-SEGMENT INTERSECTION ----------
  function ccw(ax, ay, bx, by, cx, cy) {
    return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
  }
  function segmentsCross(p1, p2, p3, p4) {
    if (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4) return false;
    const d1 = ccw(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
    const d2 = ccw(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    const d3 = ccw(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const d4 = ccw(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function segIntersectionPoint(p1, p2, p3, p4) {
    const x1=p1.x, y1=p1.y, x2=p2.x, y2=p2.y, x3=p3.x, y3=p3.y, x4=p4.x, y4=p4.y;
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (denom === 0) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
  }

  // ---------- AUDIO ----------
  // Lazy-init on first user gesture (browser autoplay policy).
  let audioCtx = null;
  let soundOn = localStorage.getItem('zamborin-untangle.sound') !== '0';
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (_) { audioCtx = null; }
  }
  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem('zamborin-untangle.sound', on ? '1' : '0'); } catch (_) {}
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
  function sfxPickup()  { tone(680, 0.06, 0.035, 'sine'); }
  function sfxDrop()    { tone(420, 0.08, 0.04,  'sine'); }
  function sfxResolve() { tone(900, 0.09, 0.045, 'triangle'); }
  function sfxStart()   { tone(523, 0.10, 0.05,  'triangle'); setTimeout(() => tone(784, 0.12, 0.05, 'triangle'), 80); }
  function sfxWin() {
    tone(523, 0.13, 0.06, 'triangle');
    setTimeout(() => tone(659, 0.13, 0.06, 'triangle'),  90);
    setTimeout(() => tone(784, 0.13, 0.06, 'triangle'), 180);
    setTimeout(() => tone(1047, 0.22, 0.07,'triangle'), 280);
  }

  // ---------- STATE ----------
  let scene = 'instructions';   // 'instructions' | 'playing' | 'won'
  let awaitingStart = true;
  let edges = [];
  let pos   = [];
  let N = 9;
  let par = 0;
  let moves = 0;

  let runLevel = parseInt(localStorage.getItem('zamborin-untangle.level') || '1', 10);
  if (!Number.isFinite(runLevel) || runLevel < 1) runLevel = 1;
  let runTier = tierForLevel(runLevel);

  let highestLevel = parseInt(localStorage.getItem('zamborin-untangle.highest') || '1', 10);
  if (!Number.isFinite(highestLevel) || highestLevel < 1) highestLevel = 1;

  let dragIdx   = -1;
  let dragOrigin = null;
  let dragMovedFar = false;
  let crossingsAtPress = 0;

  function bestKey(level) { return 'zamborin-untangle.best.L' + level; }
  function getBest(level) {
    const v = parseInt(localStorage.getItem(bestKey(level)) || '0', 10);
    return v > 0 ? v : null;
  }
  let bestThisLevel = getBest(runLevel);

  const START_BTN = { x: 0, y: 0, w: 0, h: 0 };
  const SHARE_BTN = { x: 0, y: 0, w: 0, h: 0 };
  const NEXT_BTN  = { x: 0, y: 0, w: 0, h: 0 };
  const SOUND_BTN = { x: 0, y: 0, w: 0, h: 0 };
  function inRect(r, lx, ly) { return r.w > 0 && lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h; }

  // ---------- INIT ----------
  function initLevel(level) {
    runLevel = level;
    runTier  = tierForLevel(level);
    rng = mulberry32(hashSeed(levelSeedString(level)));
    N = runTier.N;
    edges = generateGraphTopology(N, runTier.edges);

    const radius = Math.min(PLAY_W, PLAY_H) / 2 - MARGIN;
    const truePos = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI - Math.PI / 2;
      truePos.push({ x: PLAY_CX + Math.cos(a) * radius, y: PLAY_CY + Math.sin(a) * radius });
    }

    const perturbCount = Math.max(2, Math.round(N * runTier.perturbPct));
    const order = [];
    for (let i = 0; i < N; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    const toMove = new Set(order.slice(0, perturbCount));
    pos = truePos.map(p => ({ x: p.x, y: p.y }));
    for (const i of toMove) {
      pos[i] = {
        x: PLAY_X + MARGIN + rng() * (PLAY_W - MARGIN * 2),
        y: PLAY_Y + MARGIN + rng() * (PLAY_H - MARGIN * 2),
      };
    }
    par = perturbCount;
    moves = 0;
    scene = 'playing';
    dragIdx = -1;
    bestThisLevel = getBest(runLevel);
    try { localStorage.setItem('zamborin-untangle.level', String(runLevel)); } catch (_) {}
  }

  // ---------- CROSSING DETECTION ----------
  function detectCrossings() {
    const edgeCrossing = new Array(edges.length).fill(false);
    const crossPoints  = [];
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const p1 = pos[a], p2 = pos[b];
      for (let j = i + 1; j < edges.length; j++) {
        const [c, d] = edges[j];
        if (a === c || a === d || b === c || b === d) continue;
        const p3 = pos[c], p4 = pos[d];
        if (segmentsCross(p1, p2, p3, p4)) {
          edgeCrossing[i] = true;
          edgeCrossing[j] = true;
          const pt = segIntersectionPoint(p1, p2, p3, p4);
          if (pt) crossPoints.push(pt);
        }
      }
    }
    return { crossings: crossPoints.length, edgeCrossing, crossPoints };
  }

  // ---------- INPUT ----------
  function logical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      lx: ((clientX - rect.left) / rect.width)  * W,
      ly: ((clientY - rect.top)  / rect.height) * H,
    };
  }
  function vertexAt(lx, ly) {
    let best = -1, bestDist = VERTEX_HIT * VERTEX_HIT;
    for (let i = 0; i < N; i++) {
      const dx = lx - pos[i].x, dy = ly - pos[i].y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) { bestDist = d2; best = i; }
    }
    return best;
  }
  function clampToPlayfield(p) {
    p.x = Math.max(PLAY_X + MARGIN, Math.min(PLAY_X + PLAY_W - MARGIN, p.x));
    p.y = Math.max(PLAY_Y + MARGIN, Math.min(PLAY_Y + PLAY_H - MARGIN, p.y));
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ensureAudio();
    const { lx, ly } = logical(e.clientX, e.clientY);

    // Sound toggle is always live (instructions screen + playing + won)
    if (inRect(SOUND_BTN, lx, ly)) {
      setSound(!soundOn);
      if (soundOn) tone(660, 0.06, 0.04, 'sine');
      return;
    }

    if (awaitingStart) {
      if (inRect(START_BTN, lx, ly)) {
        awaitingStart = false;
        sfxStart();
        initLevel(runLevel);
      }
      return;
    }
    if (scene === 'won') {
      if (inRect(NEXT_BTN, lx, ly))  { initLevel(runLevel + 1); return; }
      if (inRect(SHARE_BTN, lx, ly)) { copyShareString(); return; }
      return;
    }
    if (scene !== 'playing') return;
    const idx = vertexAt(lx, ly);
    if (idx === -1) return;
    dragIdx = idx;
    dragOrigin = { x: pos[idx].x, y: pos[idx].y };
    dragMovedFar = false;
    crossingsAtPress = detectCrossings().crossings;
    sfxPickup();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragIdx === -1) return;
    e.preventDefault();
    const { lx, ly } = logical(e.clientX, e.clientY);
    pos[dragIdx].x = lx;
    pos[dragIdx].y = ly;
    clampToPlayfield(pos[dragIdx]);
    const dx = pos[dragIdx].x - dragOrigin.x;
    const dy = pos[dragIdx].y - dragOrigin.y;
    if (dx * dx + dy * dy > 4 * 4) dragMovedFar = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (dragIdx === -1) return;
    e.preventDefault();
    if (dragMovedFar) {
      moves++;
      const after = detectCrossings().crossings;
      if (after === 0) {
        sfxWin();
        onWin();
      } else if (after < crossingsAtPress) {
        sfxResolve();
      } else {
        sfxDrop();
      }
    }
    dragIdx = -1; dragOrigin = null; dragMovedFar = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointercancel', () => {
    dragIdx = -1; dragOrigin = null; dragMovedFar = false;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      ensureAudio();
      setSound(!soundOn);
      if (soundOn) tone(660, 0.06, 0.04, 'sine');
      return;
    }
    if (awaitingStart && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); ensureAudio(); awaitingStart = false; sfxStart(); initLevel(runLevel); return;
    }
    if (scene === 'won' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); initLevel(runLevel + 1);
    }
  });

  function onWin() {
    scene = 'won';
    if (bestThisLevel == null || moves < bestThisLevel) {
      bestThisLevel = moves;
      try { localStorage.setItem(bestKey(runLevel), String(moves)); } catch (_) {}
    }
    if (runLevel + 1 > highestLevel) {
      highestLevel = runLevel + 1;
      try { localStorage.setItem('zamborin-untangle.highest', String(highestLevel)); } catch (_) {}
    }
    try { localStorage.setItem('zamborin-untangle.level', String(runLevel + 1)); } catch (_) {}
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

  function drawSoundButton() {
    const btnSize = 28;
    const padding = 12;
    const bx = W - padding - btnSize;
    const by = padding;
    SOUND_BTN.x = bx; SOUND_BTN.y = by; SOUND_BTN.w = btnSize; SOUND_BTN.h = btnSize;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    roundRect(bx, by, btnSize, btnSize, 6);
    ctx.fill();

    // speaker glyph
    const cx = bx + btnSize / 2;
    const cy = by + btnSize / 2;
    ctx.fillStyle = soundOn ? C.text : C.textMute;
    ctx.strokeStyle = soundOn ? C.text : C.textMute;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 3);
    ctx.lineTo(cx - 3, cy - 3);
    ctx.lineTo(cx + 1, cy - 6);
    ctx.lineTo(cx + 1, cy + 6);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.lineTo(cx - 7, cy + 3);
    ctx.closePath();
    ctx.fill();
    if (soundOn) {
      ctx.beginPath();
      ctx.arc(cx + 3, cy, 3, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 3, cy, 6, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    } else {
      // slash through icon when muted
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + btnSize - 4);
      ctx.lineTo(bx + btnSize - 4, by + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHUD() {
    // LEFT: MOVES
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MOVES', PLAY_X, 18);
    ctx.font = '800 24px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(moves), PLAY_X, 42);

    // CENTER: LEVEL + tier name
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL', W / 2, 18);
    ctx.font = '800 24px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(runLevel), W / 2, 42);
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText(runTier.name, W / 2, 60);

    // RIGHT: PAR
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'right';
    ctx.fillText('PAR', PLAY_X + PLAY_W, 18);
    ctx.font = '800 24px Inter, sans-serif';
    ctx.fillStyle = moves > par ? C.accent : C.text;
    ctx.fillText(String(par), PLAY_X + PLAY_W, 42);
  }

  function drawPlayfield() {
    ctx.fillStyle = C.playfield;
    roundRect(PLAY_X - 6, PLAY_Y - 6, PLAY_W + 12, PLAY_H + 12, 14);
    ctx.fill();
  }

  function drawEdges(now, crossInfo) {
    const pulse = 0.55 + 0.45 * Math.sin(now / 280);
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const p1 = pos[a], p2 = pos[b];
      const crossing = crossInfo.edgeCrossing[i];
      if (crossing) {
        ctx.save();
        ctx.shadowColor = C.accentHi;
        ctx.shadowBlur = 8 + 6 * pulse;
        ctx.strokeStyle = C.edgeCross;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.shadowColor = 'rgba(101, 119, 255, 0.35)';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = C.edgeOK;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawCrossDots(crossInfo) {
    for (const pt of crossInfo.crossPoints) {
      ctx.fillStyle = C.crossDot;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawVertices(now) {
    const pulse = 0.6 + 0.4 * Math.sin(now / 320);
    for (let i = 0; i < N; i++) {
      const p = pos[i];
      const isDrag = i === dragIdx;
      const baseColor = VERTEX_PALETTE[i % VERTEX_PALETTE.length];
      ctx.save();
      ctx.shadowColor = isDrag ? C.vertexDrag : baseColor;
      ctx.shadowBlur = isDrag ? (10 + 6 * pulse) : 8;
      ctx.fillStyle = isDrag ? C.vertexDrag : baseColor;
      ctx.beginPath(); ctx.arc(p.x, p.y, VERTEX_R, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = isDrag ? '#FFEAB4' : 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath(); ctx.arc(p.x - VERTEX_R * 0.25, p.y - VERTEX_R * 0.25, VERTEX_R * 0.35, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawHintRow() {
    const text = MODE === 'mobile'
      ? 'DRAG ANY DOT — REMOVE EVERY CROSSING'
      : 'CLICK AND DRAG ANY DOT — REMOVE EVERY EDGE CROSSING';
    const stripTop    = PLAY_Y + PLAY_H + 6;
    const stripBot    = BANNER_H > 0 ? BANNER_Y : H;
    const stripHeight = stripBot - stripTop;
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(text);
    const baselineY = stripTop + (stripHeight - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2 + m.actualBoundingBoxAscent;
    ctx.fillText(text, W / 2, baselineY);
  }

  function drawBannerAd() {
    if (BANNER_H === 0) return;
    ctx.fillStyle = C.panel;
    roundRect(BANNER_X, BANNER_Y, BANNER_W, BANNER_H, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    roundRect(BANNER_X + 0.5, BANNER_Y + 0.5, BANNER_W - 1, BANNER_H - 1, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AD · 320 × 50', BANNER_X + BANNER_W / 2, BANNER_Y + BANNER_H / 2);
  }

  // ---------- INSTRUCTIONS ----------
  function drawInstructions() {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, BANNER_H > 0 ? BANNER_Y - 8 : H);

    const midX = W / 2;
    const playBot = BANNER_H > 0 ? BANNER_Y - 8 : H;
    const midY = playBot / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText('HOW TO PLAY', midX, midY - 170);

    ctx.font = '800 ' + (MODE === 'mobile' ? 32 : 36) + 'px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText('Untangle', midX, midY - 130);

    const rules = [
      'Drag any dot to move it.',
      'Edges that cross another edge pulse red.',
      'Goal: remove every crossing.',
      'Each level adds more dots and edges.',
    ];
    ctx.font = '500 16px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    const lineH = 26;
    const rulesTop = midY - 60;
    for (let i = 0; i < rules.length; i++) ctx.fillText(rules[i], midX, rulesTop + i * lineH);

    // Show resume / new label
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    const resumeY = rulesTop + rules.length * lineH + 12;
    if (runLevel > 1) {
      ctx.fillText('RESUMING AT LEVEL ' + runLevel + ' · ' + runTier.name, midX, resumeY);
    } else {
      ctx.fillText('STARTING AT LEVEL 1 · TUTORIAL', midX, resumeY);
    }

    const btnW = MODE === 'mobile' ? 240 : 280;
    const btnH = MODE === 'mobile' ? 56 : 52;
    const btnY = resumeY + 22;
    const btnX = midX - btnW / 2;
    START_BTN.x = btnX; START_BTN.y = btnY; START_BTN.w = btnW; START_BTN.h = btnH;
    ctx.fillStyle = C.accent;
    roundRect(btnX, btnY, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillText(runLevel > 1 ? 'CONTINUE' : 'START', midX, btnY + btnH / 2 + 1);
  }

  // ---------- WIN ----------
  function drawWon(now) {
    ctx.fillStyle = C.overlay;
    roundRect(PLAY_X - 6, PLAY_Y - 6, PLAY_W + 12, PLAY_H + 12, 14);
    ctx.fill();

    const midX = W / 2;
    const midY = PLAY_Y + PLAY_H / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillStyle = C.aligned;
    ctx.fillText('LEVEL ' + runLevel + ' UNTANGLED', midX, midY - 150);

    ctx.font = '800 56px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(moves), midX, midY - 88);
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('YOUR MOVES', midX, midY - 52);

    ctx.font = '500 24px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(par), midX, midY - 16);
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('PAR', midX, midY + 2);

    let verdict, color;
    if (moves < par)        { verdict = 'UNDER PAR · BRILLIANT'; color = C.aligned; }
    else if (moves === par) { verdict = 'AT PAR'; color = C.aligned; }
    else if (moves <= par+2){ verdict = '+' + (moves - par) + ' OVER PAR · GREAT'; color = C.text; }
    else                    { verdict = '+' + (moves - par) + ' OVER PAR'; color = C.textDim; }
    ctx.font = '700 13px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(verdict, midX, midY + 32);

    // PRIMARY: NEXT LEVEL
    const btnW = MODE === 'mobile' ? 240 : 260;
    const btnH = 48;
    const btnX = midX - btnW / 2;
    const nextY = midY + 64;
    NEXT_BTN.x = btnX; NEXT_BTN.y = nextY; NEXT_BTN.w = btnW; NEXT_BTN.h = btnH;
    ctx.fillStyle = C.accent;
    roundRect(btnX, nextY, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillText('NEXT LEVEL  →', midX, nextY + btnH / 2 + 1);

    // SECONDARY: SHARE (ghost button)
    const shareY = nextY + btnH + 12;
    SHARE_BTN.x = btnX; SHARE_BTN.y = shareY; SHARE_BTN.w = btnW; SHARE_BTN.h = 40;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.lineWidth = 1.5;
    roundRect(btnX, shareY, btnW, 40, 20);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.textDim;
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillText('SHARE RESULT', midX, shareY + 40 / 2 + 1);

    const pulse = 0.55 + 0.45 * Math.sin(now / 350);
    ctx.globalAlpha = pulse;
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.fillText('PRESS ENTER FOR NEXT LEVEL', midX, shareY + 40 + 22);
    ctx.globalAlpha = 1;
  }

  // ---------- SHARE ----------
  function homeURL() { return window.location.origin + window.location.pathname; }
  function buildSharePayload() {
    let verdict;
    if (moves < par)        verdict = 'under par by ' + (par - moves);
    else if (moves === par) verdict = 'at par';
    else                    verdict = '+' + (moves - par) + ' over par';
    const text = 'I untangled Level ' + runLevel + ' · ' + runTier.name + '\n'
               + moves + ' moves (par ' + par + ') · ' + verdict + '\n'
               + 'Untangle, a Zamborin Game';
    return { title: 'Untangle', text, url: homeURL() };
  }
  function copyShareString() {
    const payload = buildSharePayload();
    const flat = payload.text + '\n' + payload.url;
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = flat; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    };
    if (navigator.share && (!navigator.canShare || navigator.canShare(payload))) {
      navigator.share(payload).catch((err) => {
        if (err && err.name === 'AbortError') return;
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(flat);
        else fallback();
      });
    } else if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(flat);
    } else fallback();
  }

  // ---------- LOOP ----------
  function loop(now) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    if (awaitingStart) {
      drawInstructions();
      drawSoundButton();
      drawBannerAd();
      requestAnimationFrame(loop);
      return;
    }

    drawHUD();
    drawPlayfield();
    const crossInfo = detectCrossings();
    drawEdges(now, crossInfo);
    drawCrossDots(crossInfo);
    drawVertices(now);
    drawHintRow();
    drawSoundButton();
    drawBannerAd();

    if (scene === 'won') drawWon(now);

    requestAnimationFrame(loop);
  }

  // ---------- START ----------
  function bootToInstructions() {
    awaitingStart = true;
    requestAnimationFrame(loop);
  }
  if (document.getElementById('splash')) {
    window.addEventListener('splash-done', bootToInstructions, { once: true });
  } else {
    bootToInstructions();
  }
})();
