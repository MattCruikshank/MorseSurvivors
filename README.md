# Morse Survivors

A browser game for practicing Morse code. Creatures come down at you from the top of the screen, and each one carries a character: **G** is the Ghost 👻, **F** is the Fox 🦊. Key the character in Morse and the **closest** creature carrying it pops. You have 5 hearts, and you lose one each time a creature reaches you. The longer you last, the faster they come.

**Play it: https://mattcruikshank.github.io/MorseSurvivors/**

It works on desktop and on phones, and it's a companion to the [Morse Code trainer](https://mattcruikshank.github.io/MorseCode/). The two share a look, keyer and timing. On its first run, the game picks up your speed and sound settings from the trainer.

## How to play

- **Key:** hold <kbd>Space</kbd>, or press and hold anywhere on the playing field. A short press is a dot and a long press is a dash. Pause briefly to finish a character.
- Each creature comes at you like a little train: its **character** leads, the **creature** follows, and its **Morse code** trails behind. Try to key it from the character alone, so you learn the code instead of reading it.
- Letters A–Z each have a creature whose name starts with that letter. Digits 0–9 have their own creatures.
- <kbd>Backspace</kbd>, or a run of 6 or more dots, cancels a character you're partway through. <kbd>Esc</kbd> pauses the game.

## Settings

Settings are saved in your browser.

- **Appearance:** System, Light or Dark theme
- **Characters:** letters A–Z and/or numbers 0–9, or only the characters you list (e.g. `ETANIM`)
- **Input:** Morse key, or typing for practice
- **Display:** show or hide the Morse code behind each creature, plus an optional keyer display. The keyer display is off by default and can sit in any of 9 spots on the screen.
- **Difficulty:** hearts, time for a creature to reach you, how fast creatures speed up, how often new ones arrive (and how fast that ramps up), and the most on screen at once. A table shows the ramp-up over time.
- **Keying speed:** WPM, with optional Farnsworth spacing
- **Sound:** sidetone, sound effects, pitch and volume

## Run it locally

There's no build step. Open `index.html`, or serve the folder:

```sh
python -m http.server 8000
```

## Publish on GitHub Pages

Push to a repository, then go to **Settings → Pages**, choose **Deploy from a branch**, and pick `main` and `/ (root)`. `.nojekyll` is included.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, overlays and the settings drawer |
| `style.css` | Theme tokens (light/dark), playing field, creatures |
| `js/morse.js` | Morse tables (shared with the trainer) |
| `js/creatures.js` | The cast: one creature per character |
| `js/game.js` | Game loop, spawning, keyer, audio, settings |
