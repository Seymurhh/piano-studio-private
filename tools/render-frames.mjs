#!/usr/bin/env node
// Renders still frames (and short frame sequences) of the studio's stage headlessly, so a change to the picture can
// be checked by eye. Zero dependencies: a tiny static server, Google Chrome in headless mode, and the Chrome
// DevTools Protocol spoken over Node's built-in WebSocket. It never changes the app; it only loads tools/frame.html.
//
//   node tools/render-frames.mjs --piece satie-gymnopedie-1.smf --times 2,5,10 --out /some/dir
//   node tools/render-frames.mjs --piece bach-prelude-in-c.smf --video 4 6 24 --mp4 --out /some/dir
//   node tools/render-frames.mjs --help
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..'); // the app folder that is served
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const HELP = `Render frames of the Piano studio stage headlessly.

  node tools/render-frames.mjs --piece <name>[,<name>...] [--times 2,5,10] [--video <start> <end> <fps> [--mp4]]
                               [--out <dir>] [--w 1280 --h 720 | --shape tall] [--set key=value ...] [options]

What to draw
  --piece <name>       file in assets/music (".smf" added if no extension), a path from the app root, a MIDI file
                       anywhere on disk, or "demo". A comma list renders each piece in turn. Default: demo.
  --times <list>       music seconds, comma separated; "a:b:step" expands to a range (end included). May be negative
                       (the app starts 1.5 s before the first note).
  --video <s> <e> <fps> a consecutive sequence from s up to (not including) e, into its own folder.
  --mp4                also join the sequence into an H.264 mp4 with ffmpeg.
  --contact            also tile the stills of each piece into <prefix>-contact.png with ffmpeg.

Picture (anything not listed here is passed to the page, which calls the stage setter of that name)
  --view <v>           sheet (default), piano, flight, dancer
  --shape wide|tall    default wide; --w / --h set the size (default 1280x720, or 720x1280 tall)
  --ratio <r>          drawing pixel ratio; default like the app's video export (2 up to 1080p, 1.5 up to 1440p, 1 above)
  --raw                save the full drawn picture instead of scaling it down to w x h
  --set key=value      stage option, e.g. --set theme=ember --set sheetCam=low --set glow=0.7 --set look=passacaglia.
                       Same as --key value. true/false/on/off and numbers are converted.
  --js <code>          JavaScript run in the page after setup, with "stage" in scope (e.g. --js "stage.setSky('plain')")
  --settle <ms>        wait this long after the first frame before drawing (for assets the stage loads in the
                       background; a stage.ready() promise, if the stage has one, is always awaited)

Output and engine
  --out <dir>          output folder (created). Default: <system temp>/piano-frames
  --prefix <p>         file name prefix. Default: the piece name (plus the view when not sheet)
  --format png|jpeg    image format (default png); --quality 0..1 for jpeg (default 0.92)
  --gl auto|metal|swiftshader|default   graphics backend. auto = Metal through ANGLE, SwiftShader if that fails.
  --timeout <s>        how long to wait for the page and for each frame (default 120)
  --verbose            print the page's console messages
  --serve              only start the server and print the bench URL, to open frame.html in your own browser

Files: <out>/<prefix>-<time>.png (time like 005.00, negative as m001.50); sequences in
<out>/<prefix>-seq-<start>-<end>-<fps>fps/f00000.png and, with --mp4, <out>/<prefix>-seq-<start>-<end>-<fps>fps.mp4.
`;

// ---------- arguments ----------
const DRIVER = new Set(['piece', 'times', 'out', 'video', 'mp4', 'prefix', 'format', 'quality', 'gl', 'contact', 'js', 'timeout', 'verbose', 'serve', 'help', 'set']);
const FLAGS = new Set(['mp4', 'contact', 'verbose', 'serve', 'help', 'raw']);
function parseArgs(argv) {
  const o = { pass: [], set: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '-h') a = '--help';
    if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}". Run with --help.`);
    let key = a.slice(2), val;
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); }
    if (key === 'video') {
      const v = argv.slice(i + 1, i + 4).map(Number);
      if (v.length < 3 || v.some((x) => !Number.isFinite(x)) || v[2] <= 0 || v[1] <= v[0]) throw new Error('--video needs <start seconds> <end seconds> <fps>, with end after start.');
      o.video = { start: v[0], end: v[1], fps: v[2] }; i += 3; continue;
    }
    if (val === undefined) {
      if (FLAGS.has(key)) val = 'true';
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) val = argv[++i];
      else throw new Error(`--${key} needs a value.`);
    }
    if (key === 'set') {
      const k = val.indexOf('=');
      if (k <= 0) throw new Error(`--set needs key=value, got "${val}".`);
      o.pass.push([val.slice(0, k), val.slice(k + 1)]);
    } else if (DRIVER.has(key)) o[key] = val;
    else o.pass.push([key === 'width' ? 'w' : key === 'height' ? 'h' : key, val]);
  }
  return o;
}

function parseTimes(s) {
  if (!s) return [];
  const out = [];
  for (const part of String(s).split(',').map((x) => x.trim()).filter(Boolean)) {
    const r = part.split(':').map(Number);
    if (r.length === 3 && r.every(Number.isFinite) && r[2] > 0) { for (let t = r[0]; t <= r[1] + 1e-9; t += r[2]) out.push(+t.toFixed(6)); continue; }
    const t = Number(part);
    if (!Number.isFinite(t)) throw new Error(`"${part}" is not a time in seconds.`);
    out.push(t);
  }
  return out;
}
const label = (t) => { const a = Math.abs(t), s = Math.abs(a * 100 - Math.round(a * 100)) < 1e-6 ? a.toFixed(2) : a.toFixed(3); return (t < 0 ? 'm' : '') + s.padStart(6, '0'); };
const ms = (v) => `${v.toFixed(0)} ms`;
const sleep = (n) => new Promise((r) => setTimeout(r, n));

// ---------- a tiny static server for the app folder (plus outside MIDI files at /__piece/<name>) ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.smf': 'audio/midi', '.mid': 'audio/midi', '.midi': 'audio/midi', '.wasm': 'application/wasm' };
function startServer(extra) {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    let file;
    if (rel.startsWith('/__piece/')) file = extra.get(rel.slice('/__piece/'.length));
    else { file = path.join(ROOT, rel); if (rel.endsWith('/')) file = path.join(file, 'index.html'); }
    if (!file || (!rel.startsWith('/__piece/') && file !== ROOT && !file.startsWith(ROOT + path.sep))) { res.writeHead(404).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server)); });
}

// ---------- Chrome and the DevTools Protocol ----------
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
      } else if (m.method) for (const fn of this.listeners) fn(m);
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Chrome closed the DevTools connection.')); } this.pending.clear(); });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error(`Could not connect to Chrome at ${url}.`)), { once: true });
    });
  }
  send(method, params = {}, sessionId, timeout = 120000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} took longer than ${timeout / 1000} s.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

const GL_FLAGS = {
  metal: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  default: [],
};
const live = new Set(); // Chrome processes and temp folders still to clean up

async function launchChrome(gl) {
  if (!fs.existsSync(CHROME)) throw new Error(`Google Chrome was not found at ${CHROME} (set CHROME=/path/to/chrome).`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-frames-chrome-'));
  const args = ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-features=Translate,MediaRouter',
    '--use-mock-keychain', '--password-store=basic', '--mute-audio', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1280,800',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--enable-webgl',
    ...GL_FLAGS[gl], 'about:blank'];
  const proc = spawn(CHROME, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const handle = { proc, profile, log: '' };
  live.add(handle);
  proc.stderr.on('data', (d) => { handle.log = (handle.log + d).slice(-6000); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300; i++) {
    if (proc.exitCode !== null) throw new Error(`Chrome exited early (code ${proc.exitCode}).\n${handle.log}`);
    if (fs.existsSync(portFile)) {
      const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split('\n');
      if (port && wsPath) { handle.cdp = await CDP.connect(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`); return handle; }
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not start its DevTools endpoint.\n${handle.log}`);
}

async function stopChrome(h) {
  if (!h) return;
  h.cdp?.close();
  const { proc } = h;
  if (proc.exitCode === null && proc.signalCode === null) {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
    for (let i = 0; i < 30 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(100);
    if (proc.exitCode === null && proc.signalCode === null) { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  for (let i = 0; i < 5; i++) { try { fs.rmSync(h.profile, { recursive: true, force: true }); break; } catch { await sleep(200); } }
  live.delete(h);
}
function killAllSync() { // last resort on exit: no awaiting possible
  for (const h of live) {
    try { process.kill(-h.proc.pid, 'SIGKILL'); } catch { /* gone */ }
    try { fs.rmSync(h.profile, { recursive: true, force: true }); } catch { /* busy */ }
  }
  live.clear();
}

// Opens one page with its own DevTools session, and reports its console and crashes.
async function openPage(h, verbose) {
  const { targetId } = await h.cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await h.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = { sessionId, crashed: false, errors: [], send: (m, p, t) => h.cdp.send(m, p, sessionId, t) };
  h.cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Inspector.targetCrashed') page.crashed = true;
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; const s = d.exception?.description || d.text; page.errors.push(s); console.error(`  [page error] ${s}`); }
    else if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (m.params.type === 'error') { page.errors.push(text); console.error(`  [page console.error] ${text}`); }
      else if (verbose) console.log(`  [page ${m.params.type}] ${text}`);
    }
  });
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Inspector.enable').catch(() => {});
  return page;
}

async function evaluate(page, expression, timeout) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function loadBench(page, url, timeout) {
  // Forget the previous piece's bench first, so a poll that still reaches the old document (before the new one
  // commits) can never mistake its "ready" for the new page's.
  await evaluate(page, 'window.__bench = undefined', 10000).catch(() => {});
  await page.send('Page.navigate', { url });
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (page.crashed) throw new Error('The page crashed while loading (the graphics backend may not work here).');
    let s = null;
    try { s = await evaluate(page, 'window.__bench ? JSON.stringify(window.__bench) : null', 10000); } catch { /* page still navigating */ }
    if (s) {
      const b = JSON.parse(s);
      if (b.state === 'ready') return b.info;
      if (b.state === 'error') { const e = new Error(`The bench page failed: ${b.error}`); e.page = b.kind !== 'gl'; e.stack2 = b.stack; throw e; }
    }
    await sleep(100);
  }
  throw new Error(`The bench page was not ready after ${timeout / 1000} s.`);
}

async function grab(page, t, opts, file, timeout) {
  const a = performance.now();
  const v = await evaluate(page, `window.__render(${JSON.stringify(t)}, ${JSON.stringify(opts)})`, timeout);
  fs.writeFileSync(file, Buffer.from(v.url.slice(v.url.indexOf(',') + 1), 'base64'));
  const total = performance.now() - a; // transfer = everything outside the page's own work: the trip back, decoding, writing
  return { t, file, ms: { ...v.ms, transfer: +(total - v.ms.prime - v.ms.render - v.ms.readback - v.ms.encode).toFixed(1), total: +total.toFixed(1) }, luma: v.luma, size: [v.w, v.h] };
}

function describe(r) {
  const flag = r.luma.max < 12 ? '  << looks BLACK' : r.luma.sd < 2 ? '  << looks BLANK (flat)' : '';
  return `t=${r.t.toFixed(2).padStart(7)}  ${ms(r.ms.total).padStart(7)}  (${r.ms.prime >= 0.5 ? `prime ${ms(r.ms.prime)}, ` : ''}render ${ms(r.ms.render)}, readback+scale ${ms(r.ms.readback)}, encode ${ms(r.ms.encode)}, transfer+write ${ms(r.ms.transfer)})  luma ${r.luma.mean}/${r.luma.max} sd ${r.luma.sd}${flag}`;
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error) throw new Error(`ffmpeg could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

function stats(list) {
  if (!list.length) return '';
  const tot = list.map((r) => r.ms.total).sort((a, b) => a - b), avg = (k) => list.reduce((s, r) => s + r.ms[k], 0) / list.length;
  return `${list.length} frames: mean ${ms(avg('total'))} per frame (median ${ms(tot[tot.length >> 1])}, min ${ms(tot[0])}, max ${ms(tot[tot.length - 1])}); `
    + `mean prime ${ms(avg('prime'))}, render ${ms(avg('render'))}, readback+scale ${ms(avg('readback'))}, encode ${ms(avg('encode'))}, transfer+write ${ms(avg('transfer'))}`;
}

// ---------- main ----------
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  const times = parseTimes(o.times);
  const out = path.resolve(o.out || path.join(os.tmpdir(), 'piano-frames'));
  const format = /^jpe?g$/i.test(o.format || '') ? 'jpeg' : 'png', ext = format === 'jpeg' ? 'jpg' : 'png';
  const quality = Number(o.quality) || 0.92;
  const timeout = (Number(o.timeout) || 120) * 1000;
  const glWanted = o.gl || 'auto';
  if (!['auto', 'metal', 'swiftshader', 'default'].includes(glWanted)) throw new Error('--gl must be auto, metal, swiftshader or default.');
  const pieces = (o.piece || 'demo').split(',').map((s) => s.trim()).filter(Boolean);
  if (!o.serve && !times.length && !o.video) throw new Error('Nothing to draw: give --times and/or --video. Run with --help.');

  // Outside MIDI files (absolute or relative paths that exist on disk but are not in the app) are served at /__piece/.
  const extra = new Map();
  const query = (piece) => {
    const p = new URLSearchParams();
    const onDisk = /[\\/]/.test(piece) && fs.existsSync(path.resolve(piece)) && !path.resolve(piece).startsWith(ROOT + path.sep);
    if (onDisk) { const name = `${extra.size}-${path.basename(piece)}`; extra.set(name, path.resolve(piece)); p.set('src', `/__piece/${encodeURIComponent(name)}`); p.set('piece', path.basename(piece)); }
    else if (/[\\/]/.test(piece) && fs.existsSync(path.resolve(piece))) p.set('piece', path.relative(ROOT, path.resolve(piece)).split(path.sep).join('/'));
    else p.set('piece', piece);
    for (const [k, v] of o.pass) p.set(k, v);
    return p;
  };

  const server = await startServer(extra);
  const base = `http://127.0.0.1:${server.address().port}/tools/frame.html`;
  let chrome = null;
  const cleanup = async () => { await stopChrome(chrome); chrome = null; await new Promise((r) => server.close(() => r())); };
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { if (stopping) return; stopping = true; console.error(`\n${sig}: cleaning up…`); try { await cleanup(); } finally { process.exit(130); } });

  try {
    if (o.serve) {
      for (const piece of pieces) { const p = query(piece); if (times.length) p.set('times', times.join(',')); console.log(`${base}?${p}`); }
      console.log('Serving the app folder. Open the address above in Chrome; press Ctrl-C to stop.');
      await new Promise(() => {});
    }
    fs.mkdirSync(out, { recursive: true });
    const written = [], all = [];
    const t0 = performance.now();

    // Start Chrome with the wanted graphics backend; in auto mode fall back to SwiftShader if Metal does not work.
    const backends = glWanted === 'auto' ? ['metal', 'swiftshader'] : [glWanted];
    let page = null, info = null, gl = null;
    const firstURL = () => { const p = query(pieces[0]); p.set('bare', '1'); if (times.length) p.set('times', String(times[0])); else p.set('times', String(o.video.start)); return `${base}?${p}`; };
    for (const b of backends) {
      try {
        const tl = performance.now();
        chrome = await launchChrome(b);
        page = await openPage(chrome, o.verbose);
        info = await loadBench(page, firstURL(), timeout);
        gl = b;
        console.log(`Chrome ready with ${b} in ${ms(performance.now() - tl)}: ${info.gl.renderer} (${info.gl.version})`);
        break;
      } catch (err) {
        await stopChrome(chrome); chrome = null;
        // Only graphics trouble (Chrome not starting, WebGL failing, the page crashing) is worth another backend.
        if (err.page) throw err;
        console.error(`Graphics backend "${b}" failed: ${err.message.split('\n')[0]}`);
        if (b === backends[backends.length - 1]) throw err;
      }
    }

    for (let pi = 0; pi < pieces.length; pi++) {
      const piece = pieces[pi];
      if (pi > 0) {
        const p = query(piece); p.set('bare', '1'); p.set('times', String(times.length ? times[0] : o.video.start));
        info = await loadBench(page, `${base}?${p}`, timeout);
      }
      const view = (o.pass.find(([k]) => k === 'view') || [])[1] || 'sheet';
      const stem = path.basename(piece).replace(/\.(smf|midi?)$/i, '') + (view !== 'sheet' ? `-${view}` : '');
      const prefix = o.prefix ? (pieces.length > 1 ? `${o.prefix}-${stem}` : o.prefix) : stem;
      console.log(`\n${piece}: ${info.notes} notes, ${info.duration} s, ${info.tracks} track(s); ${info.size.w}x${info.size.h} drawn at ${info.size.drawn.join('x')} (ratio ${info.size.ratio}), saved at ${info.size.out.join('x')}; load ${ms(info.ms.load)}, first frame (scene build) ${ms(info.ms.build)}`);
      if (Object.keys(info.applied).length) console.log(`  options: ${Object.entries(info.applied).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`);
      if (info.unknown.length) console.warn(`  WARNING: the stage has no setter for: ${info.unknown.join(', ')} (it has: ${info.setters.join(', ')})`);
      if (o.js) { const r = await evaluate(page, `(async (stage) => { ${o.js} })(window.__stage)`, timeout); if (r !== undefined) console.log(`  --js returned: ${JSON.stringify(r)}`); }

      const stills = [];
      for (const t of times) {
        const r = await grab(page, t, { format, quality, prime: t }, path.join(out, `${prefix}-${label(t)}.${ext}`), timeout);
        stills.push(r); written.push(r.file); console.log(`  ${path.basename(r.file)}  ${describe(r)}`);
        if (page.crashed) throw new Error('The page crashed while drawing.');
      }
      if (stills.length) { all.push(...stills); console.log(`  stills: ${stats(stills)}`); }
      if (o.contact && stills.length > 1) {
        const cols = stills.length <= 4 ? 2 : 3, rows = Math.ceil(stills.length / cols), file = path.join(out, `${prefix}-contact.png`);
        const inputs = stills.flatMap((r) => ['-i', r.file]);
        ffmpeg([...inputs, '-filter_complex', `${stills.map((_, i) => `[${i}:v]`).join('')}concat=n=${stills.length}:v=1:a=0,scale=640:-2,tile=${cols}x${rows}`, '-frames:v', '1', file]);
        written.push(file); console.log(`  contact sheet: ${file}`);
      }

      if (o.video) {
        const { start, end, fps } = o.video, n = Math.max(1, Math.round((end - start) * fps));
        const name = `${prefix}-seq-${label(start)}-${label(end)}-${fps}fps`, dir = path.join(out, name);
        fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        const seq = [];
        for (let i = 0; i < n; i++) {
          const t = +(start + i / fps).toFixed(6);
          const r = await grab(page, t, { format, quality, prime: i === 0 ? start - 1 / fps : null }, path.join(dir, `f${String(i).padStart(5, '0')}.${ext}`), timeout);
          seq.push(r);
          if (o.verbose || i % Math.max(1, Math.round(fps / 2)) === 0) console.log(`  ${name}/${path.basename(r.file)}  ${describe(r)}`);
          if (page.crashed) throw new Error('The page crashed while drawing.');
        }
        all.push(...seq); written.push(dir + path.sep);
        console.log(`  sequence: ${n} frames in ${dir}${path.sep}`);
        console.log(`  sequence: ${stats(seq)}`);
        const dark = seq.filter((r) => r.luma.max < 12).length;
        if (dark) console.warn(`  WARNING: ${dark} of ${n} frames look black.`);
        if (o.mp4) {
          const file = path.join(out, `${name}.mp4`);
          ffmpeg(['-framerate', String(fps), '-i', path.join(dir, `f%05d.${ext}`), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
          written.push(file); console.log(`  mp4: ${file}`);
        }
      }
    }

    console.log(`\nBackend: ${gl} (${info.gl.renderer}). Overall: ${stats(all)}. Wall time ${(performance.now() - t0) / 1000 | 0} s.`);
    console.log('Files written:');
    for (const f of written) console.log(`  ${f}`);
  } finally {
    await cleanup();
  }
}

process.on('exit', killAllSync);
main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  if (err.stack2 && process.argv.includes('--verbose')) console.error(err.stack2);
  process.exitCode = 1;
});
