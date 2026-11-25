// Piano studio: play live from the piano, load or record a performance, watch it in 3D, and make a video. Everything runs in the browser.
import { parseMidi, fromRecording, writeMidi, demoPiece, noteName } from './midi.js?v=13';
import { createStage } from './stage.js?v=44';
import { createListener, STYLE_NAMES } from './listen.js?v=8';
import { drawCard, OPEN, CLOSE, STYLES } from './cards.js?v=3';
import { INSTRUMENTS, ROOMS, makeOutput, noteOn, voice, renderPiece, loadInstrument, isLoaded, heldFor } from './synth.js?v=14';

const $ = (s, r = document) => r.querySelector(s);
async function fetchJSON(path) { // null when the file is missing or not JSON
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}
const LEAD = 1.5, TAIL = 2.5; // seconds of runway before the first note and after the last
const canvas = $('#stage'), box = $('#stagebox'), stage = createStage(canvas);
const P = { piece: null, name: '', playing: false, pos: -LEAD, rate: 1, bus: null, t0: 0, p0: 0, next: 0, busy: false };
const A = { ctx: null, out: null, ear: null }; // sound: one audio context, and the chain every note passes through
const V = { rec: null, chunks: [], dest: null }; // live screen recording
const R = { on: false, events: [], start: 0 }; // recording of what is played
const L = { access: null, inputs: [], held: new Map(), trail: [], voices: new Map(), sustained: [], pedal: false, last: -99 }; // live playing
// A part of the piece, for a short video (YouTube Shorts: 3 minutes at most; 30 to 60 seconds suits most): exactly
// from the start time to the end time written, fading in from black and out to black so it loops cleanly, with the
// opening and closing cards (on black) when they are chosen. Parts keep their own opening-card choice (on unless
// changed). From the very start it keeps the runway and the picture's own opening; to the very end, its own ending.
const PART = { fadeIn: 0.5, soundIn: 0.25, fadeOut: 1.5, ring: 5, first: 45 };
const K = { from: 0, to: PART.first, stopAt: null }; // the part's start and end as written (s; null when not a time); the end of a part being played
// ---------- opening and closing cards ----------
const capital = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function guessMeta(piece, name) { // from the file: "Title (Composer) - subtitle" in its track name, or else its file name
  const label = piece.label || '', m = label.match(/^(.*?)\s*\((.*?)\)\s*(?:[-–—:]\s*(.*))?$/);
  if (m) return { title: m[1], composer: m[2], subtitle: m[3] ? m[3].charAt(0).toUpperCase() + m[3].slice(1) : '', credits: [] };
  return { title: label || capital(String(name || '').replace(/[_-]+/g, ' ')), composer: '', subtitle: '', credits: [] };
}
function fillCard(meta) {
  $('#card-title').value = $('#ptitle').value = meta.title || ''; $('#card-composer').value = meta.composer || '';
  $('#card-subtitle').value = meta.subtitle || ''; $('#card-credits').value = (meta.credits || []).join('\n');
}
const soundCredit = () => { // (the licences ask for credit: the grand's recordings, and FluidR3's for every other sound)
  const i = INSTRUMENTS.find((x) => x.id === C.instrument) || {}, out = [];
  if (i.pack === 'grand') out.push('Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0)');
  if (i.layer) out.push('String sound: FluidR3 GM by Frank Wen (MIT)');
  else if (i.pack && i.pack !== 'grand') out.push('Instrument sound: FluidR3 GM by Frank Wen (MIT)');
  return out;
};
function cardInfo() {
  const v = (id) => $(id).value.trim();
  return { title: v('#card-title'), composer: v('#card-composer'), subtitle: v('#card-subtitle'), channel: C.channel, message: C.message,
    credits: [...v('#card-credits').split('\n').map((s) => s.trim()).filter(Boolean), ...soundCredit()] }; // the sound's licence asks for credit, so it is always there
}
// The colour that leads: on paper the right hand's, otherwise the light strip of the chosen colours. The page's accent
// and the opening and closing cards take it.
const paperOn = () => C.view === 'sheet' && C.look === 'paper';
const openKey = () => (C.part === 'part' ? 'cardOpenPart' : paperOn() ? 'cardOpenPaper' : 'cardOpen'); // the paper look has its own opening-card choice (off by default: its 3D title opens the video), and so do parts (PART)
const accentColor = () => (paperOn() ? (stage.handPairs().find((p) => p.id === C.hands) || stage.handPairs()[0]).chips[0] : stage.themes()[C.theme]?.[0] || '#3dffa0');
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
  'export', 'prog', 'download', 'overlay', 'connect', 'volume', 'monitor', 'now', 'ribbon', 'library', 'dots', 'paths', 'trails', 'sparks', 'zap', 'current', 'cracks', 'race', 'cornerk', 'dark', 'cornerdark', 'shine', 'ballk', 'glow', 'title3d', 'ptitle'].map((id) => [id, $('#' + id)]));
const say = (id, text) => { $('#' + id).textContent = text; };
const mmss = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const safeName = () => (P.name || 'piano').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'piano';
const clock = () => performance.now() / 1000;
const fill = (el) => el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min || 1)) * 100}%`);

// ---------- choices are remembered on this computer ----------
const PHONE = matchMedia('(max-width: 640px)').matches; // a phone held upright: start with the tall picture looking along the keys, which fills the screen
// New visitors start with the sheet music on soft paper (look) in ivory (paper), its hands in rose and ice (hands), the
// title lettered in 3D.
const DEFAULTS = { instrument: 'grand', room: 'hall', volume: 0.9, monitor: true, theme: 'aurora', view: 'sheet', look: 'paper', hands: 'rose', paper: 'ivory', finish: 'matte', trails: false, corner: 'off', cornerK: 0.5, dark: 0.5, cornerDark: 0.75, sparks: 0, zap: 0, current: 0, cracks: 0, race: 0, ballStyle: 'light', camMove: 'steady', shine: 0.5, ballK: 0.5, title3d: true, v: 10, dance: 'auto', camera: PHONE ? 'side' : 'front', shape: PHONE ? 'tall' : 'wide', notes: 'trails', ribbon: true, dots: true, strip: 'notes', paths: true, sheetCam: 'side', glow: 0.45, sky: 'stars', landing: 'sparks', cardOpen: true, cardOpenPaper: false, cardOpenPart: true, cardClose: true, markOn: true, part: 'whole', cardStyle: 'lumen', channel: 'Lumen Keys', message: 'Thank you for listening', labels: false, effects: true, motion: !matchMedia('(prefers-reduced-motion: reduce)').matches };
const C = { ...DEFAULTS };
try { // v 2: note names off unless switched on again; v 3: notes are trails of light unless changed again; v 4: the
  // picture starts as the sheet music on soft paper (choices saved by the older studio this one was copied from do not
  // count); v 5: the paper has a colour (ivory unless chosen; every other choice is kept); v 6: the paper look keeps
  // its own opening-card choice, off unless switched on (its 3D title opens the video), while the other looks keep theirs;
  // v 7: the corner light has a strength (0.5 unless chosen; every other choice is kept); v 8: the paper look has a
  // camera choice (Steady unless chosen; every other choice is kept); v 9: the paper look has a shine of the notes and
  // a brightness of the balls (their defaults unless chosen; every other choice is kept); v 10: the paper look is darker
  // by default (the darkness of the room and the shadow in the corners at their defaults, even if a darkness of 0 was
  // saved before; every other choice is kept)
  const saved = JSON.parse(localStorage.getItem('studio') || '{}');
  if (!(saved.v >= 2)) delete saved.labels;
  if (!(saved.v >= 3)) delete saved.notes;
  if (!(saved.v >= 4)) { delete saved.view; delete saved.look; delete saved.hands; }
  if (!(saved.v >= 6)) delete saved.cardOpenPaper;
  if (!(saved.v >= 7)) delete saved.cornerK;
  if (!(saved.v >= 8)) saved.camMove = 'steady';
  if (!(saved.v >= 9)) { delete saved.shine; delete saved.ballK; }
  if (!(saved.v >= 10)) { delete saved.dark; delete saved.cornerDark; }
  Object.assign(C, saved, { v: 10 });
} catch {}
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
  stage.setMark(piece ? mark3d() : ''); stage.setComposer(piece ? composer3d() : ''); stage.setTitle(piece ? title3d() : null); // lettered in 3D at the start of the paper look
  stage.setPiece(piece);
  say('piece-title', name);
  const pedals = piece ? piece.pedal.filter((p) => p.down).length : 0;
  say('piece-info', piece ? `${piece.notes.length} notes, ${mmss(piece.duration)} long${pedals ? `, ${pedals} pedal presses` : ''}.` : '');
  if (piece) { ui.seek.min = -LEAD; ui.seek.max = piece.duration + TAIL; ui.seek.value = P.pos; fill(ui.seek); }
  ui.download.hidden = true;
  enable();
  $('#part-start').value = '0:00'; $('#part-end').value = piece ? clockOf(Math.min(PART.first, piece.duration)) : clockOf(PART.first); partTimes();
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
  if (K.stopAt != null) { K.stopAt = null; $('#part-play').textContent = 'Play the part'; } // (any pause ends playing a part)
  if (P.bus) { const g = P.bus.input; g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.02); setTimeout(() => g.disconnect(), 300); P.bus = null; }
}
function schedule() {
  const t = now(), notes = P.piece.notes;
  while (P.next < notes.length && notes[P.next].onset < t + 0.25) {
    const n = notes[P.next++];
    voice(A.ctx, P.bus, n.pitch, n.vel, P.t0 + (n.onset - P.p0) / P.rate, heldFor(P.bus.instrument, n) / P.rate);
  }
}
function frame() {
  requestAnimationFrame(frame);
  if (P.busy) return;
  const t = clock();
  if (C.view === 'dancer') hear();
  if (M.on) { listen(); return; }
  const idle = !P.piece && paperOn(); // nothing loaded, on paper: the empty staves glide by, ready for whatever is played
  if (!P.playing && (R.on || L.held.size || t - L.last < 5 || idle)) { // someone is playing: show their notes leaving the keys
    while (L.trail.length && L.trail[0].t1 != null && t - L.trail[0].t1 > 30) L.trail.shift();
    stage.render(t, true);
    if (R.on) ui.clock.textContent = `${mmss(t - R.start)} recorded`;
    return;
  }
  if (P.playing) {
    schedule(); P.pos = now();
    if (P.pos >= P.piece.duration + TAIL || (K.stopAt != null && P.pos >= K.stopAt)) pause();
    ui.seek.value = P.pos; fill(ui.seek);
  }
  stage.render(P.pos);
  if (P.piece) ui.clock.textContent = `${mmss(P.pos)} / ${mmss(P.piece.duration)}`;
}
ui.play.addEventListener('click', () => (P.playing ? pause() : play()));
ui.seek.addEventListener('input', () => { const was = P.playing; pause(); P.pos = Number(ui.seek.value); fill(ui.seek); L.last = -99; if (was) play(); });
ui.speed.addEventListener('change', () => { const was = P.playing; pause(); P.rate = Number(ui.speed.value); if (was) play(); });

// ---------- a part of the piece, for a short video (see PART) ----------
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
function partRange() { // the part as it will be filmed: from t0 to b (music time); null without a piece, { error } when the times do not make a part
  const piece = P.piece;
  if (!piece) return null;
  if (K.from == null || K.to == null) return { error: 'Write both times as minutes:seconds, for example 1:05 or 1:05.5.' };
  const from = Math.max(0, K.from), top = from < 0.05, end = K.to >= piece.duration - 0.05;
  if (from >= piece.duration - 0.5) return { error: `The piece is ${mmss(piece.duration)} long: start before that.` };
  const t0 = top ? -LEAD : from, b = end ? piece.duration + TAIL : K.to;
  if (b - t0 < 1) return { error: 'The end must come after the start.' };
  return { t0, b, from, to: end ? piece.duration : K.to, top, end };
}
const clockOf = (s) => { const r = Math.round(s * 10) / 10; return mmss(r) + (r % 1 ? (r % 1).toFixed(1).slice(1) : ''); }; // 1:05 or 1:05.5
function partChanged() {
  const on = C.part === 'part', r = on ? partRange() : null, ok = r && !r.error;
  $('#part-box').hidden = !on;
  $('#part-play').disabled = !ok || P.busy;
  ui.seek.classList.toggle('part', !!ok); // the part shows as a band on the position bar
  if (ok) {
    const span = P.piece.duration + TAIL + LEAD, pc = (x) => `${(((x + LEAD) / span) * 100).toFixed(2)}%`;
    ui.seek.style.setProperty('--a', pc(r.t0)); ui.seek.style.setProperty('--b', pc(r.b));
  }
  if (!on) return;
  if (!r) return say('part-msg', 'Open a piece, then write where the part starts and ends.');
  if (r.error) return say('part-msg', r.error);
  const cards = (C[openKey()] ? OPEN : 0) + (C.cardClose ? CLOSE : 0), total = r.b - r.t0 + cards;
  say('part-msg', [`The part runs from ${r.top ? 'the start' : clockOf(r.from)} to ${r.end ? 'the end' : clockOf(r.to)}, fading in and out.`,
    cards ? `With the ${C[openKey()] && C.cardClose ? 'opening and closing cards' : C.cardClose ? 'closing card' : 'opening card'} the video is ${clockOf(total)} long.` : `The video is ${clockOf(total)} long.`,
    total > 180 ? 'That is over 3 minutes, so YouTube will show it as a normal video, not a Short.' : '',
    C.shape !== 'tall' ? 'For a Short, choose Shape: Tall in the Look tab.' : ''].filter(Boolean).join(' '));
}
function readTime(text) { // "1:05", "65" or "1:05.5" as seconds; null when it is not a time
  const m = String(text).trim().match(/^(?:(\d+):)?(\d+(?:[.,]\d*)?)$/);
  return m ? Number(m[1] || 0) * 60 + Number(m[2].replace(',', '.')) : null;
}
function partTimes() { // read both boxes
  for (const [id, key] of [['#part-start', 'from'], ['#part-end', 'to']]) {
    const v = readTime($(id).value);
    K[key] = v; if (v == null) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid');
  }
  partChanged();
}
radios($('#parts'), [], C.part, (v) => { C.part = v; remember(); $('#card-open').checked = C[openKey()]; partChanged(); });
for (const id of ['#part-start', '#part-end']) $(id).addEventListener('input', partTimes);
$('#part-play').addEventListener('click', () => { // hear and see the part, stopping at its end
  if (K.stopAt != null) return pause();
  const r = partRange();
  if (!r || r.error) return;
  pause(); P.pos = r.t0; L.last = -99; play();
  if (P.playing) { K.stopAt = r.b; $('#part-play').textContent = 'Stop'; }
});
partChanged();

// ---------- look ----------
function accent() { // the page takes its accent colour from the picture's colours
  const led = accentColor(), n = parseInt(led.slice(1), 16);
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
// On paper: calm pairs of colours for the two hands (right hand first), changed without rebuilding the picture.
radios($('#hands'), stage.handPairs().map((p) => ({ id: p.id, build(b) {
  b.className = 'swatch';
  const chips = document.createElement('span'), label = document.createElement('span');
  chips.className = 'chips'; label.textContent = p.name;
  for (const c of p.chips) { const i = document.createElement('i'); i.style.background = c; chips.append(i); }
  b.append(chips, label);
} })), C.hands, (id) => { C.hands = id; remember(); stage.setHands(id); accent(); });
// On paper: the colour of the paper (and its ink), each shown as a small lit sheet; the line below describes the one chosen.
const PAPERS = stage.papers(), paperDesc = () => { $('#paper-desc').textContent = (PAPERS.find((p) => p.id === C.paper) || PAPERS[0]).desc; };
if (!PAPERS.some((p) => p.id === C.paper)) C.paper = PAPERS[0].id;
radios($('#papers'), PAPERS.map((p) => ({ id: p.id, build(b) {
  b.className = 'swatch';
  const sheet = document.createElement('i'), label = document.createElement('span');
  sheet.className = p.dark ? 'sheet dark' : 'sheet'; sheet.style.background = p.css || `radial-gradient(120% 95% at 45% 100%, ${p.swatch[0]} 35%, ${p.swatch[1]})`; // (marble: its veins)
  label.textContent = p.name;
  b.append(sheet, label);
} })), C.paper, (id) => { C.paper = id; remember(); stage.setPaper(id); paperDesc(); finishDesc(); });
paperDesc();
// On paper: what the notes are made of (matte ink, polished metal, smoked glass, satin gold, and since round 12 piano
// lacquer, sapphire enamel, wine velvet, rose gold, pearl and jade), each shown as a small notehead of it; the line
// below describes the one chosen. On a dark paper a finish may take its own version there (f.dark: its name, words and
// button), and the buttons show it; a finish made for one kind of paper (f.best) says so. Changing it builds the
// picture again.
const FINISHES = stage.finishes(), onDark = () => !!PAPERS.find((p) => p.id === C.paper)?.dark;
const BEST = { light: 'Made for light paper.', dark: 'Made for dark paper and marble.' };
const finishDesc = () => {
  const f = FINISHES.find((x) => x.id === C.finish) || FINISHES[0], dark = onDark(), v = dark && f.dark ? f.dark : f;
  $('#finish-desc').textContent = v.desc + (f.best ? ' ' + BEST[f.best] : ''); // (each version's words name it)
  for (const x of FINISHES) { // (the buttons: each finish as it looks on this paper)
    const b = $('#finishes').querySelector(`[data-v="${x.id}"]`), w = dark && x.dark ? x.dark : x;
    if (!b) continue;
    b.querySelector('i.note').style.background = w.chip || x.chip;
    b.title = (dark && x.dark ? x.dark.name : x.name) + (x.best ? ' · ' + BEST[x.best] : '');
  }
};
if (!FINISHES.some((f) => f.id === C.finish)) C.finish = FINISHES[0].id;
radios($('#finishes'), FINISHES.map((f) => ({ id: f.id, build(b) {
  b.className = 'swatch';
  const chip = document.createElement('i'), label = document.createElement('span');
  chip.className = 'note'; chip.style.background = f.chip;
  label.textContent = f.name;
  b.append(chip, label);
} })), C.finish, (id) => { C.finish = id; remember(); stage.setFinish(id); finishDesc(); });
finishDesc();
// The title lettered on the paper is the name of the piece (Video tab), which can also be changed here; typing
// waits half a second before the picture is built again.
function title3d() { return C.title3d ? $('#card-title').value.trim() : ''; }
function composer3d() { return C.title3d ? $('#card-composer').value.trim() : ''; } // printed under the title's right end
function mark3d() { return C.markOn ? String(C.channel || '').trim() : ''; } // the channel's name, every 30 s (MARK in paper.js; markAlpha elsewhere)
let titleTimer = 0;
function titleChanged(now) {
  clearTimeout(titleTimer);
  const go = () => { if (P.piece) { stage.setMark(mark3d()); stage.setComposer(composer3d()); stage.setTitle(title3d()); } };
  if (now) go(); else titleTimer = setTimeout(go, 500);
}
ui.title3d.checked = C.title3d;
ui.title3d.addEventListener('change', () => { C.title3d = ui.title3d.checked; remember(); titleChanged(true); });
ui.ptitle.addEventListener('input', () => { $('#card-title').value = ui.ptitle.value; titleChanged(); });
$('#card-title').addEventListener('input', () => { ui.ptitle.value = $('#card-title').value; titleChanged(); });
$('#card-composer').addEventListener('input', () => titleChanged());
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
  document.body.classList.toggle('paper', paperOn());
  ui.overlay.hidden = paperOn(); // the paper letters its own title; a second, flat one would only repeat it
  $('#card-open').checked = C[openKey()];
  accent();
  if (C.view !== 'dancer') { stage.setMusic(null); if (!L.held.size) ui.now.textContent = ''; }
  else if (!A.ctx) say('rec-msg', 'The dancer is waiting for music: press "Listen with the microphone", or Play, or play the piano.');
}
radios($('#views'), [], C.view, (v) => { C.view = v; remember(); stage.setView(M.on && (v === 'piano' || v === 'sheet') ? 'flight' : v); pictureChanged(); });
radios($('#looks'), [], C.look, (v) => { C.look = v; remember(); stage.setLook(v); pictureChanged(); });
radios($('#dances'), [], C.dance, (v) => { C.dance = v; remember(); stage.setDance(v); });
radios($('#cameras'), [], C.camera, (v) => { C.camera = v; remember(); stage.setCamera(v); });
radios($('#shapes'), [], C.shape, (v) => { C.shape = v; remember(); box.classList.toggle('tall', v === 'tall'); fit(); partChanged(); });
radios($('#notes'), [], C.notes, (v) => { C.notes = v; remember(); stage.setNotes(v); });
radios($('#strip'), [], C.strip, (v) => { C.strip = v; remember(); stage.setStrip(v); });
radios($('#sheetcam'), [], C.sheetCam, (v) => { C.sheetCam = v; remember(); stage.setSheetCam(v); });
radios($('#sky'), [], C.sky, (v) => { C.sky = v; remember(); stage.setSky(v); });
$('#card-open').checked = C[openKey()]; $('#card-open').addEventListener('change', () => { C[openKey()] = $('#card-open').checked; remember(); partChanged(); });
$('#card-close').checked = C.cardClose; $('#card-close').addEventListener('change', () => { C.cardClose = $('#card-close').checked; remember(); partChanged(); });
for (const [id, key] of [['#card-channel', 'channel'], ['#card-message', 'message']]) { $(id).value = C[key]; $(id).addEventListener('input', () => { C[key] = $(id).value; remember(); if (key === 'channel') titleChanged(); }); }
$('#mark-on').checked = C.markOn;
$('#mark-on').addEventListener('change', () => { C.markOn = $('#mark-on').checked; remember(); titleChanged(true); });
$('#card-style').innerHTML = Object.entries(STYLES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
$('#card-style').value = C.cardStyle; $('#card-style').addEventListener('change', () => { C.cardStyle = $('#card-style').value; remember(); });
$('#preview-open').addEventListener('click', () => previewCard('open'));
$('#preview-close').addEventListener('click', () => previewCard('close'));
radios($('#landing'), [], C.landing, (v) => { C.landing = v; remember(); stage.setLanding(v); });
stage.setLanding(C.landing);
// On paper, the camera: Steady (the default), Cinematic or Close-ups (both planned from the piece); the line under it
// describes the one chosen. Every choice can always be made: Cinematic and Close-ups move even with the gentle camera
// movement off (it only calms the Steady camera), so they are never greyed out (round 5: greyed buttons, with the
// gentle movement off, e.g. under the system's Reduce motion, looked as if the camera could not be changed).
const CAM_MOVES = stage.camMoves(), camDesc = () => {
  const d = (CAM_MOVES.find((c) => c.id === C.camMove) || CAM_MOVES[0]).desc;
  $('#cammove-desc').textContent = C.camMove === 'steady' && !C.motion ? d + ' (Held still: Gentle camera movement is off.)' : d;
};
if (!CAM_MOVES.some((c) => c.id === C.camMove)) C.camMove = ['crane', 'breathe', 'follow'].includes(C.camMove) ? 'cinematic' : 'steady'; // (names used by earlier trials)
radios($('#cammove'), [], C.camMove, (v) => { C.camMove = v; remember(); stage.setCamMove(v); camDesc(); });
// On paper (round 8), the balls' style: balls of light, or dark-energy orbs (dark, a ring of light, a sparking dark-red nucleus).
C.ballStyle = C.ballStyle === 'dark' ? 'dark' : 'light'; stage.setBallStyle(C.ballStyle);
radios($('#ballstyle'), [], C.ballStyle, (v) => { C.ballStyle = v; remember(); stage.setBallStyle(v); });
stage.setCamMove(C.camMove);
// On paper, both off unless chosen: the corner light (each ball's touches light the open paper in its corner) and the
// powder sparks (how many: the slider; left = none). The line under the corner light describes the style chosen; its
// strength slider (left = faint) does nothing, and is shown greyed, while the corner light is off.
const CORNERS = stage.corners(), cornerDesc = () => {
  $('#corner-desc').textContent = (CORNERS.find((c) => c.id === C.corner) || CORNERS[0]).desc;
  const off = C.corner === 'off'; ui.cornerk.disabled = off; $('#cornerk-line').classList.toggle('off', off); $('#cornerk-desc').classList.toggle('off', off);
};
if (!CORNERS.some((c) => c.id === C.corner)) C.corner = 'off';
radios($('#corner'), [], C.corner, (v) => { C.corner = v; remember(); stage.setCorner(v); cornerDesc(); });
stage.setCorner(C.corner); cornerDesc();
C.cornerK = Number.isFinite(Number(C.cornerK)) ? Math.max(0, Math.min(1, Number(C.cornerK))) : 0.5;
ui.cornerk.value = C.cornerK; fill(ui.cornerk); stage.setCornerStrength(C.cornerK);
ui.cornerk.addEventListener('input', () => { C.cornerK = Number(ui.cornerk.value); remember(); stage.setCornerStrength(C.cornerK); fill(ui.cornerk); });
// On paper, the darkness of the room (left = as lit: the lamp dimmed) and the shadow in the corners (left = none: the
// top-left and bottom-right corners in deep shade); the balls, the glows and the lit notes keep their light. Both are on
// by default (DEFAULTS).
C.dark = Number.isFinite(Number(C.dark)) ? Math.max(0, Math.min(1, Number(C.dark))) : DEFAULTS.dark;
ui.dark.value = C.dark; fill(ui.dark); stage.setDarkness(C.dark);
ui.dark.addEventListener('input', () => { C.dark = Number(ui.dark.value); remember(); stage.setDarkness(C.dark); fill(ui.dark); });
C.cornerDark = Number.isFinite(Number(C.cornerDark)) ? Math.max(0, Math.min(1, Number(C.cornerDark))) : DEFAULTS.cornerDark;
ui.cornerdark.value = C.cornerDark; fill(ui.cornerdark); stage.setCornerShadow(C.cornerDark);
ui.cornerdark.addEventListener('input', () => { C.cornerDark = Number(ui.cornerdark.value); remember(); stage.setCornerShadow(C.cornerDark); fill(ui.cornerdark); });
// On paper, the shine of the notes (how strongly the notation mirrors the balls; left = quiet) and the brightness of the
// balls (with the light they throw; left = soft, the middle as designed). The brightness does nothing, and is shown
// greyed, while the balls are off.
const unit = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
const ballDesc = () => { const off = !C.paths; for (const k of ['ballk', 'current', 'race']) { ui[k].disabled = off; $(`#${k}-line`).classList.toggle('off', off); $(`#${k}-desc`).classList.toggle('off', off); } for (const id of ['#ballstyle', '#ballstyle-desc']) $(id).classList.toggle('off', off); };
C.shine = unit(C.shine, DEFAULTS.shine); C.ballK = unit(C.ballK, DEFAULTS.ballK);
ui.shine.value = C.shine; fill(ui.shine); stage.setShine(C.shine);
ui.shine.addEventListener('input', () => { C.shine = Number(ui.shine.value); remember(); stage.setShine(C.shine); fill(ui.shine); });
ui.ballk.value = C.ballK; fill(ui.ballk); stage.setBallBrightness(C.ballK);
ui.ballk.addEventListener('input', () => { C.ballK = Number(ui.ballk.value); remember(); stage.setBallBrightness(C.ballK); fill(ui.ballk); });
C.sparks = Math.max(0, Math.min(1, Number(C.sparks) || 0));
ui.sparks.value = C.sparks; fill(ui.sparks); stage.setSparks(C.sparks);
ui.sparks.addEventListener('input', () => { C.sparks = Number(ui.sparks.value); remember(); stage.setSparks(C.sparks); fill(ui.sparks); });
// On paper, the electric notes (round 5): sharp crackles of current at each note as its ball lands (left = none).
C.zap = unit(C.zap, 0);
ui.zap.value = C.zap; fill(ui.zap); stage.setZap(C.zap);
ui.zap.addEventListener('input', () => { C.zap = Number(ui.zap.value); remember(); stage.setZap(C.zap); fill(ui.zap); });
// On paper (round 6), the current with the balls (an electric tail, sparks and a leap ahead to the next note) and the
// cracks of light in the notes (each note breaks into glowing cracks as it is played): left = none. The current goes
// with the balls, so it is greyed while they are off.
// The race between the balls (round 7): they take turns running a little ahead of the music and passing each other,
// between stretches of going level (left = none); greyed with the balls off.
for (const [k, fn] of [['current', 'setCurrent'], ['cracks', 'setCracks'], ['race', 'setRace']]) {
  C[k] = unit(C[k], 0); ui[k].value = C[k]; fill(ui[k]); stage[fn](C[k]);
  ui[k].addEventListener('input', () => { C[k] = Number(ui[k].value); remember(); stage[fn](C[k]); fill(ui[k]); });
}
stage.setSheetCam(C.sheetCam); stage.setSky(C.sky); stage.setGlow(C.glow);
ui.glow.value = C.glow; fill(ui.glow);
ui.glow.addEventListener('input', () => { C.glow = Number(ui.glow.value); remember(); stage.setGlow(C.glow); fill(ui.glow); });
stage.setStrip(C.strip);
stage.setNotes(C.notes);
for (const [k, fn] of [['labels', 'setLabels'], ['effects', 'setEffects'], ['motion', 'setMotion'], ['ribbon', 'setRibbon'], ['dots', 'setDots'], ['paths', 'setPaths'], ['trails', 'setTrails']]) {
  ui[k].checked = C[k]; stage[fn](C[k]);
  ui[k].addEventListener('change', () => { C[k] = ui[k].checked; remember(); stage[fn](C[k]); if (k === 'motion') camDesc(); if (k === 'paths') ballDesc(); });
}
camDesc(); ballDesc();
stage.setTheme(C.theme); stage.setLook(C.look); stage.setHands(C.hands); stage.setPaper(C.paper); stage.setFinish(C.finish); stage.setView(C.view); stage.setDance(C.dance); pictureChanged(); stage.setCamera(C.camera); box.classList.toggle('tall', C.shape === 'tall');
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
  if (h) { L.voices.delete(pitch); if (L.pedal && !restrike && !A.out.instrument.bowed) L.sustained.push(h); else h.release(A.ctx.currentTime); } // (bowed strings: no pedal)
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

// Safari hands back the whole MPEG-4 ES descriptor as the AAC "description" where WebCodecs asks for the bare
// AudioSpecificConfig (2 bytes). Written into the file as it is, players find no usable sound track: Safari videos
// were silent. Take the bare config out of the descriptor (tag 5 inside tags 3 and 4).
function bareAsc(desc) {
  if (!desc) return null;
  const b = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength).slice() : new Uint8Array(desc).slice();
  if (b[0] !== 0x03) return b; // already the bare config
  let i = 0;
  const size = () => { let n = 0, c; do { c = b[i++]; n = (n << 7) | (c & 0x7f); } while (c & 0x80 && i < b.length); return n; };
  while (i < b.length) {
    const tag = b[i++], n = size();
    if (tag === 0x05) return b.slice(i, i + n);
    if (tag === 0x03) { const f = b[i + 2]; i += 3; if (f & 0x80) i += 2; if (f & 0x40) i += 1 + b[i]; if (f & 0x20) i += 2; }
    else if (tag === 0x04) i += 13;
    else i += n;
  }
  return null;
}

// Where the file is written: a file in the browser's own storage when it allows it, so even a long 4K video never has
// to fit in memory; otherwise memory, as before.
async function videoFile() {
  try {
    const dir = await navigator.storage?.getDirectory?.();
    const handle = dir && await dir.getFileHandle('studio-video.mp4', { create: true });
    if (!handle?.createWritable) return null;
    return { handle, stream: await handle.createWritable({ keepExistingData: false }) };
  } catch { return null; }
}

// The sound of a part: its notes and those still ringing as it starts, made on their own (not the whole piece), with a
// short fade in and a longer fade out to match the picture, and silence for the cards before and after.
async function partSound(piece, part, before, after, opts, onProgress) {
  const { t0, b } = part, rate = 48000, keep = piece.notes.filter((n) => n.onset < b && n.end + PART.ring > t0);
  let s0 = t0;
  for (const n of keep) s0 = Math.min(s0, n.onset);
  const buf = await renderPiece({ notes: keep.map((n) => ({ ...n, onset: n.onset - s0, end: n.end - s0 })), duration: b - s0 }, 0, 0, opts, rate, onProgress);
  const at = Math.round((t0 - s0) * rate), n = Math.max(0, Math.min(Math.round((b - t0) * rate), buf.length - at));
  const pre = Math.round(before * rate), len = pre + n + Math.round(after * rate), fi = Math.min(n, Math.round(PART.soundIn * rate)), fo = Math.min(n, Math.round(PART.fadeOut * rate));
  const ch = [0, 1].map((c) => { const d = new Float32Array(len); d.set(buf.getChannelData(c).subarray(at, at + n), pre); return d; });
  for (const d of ch) {
    for (let i = 0; i < fi; i++) d[pre + i] *= smooth(i / fi);
    for (let i = 0; i < fo; i++) d[pre + n - 1 - i] *= smooth(i / fo);
  }
  return { length: len, getChannelData: (c) => ch[c] };
}

// The channel's name in the looks other than paper: shown for MARK2D.show s from every 30 s of music (as on paper, none
// in the last 8 s), fading in and out.
const MARK2D = { every: 30, show: 4, fade: 0.7, ending: 8 };
function markAlpha(t, duration) {
  const at = Math.floor(t / MARK2D.every) * MARK2D.every, u = t - at;
  if (at < MARK2D.every || at >= duration - MARK2D.ending || u > MARK2D.show) return 0;
  return smooth(u / MARK2D.fade) * smooth((MARK2D.show - u) / MARK2D.fade);
}

const X = { stop: false }; // the export in progress, if any
const pauseFor = (ms) => new Promise((r) => {
  if (!document.hidden) return setTimeout(r, ms);
  const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); // a hidden tab slows timers to once a second
});
function within(promise, ms, what) {
  let timer;
  return Promise.race([promise, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${what} stopped responding`)), ms); })]).finally(() => clearTimeout(timer));
}

async function makeVideo() {
  if (P.busy && X.on) { X.stop = true; ui.export.disabled = true; say('exp-msg', 'Stopping…'); return; }
  if (!P.piece || P.busy) return;
  if (C.view === 'dancer') return say('exp-msg', 'The dancer reacts to sound as it happens, so it cannot be drawn frame by frame. Use "Start filming" below instead.');
  if (!('VideoEncoder' in window)) return say('exp-msg', 'This browser cannot make videos. Use Chrome or Edge on a computer.');
  pause();
  if (C.part === 'part') { const r = partRange(); if (r && r.error) return say('exp-msg', r.error); }
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

  P.busy = true; X.on = true; X.stop = false; partChanged();
  for (const k of ['play', 'seek', 'record', 'demo', 'capture', 'mic']) ui[k].disabled = true;
  ui.export.textContent = 'Stop'; ui.export.disabled = false;
  ui.prog.hidden = false; ui.prog.value = 0; ui.download.hidden = true;
  if (X.url) { URL.revokeObjectURL(X.url); X.url = null; }
  const began = performance.now(), stopped = () => { if (X.stop) throw new Error('stopped'); };
  let file = null, venc = null, aenc = null;
  try {
    const part = C.part === 'part' ? partRange() : null; // only a part, for a short video: a fade at each end, the cards on black
    const title = paperOn() ? '' : ui.vtitle.value.trim(), intro = C[openKey()] ? OPEN : 0, outro = C.cardClose ? CLOSE : 0, end = P.piece.duration + TAIL; // (paper: its title is lettered in 3D)
    const m0 = part ? part.t0 : -LEAD, m1 = part ? part.b : end; // the music in the video, between the cards
    const from = m0 - intro, span = intro + m1 - m0 + outro; // music time of the first frame, and the length
    const total = Math.ceil(span * fps), info = cardInfo(), tint = accentColor(), mark2d = paperOn() ? '' : mark3d();

    // 1. The sound first (about a tenth of the time): if anything goes wrong it shows at once, not at the end.
    let buf = null;
    if (ac) {
      say('exp-msg', 'Making the sound… Keep this tab open and in front.');
      await loadInstrument(C.instrument);
      let moved = performance.now();
      const opts = { instrument: C.instrument, room: C.room, volume: 1 }, step = (p) => {
        moved = performance.now(); ui.prog.value = 0.12 * p; say('exp-msg', `Making the sound… ${Math.round(p * 100)}%`);
      };
      const sound = part ? partSound(P.piece, part, intro, outro, opts, step) : renderPiece(P.piece, LEAD + intro, TAIL + outro, opts, 48000, step);
      buf = await new Promise((yes, no) => {
        sound.then(yes, no);
        const watch = setInterval(() => {
          if (X.stop) { clearInterval(watch); no(new Error('stopped')); }
          else if (performance.now() - moved > 90000) { clearInterval(watch); no(new Error('making the sound stopped responding')); }
        }, 500);
        sound.finally(() => clearInterval(watch)).catch(() => {});
      });
    }

    // 2. The picture, with the sound added alongside it, written straight to the file.
    const { Muxer, ArrayBufferTarget, StreamTarget } = await import('../vendor/mp4-muxer.js?v=5');
    file = await videoFile();
    let failed = null, inflight = 0, written = Promise.resolve();
    const target = file ? new StreamTarget({
      chunked: true, chunkSize: 8 << 20,
      onData: (data, position) => {
        // Safari writes the whole memory block behind a part-view, not just the part: give it an exact copy
        if (data.byteOffset || data.byteLength !== data.buffer.byteLength) data = data.slice();
        inflight += data.byteLength;
        written = file.stream.write({ type: 'write', data, position }).then(() => { inflight -= data.byteLength; }, (e) => { failed = failed || e; });
      },
    }) : new ArrayBufferTarget();
    const len = buf ? buf.length : 0;
    const muxer = new Muxer({ target, firstTimestampBehavior: 'offset',
      fastStart: file ? { expectedVideoChunks: total, expectedAudioChunks: Math.ceil(len / 960) + 200 } : 'in-memory', // the index at the front either way
      video: { codec: vc.mux, width: w, height: h, frameRate: fps },
      ...(ac ? { audio: { codec: ac.mux, sampleRate: 48000, numberOfChannels: 2 } } : {}) });
    let vout = 0;
    venc = new VideoEncoder({ output: (chunk, meta) => { vout++; try { muxer.addVideoChunk(chunk, meta); } catch (e) { failed = failed || e; } }, error: (e) => { failed = failed || e; } });
    venc.configure({ codec: vc.codec, width: w, height: h, bitrate, framerate: fps });
    if (ac) {
      aenc = new AudioEncoder({
        output: (chunk, meta) => {
          if (meta?.decoderConfig && ac.mux === 'aac') {
            const asc = bareAsc(meta.decoderConfig.description);
            meta = asc && asc.length >= 2 ? { decoderConfig: { ...meta.decoderConfig, description: asc } } : undefined;
          }
          try { muxer.addAudioChunk(chunk, meta); } catch (e) { failed = failed || e; }
        },
        error: (e) => { failed = failed || e; } });
      aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
    }
    const L = buf && buf.getChannelData(0), Rr = buf && buf.getChannelData(1);
    let apos = 0;
    const sendSound = (upto) => {
      for (upto = Math.min(len, upto); apos < upto;) {
        const n = Math.min(4800, upto - apos), data = new Float32Array(n * 2);
        data.set(L.subarray(apos, apos + n), 0); data.set(Rr.subarray(apos, apos + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((apos / 48000) * 1e6), data });
        aenc.encode(ad); ad.close(); apos += n;
      }
    };

    // Each frame is drawn larger than the video (twice the size up to Full HD) and scaled down, which smooths every
    // edge and keeps fine lines steady instead of flickering.
    stage.resize(w, h, short <= 1080 ? 2 : short <= 1440 ? 1.5 : 1);
    await stage.ready(); // the paper look's lettering may still be loading
    const comp = document.createElement('canvas'); comp.width = w; comp.height = h;
    const g = comp.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const drawStart = performance.now();
    for (let i = 0; i < total; i++) {
      if (failed) throw failed;
      stopped();
      const t = from + i / fps; // music time: the opening card plays before the runway, the closing card after the end
      // (paper: the opening card sits on black, then the picture fades in from black at the start of the runway, so
      // the moving page and its 3D title never show through the card)
      const music = t >= m0 && t <= m1;
      if ((intro && t < m0 && (paperOn() || part)) || (part && t > m1)) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); } // (a part's cards sit on black)
      else { stage.render(Math.min(t, end + 2.5)); g.drawImage(canvas, 0, 0, w, h); }
      if (title && (music || !part)) {
        g.font = `600 ${Math.round(Math.min(w, h) * 0.045)}px Georgia, serif`; g.textBaseline = 'top';
        g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = h * 0.012;
        g.fillText(title, w * 0.035, h * 0.04);
      }
      g.shadowBlur = 0;
      const ma = mark2d && music && markAlpha(t, P.piece.duration);
      if (ma > 0) { // the channel's name, fading in at the top every 30 s (on paper it is part of the page instead)
        g.save(); g.globalAlpha = 0.82 * ma; g.font = `500 ${Math.round(Math.min(w, h) * 0.036)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'top';
        if ('letterSpacing' in g) g.letterSpacing = `${Math.round(Math.min(w, h) * 0.004)}px`;
        g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = h * 0.01; g.fillText(mark2d, w / 2, h * (h > w ? 0.075 : 0.05)); g.restore();
      }
      if (part && music) { // a part fades in from black and out to black (except where the paper look does so itself, at the very start and end)
        const u = t - m0, k = Math.max(part.top && paperOn() ? 0 : 1 - smooth(u / PART.fadeIn), part.end && paperOn() ? 0 : smooth((u - (m1 - m0) + PART.fadeOut) / PART.fadeOut));
        if (k > 0.001) { g.globalAlpha = k; g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.globalAlpha = 1; }
      }
      if (intro && t < m0) drawCard(g, w, h, 'open', i / fps, info, C.cardStyle, tint);
      if (outro && t > m1) drawCard(g, w, h, 'close', t - m1, info, C.cardStyle, tint);
      const vf = new VideoFrame(comp, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      if (aenc) sendSound(Math.round(((i + 1) * 48000) / fps));
      // wait for the encoders and the disk to catch up, so nothing piles up in memory; say so if one stops altogether
      for (let since = performance.now(), seen = vout; venc.encodeQueueSize > 6 || (aenc && aenc.encodeQueueSize > 20) || inflight > (48 << 20);) {
        await pauseFor(4);
        if (failed) throw failed;
        stopped();
        if (vout !== seen) { seen = vout; since = performance.now(); }
        else if (performance.now() - since > 60000) throw new Error(inflight > (48 << 20) ? 'writing the file stopped responding' : 'the video encoder stopped responding');
      }
      if (i % 10 === 0) {
        ui.prog.value = (ac ? 0.12 : 0) + (ac ? 0.85 : 0.97) * (i / total);
        const left = i > fps * 3 ? ((performance.now() - drawStart) / i) * (total - i) / 1000 : 0;
        const est = !left ? '' : left < 15 ? ', a few seconds left' : left < 90 ? `, about ${Math.ceil(left / 10) * 10} seconds left` : `, about ${Math.round(left / 60)} minutes left`;
        say('exp-msg', `Drawing the video: ${mmss(i / fps)} of ${mmss(total / fps)}${est}. Keep this tab open and in front.`);
        await pauseFor(0);
      }
    }

    // 3. Finish: the last frames and sound, the index at the front of the file, and the file itself.
    say('exp-msg', 'Finishing the file…'); ui.prog.value = 0.975;
    if (aenc) sendSound(len);
    await within(venc.flush(), 120000, 'finishing the video'); venc.close(); venc = null;
    if (aenc) { await within(aenc.flush(), 60000, 'finishing the sound'); aenc.close(); aenc = null; }
    if (failed) throw failed;
    buf = null;
    muxer.finalize();
    ui.prog.value = 0.99;
    let out, size;
    if (file) {
      await within(written, 120000, 'writing the file'); if (failed) throw failed;
      await within(file.stream.close(), 120000, 'saving the file'); file.stream = null;
      out = await file.handle.getFile(); size = out.size;
      if (!size) throw new Error('the file came out empty');
    } else { out = new Blob([muxer.target.buffer], { type: 'video/mp4' }); size = out.size; }
    ui.prog.value = 1;
    X.url = URL.createObjectURL(out);
    ui.download.href = X.url; ui.download.hidden = false;
    ui.download.download = safeName() + (part ? `-short-${Math.floor(part.from / 60)}m${String(Math.floor(part.from % 60)).padStart(2, '0')}s` : '') + '.mp4';
    const notes = [vc.mux === 'vp9' && 'It uses VP9 video, which some players (QuickTime, iPhone Photos) may not open; Chrome on a Mac normally makes the more compatible H.264 kind.',
      !ac && 'This browser could not add sound.', ac && ac.mux === 'opus' && 'Its sound is Opus, which some players do not support.'].filter(Boolean);
    say('exp-msg', `Video ready: ${mmss(total / fps)}, ${w}×${h}, ${(size / 1048576).toFixed(1)} MB, made in ${mmss((performance.now() - began) / 1000)}. Press "Save the video". ${notes.join(' ')}`);
  } catch (err) {
    say('exp-msg', X.stop ? 'Stopped. No video was made.' : 'The video could not be made: ' + (err.message || err) + '. Please try again; a smaller size or 30 frames a second needs less of the computer.');
    for (const e of [venc, aenc]) { try { if (e && e.state !== 'closed') e.close(); } catch {} }
    try { await file?.stream?.abort(); } catch {}
  }
  P.busy = false; X.on = false; X.stop = false; ui.prog.hidden = true;
  ui.export.textContent = 'Make the video';
  for (const k of ['record', 'demo', 'capture', 'mic']) ui[k].disabled = false;
  enable(); fit(); partChanged();
}
ui.export.addEventListener('click', makeVideo);

stage.setLive(L.held); stage.setTrail(L.trail);
fit();
requestAnimationFrame(frame);
chooseInstrument(C.instrument, $(`#instruments [data-v="${C.instrument}"]`), false);
// If this browser has already been allowed to use the piano, connect without being asked.
try { navigator.permissions?.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') connect(true); }).catch(() => {}); } catch {} // some browsers do not know the question at all

