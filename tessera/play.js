/* ============================================================
   TESSERA Words · Desktop · 12-col × 8-row grid
   Falling-letter mechanic. Land tiles into columns; whenever a
   horizontal or vertical run of 3+ letters forms an English
   word, it clears and tiles above fall in.
   All rendering is canvas-drawn vector — no images.
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE DETECTION ----------
  // Mobile is anything with a coarse pointer (touchscreen) or a narrow viewport.
  // Locked at page load — we don't hot-swap layouts on resize.
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  // Per-mode canvas + grid configuration.
  //   Desktop: fixed 760×570 with 12×8 grid (fits any laptop window).
  //   Mobile : LOGICAL canvas = current viewport (innerWidth × innerHeight),
  //            so we always fill 100 % of what the browser actually gives us
  //            — no letterboxing whether the user is in Safari with chrome
  //            visible, in a PWA, or anywhere in between. CELL is then sized
  //            to fit 13 rows of the locked 6-column grid inside the
  //            available vertical space (HUD + hint band + banner reserved).
  function buildMobileCFG() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const HUD_H        = 56;
    const BANNER_H     = 50;
    const BOTTOM_PAD   = 22;
    const HINT_AREA    = 36;          // gap above hint + text band + gap below
    const GRID_TOP_GAP = 8;
    const SIDE_PAD     = 8;
    const gridMaxH = vh - HUD_H - GRID_TOP_GAP - HINT_AREA - BANNER_H - BOTTOM_PAD;
    const cellByH  = Math.floor(gridMaxH / 13);
    const cellByW  = Math.floor((vw - SIDE_PAD * 2) / 6);
    // Cap at 70 so a tablet in mobile mode doesn't grow into giant tiles.
    const CELL     = Math.min(70, cellByH, cellByW);
    // Inline-style CSS vars so .game-wrap renders at the same dimensions.
    document.body.style.setProperty('--canvas-w', vw + 'px');
    document.body.style.setProperty('--canvas-h', vh + 'px');
    return { W: vw, H: vh, COLS: 6, ROWS: 13, CELL, HUD_H, BANNER_W: 320, BANNER_H };
  }
  const CFG = MODE === 'mobile' ? buildMobileCFG() : (() => {
    const desktopCFG = {
      W: 760, H: 570,
      COLS: 12, ROWS: 8, CELL: 56,
      HUD_H: 56,
      BANNER_W: 0, BANNER_H: 0,
    };
    document.body.style.setProperty('--canvas-w', desktopCFG.W + 'px');
    document.body.style.setProperty('--canvas-h', desktopCFG.H + 'px');
    return desktopCFG;
  })();

  // Orientation change → reload so we recompute against the new viewport.
  // Plain resize is ignored (iOS chrome toggle shouldn't restart the game).
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
  const W = CFG.W;
  const H = CFG.H;
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

  // ---------- GRID ----------
  // Geometry derives from the per-mode CFG so the same drawing/logic code
  // serves both desktop (12 × 8) and mobile (6 × 13) layouts.
  //
  // Desktop budget (760 × 570):
  //   HUD 56 · gap 8 · grid 448 · hint band · 28 bottom breathing
  //
  // Mobile budget (393 × 852):
  //   HUD 56 · gap 8 · grid 676 · gap 12 · hint 20 · gap 8 · banner 50 · 22 bottom pad
  const COLS = CFG.COLS;
  const ROWS = CFG.ROWS;
  const CELL = CFG.CELL;
  const GRID_W = COLS * CELL;
  const GRID_H = ROWS * CELL;
  const HUD_H  = CFG.HUD_H;
  const GRID_X = Math.floor((W - GRID_W) / 2);
  const GRID_Y = HUD_H + 8;

  // Banner ad slot — only drawn in mobile mode (BANNER_H = 0 on desktop).
  const BANNER_W = CFG.BANNER_W;
  const BANNER_H = CFG.BANNER_H;
  const BANNER_X = Math.floor((W - BANNER_W) / 2);
  const BANNER_Y = H - BANNER_H - 22;   // 22 px bottom safe-area pad on mobile

  // grid[r][c] = { letter, color } or null
  let grid = [];
  function emptyGrid() {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) row.push(null);
      g.push(row);
    }
    return g;
  }

  // ---------- LETTER BAG (weighted Scrabble-ish frequencies) ----------
  const LETTER_DIST = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2,
    I: 9, J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2,
    Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1,
    Y: 2, Z: 1,
  };
  let bag = [];
  function refillBag() {
    bag = [];
    for (const [l, n] of Object.entries(LETTER_DIST)) {
      for (let i = 0; i < n; i++) bag.push(l);
    }
    // Fisher-Yates
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  // Streak-aware draw: never emits more than MAX_STREAK same-type letters
  // in a row (vowel vs consonant). Prevents the Scrabble bag from dealing
  // "AEIOUA…" or "QZXKJ…" runs that lock the player out of word formation.
  // We rummage the bag for an alternate-type letter when the streak is hit,
  // putting the original back into the bag so frequency stays Scrabble-honest.
  const VOWELS = 'AEIOU';
  const MAX_STREAK = 3;
  let vowelStreak = 0;
  let consonantStreak = 0;
  function drawLetter() {
    if (bag.length === 0) refillBag();
    let letter = bag.pop();
    const wantVowel = consonantStreak >= MAX_STREAK;
    const wantConsonant = vowelStreak >= MAX_STREAK;
    if (wantVowel || wantConsonant) {
      const isVowelNow = VOWELS.includes(letter);
      if ((wantVowel && !isVowelNow) || (wantConsonant && isVowelNow)) {
        const match = (l) => wantVowel ? VOWELS.includes(l) : !VOWELS.includes(l);
        let idx = bag.findIndex(match);
        // If the bag has nothing of the needed type left, refill it before retrying.
        if (idx === -1) { refillBag(); idx = bag.findIndex(match); }
        if (idx >= 0) {
          const swap = bag[idx];
          bag.splice(idx, 1);
          bag.unshift(letter);            // recycle the rejected letter
          letter = swap;
        }
      }
    }
    if (VOWELS.includes(letter)) { vowelStreak++; consonantStreak = 0; }
    else { consonantStreak++; vowelStreak = 0; }
    return letter;
  }

  // ---------- WORD LIST (TWL06 Scrabble, 3-7 letters) ----------
  // 51 852 words bundled in ./words.txt — one word per line, uppercase.
  // Loaded asynchronously at startup; no words match until it arrives, which
  // is harmless because the first tile takes seconds to fall.
  const VALID_WORDS = new Set();
  let dictLoaded = false;
  fetch('./words.txt')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(text => {
      for (const line of text.split('\n')) {
        const w = line.trim();
        if (w) VALID_WORDS.add(w);
      }
      dictLoaded = true;
    })
    .catch(err => console.error('TESSERA Words: dictionary load failed', err));


  // ---------- PALETTE — DARK PORTAL ----------
  // Canvas world matches the page chrome (see play.css). The dark background lets
  // bright candy-colored tiles pop. All text-on-tile combos meet ≥4.5:1 contrast.
  const C = {
    bg:         '#131F36',          // matches gradient mid-stop on .game-wrap
    playfield:  '#1A2A45',          // slightly lighter playfield card
    cellEmpty:  '#1F3052',          // empty grid cell
    cellEmpty2: '#22355A',          // alt checker cell (subtle)
    cellLine:   'rgba(255, 255, 255, 0.06)',
    tileFace:   '#FFFFFF',          // letter glyphs sit on dark tile bodies
    accent:     '#D8523F',          // coral, darkened to 4.55:1 with white text
    accentHi:   '#FF6B5C',
    text:       '#FFFFFF',
    textDim:    '#C5CFE0',
    textMute:   '#8E9CB5',
    aligned:    '#5DD39E',          // mint — win/clear
    panel:      '#1A2A45',
    panel2:     '#22355A',
    flashGood:  '#FFD23F',          // sunshine yellow on clears
    line:       'rgba(255, 255, 255, 0.08)',
  };

  // Six candy palettes — body, then highlight strip — rotates per level.
  // Each pair tuned so the body holds ≥4.5:1 (AA-large) with the white glyph.
  // Burnt orange was originally too light (2.7:1) and got darkened to #D85B0E
  // to clear AA-large; the old #F07F2A now lives on the highlight strip.
  const TILE_PALETTES = [
    ['#E84855', '#FF6B7A'],   // cherry red
    ['#D85B0E', '#F07F2A'],   // burnt orange (darkened for AA contrast)
    ['#3D5AFE', '#6577FF'],   // royal blue
    ['#00897B', '#26A69A'],   // emerald
    ['#7E57C2', '#9575CD'],   // royal purple
    ['#C2185B', '#E91E63'],   // magenta rose
  ];
  let levelIdx = 0;
  function tileColor() { return TILE_PALETTES[levelIdx % TILE_PALETTES.length]; }

  // ---------- ACTIVE TILE — STOP-MOTION CELL STEPPING ----------
  // Tile occupies one grid cell at a time and snaps down by one row every
  // `currentStepInterval()` ms. No pixel-by-pixel drift — feels deliberate
  // and gives the player time to think.
  let active = null;        // { letter, col, row, nextStepAt }
  let nextLetter = null;
  const STEP_BASE_MS  = 750;        // gentle warm-up speed (0 letters dropped)
  const STEP_DELTA_MS = 4;          // ms shaved off per letter
  const STEP_MIN_MS   = 350;        // cap so end-game stays playable
  const FAST_DROP_MS  = 80;         // when player presses ↓ / Space
  function currentStepInterval() {
    return Math.max(STEP_MIN_MS, STEP_BASE_MS - lettersDropped * STEP_DELTA_MS);
  }
  let fastDropActive = false;

  // ---------- GAME STATE ----------
  let score = 0;
  let wordsFound = 0;
  let lettersDropped = 0;
  let gameOver = false;
  let awaitingStart = true;          // true → instructions overlay; false → live game
  // Hit-test rect for the START button drawn during the instructions scene.
  // Filled by drawInstructions() each frame; consumed by the pointer handler.
  const START_BTN = { x: 0, y: 0, w: 0, h: 0 };
  let clearFlashes = [];    // { cells: [{r,c}], startAt }

  // ---------- INIT ----------
  function initGame() {
    grid = emptyGrid();
    refillBag();
    vowelStreak = 0;
    consonantStreak = 0;
    score = 0;
    wordsFound = 0;
    lettersDropped = 0;
    gameOver = false;
    levelIdx = 0;
    clearFlashes = [];
    nextLetter = drawLetter();
    spawnTile();
    requestAnimationFrame(loop);
  }

  function spawnTile() {
    const col = Math.floor(COLS / 2);
    const letter = nextLetter || drawLetter();
    nextLetter = drawLetter();
    // Active tile starts in row 0; next step (move to row 1) is scheduled
    // one full interval later so the player can read it before it falls.
    active = { letter, col, row: 0, nextStepAt: performance.now() + currentStepInterval() };
    fastDropActive = false;
    // If the spawn cell is already occupied, the stack is full → game over.
    if (grid[0][col] !== null) {
      gameOver = true;
    }
  }

  // Get the lowest empty row in this column.
  function lowestEmpty(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][col] === null) return r;
    }
    return -1;
  }

  // Lock the active tile into place and run word detection.
  function lockTile() {
    if (!active) return;
    const col = active.col;
    const row = lowestEmpty(col);
    if (row === -1) {
      // Column overflow — game over.
      gameOver = true;
      active = null;
      return;
    }
    const [body, top] = tileColor();
    grid[row][col] = { letter: active.letter, body, top };
    lettersDropped++;
    if (lettersDropped % 10 === 0) levelIdx++;
    active = null;
    detectAndClearWords();
    if (!gameOver) spawnTile();
  }

  // Sweep grid for horizontal and vertical word matches (3-6 letters).
  // Greedy left-to-right / top-to-bottom; longest match at each starting cell.
  function detectAndClearWords() {
    const toClear = new Set();
    // horizontals
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (let len = 7; len >= 3; len--) {
          if (c + len > COLS) continue;
          let w = '';
          let ok = true;
          for (let k = 0; k < len; k++) {
            const cell = grid[r][c + k];
            if (!cell) { ok = false; break; }
            w += cell.letter;
          }
          if (!ok) continue;
          if (VALID_WORDS.has(w)) {
            for (let k = 0; k < len; k++) toClear.add(r + ',' + (c + k));
            score += len * len * 10;       // longer = exponentially better
            wordsFound++;
            break; // longest match at this start, move on
          }
        }
      }
    }
    // verticals
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        for (let len = 7; len >= 3; len--) {
          if (r + len > ROWS) continue;
          let w = '';
          let ok = true;
          for (let k = 0; k < len; k++) {
            const cell = grid[r + k][c];
            if (!cell) { ok = false; break; }
            w += cell.letter;
          }
          if (!ok) continue;
          if (VALID_WORDS.has(w)) {
            for (let k = 0; k < len; k++) toClear.add((r + k) + ',' + c);
            score += len * len * 10;
            wordsFound++;
            break;
          }
        }
      }
    }
    if (toClear.size === 0) return;
    const cells = [];
    for (const key of toClear) {
      const [r, c] = key.split(',').map(Number);
      cells.push({ r, c });
    }
    clearFlashes.push({ cells, startAt: performance.now() });
    // Remove tiles and apply gravity
    for (const { r, c } of cells) grid[r][c] = null;
    applyGravity();
  }

  function applyGravity() {
    for (let c = 0; c < COLS; c++) {
      const stack = [];
      for (let r = ROWS - 1; r >= 0; r--) {
        if (grid[r][c]) stack.push(grid[r][c]);
      }
      for (let r = ROWS - 1; r >= 0; r--) {
        grid[r][c] = stack[ROWS - 1 - r] || null;
      }
    }
  }

  // ---------- INPUT ----------
  let keys = { ArrowLeft: false, ArrowRight: false, ArrowDown: false };
  let leftHeld = 0, rightHeld = 0;
  const HORIZ_REPEAT_MS = 110;

  window.addEventListener('keydown', (e) => {
    if (awaitingStart && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      awaitingStart = false;
      initGame();
      return;
    }
    if (gameOver && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      initGame();
      return;
    }
    if (!active) return;
    if (e.key === 'ArrowLeft')  { if (active.col > 0) active.col--; keys.ArrowLeft = true; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { if (active.col < COLS - 1) active.col++; keys.ArrowRight = true; e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === ' ') {
      // Fast-drop: shorten the next step to FAST_DROP_MS so the tile rains
      // down quickly. The flag persists until keyup so it keeps applying as
      // each step completes.
      fastDropActive = true;
      active.nextStepAt = Math.min(active.nextStepAt, performance.now() + FAST_DROP_MS);
      keys.ArrowDown = true;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key in keys) keys[e.key] = false;
    if (e.key === 'ArrowDown' || e.key === ' ') {
      fastDropActive = false;
    }
  });

  // Mouse / pointer
  function inRect(r, lx, ly) {
    return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const lx = ((e.clientX - rect.left) / rect.width) * W;
    const ly = ((e.clientY - rect.top)  / rect.height) * H;

    // Instructions scene: only the START pill is interactive.
    if (awaitingStart) {
      if (inRect(START_BTN, lx, ly)) {
        awaitingStart = false;
        initGame();
      }
      return;
    }
    if (gameOver) { initGame(); return; }
    if (!active) return;
    if (ly > GRID_Y - CELL && ly < GRID_Y + GRID_H + 40) {
      const col = Math.max(0, Math.min(COLS - 1, Math.floor((lx - GRID_X) / CELL)));
      active.col = col;
      fastDropActive = true;
      active.nextStepAt = performance.now() + FAST_DROP_MS;
    }
  });

  // ---------- RENDERING ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawHUD() {
    // SCORE column — left-aligned to the GRID's left edge
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCORE', GRID_X, 16);
    ctx.font = '800 24px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(score), GRID_X, 38);

    // WORDS — centred on the canvas (also centre of the grid)
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'center';
    ctx.fillText('WORDS', W / 2, 16);
    ctx.font = '800 24px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(wordsFound), W / 2, 38);

    // NEXT column — right-aligned to the GRID's right edge
    const RIGHT_EDGE = GRID_X + GRID_W;
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'right';
    ctx.fillText('NEXT', RIGHT_EDGE, 16);
    if (nextLetter) {
      // Tile sits in the value-row alongside SCORE/WORDS numerics.
      //   Label baseline middle: y=16 (text spans ~10–22)
      //   Tile spans 26–50, so ≥4 px clear of the label above and the playfield below
      //   (playfield card starts at GRID_Y - 10 = 54).
      const sz = 24;
      const previewX = RIGHT_EDGE - sz, previewY = 26;
      const [body, top] = tileColor();
      drawTileAt(previewX, previewY, sz, nextLetter, body, top, 1);
    }
  }

  function drawPlayfield() {
    // Soft outer card
    ctx.fillStyle = C.playfield;
    roundRect(GRID_X - 10, GRID_Y - 10, GRID_W + 20, GRID_H + 20, 14);
    ctx.fill();

    // Column hover guide (under active tile)
    if (active && !gameOver) {
      const gx = GRID_X + active.col * CELL;
      ctx.fillStyle = C.accent;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(gx, GRID_Y, CELL, GRID_H);
      ctx.globalAlpha = 1;
    }

    // Empty cells (subtle checker)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c]) continue;
        const x = GRID_X + c * CELL + 2;
        const y = GRID_Y + r * CELL + 2;
        ctx.fillStyle = (r + c) % 2 === 0 ? C.cellEmpty : C.cellEmpty2;
        roundRect(x, y, CELL - 4, CELL - 4, 6);
        ctx.fill();
      }
    }

    // Subtle border
    ctx.strokeStyle = C.cellLine;
    ctx.lineWidth = 1;
    roundRect(GRID_X - 0.5, GRID_Y - 0.5, GRID_W + 1, GRID_H + 1, 8);
    ctx.stroke();
  }

  function drawTileAt(x, y, sz, letter, body, top, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity != null ? opacity : 1;
    // Body
    ctx.fillStyle = body;
    roundRect(x, y, sz, sz, 7);
    ctx.fill();
    // Highlight strip (top quarter)
    ctx.fillStyle = top;
    roundRect(x + 3, y + 3, sz - 6, sz * 0.36, 5);
    ctx.fill();
    // Letter
    ctx.fillStyle = C.tileFace;
    ctx.font = '800 ' + Math.floor(sz * 0.6) + 'px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x + sz / 2, y + sz / 2 + 2);
    ctx.restore();
  }

  function drawPlacedTiles() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (!t) continue;
        const x = GRID_X + c * CELL + 2;
        const y = GRID_Y + r * CELL + 2;
        drawTileAt(x, y, CELL - 4, t.letter, t.body, t.top, 1);
      }
    }
  }

  function drawActiveTile() {
    if (!active || gameOver) return;
    const x = GRID_X + active.col * CELL + 2;
    const y = GRID_Y + active.row * CELL + 2;
    const [body, top] = tileColor();
    // Landing-row preview: faded outline at the cell the tile will lock into.
    const landRow = lowestEmpty(active.col);
    if (landRow !== -1 && landRow !== active.row) {
      const ly = GRID_Y + landRow * CELL + 2;
      ctx.fillStyle = C.accent;
      ctx.globalAlpha = 0.2;
      roundRect(x, ly, CELL - 4, CELL - 4, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawTileAt(x, y, CELL - 4, active.letter, body, top, 1);
  }

  function drawClearFlashes(now) {
    for (let i = clearFlashes.length - 1; i >= 0; i--) {
      const f = clearFlashes[i];
      const t = (now - f.startAt) / 420;
      if (t >= 1) { clearFlashes.splice(i, 1); continue; }
      const alpha = 1 - t;
      ctx.fillStyle = C.flashGood;
      ctx.globalAlpha = alpha * 0.65;
      for (const { r, c } of f.cells) {
        const x = GRID_X + c * CELL + 2;
        const y = GRID_Y + r * CELL + 2;
        const sz = (CELL - 4) * (1 + t * 0.3);
        const ox = (sz - (CELL - 4)) / 2;
        roundRect(x - ox, y - ox, sz, sz, 8);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawHintRow() {
    // Optically centred between the grid bottom and either the banner top
    // (mobile) or the canvas bottom (desktop). actualBoundingBox* gives the
    // tight glyph rectangle so caps don't drift above true visual centre.
    const text = MODE === 'mobile'
      ? 'TAP A COLUMN TO DROP'
      : '← →  MOVE   ·   ↓ / SPACE  FAST DROP   ·   CLICK A COLUMN TO DROP';
    const stripTop    = GRID_Y + GRID_H;
    const stripBot    = BANNER_H > 0 ? BANNER_Y : H;
    const stripHeight = stripBot - stripTop;
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(text);
    const ascent  = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    const glyphH  = ascent + descent;
    const baselineY = stripTop + (stripHeight - glyphH) / 2 + ascent;
    ctx.fillText(text, W / 2, baselineY);
  }

  // Banner-ad placeholder — mobile-only. Dashed rectangle with "AD · 320 × 50",
  // matches the desktop ad-slot style so wiring a real ad network later is a
  // visual no-op. Disabled on desktop (BANNER_H === 0).
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

  // Instructions screen — shown once on first load (after splash) and dismissed
  // by the START button. Subsequent restarts (after game-over) skip straight to
  // gameplay since the player already knows the rules.
  function drawInstructions() {
    // Full canvas background (banner stays visible underneath in mobile mode).
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, BANNER_H > 0 ? BANNER_Y - 8 : H);

    const midX = W / 2;
    // Vertical centre of the play area (above banner on mobile, full canvas on desktop).
    const playBot = BANNER_H > 0 ? BANNER_Y - 8 : H;
    const midY = playBot / 2;

    // TITLE
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText('HOW TO PLAY', midX, midY - 160);

    ctx.font = '800 ' + (MODE === 'mobile' ? 32 : 36) + 'px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText('TESSERA Words', midX, midY - 120);

    // RULES — three short lines
    const rules = [
      'Tiles fall into the column you tap.',
      'Form English words across or down — 3 letters or more.',
      'Longer words score exponentially more.',
      'Beat the stack. Game gets faster as you play.',
    ];
    ctx.font = '500 ' + (MODE === 'mobile' ? 14 : 14) + 'px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    const lineH = 24;
    const rulesTop = midY - 60;
    for (let i = 0; i < rules.length; i++) {
      ctx.fillText(rules[i], midX, rulesTop + i * lineH);
    }

    // START button — generous pill, accent fill, white text
    const btnW = MODE === 'mobile' ? 240 : 280;
    const btnH = MODE === 'mobile' ? 56 : 52;
    const btnY = rulesTop + rules.length * lineH + 28;
    const btnX = midX - btnW / 2;
    START_BTN.x = btnX; START_BTN.y = btnY; START_BTN.w = btnW; START_BTN.h = btnH;
    ctx.fillStyle = C.accent;
    roundRect(btnX, btnY, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillText('START', midX, btnY + btnH / 2 + 1);

    // Controls hint (small, beneath the button)
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = C.textMute;
    const ctrlHint = MODE === 'mobile'
      ? 'TAP A COLUMN TO DROP A TILE'
      : '← →  MOVE   ·   ↓ / SPACE  FAST DROP   ·   CLICK A COLUMN TO DROP';
    ctx.fillText(ctrlHint, midX, btnY + btnH + 26);
  }

  function drawGameOver() {
    // Dark-tinted overlay so verdict text reads cleanly over any board state.
    ctx.fillStyle = 'rgba(14, 23, 38, 0.92)';
    roundRect(GRID_X - 10, GRID_Y - 10, GRID_W + 20, GRID_H + 20, 14);
    ctx.fill();

    const midX = W / 2;
    const midY = GRID_Y + GRID_H / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText('STACK FILLED', midX, midY - 80);

    ctx.font = '800 56px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(String(score), midX, midY - 24);
    ctx.font = '500 12px Inter, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('FINAL SCORE', midX, midY + 8);

    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(wordsFound + ' WORDS · ' + lettersDropped + ' LETTERS', midX, midY + 36);

    // Pill button — generous internal padding (≥36 px each side, 14 px top/bottom)
    const btnW = 280, btnH = 52;
    const bx = midX - btnW / 2;
    const by = midY + 60;
    ctx.fillStyle = C.accent;
    roundRect(bx, by, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 13px Inter, sans-serif';
    ctx.fillText('PLAY AGAIN  ·  PRESS ENTER', midX, by + btnH / 2 + 1);
  }

  // ---------- LOOP ----------
  function loop(now) {
    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    if (awaitingStart) {
      // Instructions scene — no playfield, no HUD, just the rules + START.
      drawInstructions();
      drawBannerAd();
      requestAnimationFrame(loop);
      return;
    }

    drawHUD();
    drawPlayfield();
    drawPlacedTiles();
    drawClearFlashes(now);

    // Advance active tile — one row per step interval, with fast-drop override.
    if (active && !gameOver && now >= active.nextStepAt) {
      const landRow = lowestEmpty(active.col);
      if (landRow === -1 || active.row >= landRow) {
        lockTile();
      } else {
        active.row++;
        const interval = fastDropActive ? FAST_DROP_MS : currentStepInterval();
        active.nextStepAt = now + interval;
      }
    }
    drawActiveTile();
    drawHintRow();
    drawBannerAd();

    if (gameOver) drawGameOver();

    requestAnimationFrame(loop);
  }

  // ---------- START ----------
  // After splash: show the instructions overlay and start the render loop.
  // initGame() is gated on the player tapping START (handled in the pointer
  // listener above). Restarts after game-over skip the instructions screen.
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
