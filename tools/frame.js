// Frame bench: draws the studio's stage at chosen music times so a picture can be checked by eye, either driven
// headlessly by tools/render-frames.mjs or opened by hand in a browser (with a scrub bar). It only imports the app's
// modules and never changes them.
//
// Query options (all optional):
//   piece   file name in assets/music (".smf" added when there is no extension), a path from the app root
//           (contains "/"), "demo" for the built-in demo pattern, or "none"
//   src     a URL to fetch the MIDI from instead (the driver serves outside files at /__piece/<name>)
//   view    stage view, default "sheet"
//   shape   wide | tall (default wide); w / h (or width / height) override the size, default 1280x720 or 720x1280
//   ratio   pixel ratio the stage draws at; default as the app's video export: 2 up to 1080p, 1.5 up to 1440p, else 1
//   raw     1 = hand back the full drawn picture instead of scaling it down to w x h like the export does
//   times   comma list of music seconds to draw when opened by hand (the first one is also the warm-up frame)
//   bare    1 = no scrub bar or message (the driver sets it)
//   settle  milliseconds to wait after the first frame before drawing (for anything the stage loads in the background;
//           a stage.ready() function returning a promise, if the stage ever has one, is awaited as well)
//   anything else, e.g. theme, sheetCam, sky, glow, landing, effects, motion, paths, look ...: passed to the stage
//           setter of the same name (set<Name>, case-insensitive) when the stage has one; unknown ones are reported.
//           Values: true/false/on/off/yes/no -> booleans, numbers -> numbers, JSON objects/arrays -> parsed.
//
// What the driver uses: window.__bench = { state: 'loading' | 'ready' | 'error', kind ('gl' | 'page'), error, stack, info },
// window.__render(t, { format, quality, prime }) -> { t, url (data URL), w, h, ms: { prime, render, readback, encode }, luma },
// window.__apply({ key: value }) -> applies more options, window.__stage = the stage object.
import { createStage } from '../assets/js/stage.js';
import { parseMidi, demoPiece } from '../assets/js/midi.js';

const q = new URLSearchParams(location.search);
const RESERVED = new Set(['piece', 'src', 'view', 'shape', 'w', 'h', 'width', 'height', 'ratio', 'raw', 'times', 'bare', 'settle', 'format', 'quality']);
const bench = (window.__bench = { state: 'loading', error: null, info: null });
const $ = (s) => document.querySelector(s);
const flag = (k) => /^(1|true|yes|on)$/i.test(q.get(k) || '');
const say = (s) => { $('#msg').textContent = s; };

function coerce(v) {
  if (typeof v !== 'string') return v;
  if (/^(true|on|yes)$/i.test(v)) return true;
  if (/^(false|off|no)$/i.test(v)) return false;
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return Number(v);
  if (/^[[{]/.test(v)) { try { return JSON.parse(v); } catch { /* keep the text */ } }
  return v;
}

function size() {
  const tall = q.get('shape') === 'tall';
  let w = Number(q.get('w') || q.get('width')) || 0, h = Number(q.get('h') || q.get('height')) || 0;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  if (!w && !h) [w, h] = tall ? [720, 1280] : [1280, 720];
  else if (!h) h = w * (tall ? 16 / 9 : 9 / 16);
  else if (!w) w = h * (tall ? 9 / 16 : 16 / 9);
  w = even(w); h = even(h);
  const short = Math.min(w, h);
  const ratio = Number(q.get('ratio')) || (short <= 1080 ? 2 : short <= 1440 ? 1.5 : 1); // as the app's video export
  return { w, h, ratio };
}

async function loadPiece() {
  const name = q.get('piece'), src = q.get('src');
  if (!src && (!name || name === 'demo')) return { piece: demoPiece(), label: 'demo' };
  if (!src && name === 'none') return { piece: null, label: 'none' };
  let url = src;
  if (!url) {
    const file = /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.smf`;
    url = file.includes('/') ? `../${file.replace(/^\/+/, '')}` : `../assets/music/${file}`;
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Could not load the piece ${url} (HTTP ${r.status}).`);
  const piece = parseMidi(await r.arrayBuffer());
  let meta = null;
  try { // the library's own title and composer, for the report only
    const list = await (await fetch('../assets/music/index.json', { cache: 'no-store' })).json();
    meta = list.find((it) => it.file === url.split('/').pop()) || null;
  } catch { /* no library list */ }
  return { piece, label: name || src, meta };
}

function glInfo(canvas) {
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { version: null, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { version: gl.getParameter(gl.VERSION), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  } catch { return { version: null, renderer: null }; }
}

async function main() {
  const canvas = $('#stage');
  const { w, h, ratio } = size();
  const raw = flag('raw');
  const times = (q.get('times') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  const t0 = performance.now();
  try { await document.fonts.ready; } catch { /* fonts API missing */ }
  const { piece, label, meta } = await loadPiece();
  const tLoaded = performance.now();

  let stage;
  try { stage = createStage(canvas); } catch (err) { err.kind = 'gl'; throw err; } // WebGL could not start
  window.__stage = stage;
  const setters = new Map(Object.keys(stage).filter((k) => /^set[A-Z]/.test(k) && typeof stage[k] === 'function').map((k) => [k.slice(3).toLowerCase(), k]));
  const applied = {}, unknown = [];
  const apply = (opts) => {
    for (const [k, v] of Object.entries(opts)) {
      const fn = setters.get(k.toLowerCase());
      if (!fn) { if (!unknown.includes(k)) unknown.push(k); continue; }
      const value = coerce(v);
      stage[fn](value); applied[k] = value;
    }
  };
  window.__apply = apply;

  stage.resize(w, h, ratio); // as the export does: the stage draws ratio times larger, the result is scaled to w x h
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  apply({ view: q.get('view') || 'sheet' });
  stage.setPiece(piece);
  const rest = {};
  for (const [k, v] of q) if (!RESERVED.has(k)) rest[k] = v;
  apply(rest);

  const ow = raw ? canvas.width : w, oh = raw ? canvas.height : h;
  const comp = document.createElement('canvas'); comp.width = ow; comp.height = oh;
  const g = comp.getContext('2d'); // set up exactly as the export's own canvas, so the scaling down matches it
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
  const pg = probe.getContext('2d', { willReadFrequently: true });

  // Brightness of the finished picture, so a black or blank frame is noticed without looking at it.
  function luma() {
    pg.clearRect(0, 0, 64, 36); pg.drawImage(comp, 0, 0, 64, 36);
    const d = pg.getImageData(0, 0, 64, 36).data;
    let sum = 0, sq = 0, max = 0, lit = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y; sq += y * y; if (y > max) max = y; if (y > 24) lit++;
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1), max: Math.round(max), lit: +(lit / n).toFixed(3) };
  }

  function draw(t) {
    const a = performance.now();
    stage.render(t);
    const b = performance.now();
    g.clearRect(0, 0, ow, oh); g.drawImage(canvas, 0, 0, ow, oh);
    g.getImageData(0, 0, 1, 1); // reading a pixel waits until the frame is finished and scaled
    const c = performance.now();
    return { render: b - a, readback: c - b };
  }

  // prime: a music time drawn (and thrown away) first. The stage reads a little state left by the frame before (the
  // sheet's ball tails face the previous frame's camera), so stills prime with their own time and sequences with the
  // time one frame before their start, which makes every result independent of what was drawn before it.
  window.__render = (t, { format = 'png', quality = 0.92, prime = null } = {}) => {
    const p0 = performance.now();
    if (prime !== null && prime !== undefined) draw(Number(prime)); // waits for it, so the times below are the frame's own
    const p1 = performance.now();
    const ms = draw(Number(t));
    ms.prime = p1 - p0;
    const a = performance.now();
    const url = comp.toDataURL(format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : 'image/png', quality);
    ms.encode = performance.now() - a;
    for (const k in ms) ms[k] = +ms[k].toFixed(1);
    return { t: Number(t), url, w: ow, h: oh, ms, luma: luma() };
  };

  // Warm-up: the first frame builds the scene and compiles the shaders, which is slow and not a fair frame time.
  // If the stage loads anything in the background (fonts, textures), it can offer stage.ready() -> Promise, which is
  // awaited here; "settle" (milliseconds) waits longer still. The frame is drawn again after either.
  const warmT = times.length ? times[0] : 0;
  const tw = performance.now();
  draw(warmT);
  if (typeof stage.ready === 'function') { await stage.ready(); draw(warmT); }
  const settle = Number(q.get('settle')) || 0;
  if (settle > 0) { await new Promise((r) => setTimeout(r, settle)); draw(warmT); }
  const warm = performance.now() - tw;

  bench.info = {
    piece: label, meta, notes: piece ? piece.notes.length : 0, duration: piece ? +piece.duration.toFixed(2) : 0, tracks: piece ? piece.tracks : 0,
    size: { w, h, ratio, drawn: [canvas.width, canvas.height], out: [ow, oh] }, applied, unknown,
    setters: [...setters.values()], gl: glInfo(canvas),
    ms: { load: +(tLoaded - t0).toFixed(1), build: +warm.toFixed(1) },
  };
  bench.state = 'ready';

  if (flag('bare')) { $('#msg').hidden = true; return; }
  // Opened by hand: a scrub bar over the whole piece.
  const bar = $('#bar'), scrub = $('#scrub'), tl = $('#tlabel');
  bar.hidden = false; bar.style.width = `${w}px`; bar.style.boxSizing = 'border-box';
  scrub.min = -1.5; scrub.max = (piece ? piece.duration : 10) + 2.5; scrub.value = warmT;
  let pending = null;
  const show = () => { const t = Number(scrub.value); const ms = draw(t); tl.textContent = `t = ${t.toFixed(2)} s`; say(`${label} · ${w}x${h} at ratio ${ratio} · ${bench.info.gl.renderer} · ${(ms.render + ms.readback).toFixed(0)} ms${unknown.length ? ` · no setter for: ${unknown.join(', ')}` : ''}`); pending = null; };
  scrub.addEventListener('input', () => { if (!pending) pending = requestAnimationFrame(show); });
  show();
}

main().catch((err) => {
  bench.state = 'error';
  bench.kind = (err && err.kind) || 'page'; // 'gl' = the graphics backend failed, 'page' = anything else
  bench.error = String((err && err.message) || err);
  bench.stack = String((err && err.stack) || '');
  say('The frame bench could not start: ' + bench.error);
});
