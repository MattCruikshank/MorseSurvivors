# CLAUDE.md

Morse Survivors is a browser game for practicing Morse code. Creatures come down from the top toward the player at the bottom middle. Each one carries one character, and keying that character pops the closest one carrying it. It's plain HTML, CSS and JS with no build step, no framework and no dependencies, and it's hosted on GitHub Pages at https://mattcruikshank.github.io/MorseSurvivors/. Pushing to `main` deploys it.

## Sibling project

`../MorseCode` (https://mattcruikshank.github.io/MorseCode/) is the Morse trainer this game is a companion to. Keep the two consistent:

- `js/morse.js` is a straight copy of the trainer's file. Change both or neither.
- The theme tokens in `style.css` (`:root`, the dark-mode media query, `[data-theme="dark"]`), the settings drawer markup and classes (`.drawer`, `fieldset`, `.seg`, `.range`, `.check`) and the keyer timing (PARIS unit, Farnsworth formula, dash at 2 units or more, letter ends after 3 gap-units) all match the trainer. Port changes in either direction when they apply.
- Both sites share one origin, so they share `localStorage`. The trainer uses `morse.settings`; this game uses `morseSurvivors.settings` and `morseSurvivors.best`. On first run, the game copies the theme, WPM, Farnsworth and sound settings from `morse.settings` (`loadSettings` in `js/game.js`). Don't write to the trainer's key.

## Layout

- `index.html`: top bar (HUD), `#arena` (the playing field; it's also the Morse key), overlays (title, pause, game over), settings drawer. A small inline script applies the saved theme before first paint. It reads `morseSurvivors.settings`, so keep its key in sync with `KEY` in `game.js`.
- `js/creatures.js`: `CAST` maps each character (A–Z, 0–9) to `{ e: emoji, n: name }`. Pick a creature whose name starts with the letter (G is a Ghost), so the picture helps people remember the letter. Every character the settings can enable needs an entry. Use emoji that render widely; Unicode 14 (🩻) is about as new as it gets.
- `js/game.js`: a single IIFE. It's organised in banner-comment sections: Settings, Morse tables, DOM, Audio, Game state, Spawning, Main loop, Entering characters, Morse keyer, Rendering, Settings UI, Input wiring, Boot.
- `style.css`: theme tokens first, then the field, creatures, keyer display, overlays and drawer.

## Conventions

- **Adding a setting:** add it to `DEFAULTS`, add the control to the drawer in `index.html` with `id` equal to the setting name (radios use `name`), and wire it in `bindSettings()` with `bindCheck`, `bindRange` or `bindRadio`. Those helpers save automatically.
- The keyer display (`#entry`) is **off by default**. Don't add an always-on keyer UI or KEY button. The whole field is the key (Space, or press and hold), and `data-pos` takes one of `tl tc tr ml mc mr bl bc br`.
- **Each creature is a train pointed at the player:** character in front, then the creature, then its Morse code, spaced along the direction of travel (`spawn()` sets each part's left/top; `.mob` is a zero-size anchor at the head). All three are always visible; nothing fades or pops in. The order is the teaching point: you meet the character first and the code last. The `showCode` setting hides the code.
- Every creature takes `approachAt(minutes)` seconds to reach the player, wherever it starts (speed = spawn distance ÷ time). Keep that fairness when changing movement.
- All input, Morse or typed, goes through `enterChar(ch)`. A character that matches no creature goes to `wrong()`.
- `loadSettings()` keeps only the keys in `DEFAULTS`, so a retired setting disappears from saved data the next time settings are saved.
- Words mode (keying whole names) was removed so the game could focus on single characters. It's in git history (commit `91dd9e4`) if it comes back.
- Write user-facing text in plain, friendly sentences, in the trainer's style.

## Testing

There are no automated tests. To check changes, drive the page in headless Chrome with `puppeteer-core`, using the installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`). Install it in the scratchpad, not in this repo, and don't add a `package.json` here. Useful approaches:

- Seed `localStorage['morseSurvivors.settings']` before reloading. Fast keying (`wpm: 20, farnsworth: false`), a short `spawn`, `sound: false` and `keyerPos: 'bc'` all help.
- Key Morse with `keyboard.down('Space')` and `up` (at 20 WPM, about 60 ms for a dot and 200 ms for a dash, with about 260 ms between letters). Read characters from `.mob .ch` (the lowest one on screen is the closest), and check that `#score` goes up.
- Take screenshots in light and dark, at desktop size and at a 390×800 touch viewport. Collect `pageerror` and console errors.

## Publishing

Commit to `main` and push. Pages rebuilds in about a minute; check that https://mattcruikshank.github.io/MorseSurvivors/ returns 200. `.nojekyll` must stay.
