(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ======================================================================
  // Settings
  // ======================================================================
  const KEY = 'morseSurvivors.settings';
  const DEFAULTS = {
    theme: 'system',
    letters: true, numbers: false, only: '',
    input: 'morse',
    showCode: true, keyerPos: 'off',
    heartsMax: 5, approach: 30, speedUp: 15, spawn: 4, spawnUp: 15, maxMobs: 8,
    wpm: 12, farnsworth: true, fwpm: 8,
    sound: true, sfx: true, pitch: 600, volume: 0.5
  };
  function loadSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    if (saved) {
      const s = {};
      for (const k of Object.keys(DEFAULTS)) s[k] = k in saved ? saved[k] : DEFAULTS[k]; // drop retired settings
      return s;
    }
    // First visit: borrow keying and sound preferences from the Morse Code trainer, if it ran on this site.
    const s = Object.assign({}, DEFAULTS);
    try {
      const t = JSON.parse(localStorage.getItem('morse.settings') || '{}');
      for (const k of ['theme', 'wpm', 'farnsworth', 'fwpm', 'sound', 'pitch', 'volume']) if (k in t) s[k] = t[k];
    } catch (e) { /* ignore */ }
    return s;
  }
  const S = loadSettings();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode */ } }

  // Keying timing, same as the trainer. One dot = 1200 / WPM ms ("PARIS").
  const unit = () => 1200 / S.wpm;
  function gapUnit() {
    if (!S.farnsworth || S.fwpm >= S.wpm) return unit();
    const c = S.wpm, s = S.fwpm;
    const ta = (60 * c - 37.2 * s) / (s * c);
    return (ta / 19) * 1000;
  }
  const dashThreshold = () => 2 * unit();
  const letterGap = () => 3 * gapUnit();

  // Difficulty ramp. Both grow linearly with minutes played.
  const approachAt = (min) => S.approach / (1 + (S.speedUp / 100) * min);              // seconds to reach you
  const spawnEveryAt = (min) => Math.max(0.6, S.spawn / (1 + (S.spawnUp / 100) * min)); // seconds between spawns

  // ======================================================================
  // Morse tables
  // ======================================================================
  const codeToChar = {}, charToCode = {};
  for (const set of Object.values(MORSE)) {
    for (const [ch, code] of Object.entries(set)) { codeToChar[code] = ch; charToCode[ch] = code; }
  }

  function charPool() {
    const only = Array.from(S.only.toUpperCase()).filter((c) => CAST[c]);
    if (only.length) return [...new Set(only)];
    let chars = [];
    if (S.letters) chars = chars.concat(Object.keys(MORSE.letters));
    if (S.numbers) chars = chars.concat(Object.keys(MORSE.numbers));
    return chars.length ? chars : Object.keys(MORSE.letters);
  }

  // ======================================================================
  // DOM
  // ======================================================================
  const arena = $('#arena'), mobsEl = $('#mobs'), hero = $('#hero');
  const entry = $('#entry'), typedEl = $('#typed'), liveEl = $('#live'), typeBox = $('#typeBox');
  const heartsEl = $('#hearts'), scoreEl = $('#score'), clockEl = $('#clock');
  const overlay = $('#overlay'), ovTitle = $('#ovTitle'), ovBody = $('#ovBody'), ovBtn = $('#ovBtn'), ovFoot = $('#ovFoot');

  // The player stands at the bottom middle; HERO_GAP is the space below them.
  const HERO_GAP = 14;
  let W = 0, H = 0, monSize = 48, heroSize = 56, heroX = 0, heroY = 0;
  function measure() {
    W = arena.clientWidth; H = arena.clientHeight;
    monSize = clamp(Math.min(W, H) * 0.075, 30, 60);
    heroSize = monSize * 1.2;
    heroX = W / 2;
    heroY = H - HERO_GAP - heroSize / 2;
    arena.style.setProperty('--mon', monSize + 'px');
    arena.style.setProperty('--hero', heroSize + 'px');
    arena.style.setProperty('--hero-gap', HERO_GAP + 'px');
    for (const m of mobs) place(m);
  }

  // ======================================================================
  // Audio: sidetone + little sound effects
  // ======================================================================
  let ac = null, osc = null, gain = null;
  function ensureAudio() {
    if (!ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      ac = new Ctx();
      osc = ac.createOscillator(); gain = ac.createGain();
      osc.type = 'sine'; osc.frequency.value = S.pitch; gain.gain.value = 0;
      osc.connect(gain).connect(ac.destination); osc.start();
    }
    if (ac.state === 'suspended') ac.resume();
    return true;
  }
  function toneOn() {
    if (!S.sound || !ensureAudio()) return;
    const t = ac.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(S.volume * 0.5, t, 0.004);
  }
  function toneOff() {
    if (!ac) return;
    const t = ac.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0, t, 0.006);
  }
  const SFX = {
    pop: { type: 'triangle', f0: 520, f1: 1500, dur: 0.16, vol: 0.45 },
    hurt: { type: 'sawtooth', f0: 200, f1: 55, dur: 0.4, vol: 0.3 },
    wrong: { type: 'square', f0: 120, f1: 100, dur: 0.14, vol: 0.14 },
    over: { type: 'sawtooth', f0: 300, f1: 40, dur: 1.1, vol: 0.3 }
  };
  function sfx(name) {
    if (!S.sfx || S.volume <= 0 || !ensureAudio()) return;
    const p = SFX[name], t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = p.type;
    o.frequency.setValueAtTime(p.f0, t);
    o.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur);
    g.gain.setValueAtTime(p.vol * S.volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + p.dur + 0.02);
  }

  // ======================================================================
  // Game state
  // ======================================================================
  let state = 'title';   // title | playing | paused | over
  let mobs = [];         // {ch, el, ux, uy, r, speed, wob, wf, wp, x, y, dead}
  let t = 0, nextSpawn = 0, score = 0, hearts = 5, lastFrame = 0;
  let overGuard = 0;

  const live = () => mobs.filter((m) => !m.dead);

  function startGame() {
    for (const m of mobs) m.el.remove();
    mobs = [];
    t = 0; nextSpawn = 1; score = 0; hearts = S.heartsMax;
    resetKeyer();
    showKeyed('', '');
    hero.textContent = '🧍';
    state = 'playing';
    overlay.hidden = true;
    renderHud();
    ensureAudio();
    if (S.input === 'typing') focusTypeBox();
    lastFrame = performance.now();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    resetKeyer();
    showOverlay('paused');
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    overlay.hidden = true;
    lastFrame = performance.now();
    if (S.input === 'typing') focusTypeBox();
  }

  function gameOver() {
    state = 'over';
    resetKeyer();
    hero.textContent = '🪦';
    sfx('over');
    let best = readBest();
    const isBest = score > best.score || (score === best.score && t > best.time && score > 0);
    if (isBest) { best = { score, time: t }; try { localStorage.setItem('morseSurvivors.best', JSON.stringify(best)); } catch (e) { /* ignore */ } }
    overGuard = performance.now() + 900;
    setTimeout(() => { if (state === 'over') showOverlay('over', { isBest, best }); }, 700);
  }

  // ---- Spawning ----------------------------------------------------------
  function spawn() {
    const pool = charPool();
    const onScreen = new Set(live().map((m) => m.ch));
    const fresh = pool.filter((c) => !onScreen.has(c));
    const ch = pick(fresh.length ? fresh : pool);

    // Enter from the top, at an x away from the creatures that have just come in.
    const recent = live().filter((m) => m.y < H * 0.4);
    const pad = monSize * 0.8;
    let x = rand(pad, W - pad), bestGap = -1;
    for (let i = 0; i < 10; i++) {
      const cx = rand(pad, Math.max(pad + 1, W - pad));
      let gap = Infinity;
      for (const m of recent) gap = Math.min(gap, Math.abs(cx - m.x));
      if (gap > bestGap) { bestGap = gap; x = cx; }
    }
    const y = -monSize * 0.6; // the train's head (its character) is first onto the screen
    const dx = x - heroX, dy = y - heroY, r = Math.hypot(dx, dy);
    const ux = dx / r, uy = dy / r;
    const cast = CAST[ch] || { e: '👾', n: '' };

    // A little train pointing at the player: character in front, then the creature, then its Morse code.
    const el = document.createElement('div');
    el.className = 'mob';
    const at = (k) => `left:${(ux * k * monSize).toFixed(1)}px;top:${(uy * k * monSize).toFixed(1)}px`;
    el.innerHTML = `<span class="ch" style="${at(0)}">${esc(ch)}</span>` +
      `<span class="e" style="${at(1.0)}" title="${esc(cast.n)}">${cast.e}</span>` +
      `<span class="cd marks" style="${at(2.0)}">${marks(charToCode[ch] || '')}</span>`;
    const m = {
      ch, el, ux, uy, r,
      // Every creature takes the same time to reach you, wherever it starts.
      speed: r / approachAt(t / 60),
      wob: rand(0, 0.35) * monSize, wf: rand(0.4, 1.2), wp: rand(0, 6.28),
      x, y, dead: false
    };
    mobsEl.appendChild(el);
    mobs.push(m);
    place(m);
  }

  function place(m) {
    const damp = clamp((m.r - heroSize) / (heroSize * 3), 0, 1); // fly straight at the end
    const w = m.wob * damp * Math.sin(t * m.wf * 2 * Math.PI + m.wp);
    m.x = heroX + m.r * m.ux - m.uy * w;
    m.y = heroY + m.r * m.uy + m.ux * w;
    m.el.style.transform = `translate(${m.x}px, ${m.y}px)`;
  }

  // ---- Main loop -----------------------------------------------------------
  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state === 'playing') step(dt);
    requestAnimationFrame(frame);
  }

  let lastClock = -1;
  function step(dt) {
    t += dt;
    if (t >= nextSpawn) {
      if (live().length < S.maxMobs) { spawn(); nextSpawn = t + spawnEveryAt(t / 60); }
      else nextSpawn = t + 0.25;
    }
    const hitR = heroSize * 0.45 + monSize * 0.3;
    for (const m of mobs) {
      if (m.dead) continue;
      m.r -= m.speed * dt;
      place(m);
      if (m.r <= hitR) bite(m);
      if (state !== 'playing') return;
    }
    const sec = Math.floor(t);
    if (sec !== lastClock) { lastClock = sec; clockEl.textContent = fmtTime(t); }
  }

  function removeMob(m, cls, ms) {
    m.dead = true;
    m.el.classList.add(cls);
    setTimeout(() => { m.el.remove(); mobs = mobs.filter((x) => x !== m); }, ms);
  }

  function bite(m) {
    removeMob(m, 'bite', 420);
    hearts--;
    sfx('hurt');
    hero.classList.remove('hit'); arena.classList.remove('hurt');
    void hero.offsetWidth;
    hero.classList.add('hit'); arena.classList.add('hurt');
    renderHud(true);
    if (hearts <= 0) gameOver();
  }

  // ======================================================================
  // Entering a character (from Morse or typing)
  // ======================================================================
  function enterChar(ch) {
    if (state !== 'playing') return;
    let best = null;
    for (const m of live()) if (m.ch === ch && (!best || m.r < best.r)) best = m;
    if (!best) return wrong(ch);
    best.el.querySelector('.e').textContent = '💥';
    removeMob(best, 'pop', 450);
    score++;
    sfx('pop');
    renderHud();
    showKeyed(ch, 'ok');
  }

  let badTimer = 0;
  function wrong(ch) {
    sfx('wrong');
    arena.classList.add('bad');
    entry.classList.remove('bad'); void entry.offsetWidth; entry.classList.add('bad');
    showKeyed(ch, 'bad');
    clearTimeout(badTimer);
    badTimer = setTimeout(() => { arena.classList.remove('bad'); entry.classList.remove('bad'); }, 450);
  }

  // The keyer display shows the last character you keyed, briefly.
  let keyedTimer = 0;
  function showKeyed(ch, kind) {
    typedEl.textContent = ch;
    typedEl.className = 'typed' + (kind ? ' ' + kind : '');
    clearTimeout(keyedTimer);
    if (ch) keyedTimer = setTimeout(() => { typedEl.textContent = ''; typedEl.className = 'typed'; }, 900);
  }

  // ======================================================================
  // Morse keyer
  // ======================================================================
  let down = false, t0 = 0, code = '', rafId = 0, letterTimer = 0;
  const symFor = (ms) => (ms >= dashThreshold() ? '-' : '.');

  function canKey() { return state === 'playing' && S.input === 'morse'; }

  function pressKey() {
    if (down || !canKey()) return;
    down = true; t0 = performance.now();
    clearTimeout(letterTimer);
    toneOn();
    arena.classList.add('tx');
    if (!code) showKeyed('', '');
    preview();
  }
  function preview() {
    if (!down) return;
    renderLive(symFor(performance.now() - t0));
    rafId = requestAnimationFrame(preview);
  }
  function releaseKey() {
    if (!down) return;
    down = false;
    cancelAnimationFrame(rafId);
    toneOff();
    arena.classList.remove('tx');
    if (state !== 'playing') return;
    code += symFor(performance.now() - t0);
    renderLive();
    letterTimer = setTimeout(commitCode, letterGap());
  }
  function commitCode() {
    const c = code;
    code = '';
    renderLive();
    if (!c || /^\.{6,}$/.test(c)) return; // a run of dots (the "error" prosign) just cancels
    const ch = codeToChar[c];
    if (!ch) return wrong('?');
    enterChar(ch);
  }
  function resetKeyer() {
    if (down) { down = false; cancelAnimationFrame(rafId); toneOff(); arena.classList.remove('tx'); }
    clearTimeout(letterTimer);
    code = '';
    renderLive();
  }

  // ======================================================================
  // Rendering
  // ======================================================================
  function marks(c) { return Array.from(c).map((s) => `<i class="${s === '.' ? 'd' : 'h'}"></i>`).join(''); }

  function renderLive(pending) {
    if (S.keyerPos === 'off') return;
    liveEl.innerHTML = marks(code) + (pending ? `<i class="${pending === '.' ? 'd' : 'h'} pending"></i>` : '');
  }
  function renderEntry() {
    entry.hidden = S.keyerPos === 'off';
    entry.dataset.pos = S.keyerPos;
    renderLive();
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function renderHud(broke) {
    let h = '';
    for (let i = 0; i < S.heartsMax; i++) {
      const lost = i >= hearts;
      const cls = lost ? (broke && i === hearts ? 'lost breaking' : 'lost') : '';
      h += `<span class="${cls}">❤️</span>`;
    }
    heartsEl.innerHTML = h;
    heartsEl.setAttribute('aria-label', `${Math.max(0, hearts)} of ${S.heartsMax} hearts`);
    scoreEl.textContent = score;
    clockEl.textContent = fmtTime(t);
  }

  function castList() {
    return '<div class="cast">' + charPool().map((ch) => {
      const c = CAST[ch];
      return `<span title="${esc(c.n)}"><b>${esc(ch)}</b>${c.e}</span>`;
    }).join('') + '</div>';
  }
  function howToKey() {
    return S.input === 'typing'
      ? 'type it on the keyboard'
      : 'key it in Morse: hold <kbd>Space</kbd>, or press and hold anywhere on the field';
  }

  function showOverlay(kind, info) {
    overlay.hidden = false;
    ovFoot.textContent = '';
    if (kind === 'title') {
      ovTitle.textContent = 'Morse Survivors';
      ovBody.innerHTML = `${castList()}
        <ul>
          <li>Creatures come down at you from the top. Each one carries a character, like <b>G</b> for the Ghost 👻.</li>
          <li>To pop one, ${howToKey()}. The <b>closest</b> one with that character goes 💥.</li>
          <li>The character leads the way, the creature follows, and its Morse code trails behind. Try to key it before you read the code.</li>
          <li>You have ${S.heartsMax} ${S.heartsMax === 1 ? 'heart' : 'hearts'}. You lose one each time a creature reaches you.</li>
        </ul>`;
      ovBtn.textContent = 'Start';
      const best = readBest();
      ovFoot.innerHTML = (best.score ? `Best: ${best.score} popped in ${fmtTime(best.time)}. ` : '') +
        'Change the speed, characters and more in Settings ⚙.';
    } else if (kind === 'paused') {
      ovTitle.textContent = 'Paused';
      ovBody.innerHTML = `<p>${score} popped, ${fmtTime(t)} survived.</p>
        <p><button type="button" class="btn" id="restartBtn">Start over</button></p>`;
      $('#restartBtn').addEventListener('click', startGame);
      ovBtn.textContent = 'Resume';
      ovFoot.innerHTML = 'Press <kbd>Esc</kbd> or <kbd>Space</kbd> to resume.';
    } else if (kind === 'over') {
      ovTitle.textContent = 'Game over';
      ovBody.innerHTML = `<div class="big-stats">
          <div><b>${score}</b><span>popped</span></div>
          <div><b>${fmtTime(t)}</b><span>survived</span></div>
        </div>
        ${info.isBest ? '<p class="best">🏆 New personal best!</p>' : `<p class="fine">Best: ${info.best.score} popped in ${fmtTime(info.best.time)}</p>`}`;
      ovBtn.textContent = 'Play again';
    }
  }
  function readBest() {
    try { return Object.assign({ score: 0, time: 0 }, JSON.parse(localStorage.getItem('morseSurvivors.best') || '{}')); }
    catch (e) { return { score: 0, time: 0 }; }
  }
  function overlayAction() {
    if (state === 'paused') resume();
    else if (state === 'over' && performance.now() < overGuard) return;
    else startGame();
  }

  // ======================================================================
  // Settings UI
  // ======================================================================
  function applyTheme() {
    if (S.theme === 'light' || S.theme === 'dark') document.documentElement.setAttribute('data-theme', S.theme);
    else document.documentElement.removeAttribute('data-theme');
  }
  function updateCharsUI() {
    const onlyOn = S.only.trim().length > 0;
    for (const id of ['letters', 'numbers']) $('#' + id).closest('label').classList.toggle('disabled-group', onlyOn);
    $('#onlyNote').textContent = onlyOn ? `(using ${charPool().join(' ')})` : '(blank = all of the above)';
    if (state === 'title') showOverlay('title');
  }
  function updateCodeUI() { arena.classList.toggle('no-code', !S.showCode); }
  function updateSpeedUI() {
    $('#wpm').value = S.wpm;
    $('#fwpm').max = S.wpm;
    $('#fwpm').value = Math.min(S.fwpm, S.wpm);
    $('#wpmOut').textContent = `${S.wpm} WPM`;
    $('#fwpmOut').textContent = `${Math.min(S.fwpm, S.wpm)} WPM`;
    $('#fwpm').disabled = !S.farnsworth;
    $('#fwpmRow').classList.toggle('disabled', !S.farnsworth);
    const r = (ms) => Math.round(ms) + ' ms';
    const rows = [
      ['Dot (1 unit)', r(unit())],
      ['Dash (3 units)', r(3 * unit())],
      ['A press longer than this is a dash', r(dashThreshold())],
      ['Silence that ends a letter', r(letterGap())]
    ];
    $('#timing').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }
  function updateDifficultyUI() {
    const sec = (v) => (Math.round(v * 10) / 10) + ' s';
    $('#heartsMaxOut').textContent = S.heartsMax;
    $('#approachOut').textContent = sec(S.approach);
    $('#speedUpOut').textContent = `${S.speedUp}% a minute`;
    $('#spawnOut').textContent = sec(S.spawn);
    $('#spawnUpOut').textContent = `${S.spawnUp}% a minute`;
    $('#maxMobsOut').textContent = S.maxMobs;
    let h = '<tr><th>After</th><th>Reaches you in</th><th>New one every</th></tr>';
    for (const min of [0, 1, 2, 3, 5, 10]) {
      h += `<tr><td>${min === 0 ? 'Start' : min + ' min'}</td><td>${sec(approachAt(min))}</td><td>${sec(spawnEveryAt(min))}</td></tr>`;
    }
    $('#ramp').innerHTML = h;
  }

  function bindRadio(name, key, after) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((r) => {
      r.checked = r.value === S[key];
      r.addEventListener('change', () => { S[key] = r.value; save(); after && after(); });
    });
  }
  function bindCheck(id, after) {
    const el = $('#' + id);
    el.checked = S[id];
    el.addEventListener('change', () => { S[id] = el.checked; save(); after && after(el); });
  }
  function bindRange(id, after) {
    const el = $('#' + id);
    el.value = S[id];
    el.addEventListener('input', () => { S[id] = +el.value; save(); after && after(); });
  }

  function bindSettings() {
    bindRadio('theme', 'theme', applyTheme);
    bindRadio('input', 'input', () => { resetKeyer(); if (state === 'title') showOverlay('title'); });
    bindRadio('keyerPos', 'keyerPos', renderEntry);

    for (const id of ['letters', 'numbers']) {
      bindCheck(id, (el) => { if (!S.letters && !S.numbers) { S[id] = true; el.checked = true; save(); } updateCharsUI(); });
    }
    const only = $('#only');
    only.value = S.only;
    only.addEventListener('input', () => {
      S.only = Array.from(only.value.toUpperCase()).filter((c) => CAST[c]).join('');
      save(); updateCharsUI();
    });

    bindCheck('showCode', updateCodeUI);

    bindRange('heartsMax', () => {
      if (state === 'title') { hearts = S.heartsMax; showOverlay('title'); }
      else hearts = Math.min(hearts, S.heartsMax);
      renderHud(); updateDifficultyUI();
    });
    for (const id of ['approach', 'speedUp', 'spawn', 'spawnUp', 'maxMobs']) bindRange(id, updateDifficultyUI);

    $('#wpm').addEventListener('input', (e) => { S.wpm = +e.target.value; if (S.fwpm > S.wpm) S.fwpm = S.wpm; save(); updateSpeedUI(); });
    $('#fwpm').addEventListener('input', (e) => { S.fwpm = +e.target.value; save(); updateSpeedUI(); });
    bindCheck('farnsworth', updateSpeedUI);

    bindCheck('sound', () => { if (!S.sound) toneOff(); });
    bindCheck('sfx');
    const pitch = $('#pitch'), vol = $('#volume');
    pitch.value = S.pitch; vol.value = Math.round(S.volume * 100);
    const soundOut = () => { $('#pitchOut').textContent = S.pitch + ' Hz'; $('#volumeOut').textContent = Math.round(S.volume * 100) + '%'; };
    pitch.addEventListener('input', () => {
      S.pitch = +pitch.value; save(); soundOut();
      if (osc) osc.frequency.setTargetAtTime(S.pitch, ac.currentTime, 0.01);
    });
    vol.addEventListener('input', () => { S.volume = vol.value / 100; save(); soundOut(); });
    soundOut();

    $('#resetSettings').addEventListener('click', () => {
      if (!confirm('Put every setting back to its default?')) return;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      location.reload();
    });

    updateCharsUI(); updateCodeUI(); updateSpeedUI(); updateDifficultyUI();
  }

  const drawer = $('#settings'), scrim = $('#scrim');
  const drawerOpen = () => drawer.classList.contains('open');
  function openSettings() {
    pause();
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); scrim.hidden = false;
  }
  function closeSettings() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); scrim.hidden = true;
    if (drawer.contains(document.activeElement)) document.activeElement.blur();
  }

  // ======================================================================
  // Input wiring
  // ======================================================================
  const isTyping = (el) => el && el !== typeBox && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' && /^(text|search|email|number|url|password)$/i.test(el.type)));
  const isSpace = (e) => e.code === 'Space' || e.key === ' ';

  function focusTypeBox() {
    try { typeBox.focus({ preventScroll: true }); } catch (e) { typeBox.focus(); }
  }

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) { if (e.key === 'Escape') closeSettings(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (drawerOpen()) closeSettings();
      else if (state === 'playing') pause();
      else if (state === 'paused') resume();
      return;
    }
    if (drawerOpen()) return;
    if (state !== 'playing' && (isSpace(e) || e.key === 'Enter')) {
      if (e.target.tagName === 'BUTTON' && e.key === 'Enter') return; // let the focused button click itself
      e.preventDefault();
      if (!e.repeat) overlayAction();
      return;
    }
    if (state !== 'playing') return;
    if (isSpace(e)) {
      e.preventDefault();
      if (!e.repeat) pressKey();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (code) { clearTimeout(letterTimer); code = ''; renderLive(); }
      return;
    }
    if (S.input === 'typing' && e.target !== typeBox && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toUpperCase();
      if (charToCode[ch]) { e.preventDefault(); enterChar(ch); }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (!isSpace(e) || isTyping(e.target)) return;
    e.preventDefault();
    releaseKey();
  });
  window.addEventListener('blur', releaseKey);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // Typing mode: the hidden box catches phone keyboards (and desktop, when it has focus).
  typeBox.addEventListener('input', () => {
    const v = typeBox.value.toUpperCase();
    typeBox.value = '';
    for (const ch of v) if (charToCode[ch]) enterChar(ch);
  });

  // The whole field is the key.
  arena.addEventListener('pointerdown', (e) => {
    if (state !== 'playing' || e.button !== 0) return;
    e.preventDefault();
    if (S.input === 'typing') { focusTypeBox(); return; }
    try { arena.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    pressKey();
  });
  arena.addEventListener('pointerup', releaseKey);
  arena.addEventListener('pointercancel', releaseKey);
  arena.addEventListener('lostpointercapture', releaseKey);
  arena.addEventListener('contextmenu', (e) => e.preventDefault());

  ovBtn.addEventListener('click', (e) => { overlayAction(); e.currentTarget.blur(); });
  $('#pauseBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (state === 'playing') pause(); else if (state === 'paused') resume();
  });
  $('#openSettings').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  scrim.addEventListener('click', closeSettings);
  window.addEventListener('resize', measure);

  // ======================================================================
  // Boot
  // ======================================================================
  applyTheme();
  hearts = S.heartsMax;
  bindSettings();
  measure();
  renderHud();
  renderEntry();
  showOverlay('title');
  requestAnimationFrame((now) => { lastFrame = now; requestAnimationFrame(frame); });
})();
