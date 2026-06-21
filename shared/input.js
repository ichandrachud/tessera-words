/* Zamborin shared input — pointer / touch helpers that hide the
   getBoundingClientRect math, the touchstart/touchend plumbing, and the
   per-game double-tap / swipe / drag boilerplate.

   Coordinates returned to callbacks are ALWAYS in canvas logical space
   (the W/H the game draws in), not CSS pixels. Works on desktop mouse,
   touch screens, and stylus.

   Usage:
     const I = window.ZInput;

     // Single tap (+ optional double-tap on the same "target")
     I.onTap(canvas, ({ x, y, isDouble }) => { ... }, {
       doubleTapMs: 320,
       targetKey: ({ x, y }) => Math.floor((x - GRID_X) / CELL),   // column id
     });

     // 4-way swipe — direction is 'up' | 'down' | 'left' | 'right'
     I.onSwipe(canvas, (direction, { x, y }) => { ... }, { threshold: 30 });

     // Drag with start / move / end
     I.onDrag(canvas, {
       start: ({ x, y }) => { ... },
       move:  ({ x, y, dx, dy }) => { ... },
       end:   ({ x, y }) => { ... },
     });

     // Raw helper if you want to write your own listener
     const { x, y } = I.getXY(canvas, ev.clientX, ev.clientY);
*/
(function () {
  'use strict';

  // ---------- COORD CONVERSION ----------
  // Returns { x, y } in canvas logical space — i.e. the same coordinate
  // system the game uses for ctx.fillRect, hit tests, etc. Falls back
  // gracefully if the canvas hasn't been sized yet (returns CSS-pixel coords).
  function getXY(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width  || rect.width  || 1;
    const H = canvas.height || rect.height || 1;
    // Most Zamborin games scale the canvas backing store by DPR and apply
    // a setTransform inside their resize handler so 1 unit = 1 logical px.
    // The visible CSS rect is the divisor that maps back to that space.
    const x = ((clientX - rect.left) / rect.width)  * (canvas.dataset.logicalW || (W / (window.devicePixelRatio || 1)));
    const y = ((clientY - rect.top)  / rect.height) * (canvas.dataset.logicalH || (H / (window.devicePixelRatio || 1)));
    return { x, y };
  }

  // ---------- TAP / DOUBLE-TAP ----------
  // Handler receives { x, y, isDouble, event }. Double-tap requires the
  // optional targetKey() to return the same value for both taps within
  // doubleTapMs (e.g. same column, same tile, same button). If no
  // targetKey is provided, ANY two taps within the window count as a
  // double-tap.
  function onTap(canvas, handler, opts) {
    opts = opts || {};
    const doubleTapMs = opts.doubleTapMs || 0;
    const targetKey   = opts.targetKey   || null;
    let lastTapAt = 0;
    let lastKey = null;

    function fire(e) {
      const p = getXY(canvas, e.clientX, e.clientY);
      let isDouble = false;
      if (doubleTapMs) {
        const tNow = (e.timeStamp != null) ? e.timeStamp : performance.now();
        const thisKey = targetKey ? targetKey(p) : '_any';
        if (lastKey === thisKey && (tNow - lastTapAt) < doubleTapMs) {
          isDouble = true;
          lastTapAt = 0;
          lastKey = null;
        } else {
          lastTapAt = tNow;
          lastKey = thisKey;
        }
      }
      handler({ x: p.x, y: p.y, isDouble, event: e });
    }

    function handle(e) {
      if (e.preventDefault) e.preventDefault();
      fire(e);
    }
    canvas.addEventListener('pointerdown', handle);
    return () => canvas.removeEventListener('pointerdown', handle);
  }

  // ---------- SWIPE (4-way) ----------
  // Fires once per gesture, on touchend / pointerup, IF the drag distance
  // exceeded `threshold` px in either axis. Direction is the dominant axis.
  function onSwipe(canvas, handler, opts) {
    opts = opts || {};
    const threshold = opts.threshold || 30;
    let startX = 0, startY = 0, active = false;

    function down(e) {
      const p = getXY(canvas, e.clientX, e.clientY);
      startX = p.x; startY = p.y; active = true;
    }
    function up(e) {
      if (!active) return;
      active = false;
      const p = getXY(canvas, e.clientX, e.clientY);
      const dx = p.x - startX, dy = p.y - startY;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      if (absX < threshold && absY < threshold) return;     // not a swipe
      const direction = (absX > absY)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down'  : 'up');
      handler(direction, { x: p.x, y: p.y, dx, dy });
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup',   up);
    canvas.addEventListener('pointercancel', () => { active = false; });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup',   up);
    };
  }

  // ---------- DRAG ----------
  // start({x,y}) → move({x,y,dx,dy}) → end({x,y}).
  // dx/dy are deltas from the previous move (not the start).
  function onDrag(canvas, handlers, opts) {
    handlers = handlers || {};
    let dragging = false, lastX = 0, lastY = 0;

    function down(e) {
      if (e.preventDefault) e.preventDefault();
      const p = getXY(canvas, e.clientX, e.clientY);
      dragging = true;
      lastX = p.x; lastY = p.y;
      if (handlers.start) handlers.start({ x: p.x, y: p.y });
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (!dragging) return;
      const p = getXY(canvas, e.clientX, e.clientY);
      const dx = p.x - lastX, dy = p.y - lastY;
      lastX = p.x; lastY = p.y;
      if (handlers.move) handlers.move({ x: p.x, y: p.y, dx, dy });
    }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      const p = getXY(canvas, e.clientX, e.clientY);
      if (handlers.end) handlers.end({ x: p.x, y: p.y });
    }
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup',   up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup',   up);
      canvas.removeEventListener('pointercancel', up);
    };
  }

  window.ZInput = { getXY, onTap, onSwipe, onDrag };
})();
