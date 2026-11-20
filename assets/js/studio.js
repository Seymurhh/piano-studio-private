// Piano studio: play live from the piano, load or record a performance, watch it in 3D, and make a video. Everything runs in the browser.
import { $, fetchJSON, session, b64, importKey, readVault, openBytes } from './core.js?v=5';
import { parseMidi, fromRecording, writeMidi, demoPiece, noteName } from './midi.js?v=12';
import { createStage } from './stage.js?v=25';
import { createListener, STYLE_NAMES } from './listen.js?v=8';
import { drawCard, OPEN, CLOSE, STYLES } from './cards.js?v=2';
import { INSTRUMENTS, ROOMS, makeOutput, noteOn, voice, renderPiece, loadInstrument, isLoaded } from './synth.js?v=12';

const LEAD = 1.5, TAIL = 2.5; // seconds of runway before the first note and after the last
const canvas = $('#stage'), box = $('#stagebox'), stage = createStage(canvas);
const P = { piece: null, name: '', playing: false, pos: -LEAD, rate: 1, bus: null, t0: 0, p0: 0, next: 0, busy: false };
const A = { ctx: null, out: null, ear: null }; // sound: one audio context, and the chain every note passes through
const V = { rec: null, chunks: [], dest: null }; // live screen recording
const R = { on: false, events: [], start: 0 }; // recording of what is played
const L = { access: null, inputs: [], held: new Map(), trail: [], voices: new Map(), sustained: [], pedal: false, last: -99 }; // live playing
// ---------- opening and closing cards ----------
const capital = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function guessMeta(piece, name) { // from the file: "Title (Composer) - subtitle" in its track name, or else its file name
  const label = piece.label || '', m = label.match(/^(.*?)\s*\((.*?)\)\s*(?:[-–—:]\s*(.*))?$/);
  if (m) return { title: m[1], composer: m[2], subtitle: m[3] ? m[3].charAt(0).toUpperCase() + m[3].slice(1) : '', credits: [] };
  return { title: label || capital(String(name || '').replace(/[_-]+/g, ' ')), composer: '', subtitle: '', credits: [] };
}
function fillCard(meta) {
  $('#card-title').value = meta.title || ''; $('#card-composer').value = meta.composer || '';
  $('#card-subtitle').value = meta.subtitle || ''; $('#card-credits').value = (meta.credits || []).join('\n');
}
const soundCredit = () => ((INSTRUMENTS.find((i) => i.id === C.instrument) || {}).pack === 'grand'
  ? 'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)' : 'Instrument sound: FluidR3 GM by Frank Wen (MIT)');
function cardInfo() {
  const v = (id) => $(id).value.trim();
  return { title: v('#card-title'), composer: v('#card-composer'), subtitle: v('#card-subtitle'), channel: C.channel, message: C.message,
    credits: [...v('#card-credits').split('\n').map((s) => s.trim()).filter(Boolean), soundCredit()] }; // the sound's licence asks for credit, so it is always there
}
const accentColor = () => stage.themes()[C.theme]?.[0] || '#3dffa0';
let previewRun = 0;
function previewCard(kind) { // play a card over the picture, as it will appear in the video
  const cv = $('#cardview'), run = ++previewRun, t0 = performance.now(), dur = kind === 'open' ? OPEN : CLOSE, info = cardInfo(), tint = accentColor();
  cv.hidden = false;
  const tick = () => {
    if (run !== previewRun) return;
    const u = (performance.now() - t0) / 1000, r = Math.min(devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * r), h = Math.round(cv.clientHeight * r);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, h);
    if (u > dur) { cv.hidden = true; return; }
    drawCard(g, w, h, kind, u, info, C.cardStyle, tint);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const ui = Object.fromEntries(['play', 'seek', 'clock', 'speed', 'midifile', 'demo', 'record', 'savemidi', 'labels', 'effects', 'motion', 'mic', 'capture', 'vtitle', 'size', 'fps',
  'export', 'prog', 'download', 'overlay', 'connect', 'volume', 'monitor', 'now', 'ribbon', 'library', 'dots', 'paths', 'glow'].map((id) => [id, $('#' + id)]));
const say = (id, text) => { $('#' + id).textContent = text; };
const mmss = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const safeName = () => (P.name || 'piano').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'piano';
const clock = () => performance.now() / 1000;
const fill = (el) => el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min || 1)) * 100}%`);

// ---------- choices are remembered on this computer ----------
const PHONE = matchMedia('(max-width: 640px)').matches; // a phone held upright: start with the tall picture looking along the keys, which fills the screen
const DEFAULTS = { instrument: 'grand', room: 'hall', volume: 0.9, monitor: true, theme: 'aurora', view: 'piano', v: 3, dance: 'auto', camera: PHONE ? 'side' : 'front', shape: PHONE ? 'tall' : 'wide', notes: 'trails', ribbon: true, dots: true, strip: 'notes', paths: true, sheetCam: 'side', glow: 0.45, sky: 'stars', landing: 'sparks', cardOpen: true, cardClose: true, cardStyle: 'lumen', channel: 'Lumen Keys', message: 'Thank you for listening', labels: false, effects: true, motion: !matchMedia('(prefers-reduced-motion: reduce)').matches };
const C = { ...DEFAULTS };
try { const saved = JSON.parse(localStorage.getItem('studio') || '{}'); if (!(saved.v >= 2)) delete saved.labels; if (saved.v !== 3) delete saved.notes; Object.assign(C, saved, { v: 3 }); } catch {} // v 2: note names off unless switched on again; v 3: notes are trails of light unless changed again
const remember = () => { try { localStorage.setItem('studio', JSON.stringify(C)); } catch {} };

function fit() { // even sizes keep video encoders happy
  if (P.busy) return;
  const w = Math.max(2, Math.floor((canvas.clientWidth || 960) / 2) * 2), tall = C.shape === 'tall';
  stage.resize(w, Math.round((w * (tall ? 16 / 9 : 9 / 16)) / 2) * 2);
}
new ResizeObserver(fit).observe(box);

function enable() {
  const off = !P.piece || R.on || M.on;
  for (const k of ['play', 'seek', 'export', 'savemidi']) ui[k].disabled = off;
  if (V.rec) ui.export.disabled = true;
}
function load(piece, name, meta) {
  pause();
  if (piece) fillCard(meta || guessMeta(piece, name));
  P.piece = piece; P.name = name; P.pos = -LEAD; L.last = -99;
  stage.setPiece(piece);
  say('piece-title', name);
  const pedals = piece ? piece.pedal.filter((p) => p.down).length : 0;
  say('piece-info', piece ? `${piece.notes.length} notes, ${mmss(piece.duration)} long${pedals ? `, ${pedals} pedal presses` : ''}.` : '');
  if (piece) { ui.seek.min = -LEAD; ui.seek.max = piece.duration + TAIL; ui.seek.value = P.pos; fill(ui.seek); }
  ui.download.hidden = true;
  enable();
}

// ---------- sound ----------
function audio() {
  if (!A.ctx) { A.ctx = new AudioContext({ latencyHint: 'interactive' }); A.ear = createListener(A.ctx); } // the ear hears everything the studio plays, and the microphone
  if (A.ctx.state !== 'running') A.ctx.resume();
  if (!A.out) newOutput();
  return A.ctx;
}
function newOutput() {
  if (!A.ctx) return;
  const old = A.out, was = P.playing;
  if (was) pause();
  for (const h of [...L.voices.values(), ...L.sustained]) h.release(0);
  L.voices.clear(); L.sustained = [];
  A.out = makeOutput(A.ctx, { instrument: C.instrument, room: C.room, volume: C.volume });
  if (V.dest) A.out.tap.connect(V.dest);
  A.out.tap.connect(A.ear.node);
  old?.close();
  if (was) play();
}
addEventListener('pointerdown', () => { if (A.ctx && A.ctx.state !== 'running') A.ctx.resume(); }, true);

function radios(el, items, current, pick) { // a row or list of buttons that behave like radio buttons
  const set = (v) => { for (const b of el.children) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  for (const it of items) {
    if (el.querySelector(`[data-v="${it.id}"]`)) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = it.id;
    it.build ? it.build(b) : (b.textContent = it.name);
    el.append(b);
  }
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { set(b.dataset.v); pick(b.dataset.v, b); } });
  set(current);
  return set;
}

let wanted = C.instrument;
async function chooseInstrument(id, card, preview) {
  wanted = id;
  const bar = card?.querySelector('i');
  try {
    if (!isLoaded(id)) say('rec-msg', 'Loading the instrument…');
    await loadInstrument(id, (f) => { if (bar) bar.style.width = `${f * 100}%`; });
  } catch (err) {
    if (bar) bar.style.width = '0';
    setInstrument(C.instrument);
    return say('rec-msg', `${err.message || 'The sound files could not be loaded.'} The studio keeps using the previous sound.`);
  }
  if (bar) setTimeout(() => { bar.style.width = '0'; }, 400);
  if (wanted !== id) return; // another one was chosen while this was loading
  if ($('#rec-msg').textContent === 'Loading the instrument…') say('rec-msg', '');
  C.instrument = id; remember(); newOutput();
  if (preview && !P.playing && !R.on) { // a short broken chord, so the choice can be heard straight away
    audio();
    [48, 60, 64, 67, 72].forEach((p, i) => voice(A.ctx, A.out, p, 0.5 + 0.08 * i, A.ctx.currentTime + 0.05 + i * 0.13, 1.6 - i * 0.13));
  }
}
const setInstrument = radios($('#instruments'), INSTRUMENTS.map((i) => ({ id: i.id, build(b) {
  b.className = 'card';
  const name = document.createElement('b'), about = document.createElement('small');
  name.textContent = i.name; about.textContent = i.about;
  b.append(name, about, document.createElement('i'));
} })), C.instrument, (id, b) => chooseInstrument(id, b, true));
radios($('#rooms'), ROOMS, C.room, (id) => { C.room = id; remember(); newOutput(); });
ui.volume.value = C.volume; fill(ui.volume);
ui.volume.addEventListener('input', () => { C.volume = Number(ui.volume.value); fill(ui.volume); A.out?.setVolume(C.volume); remember(); });
ui.monitor.checked = C.monitor;
ui.monitor.addEventListener('change', () => { C.monitor = ui.monitor.checked; remember(); if (!C.monitor) { for (const h of [...L.voices.values(), ...L.sustained]) h.release(0); L.voices.clear(); L.sustained = []; } });

// ---------- playback ----------
const now = () => (P.playing ? P.p0 + (A.ctx.currentTime - P.t0) * P.rate : P.pos);
function play() {
  if (!P.piece || P.busy || R.on || M.on) return;
  audio();
  if (P.pos >= P.piece.duration + TAIL - 0.05) P.pos = -LEAD;
  const g = A.ctx.createGain(); g.connect(A.out.input);
  P.bus = { input: g, instrument: A.out.instrument }; // its own tap, so pausing silences notes that were already scheduled
  P.p0 = P.pos; P.t0 = A.ctx.currentTime + 0.06;
  P.next = P.piece.notes.findIndex((n) => n.onset >= P.pos);
  if (P.next < 0) P.next = P.piece.notes.length;
  P.playing = true; L.last = -99;
  ui.play.classList.add('playing'); ui.play.setAttribute('aria-label', 'Pause');
}
function pause() {
  if (P.playing) P.pos = now();
  P.playing = false; ui.play.classList.remove('playing'); ui.play.setAttribute('aria-label', 'Play');
  if (P.bus) { const g = P.bus.input; g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.02); setTimeout(() => g.disconnect(), 300); P.bus = null; }
}
function schedule() {
  const t = now(), notes = P.piece.notes;
  while (P.next < notes.length && notes[P.next].onset < t + 0.25) {
    const n = notes[P.next++];
    voice(A.ctx, P.bus, n.pitch, n.vel, P.t0 + (n.onset - P.p0) / P.rate, (n.end - n.onset) / P.rate);
  }
}
function frame() {
  requestAnimationFrame(frame);
  if (P.busy) return;
  const t = clock();
  if (C.view === 'dancer') hear();
  if (M.on) { listen(); return; }
  if (!P.playing && (R.on || L.held.size || t - L.last < 5)) { // someone is playing: show their notes leaving the keys
    while (L.trail.length && L.trail[0].t1 != null && t - L.trail[0].t1 > 30) L.trail.shift();
    stage.render(t, true);
    if (R.on) ui.clock.textContent = `${mmss(t - R.start)} recorded`;
    return;
  }
  if (P.playing) {
    schedule(); P.pos = now();
    if (P.pos >= P.piece.duration + TAIL) pause();
    ui.seek.value = P.pos; fill(ui.seek);
  }
  stage.render(P.pos);
  if (P.piece) ui.clock.textContent = `${mmss(P.pos)} / ${mmss(P.piece.duration)}`;
}
ui.play.addEventListener('click', () => (P.playing ? pause() : play()));
ui.seek.addEventListener('input', () => { const was = P.playing; pause(); P.pos = Number(ui.seek.value); fill(ui.seek); L.last = -99; if (was) play(); });
ui.speed.addEventListener('change', () => { const was = P.playing; pause(); P.rate = Number(ui.speed.value); if (was) play(); });

// ---------- look ----------
function accent() { // the page takes its accent colour from the light strip of the chosen colours
  const led = stage.themes()[C.theme]?.[0] || '#3dffa0', n = parseInt(led.slice(1), 16);
  document.documentElement.style.setProperty('--accent', led);
  const bright = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  document.documentElement.style.setProperty('--accent-ink', bright > 0.5 ? '#08090b' : '#ffffff');
}
const THEME_NAMES = { aurora: 'Aurora', ember: 'Ember', noir: 'Gold', jewel: 'Jewel', emerald: 'Emerald' };
radios($('#themes'), Object.entries(stage.themes()).map(([id, colors]) => ({ id, build(b) {
  b.className = 'swatch';
  const chips = document.createElement('span'), label = document.createElement('span');
  chips.className = 'chips'; label.textContent = THEME_NAMES[id] || id;
  for (const c of colors.slice(0, 4)) { const i = document.createElement('i'); i.style.background = c; chips.append(i); }
  b.append(chips, label);
} })), C.theme, (id) => { C.theme = id; remember(); stage.setTheme(id); accent(); });
setInterval(() => { if (C.view === 'dancer' && A.ear && !P.busy) A.ear.update(clock()); }, 12); // listening keeps its own steady pace, apart from the picture
function hear() { // dancer view: tell the stage what the music is doing, and say it in words
  const F = A.ear ? A.ear.features : null;
  stage.setMusic(F);
  if (F?.active && $('#rec-msg').textContent.startsWith('The dancer is waiting')) say('rec-msg', '');
  const style = C.dance === 'auto' ? F?.style : C.dance;
  if (!L.held.size || !C.labels) ui.now.textContent = F?.active ? `${STYLE_NAMES[style]}${F.clear > 0.35 ? ` · ${Math.round(F.step)} beats a minute` : ''}` : '';
}
function pictureChanged() {
  $('#dance-box').hidden = C.view !== 'dancer';
  document.body.classList.toggle('no-keys', C.view !== 'piano');
  document.body.classList.toggle('no-sheet', C.view !== 'sheet');
  if (C.view !== 'dancer') { stage.setMusic(null); if (!L.held.size) ui.now.textContent = ''; }
  else if (!A.ctx) say('rec-msg', 'The dancer is waiting for music: press "Listen with the microphone", or Play, or play the piano.');
}
radios($('#views'), [], C.view, (v) => { C.view = v; remember(); stage.setView(M.on && (v === 'piano' || v === 'sheet') ? 'flight' : v); pictureChanged(); });
radios($('#dances'), [], C.dance, (v) => { C.dance = v; remember(); stage.setDance(v); });
radios($('#cameras'), [], C.camera, (v) => { C.camera = v; remember(); stage.setCamera(v); });
radios($('#shapes'), [], C.shape, (v) => { C.shape = v; remember(); box.classList.toggle('tall', v === 'tall'); fit(); });
radios($('#notes'), [], C.notes, (v) => { C.notes = v; remember(); stage.setNotes(v); });
radios($('#strip'), [], C.strip, (v) => { C.strip = v; remember(); stage.setStrip(v); });
radios($('#sheetcam'), [], C.sheetCam, (v) => { C.sheetCam = v; remember(); stage.setSheetCam(v); });
radios($('#sky'), [], C.sky, (v) => { C.sky = v; remember(); stage.setSky(v); });
for (const [id, key] of [['#card-open', 'cardOpen'], ['#card-close', 'cardClose']]) { $(id).checked = C[key]; $(id).addEventListener('change', () => { C[key] = $(id).checked; remember(); }); }
for (const [id, key] of [['#card-channel', 'channel'], ['#card-message', 'message']]) { $(id).value = C[key]; $(id).addEventListener('input', () => { C[key] = $(id).value; remember(); }); }
$('#card-style').innerHTML = Object.entries(STYLES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
$('#card-style').value = C.cardStyle; $('#card-style').addEventListener('change', () => { C.cardStyle = $('#card-style').value; remember(); });
$('#preview-open').addEventListener('click', () => previewCard('open'));
$('#preview-close').addEventListener('click', () => previewCard('close'));
radios($('#landing'), [], C.landing, (v) => { C.landing = v; remember(); stage.setLanding(v); });
stage.setLanding(C.landing);
stage.setSheetCam(C.sheetCam); stage.setSky(C.sky); stage.setGlow(C.glow);
ui.glow.value = C.glow; fill(ui.glow);
ui.glow.addEventListener('input', () => { C.glow = Number(ui.glow.value); remember(); stage.setGlow(C.glow); fill(ui.glow); });
stage.setStrip(C.strip);
stage.setNotes(C.notes);
for (const [k, fn] of [['labels', 'setLabels'], ['effects', 'setEffects'], ['motion', 'setMotion'], ['ribbon', 'setRibbon'], ['dots', 'setDots'], ['paths', 'setPaths']]) {
  ui[k].checked = C[k]; stage[fn](C[k]);
  ui[k].addEventListener('change', () => { C[k] = ui[k].checked; remember(); stage[fn](C[k]); });
}
stage.setTheme(C.theme); stage.setView(C.view); stage.setDance(C.dance); pictureChanged(); stage.setCamera(C.camera); box.classList.toggle('tall', C.shape === 'tall'); accent();
ui.vtitle.addEventListener('input', () => { ui.overlay.textContent = ui.vtitle.value; });
const goFull = box.requestFullscreen || box.webkitRequestFullscreen; // iPhones have no full screen for a part of a page: there the picture simply covers the page
const unfill = () => { document.body.classList.remove('fill'); setTimeout(fit, 60); };
$('#full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (goFull) goFull.call(box);
  else { document.body.classList.add('fill'); setTimeout(fit, 60); }
});
$('#unfill').addEventListener('click', unfill);
addEventListener('keydown', (e) => { if (e.key === 'Escape') unfill(); });
addEventListener('orientationchange', () => setTimeout(fit, 250));
document.addEventListener('fullscreenchange', () => setTimeout(fit, 60));

const tabs = [...document.querySelectorAll('[role=tab]')];
function showTab(tab) {
  for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $('#' + t.getAttribute('aria-controls')).hidden = !on; }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => showTab(t));
  t.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; showTab(n); n.focus(); } });
});

// ---------- sources ----------
ui.midifile.addEventListener('change', async () => {
  const f = ui.midifile.files[0];
  if (!f) return;
  try { load(parseMidi(await f.arrayBuffer()), f.name.replace(/\.midi?$/i, '')); say('rec-msg', 'Press Play to watch and hear it.'); }
  catch (err) { say('rec-msg', err.message || 'That file could not be read.'); }
  ui.midifile.value = '';
});
ui.demo.addEventListener('click', () => { load(demoPiece(), 'Demo pattern'); play(); });

// The library: well-known pieces kept with the studio as MIDI files (assets/music/, listed in index.json).
let library = [];
fetchJSON('assets/music/index.json').then((list) => {
  library = list;
  let group = null;
  list.forEach((it, i) => {
    if (!group || group.label !== it.composer) { group = document.createElement('optgroup'); group.label = it.composer; ui.library.append(group); }
    const o = document.createElement('option'); o.value = String(i); o.textContent = it.title; group.append(o);
  });
  const o = document.createElement('option'); o.value = 'demo'; o.textContent = 'Short demo pattern'; ui.library.append(o);
}).catch(() => { ui.library.hidden = true; ui.demo.hidden = false; }); // no library on this copy of the site: offer the demo instead
ui.library.addEventListener('change', async () => {
  const v = ui.library.value;
  if (!v || P.busy || R.on || M.on) return;
  audio(); // while the click still counts as permission to make sound
  if (v === 'demo') { load(demoPiece(), 'Demo pattern'); return play(); }
  const it = library[Number(v)];
  say('rec-msg', 'Opening the piece…');
  try {
    const r = await fetch(`assets/music/${it.file}?v=1`);
    if (!r.ok) throw new Error('The piece could not be loaded.');
    load(parseMidi(await r.arrayBuffer()), `${it.title} · ${it.composer}`, { title: it.title, composer: it.composer, subtitle: '', credits: [it.credit] });
    say('rec-msg', `${it.credit}.`);
    play();
  } catch (err) { say('rec-msg', err.message || 'The piece could not be loaded.'); }
});

// ---------- live playing: the piano over its USB cable (or the computer keyboard) ----------
function showHeld() { ui.now.textContent = C.labels ? [...L.held.keys()].sort((a, b) => a - b).map(noteName).join('  ') : ''; }
function liveOn(pitch, vel) {
  const t = clock();
  liveOff(pitch, true);
  L.held.set(pitch, { vel }); L.trail.push({ pitch, vel, t0: t, t1: null }); L.last = t;
  if (L.trail.length > 400) L.trail.shift();
  if (R.on) R.events.push({ t: t - R.start, on: pitch, vel });
  if (C.monitor) {
    if (A.ctx?.state === 'running') L.voices.set(pitch, noteOn(A.ctx, A.out, pitch, vel));
    else say('rec-msg', 'Click anywhere on this page once to switch the sound on.');
  }
  showHeld();
}
function liveOff(pitch, restrike = false) {
  if (!L.held.has(pitch)) return;
  const t = clock();
  L.held.delete(pitch); L.last = t;
  for (let i = L.trail.length - 1; i >= 0; i--) if (L.trail[i].pitch === pitch && L.trail[i].t1 == null) { L.trail[i].t1 = t; break; }
  if (R.on) R.events.push({ t: t - R.start, off: pitch });
  const h = L.voices.get(pitch);
  if (h) { L.voices.delete(pitch); if (L.pedal && !restrike) L.sustained.push(h); else h.release(A.ctx.currentTime); }
  showHeld();
}
function livePedal(down) {
  L.pedal = down;
  if (R.on) R.events.push({ t: clock() - R.start, pedal: down });
  if (!down) { for (const h of L.sustained) h.release(A.ctx.currentTime); L.sustained = []; }
}
function onMidi(e) {
  const [s, a, b] = e.data, hi = s & 0xf0;
  if (hi === 0x90 && b > 0) liveOn(a, b / 127);
  else if (hi === 0x80 || hi === 0x90) liveOff(a);
  else if (hi === 0xb0 && a === 64) livePedal(b >= 64);
}
function inputsChanged() {
  L.inputs = [...L.access.inputs.values()].filter((i) => i.state !== 'disconnected');
  for (const i of L.inputs) i.onmidimessage = onMidi;
  const names = L.inputs.map((i) => i.name).join(', ');
  ui.connect.classList.toggle('on', L.inputs.length > 0);
  say('connect-text', L.inputs.length ? names : 'Connect the piano');
  return names;
}
async function connect(quiet) {
  if (!navigator.requestMIDIAccess) { if (!quiet) say('rec-msg', 'This browser cannot talk to the piano. Use Chrome or Edge on a computer.'); return false; }
  if (!L.access) {
    try { L.access = await navigator.requestMIDIAccess(); }
    catch { if (!quiet) say('rec-msg', 'Permission to use the piano was not given. Click the icon at the left of the address bar, allow MIDI devices, and try again.'); return false; }
    L.access.onstatechange = () => { const had = L.inputs.length, names = inputsChanged(); if (!had && names) say('rec-msg', `${names} is connected. Play something.`); if (had && !names) say('rec-msg', 'The piano was disconnected.'); };
  }
  const names = inputsChanged();
  if (!quiet) say('rec-msg', names ? `${names} is connected. Play something: the keys light up and you hear the instrument chosen under Sound.`
    : 'No piano found yet. Check the cable in the USB TO HOST port and that the piano is switched on. It will connect by itself when it appears.');
  return !!names;
}
ui.connect.addEventListener('click', () => { audio(); connect(false); });

ui.record.addEventListener('click', async () => {
  if (R.on) {
    R.on = false;
    ui.record.classList.remove('on'); say('record-text', 'Record');
    try {
      load(fromRecording(R.events), `Recording ${new Date().toLocaleDateString()}`);
      say('rec-msg', 'Recorded. Press Play to watch it, and "Save as MIDI file" to keep it.');
    } catch (err) { say('piece-title', 'Nothing loaded yet'); say('piece-info', ''); say('rec-msg', err.message); enable(); }
    return;
  }
  if (M.on || P.busy) return;
  audio();
  const found = await connect(true);
  pause();
  load(null, 'Recording'); say('piece-info', 'Everything she plays is being written down.');
  R.events = []; R.start = clock(); R.on = true;
  if (L.pedal) R.events.push({ t: 0, pedal: true });
  enable();
  ui.record.classList.add('on'); say('record-text', 'Stop');
  say('rec-msg', found ? `Recording from ${L.inputs.map((i) => i.name).join(', ')}. Press Stop when she has finished.`
    : 'Recording, but no piano is connected: check the USB cable. The computer keyboard works too (A S D F G H J K).');
});

// Playing by touch or with the mouse: press the keys in the picture. Several fingers at once work, and so does sliding along the keys.
const touching = new Map(); // pointer id -> pitch
function touch(e, start) {
  if (C.view !== 'piano' || P.busy || M.on) return;
  const r = canvas.getBoundingClientRect(), hit = stage.pick(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), was = touching.get(e.pointerId);
  if (!start && was == null) return;
  if (hit && hit.pitch === was) return;
  if (was != null) { liveOff(was); touching.delete(e.pointerId); }
  if (hit) { if (start) { audio(); e.preventDefault(); } touching.set(e.pointerId, hit.pitch); liveOn(hit.pitch, Math.min(0.9, Math.max(0.4, 0.45 + 0.07 * hit.depth))); } // nearer the front edge of the key = louder
}
const lift = (e) => { const was = touching.get(e.pointerId); if (was != null) { liveOff(was); touching.delete(e.pointerId); } };
canvas.addEventListener('pointerdown', (e) => touch(e, true));
canvas.addEventListener('pointermove', (e) => touch(e, false));
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, lift);

// The computer keyboard as a small piano, for trying sounds without the real one. Space is play and pause.
const KEYS = { KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65, KeyT: 66, KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71, KeyK: 72, KeyO: 73, KeyL: 74, KeyP: 75, Semicolon: 76 };
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
addEventListener('keydown', (e) => {
  if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !/^(BUTTON|A)$/.test(e.target.tagName)) { e.preventDefault(); ui.play.click(); }
  else if (KEYS[e.code] && !e.repeat && !P.busy && !M.on) { audio(); liveOn(KEYS[e.code], 0.62); }
});
addEventListener('keyup', (e) => { if (KEYS[e.code]) liveOff(KEYS[e.code]); });
addEventListener('blur', () => { for (const p of [...L.held.keys()]) liveOff(p); });

// ---------- live microphone: any sound (voice, a bird, an acoustic piano) drawn as one flying line ----------
const M = { on: false, stream: null, node: null, buf: new Float32Array(2048), pts: [], start: 0, x: 0, last: null };
function detectPitch(buf, rate) {
  let c0 = 0;
  for (let i = 0; i < buf.length; i++) c0 += buf[i] * buf[i];
  c0 /= buf.length;
  const rms = Math.sqrt(c0);
  if (rms < 0.012) return { rms, hz: 0 };
  const min = Math.floor(rate / 1600), max = Math.min(Math.floor(rate / 70), buf.length - 2), c = new Float32Array(max + 2);
  for (let lag = min - 1; lag <= max + 1; lag++) { let s = 0; for (let i = 0; i < buf.length - lag; i++) s += buf[i] * buf[i + lag]; c[lag] = s / (buf.length - lag); }
  const peak = (l) => c[l] > c[l - 1] && c[l] >= c[l + 1];
  let top = 0;
  for (let l = min; l <= max; l++) if (peak(l) && c[l] > top) top = c[l];
  if (top < 0.5 * c0) return { rms, hz: 0 }; // noise, not a clear tone
  for (let l = min; l <= max; l++) if (peak(l) && c[l] >= 0.9 * top) {
    const d = c[l - 1] - 2 * c[l] + c[l + 1], shift = d ? (0.5 * (c[l - 1] - c[l + 1])) / d : 0;
    return { rms, hz: rate / (l + shift) };
  }
  return { rms, hz: 0 };
}
function listen() {
  const t = (performance.now() - M.start) / 1000;
  M.node.getFloatTimeDomainData(M.buf);
  const { rms, hz } = detectPitch(M.buf, A.ctx.sampleRate);
  if (hz) {
    let pitch = 69 + 12 * Math.log2(hz / 440);
    if (M.last != null && Math.abs(pitch - M.last) < 2.5) pitch = M.last + (pitch - M.last) * 0.3; // steady small wobbles
    M.x = Math.max(-8, Math.min(8, M.x * 0.985 + (M.last == null ? 0 : pitch - M.last) * 0.45));
    M.pts.push({ t, off: t + 0.08, pitch, x: M.x, vel: Math.min(1, Math.max(0.2, rms * 9)) });
    M.last = pitch;
  } else M.last = null;
  while (M.pts.length && M.pts[0].t < t - 9) M.pts.shift();
  stage.render(t);
}
ui.mic.addEventListener('click', async () => {
  if (M.on) {
    M.on = false; M.stream.getTracks().forEach((tr) => tr.stop()); M.node.disconnect();
    stage.setMic(null); stage.setView(C.view); ui.mic.textContent = 'Listen with the microphone'; ui.mic.classList.remove('on');
    enable();
    return say('rec-msg', 'Stopped listening.');
  }
  if (R.on || P.busy) return;
  try { M.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch { return say('rec-msg', 'The microphone could not be used. Open this page in Chrome itself (not inside another app), click the lock icon in the address bar, allow the microphone, and try again.'); }
  pause();
  audio(); await A.ctx.resume();
  M.node = A.ctx.createAnalyser(); M.node.fftSize = 2048;
  M.src = A.ctx.createMediaStreamSource(M.stream); M.src.connect(M.node); M.src.connect(A.ear.node);
  if (V.dest) M.src.connect(V.dest);
  M.pts = []; M.x = 0; M.last = null; M.start = performance.now(); M.on = true;
  stage.setMic(M.pts); if (C.view === 'piano' || C.view === 'sheet') stage.setView('flight'); // the microphone draws flight lines, or moves the dancer; the piano picture comes back afterwards
  enable();
  ui.mic.textContent = 'Stop listening'; ui.mic.classList.add('on');
  say('rec-msg', C.view === 'dancer' ? 'Listening. Play any music near the computer: after a few seconds the dancer finds the beat. Nothing is recorded or sent anywhere.'
    : 'Listening. Sing, whistle or play one note at a time and watch the line fly. Nothing is recorded or sent anywhere.');
});

function download(bytes, type, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name;
  document.body.append(a); a.click(); a.remove();
}
ui.savemidi.addEventListener('click', () => P.piece && download(writeMidi(P.piece), 'audio/midi', safeName() + '.mid'));

// ---------- live screen recording: press Start, do anything (play, microphone, record from the piano), press Stop to save ----------
ui.capture.addEventListener('click', async () => {
  if (V.rec) return V.rec.stop();
  if (P.busy) return;
  if (!canvas.captureStream || !window.MediaRecorder) return say('cap-msg', 'This browser cannot record the screen. Use Chrome or Edge on a computer.');
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return say('cap-msg', 'This browser has no video format the studio can record.');
  audio(); await A.ctx.resume();
  V.dest = A.ctx.createMediaStreamDestination();
  A.out.tap.connect(V.dest);
  if (M.on) M.src.connect(V.dest);
  const stream = new MediaStream([...canvas.captureStream(60).getVideoTracks(), ...V.dest.stream.getAudioTracks()]);
  V.chunks = []; V.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160000 });
  const began = performance.now(), ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  V.rec.ondataavailable = (e) => { if (e.data.size) V.chunks.push(e.data); };
  V.rec.onstop = () => {
    const blob = new Blob(V.chunks, { type: type.split(';')[0] });
    stream.getTracks().forEach((tr) => tr.stop());
    try { A.out.tap.disconnect(V.dest); } catch {}
    V.rec = null; V.dest = null; V.chunks = [];
    ui.capture.textContent = 'Start filming'; ui.capture.classList.remove('on'); enable();
    if (!blob.size) return say('cap-msg', 'Nothing was recorded.');
    // Show the result on the page as well, so it can be watched and saved even where automatic downloads are blocked.
    const url = URL.createObjectURL(blob), name = `${safeName()}-live.${ext}`, prev = $('#cap-preview'), link = $('#cap-link');
    prev.src = url; prev.hidden = false; link.href = url; link.download = name; link.hidden = false;
    link.click();
    say('cap-msg', `Filmed ${mmss((performance.now() - began) / 1000)} of video (${(blob.size / 1048576).toFixed(1)} MB, .${ext}). It should be in your Downloads folder; if not, press "Save this film".`);
  };
  V.rec.start(500);
  $('#cap-preview').hidden = true; $('#cap-link').hidden = true;
  ui.capture.textContent = 'Stop and save'; ui.capture.classList.add('on'); ui.export.disabled = true;
  say('cap-msg', 'Filming… play the piano, press Play, or use the microphone. Then press "Stop and save".');
});

// ---------- video export: every frame is drawn and encoded one by one, so the result is exact however slow the computer ----------
async function pick(list, test) { for (const c of list) { try { if ((await test(c)).supported) return c; } catch {} } return null; }

async function makeVideo() {
  if (!P.piece || P.busy) return;
  if (C.view === 'dancer') return say('exp-msg', 'The dancer reacts to sound as it happens, so it cannot be drawn frame by frame. Use "Start filming" below instead.');
  if (!('VideoEncoder' in window)) return say('exp-msg', 'This browser cannot make videos. Use Chrome or Edge on a computer.');
  pause();
  const short = Number(ui.size.value), long = Math.round(short * 16 / 9), fps = Number(ui.fps.value);
  const [w, h] = C.shape === 'tall' ? [short, long] : [long, short];
  // generous bitrates: YouTube compresses again, and the cleaner the upload the better its copy looks
  const bitrate = { 720: 8e6, 1080: 16e6, 1440: 30e6, 2160: 55e6 }[short] * (fps > 30 ? 1.5 : 1);
  const big = short > 1080; // larger than Full HD needs H.264 level 5.1
  const vc = await pick(big ? [{ mux: 'avc', codec: 'avc1.640033' }, { mux: 'avc', codec: 'avc1.4d0033' }, { mux: 'vp9', codec: 'vp09.00.51.08' }]
    : [{ mux: 'avc', codec: 'avc1.64002a' }, { mux: 'avc', codec: 'avc1.640028' }, { mux: 'avc', codec: 'avc1.4d0028' }, { mux: 'vp9', codec: 'vp09.00.40.08' }],
    (c) => VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate, framerate: fps }));
  if (!vc) return say('exp-msg', 'This browser has no video encoder the studio can use.');
  const ac = 'AudioEncoder' in window ? await pick([{ mux: 'aac', codec: 'mp4a.40.2' }, { mux: 'opus', codec: 'opus' }],
    (c) => AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })) : null;

  P.busy = true;
  for (const k of ['play', 'seek', 'export', 'record', 'demo', 'capture', 'mic']) ui[k].disabled = true;
  ui.prog.hidden = false; ui.prog.value = 0; ui.download.hidden = true;
  say('exp-msg', 'Making the video. Keep this tab open and in front.');
  try {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.js?v=5');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: vc.mux, width: w, height: h, frameRate: fps },
      ...(ac ? { audio: { codec: ac.mux, sampleRate: 48000, numberOfChannels: 2 } } : {}) });
    let failed = null;
    const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
    venc.configure({ codec: vc.codec, width: w, height: h, bitrate, framerate: fps });

    // Each frame is drawn larger than the video (twice the size up to Full HD) and scaled down, which smooths every
    // edge and keeps fine lines steady instead of flickering.
    stage.resize(w, h, short <= 1080 ? 2 : short <= 1440 ? 1.5 : 1);
    const comp = document.createElement('canvas'); comp.width = w; comp.height = h;
    const g = comp.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const title = ui.vtitle.value.trim(), intro = C.cardOpen ? OPEN : 0, outro = C.cardClose ? CLOSE : 0, end = P.piece.duration + TAIL;
    const total = Math.ceil((intro + LEAD + P.piece.duration + TAIL + outro) * fps), info = cardInfo(), tint = accentColor();
    for (let i = 0; i < total && !failed; i++) {
      const t = i / fps - LEAD - intro; // music time: the opening card plays before the runway, the closing card after the end
      stage.render(Math.min(t, end + 2.5));
      g.drawImage(canvas, 0, 0, w, h);
      if (title) {
        g.font = `600 ${Math.round(Math.min(w, h) * 0.045)}px Georgia, serif`; g.textBaseline = 'top';
        g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = h * 0.012;
        g.fillText(title, w * 0.035, h * 0.04);
      }
      g.shadowBlur = 0;
      if (intro && t < -LEAD) drawCard(g, w, h, 'open', i / fps, info, C.cardStyle, tint);
      if (outro && t > end) drawCard(g, w, h, 'close', t - end, info, C.cardStyle, tint);
      const vf = new VideoFrame(comp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      if (i % 10 === 0) { ui.prog.value = (i / total) * 0.9; await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush(); venc.close();
    if (failed) throw failed;

    if (ac) {
      await loadInstrument(C.instrument);
      const buf = await renderPiece(P.piece, LEAD + intro, TAIL + outro, { instrument: C.instrument, room: C.room, volume: 1 });
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
      aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
      const L = buf.getChannelData(0), Rr = buf.getChannelData(1), step = 4800;
      for (let o = 0; o < buf.length; o += step) {
        const n = Math.min(step, buf.length - o), data = new Float32Array(n * 2);
        data.set(L.subarray(o, o + n), 0); data.set(Rr.subarray(o, o + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((o / 48000) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      if (failed) throw failed;
    }
    muxer.finalize();
    ui.prog.value = 1;
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    ui.download.href = URL.createObjectURL(blob); ui.download.download = safeName() + '.mp4'; ui.download.hidden = false;
    const notes = [vc.mux === 'vp9' && 'It uses VP9 video, which some players (QuickTime, iPhone Photos) may not open; Chrome on a Mac normally makes the more compatible H.264 kind.',
      !ac && 'This browser could not add sound.', ac && ac.mux === 'opus' && 'Its sound is Opus, which some players do not support.'].filter(Boolean);
    say('exp-msg', `Video ready: ${mmss(total / fps)}, ${w}×${h}, ${(blob.size / 1048576).toFixed(1)} MB. ${notes.join(' ')}`);
  } catch (err) {
    say('exp-msg', 'The video could not be made: ' + (err.message || err));
  }
  P.busy = false; ui.prog.hidden = true;
  for (const k of ['record', 'demo', 'capture', 'mic']) ui[k].disabled = false;
  enable(); fit();
}
ui.export.addEventListener('click', makeVideo);

// ---------- opened from a journal entry: studio.html#m=<file id>&k=<family|parent>&n=<name> ----------
async function fromJournal() {
  const q = new URLSearchParams(location.hash.slice(1)), id = q.get('m');
  if (!id || !/^[a-f0-9]{16}$/.test(id)) return;
  const raw = session.load();
  if (!raw) return say('rec-msg', 'Open the journal with your passphrase first, then come back to this recording.');
  try {
    let key;
    if (q.get('k') === 'parent' || !raw.parent) key = b64.from(q.get('k') === 'parent' ? raw.parent : raw.family);
    else key = b64.from((await readVault(b64.from(raw.parent), await fetchJSON('content/parent.vault'))).familyKey);
    const r = await fetch(`media/${id}.enc`, { cache: 'no-store' });
    const plain = await openBytes(await importKey(key), new Uint8Array(await r.arrayBuffer()));
    load(parseMidi(plain.buffer), q.get('n') || 'From the journal');
  } catch { say('rec-msg', 'That recording could not be opened.'); }
}

stage.setLive(L.held); stage.setTrail(L.trail);
fit();
requestAnimationFrame(frame);
fromJournal();
chooseInstrument(C.instrument, $(`#instruments [data-v="${C.instrument}"]`), false);
// If this browser has already been allowed to use the piano, connect without being asked.
try { navigator.permissions?.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') connect(true); }).catch(() => {}); } catch {} // some browsers do not know the question at all

