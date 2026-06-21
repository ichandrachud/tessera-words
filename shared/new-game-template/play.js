/* ============================================================
   __GAME_NAME__ · A Zamborin Game
   ============================================================ */
(() => {
  'use strict';

  // ---------- MODE ----------
  // Mobile = coarse pointer (touch) OR narrow viewport. Locked at load.
  const MODE = (matchMedia('(pointer: coarse)').matches || window.innerWidth < 768)
    ? 'mobile' : 'desktop';
  document.body.classList.add('mode-' + MODE);

  // ---------- CANVAS ----------
  // Desktop has a fixed logical size; mobile fills the viewport.
  // Edit these to your game's needs.
  let W, H;
  if (MODE === 'mobile') {
    W = window.innerWidth;
    H = window.innerHeight;
  } else {
    W = 760;
    H = 570;
  }
  document.body.style.setProperty('--canvas-w', W + 'px');
  document.body.style.setProperty('--canvas-h', H + 'px');

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.setAttribute('width',  String(W));
  canvas.setAttribute('height', String(H));

  // DPR-aware sizing so focus-mode CSS scaling stays sharp.
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
    // Tell the input helpers what coord space we draw in.
    canvas.dataset.logicalW = W;
    canvas.dataset.logicalH = H;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // ---------- AUDIO ----------
  // Shared engine — see /shared/sfx.js for the named library.
  const sfx = window.ZSFX.create({ storageKey: 'zamborin-__GAME_SLUG__.sound' });

  // ---------- INPUT ----------
  // Shared helpers — see /shared/input.js for the full API.
  const I = window.ZInput;

  I.onTap(canvas, ({ x, y, isDouble }) => {
    sfx.ensureAudio();          // wake audio on first user gesture
    // TODO: handle tap at (x, y). `isDouble` is true on the second of a
    // double-tap pair if you opt in via opts.doubleTapMs.
  });

  // Uncomment if your game needs swipe (4-way) — required for any
  // arcade-style game that ships on mobile per Zamborin's project rule.
  // I.onSwipe(canvas, (direction) => {
  //   // direction is 'up' | 'down' | 'left' | 'right'
  // });

  // Uncomment for drag-based games (Untangle-style, Carrom-style).
  // I.onDrag(canvas, {
  //   start: ({ x, y }) => { ... },
  //   move:  ({ x, y, dx, dy }) => { ... },
  //   end:   ({ x, y }) => { ... },
  // });

  // ---------- GAME STATE ----------
  // TODO: declare your state here.

  // ---------- RENDER LOOP ----------
  function loop() {
    ctx.fillStyle = '#0E1726';
    ctx.fillRect(0, 0, W, H);

    // TODO: draw your game here.
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 24px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('__GAME_NAME__', W / 2, H / 2);

    requestAnimationFrame(loop);
  }

  // Wait for the splash to finish before starting the game.
  window.addEventListener('splash-done', () => {
    requestAnimationFrame(loop);
  });

  // If the splash element doesn't exist (e.g. dev preview), start anyway.
  if (!document.getElementById('splash')) {
    requestAnimationFrame(loop);
  }
})();
