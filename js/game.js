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
    mode: 'words', maxLen: 5,
    letters: true, numbers: false, only: '',
    input: 'morse', onWrong: 'reset',
    showCode: true, showName: true, highlight: true, keyerPos: 'off',
    heartsMax: 5, approach: 30, speedUp: 15, spawn: 5, spawnUp: 15, maxMobs: 8,
    wpm: 12, farnsworth: true, fwpm: 8,
    sound: true, sfx: true, pitch: 600, volume: 0.5
  };
  function loadSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* ignore */ }
    if (saved) return Object.assign({}, DEFAULTS, saved);
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
  const approachAt = (min) => S.approach / (1 + (S.speedUp / 100) * min);          // seconds to reach you
  const spawnEveryAt = (min) => Math.max(0.6, S.spawn / (1 + (S.spawnUp / 100) * min)); // seconds between spawns

  // ======================================================================
  // Morse tables
  // ======================================================================
  const codeToChar = {}, charToCode = {};
  for (const set of Object.values(MORSE)) {
    for (const [ch, code] of Object.entries(set)) { codeToChar[code] = ch; charToCode[ch] = code; }
  }

  // ======================================================================
  // DOM
  // ======================================================================
  const arena = $('#arena'), mobsEl = $('#mobs'), hero = $('#hero');
  const entry = $('#entry'), typedEl = $('#typed'), liveEl = $('#live'), typeBox = $('#typeBox');
  const heartsEl = $('#hearts'), scoreEl = $('#score'), clockEl = $('#clock');
  const overlay = $('#overlay'), ovTitle = $('#ovTitle'), ovBody = $('#ovBody'), ovBtn = $('#ovBtn'), ovFoot = $('#ovFoot');

  let W = 0, H = 0, monSize = 48, heroSize = 56;
  function measure() {
    W = arena.clientWidth; H = arena.clientHeight;
    monSize = clamp(Math.min(W, H) * 0.075, 30, 60);
    heroSize = monSize * 1.2;
    arena.style.setProperty('--mon', monSize + 'px');
    arena.style.setProperty('--hero', heroSize + 'px');
    const lab = clamp(monSize * 0.4, 14, 22);
    mobsEl.style.setProperty('--lab', lab + 'px');
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
  let mobs = [];         // {label, emoji, el, nm, cd, ang, r, speed, wob, wf, wp, x, y, dead}
  let t = 0, nextSpawn = 0, score = 0, hearts = 5, lastFrame = 0;
  let buffer = '';       // letters keyed so far toward a name
  let overGuard = 0;

  const live = () => mobs.filter((m) => !m.dead);

  function startGame() {
    for (const m of mobs) m.el.remove();
    mobs = [];
    t = 0; nextSpawn = 1; score = 0; hearts = S.heartsMax; buffer = '';
    resetKeyer();
    hero.textContent = '🧍';
    state = 'playing';
    overlay.hidden = true;
    renderHud(); renderEntry();
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
    let best = { score: 0, time: 0 };
    try { best = Object.assign(best, JSON.parse(localStorage.getItem('morseSurvivors.best') || '{}')); } catch (e) { /* ignore */ }
    const isBest = score > best.score || (score === best.score && t > best.time && score > 0);
    if (isBest) { best = { score, time: t }; try { localStorage.setItem('morseSurvivors.best', JSON.stringify(best)); } catch (e) { /* ignore */ } }
    overGuard = performance.now() + 900;
    setTimeout(() => { if (state === 'over') showOverlay('over', { isBest, best }); }, 700);
  }

  // ---- Spawning ----------------------------------------------------------
  function namePool() {
    const pool = CREATURES.filter((c) => c.n.length <= S.maxLen);
    return pool.length ? pool : CREATURES;
  }
  function charPool() {
    const only = Array.from(S.only.toUpperCase()).filter((c) => charToCode[c]);
    if (only.length) return [...new Set(only)];
    let chars = [];
    if (S.letters) chars = chars.concat(Object.keys(MORSE.letters));
    if (S.numbers) chars = chars.concat(Object.keys(MORSE.numbers));
    return chars.length ? chars : Object.keys(MORSE.letters);
  }

  function spawn() {
    const onScreen = new Set(live().map((m) => m.label));
    let label, emoji;
    if (S.mode === 'letters') {
      const pool = charPool();
      const fresh = pool.filter((c) => !onScreen.has(c));
      label = pick(fresh.length ? fresh : pool);
      emoji = pick(CREATURES).e;
    } else {
      const pool = namePool();
      const fresh = pool.filter((c) => !onScreen.has(c.n));
      const c = pick(fresh.length ? fresh : pool);
      label = c.n; emoji = c.e;
    }

    // Pick a direction away from creatures that are already coming.
    const others = live().map((m) => m.ang);
    let ang = rand(0, Math.PI * 2), bestGap = -1;
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2);
      let gap = Math.PI;
      for (const o of others) { const d = Math.abs(((a - o + Math.PI * 3) % (Math.PI * 2)) - Math.PI); gap = Math.min(gap, d); }
      if (gap > bestGap) { bestGap = gap; ang = a; }
    }
    // Start just outside the field, along that direction.
    const margin = monSize * 1.2;
    const hx = W / 2 + margin, hy = H / 2 + margin;
    const c = Math.abs(Math.cos(ang)) || 1e-6, s = Math.abs(Math.sin(ang)) || 1e-6;
    const r = Math.min(hx / c, hy / s);
    // Every creature takes the same time to arrive, whichever side it comes from.
    const speed = r / approachAt(t / 60);

    const el = document.createElement('div');
    el.className = 'mob';
    el.innerHTML = `<span class="e">${emoji}</span><span class="nm"></span><span class="cd marks"></span>`;
    const m = {
      label, emoji, el, nm: el.querySelector('.nm'), cd: el.querySelector('.cd'),
      ang, r, speed, wob: rand(0, 0.35) * monSize, wf: rand(0.6, 1.6), wp: rand(0, 6.28),
      x: 0, y: 0, dead: false
    };
    mobsEl.appendChild(el);
    mobs.push(m);
    renderMob(m);
    place(m);
  }

  function place(m) {
    const ca = Math.cos(m.ang), sa = Math.sin(m.ang);
    const damp = clamp((m.r - heroSize) / (heroSize * 3), 0, 1); // fly straight at the end
    const w = m.wob * damp * Math.sin(t * m.wf * 2 * Math.PI + m.wp);
    m.x = W / 2 + m.r * ca - sa * w;
    m.y = H / 2 + m.r * sa + ca * w;
    // The emoji sits on the path; labels hang below it.
    m.el.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, ${-monSize * 0.55}px)`;
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
    const hitR = heroSize * 0.5 + monSize * 0.3;
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
    // If what you were keying only matched the creature that just bit you, start fresh.
    if (buffer && !live().some((x) => x.label.startsWith(buffer))) { buffer = ''; renderAllMobs(); renderEntry(); }
    if (hearts <= 0) gameOver();
  }

  function popClosest(label) {
    let best = null;
    for (const m of live()) if (m.label === label && (!best || m.r < best.r)) best = m;
    if (!best) return;
    best.el.querySelector('.e').textContent = '💥';
    removeMob(best, 'pop', 450);
    score++;
    sfx('pop');
    renderHud();
  }

  // ======================================================================
  // Entering characters (from Morse or typing)
  // ======================================================================
  function enterChar(ch) {
    if (state !== 'playing') return;
    const next = buffer + ch;
    const matches = live().filter((m) => m.label.startsWith(next));
    if (!matches.length) return wrong(next);
    if (matches.some((m) => m.label === next)) { popClosest(next); buffer = ''; }
    else buffer = next;
    renderAllMobs(); renderEntry();
  }

  let badTimer = 0;
  function wrong(shown) {
    sfx('wrong');
    if (S.onWrong === 'reset') buffer = '';
    arena.classList.add('bad');
    entry.classList.remove('bad'); void entry.offsetWidth; entry.classList.add('bad');
    typedEl.textContent = shown;
    clearTimeout(badTimer);
    badTimer = setTimeout(() => { arena.classList.remove('bad'); entry.classList.remove('bad'); renderEntry(); }, 450);
    renderAllMobs();
  }

  function clearBuffer() {
    buffer = '';
    renderAllMobs(); renderEntry();
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
    if (!c) return;
    if (/^\.{6,}$/.test(c)) return clearBuffer(); // the "error" prosign: a run of dots wipes your input
    const ch = codeToChar[c];
    if (!ch) return wrong(buffer + '?');
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
  const marks = (c) => Array.from(c).map((s) => `<i class="${s === '.' ? 'd' : 'h'}"></i>`).join('');

  function renderMob(m) {
    const matched = buffer && m.label.startsWith(buffer) ? buffer.length : 0;
    const hl = S.highlight ? matched : 0;
    m.el.classList.toggle('match', hl > 0);
    m.nm.hidden = !S.showName;
    if (S.showName) m.nm.innerHTML = `<b>${esc(m.label.slice(0, hl))}</b>${esc(m.label.slice(hl))}`;
    m.cd.hidden = !S.showCode;
    if (S.showCode) {
      m.cd.innerHTML = Array.from(m.label).map((ch, i) =>
        `<span class="grp${i < hl ? ' on' : ''}">${marks(charToCode[ch] || '')}</span>`).join('');
    }
  }
  function renderAllMobs() { for (const m of mobs) if (!m.dead) renderMob(m); }

  function renderLive(pending) {
    if (S.keyerPos === 'off') return;
    liveEl.innerHTML = marks(code) + (pending ? `<i class="${pending === '.' ? 'd' : 'h'} pending"></i>` : '');
  }
  function renderEntry() {
    entry.hidden = S.keyerPos === 'off';
    entry.dataset.pos = S.keyerPos;
    typedEl.textContent = buffer;
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

  function lineup() {
    return CREATURES.filter((c) => c.n.length <= Math.max(5, S.maxLen)).slice(0, 12).map((c) => c.e).join('');
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
      const what = S.mode === 'letters' ? 'the character it carries' : 'its name';
      ovBody.innerHTML = `<div class="lineup">${lineup()}</div>
        <ul>
          <li>Creatures are closing in on you from every side.</li>
          <li>To pop one, ${howToKey()}. Key ${what} and the <b>closest</b> one that matches goes 💥.</li>
          <li>You have ${S.heartsMax} ${S.heartsMax === 1 ? 'heart' : 'hearts'}. You lose one each time a creature reaches you.</li>
          <li>They get faster, and come more often, the longer you last.</li>
        </ul>`;
      ovBtn.textContent = 'Start';
      const best = readBest();
      ovFoot.innerHTML = (best.score ? `Best: ${best.score} popped in ${fmtTime(best.time)}. ` : '') +
        'Change the speed, mode and more in Settings ⚙.';
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
  function updateModeUI() {
    $('#wordsOpts').hidden = S.mode !== 'words';
    $('#lettersOpts').hidden = S.mode !== 'letters';
    $('#modeNote').textContent = S.mode === 'words'
      ? 'Each creature has a name, like BAT or GHOST. Key the name to pop it.'
      : 'Each creature carries one character. Key it to pop it.';
    const pool = CREATURES.filter((c) => c.n.length <= S.maxLen);
    $('#maxLenOut').textContent = `${S.maxLen}${S.maxLen >= 8 ? '+' : ''} letters (${pool.length} creatures)`;
    const g = $('#lettersOpts');
    const onlyOn = S.only.trim().length > 0;
    for (const id of ['letters', 'numbers']) $('#' + id).closest('label').classList.toggle('disabled-group', onlyOn);
    g.querySelector('.field small').textContent = onlyOn ? `(using ${charPool().join(' ')})` : '(blank = all of the above)';
    if (state === 'title') showOverlay('title');
  }
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
    bindRadio('mode', 'mode', () => { clearBuffer(); updateModeUI(); });
    bindRadio('input', 'input', () => { resetKeyer(); if (state === 'title') showOverlay('title'); });
    bindRadio('onWrong', 'onWrong');
    bindRadio('keyerPos', 'keyerPos', renderEntry);

    bindRange('maxLen', updateModeUI);
    for (const id of ['letters', 'numbers']) {
      bindCheck(id, (el) => { if (!S.letters && !S.numbers) { S[id] = true; el.checked = true; save(); } updateModeUI(); });
    }
    const only = $('#only');
    only.value = S.only;
    only.addEventListener('input', () => {
      S.only = Array.from(only.value.toUpperCase()).filter((c) => charToCode[c]).join('');
      save(); updateModeUI();
    });

    for (const id of ['showCode', 'showName', 'highlight']) bindCheck(id, renderAllMobs);

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

    updateModeUI(); updateSpeedUI(); updateDifficultyUI();
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
    const overlayUp = state !== 'playing';
    if (overlayUp && (isSpace(e) || e.key === 'Enter')) {
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
      else if (buffer) { buffer = buffer.slice(0, -1); renderAllMobs(); renderEntry(); }
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
