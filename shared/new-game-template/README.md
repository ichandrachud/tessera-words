# New-game scaffold

The fastest way to start a new Zamborin game. Copy this folder, rename
it to your game's URL slug, find-and-replace the placeholders, and you
have a working canvas + audio + input + splash already wired.

## Quick start

```bash
# 1. Copy the folder to the project root, named after the URL slug.
cp -R shared/new-game-template chess

# 2. Find-and-replace these placeholders in the new folder.
# Use VS Code's "search in folder" or sed.
#   __GAME_NAME__         e.g. "Chess"             (display name)
#   __GAME_SLUG__         e.g. "chess"             (URL + localStorage key)
#   __GAME_DESCRIPTION__  one-sentence pitch for SEO / OG card
#   __GAME_TAGLINE__      short title line, e.g. "Move pieces, take squares"
#   __GAME_OG_ALT__       alt text for the OG image
```

## What you get for free

- **Mobile + desktop layout** — `MODE` is detected at load, canvas is
  sized to fit the viewport (mobile) or fixed dimensions (desktop).
- **DPR-sharp canvas** — `resizeCanvas()` keeps the backing buffer
  matched to display pixels × devicePixelRatio.
- **Audio** — `sfx.play('drop')`, `sfx.play('win')`, etc. from
  `/shared/sfx.js`. Per-game sound on/off persisted to localStorage.
- **Input** — `ZInput.onTap` / `onSwipe` / `onDrag` from
  `/shared/input.js`. Handles all the pointer/touch coord-conversion math.
- **Splash** — `splash-done` event fires after the 2 s splash so the
  render loop only starts once the user can see the game.
- **Focus mode** — the fullscreen button in the header is already wired.
- **OG metadata** — Twitter + Facebook cards point at
  `/images/<slug>-og.jpg` (drop a 1200×630 there).

## What you still need to do

1. **Set canvas dimensions.** `W` and `H` at the top of `play.js` default
   to 760×570 desktop and the viewport on mobile. Change as needed.
2. **Write the game.** Game state, render loop, input handlers — fill in
   the `TODO`s.
3. **Drop in an OG image.** Save a 1200×630 jpg at
   `/images/<slug>-og.jpg` and the OG / Twitter cards work.
4. **Add the game to the lobby card list** in `/index.html`.
5. **Splash visual.** `play.css` has a placeholder gradient + wordmark.
   Replace with your splash image when ready.

## Shared modules available

| File | Purpose |
|---|---|
| `/shared/tokens.css` | Design tokens (already loaded) |
| `/shared/chrome.css` | Site frame + mobile auto-focus (already loaded) |
| `/shared/sfx.js` | `ZSFX.create({ storageKey })` audio engine |
| `/shared/input.js` | `ZInput.onTap / onSwipe / onDrag` helpers |
