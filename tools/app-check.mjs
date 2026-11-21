#!/usr/bin/env node
// Drives the real app page (index.html) in headless Chrome over the DevTools Protocol, to check it end to end:
// it reports every console error and uncaught exception, can take screenshots of the page, press keys of the
// computer keyboard (live playing), choose a piece, and make a video with the app's own "Make the video" button,
// saving the result. Zero dependencies, like render-frames.mjs (Node 22 or later, Google Chrome in /Applications).
//
//   node tools/app-check.mjs --out <dir>                          load the page, report errors, save page.png
//   node tools/app-check.mjs --out <dir> --keys                    also play a few notes on the keyboard, screenshot
//   node tools/app-check.mjs --out <dir> --piece demo --export 720 --fps 30   make a video, save <dir>/<name>.mp4
//   node tools/app-check.mjs --out <dir> --steps steps.json      run page scripts in turn: [{ js, wait (s), shot (png name) }]
//   options: --piece demo | <library index> | part of a library title, --look paper|night, --view sheet|piano|...,
//            --shape wide|tall, --set key=value (a saved setting, as the studio keeps it), --wait <s>, --gl metal|swiftshader
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.smf': 'audio/midi', '.mid': 'audio/midi', '.pack': 'application/octet-stream' };

function args(argv) {
  const o = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['keys', 'help'].includes(k)) { o[k] = true; continue; }
    const v = argv[++i];
    if (k === 'set') o.set.push(v.split('=')); else o[k] = v;
  }
  return o;
}

function serve() {
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(404).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function chrome(gl) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-app-chrome-'));
  const flags = gl === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const proc = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1500,1100',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', ...flags, 'about:blank'], { detached: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); }
    else for (const f of listeners) f(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const stop = () => { try { ws.close(); } catch {} try { process.kill(-proc.pid, 'SIGKILL'); } catch {} setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300); };
  return { send, on: (f) => listeners.push(f), stop };
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); return; }
  const out = path.resolve(o.out || path.join(os.tmpdir(), 'piano-app'));
  fs.mkdirSync(out, { recursive: true });
  const server = await serve(), c = await chrome(o.gl);
  const errors = [], logs = [];
  try {
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => c.send(m, p, sessionId);
    c.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(d.exception?.description || d.text); }
      else if (m.method === 'Runtime.consoleAPICalled') { const t = m.params.args.map((a) => a.value ?? a.description ?? '').join(' '); (m.params.type === 'error' ? errors : logs).push(`[${m.params.type}] ${t}`); }
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`[${m.params.entry.source}] ${m.params.entry.text} ${m.params.entry.url || ''}`);
    });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const base = `http://127.0.0.1:${server.address().port}/`;
    // saved settings (as the studio keeps them in localStorage) go in before the page's own script runs
    const saved = { v: 4 };
    if (o.look) saved.look = o.look;
    if (o.view) saved.view = o.view;
    if (o.shape) saved.shape = o.shape;
    for (const [k, v] of o.set) saved[k] = /^(true|false)$/.test(v) ? v === 'true' : Number.isFinite(Number(v)) ? Number(v) : v;
    if (Object.keys(saved).length > 1) await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('studio', ${JSON.stringify(JSON.stringify(saved))}); } catch {}` });
    const t0 = Date.now();
    await send('Page.navigate', { url: base + 'index.html' });
    for (let i = 0; i < 200; i++) { await sleep(100); if (await evaluate('document.readyState').catch(() => '') === 'complete') break; }
    await sleep((Number(o.wait) || 3) * 1000); // the glyphs, the instrument and the first frames
    const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64')); console.log('screenshot', path.join(out, name)); };
    const state = () => evaluate(`JSON.stringify({ title: document.querySelector('#piece-title').textContent, msg: document.querySelector('#rec-msg').textContent,
      paper: document.body.classList.contains('paper'), look: [...document.querySelectorAll('#looks [aria-checked=true]')].map((b) => b.textContent),
      view: [...document.querySelectorAll('#views [aria-checked=true]')].map((b) => b.textContent), saved: localStorage.getItem('studio') })`);
    console.log(`page loaded in ${Date.now() - t0} ms:`, await state());
    await evaluate(`document.querySelector('#tab-look').click()`);
    await shot('page.png');

    if (o.steps) { // a list of { js, wait (s), shot (file name) }: page script run in turn, e.g. clicking the Look controls
      for (const st of JSON.parse(fs.readFileSync(o.steps, 'utf8'))) {
        if (st.js) { const r = await evaluate(`(async () => { ${st.js} })()`); if (r !== undefined) console.log(`step ${st.shot || ''}:`, JSON.stringify(r)); }
        if (st.wait) await sleep(st.wait * 1000);
        if (st.shot) await shot(st.shot);
      }
    }

    if (o.keys) { // play a little tune on the computer keyboard: A S D F G H J K = C D E F G A B C, W E T Y U = black keys
      const keys = ['KeyA', 'KeyD', 'KeyG', 'KeyK', 'KeyT', 'KeyH', 'KeyE', 'KeyS', 'KeyA', 'KeyJ', 'KeyK'];
      for (const code of keys) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.slice(3).toLowerCase() });
        await sleep(260);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.slice(3).toLowerCase() });
        await sleep(60);
      }
      await shot('keys.png');
      await sleep(2500); await shot('keys-later.png');
    }

    if (o.piece) {
      // "demo", a library index, or part of a title in the library list
      const v = await evaluate(`(() => { const sel = document.querySelector('#library'), want = ${JSON.stringify(String(o.piece))}.toLowerCase();
        const opt = [...sel.options].find((x) => x.value && (x.value === want || x.textContent.toLowerCase().includes(want)));
        sel.value = opt ? opt.value : 'demo'; sel.dispatchEvent(new Event('change')); return sel.value + ' ' + (opt ? opt.textContent : 'demo'); })()`);
      for (let i = 0; i < 100; i++) { await sleep(100); if (!(await evaluate(`document.querySelector('#play').disabled`))) break; }
      console.log(`piece chosen (${v}):`, await state());
      await sleep(2500); await shot('playing.png');
    }

    if (o.export) {
      await evaluate(`document.querySelector('#tab-video').click(); document.querySelector('#size').value = ${JSON.stringify(String(o.export))};
        document.querySelector('#fps').value = ${JSON.stringify(String(o.fps || 30))}; document.querySelector('#export').click();`);
      const began = Date.now();
      let last = '';
      for (;;) {
        await sleep(1000);
        const s = JSON.parse(await evaluate(`JSON.stringify({ done: !document.querySelector('#download').hidden, msg: document.querySelector('#exp-msg').textContent, prog: document.querySelector('#prog').value, busy: !document.querySelector('#prog').hidden })`));
        if (s.msg !== last || (Date.now() - began) % 10000 < 1000) { console.log(`  ${((Date.now() - began) / 1000).toFixed(0)} s: ${(s.prog * 100).toFixed(0)}% ${s.msg}`); last = s.msg; }
        if (s.done) break;
        if (!s.busy && /could not|cannot|has no/.test(s.msg)) throw new Error('export failed: ' + s.msg);
        if (Date.now() - began > 30 * 60000) throw new Error('export took longer than 30 minutes');
      }
      // Save it the way a person would: press "Save the video" (the page's security rules keep scripts from reading it).
      const name = await evaluate(`document.querySelector('#download').download`), file = path.join(out, name);
      fs.rmSync(file, { force: true });
      let done = null;
      c.on((m) => { if (m.method === 'Browser.downloadProgress' && m.params.state !== 'inProgress') done = m.params.state; });
      await c.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: out, eventsEnabled: true });
      const guid = new Promise((r) => c.on((m) => { if (m.method === 'Browser.downloadWillBegin') r(m.params.guid); }));
      await evaluate(`document.querySelector('#download').click()`);
      const id = await Promise.race([guid, sleep(20000).then(() => null)]);
      if (!id) throw new Error('the download did not start');
      for (let i = 0; i < 600 && !done; i++) await sleep(100);
      if (done !== 'completed') throw new Error('the download did not finish: ' + done);
      fs.renameSync(path.join(out, id), file);
      console.log(`video saved: ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB) after ${((Date.now() - began) / 1000).toFixed(0)} s`);
      await shot('exported.png');
    }
  } finally {
    console.log(`console errors and exceptions: ${errors.length}`);
    for (const e of errors) console.log('  ' + e);
    if (logs.length) { console.log(`other console messages: ${logs.length}`); for (const l of logs.slice(0, 20)) console.log('  ' + l); }
    c.stop(); server.close();
  }
  if (errors.length) process.exitCode = 2;
}
main().catch((e) => { console.error('Error:', e.message); process.exitCode = 1; });
