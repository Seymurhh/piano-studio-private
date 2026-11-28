#!/usr/bin/env node
// Hand-motion metrics for the Keys pictures: how well the two hands play a piece, measured headlessly in plain Node
// (no installs, no browser). It loads the app's own modules (hands.js, handmesh.js, midi.js, three.js) from the working
// tree or from a git revision, poses the hands at every frame of a stretch of music, skins the real hand mesh on the
// CPU exactly as the graphics card does (the bone matrices come from handmesh.js's own update() and three.js's own
// Skeleton), and measures contact with the keys, notes no finger plays, smoothness and plausibility.
//
//   node tools/hand-metrics.mjs --piece chopin-revolutionary-etude [--from s] [--to s] [--fps 60] [--json out.json] [--rev <git-rev>]
//   node tools/hand-metrics.mjs --piece <name> --at 12.5,13      (one moment in detail: joints, targets, gaps, angles)
//   node tools/hand-metrics.mjs --summary out.md a.json b.json ...      (a markdown table of several runs)
//   node tools/hand-metrics.mjs --mirror [--json out.json] [--rev <git-rev>] [--strict]   (left hand = mirror of right?)
//   node tools/hand-metrics.mjs --help
//
// Version 2 (step S0 of tools/out/hands-design/FINAL-SPEC.md) keeps every version-1 number exactly as it was and adds,
// in new top-level JSON fields: move-normalised jolts of the hand origin and wrist, fingertip jolts outside impacts, the
// IK miss at contact and at release, the contact gap during the key's descent and at the key bottom (all presses, and
// presses the finger actually reaches), presses outside their planned window, ranges of roll / pitch / wrist deviation /
// fan, hands.stats and the time of createHands. When the hands object has keyDepth(pitch, t) (and hands.js exports
// KEY_TILT), the key depression comes from them instead of from the played map and the regex on keys.js.
//
// Units: 1 unit = one white key width (about 23.5 mm); x across the keyboard, y up, z toward the pianist; seconds of music.
// Nothing in the app is changed: the modules are copied (or taken from git) into a temporary folder, which is removed
// at the end, even on an error or Ctrl-C.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = 1;

const HELP = `Hand-motion metrics for the Keys hands (hands.js + handmesh.js), in plain Node.

Usage:
  node tools/hand-metrics.mjs --piece <name> [options]
  node tools/hand-metrics.mjs --piece <name> --at <t1,t2,...>     (print those moments in detail and stop)
  node tools/hand-metrics.mjs --summary <out.md> <run.json> [<run.json> ...]
  node tools/hand-metrics.mjs --mirror [--json <file>] [--rev <git-rev>] [--strict]

  --mirror builds a synthetic 30 s two-track piece whose left hand plays the mirror image (pitch p -> 124 - p, about D4)
  of the right hand at the same times, and reports how far the left hand's joints are from the mirror image of the
  right hand's (x -> 2 KX[62] - x), at every frame. --strict: exit with code 1 if that exceeds 1e-6 units.

Options:
  --piece <name>     a file in assets/music (".smf" added if missing), or a path to a MIDI file
  --from <s>         start time in seconds of music (default: 0.3 s before the first note)
  --to <s>           end time (default: 0.3 s after the last note ends)
  --fps <n>          frames per second for the per-frame metrics (default 60, like the video export)
  --json <file>      write every number to this JSON file
  --rev <git-rev>    take assets/js, assets/vendor and assets/models from this git revision (default: working tree)
  --posture <id>     the hands' posture: auto (hands.js's default), lyrical, classical, or legacy (before the setting)
  --keys <id>        the black keys' layout: piano (hands.js's default) or even (the keyboard before the setting)
  --top <n>          how many worst moments to list (default 10)
  --keydump <file>   write every frame with skin inside a key it does not press (tab-separated) to this file
  --curldump <file>  write every finger's MCP, PIP and DIP (the thumb: MCP, IP) at every frame, and whether it holds a key
  --jolt-hand <j>    jerk threshold for the hand origin and wrist, key widths/s^3 (default 6000)
  --jolt-tip <j>     jerk threshold for the fingertips, key widths/s^3 (default 25000)
  --quiet            print only the table
  --help             this text

The temporary copy of the modules lives in the system temp folder and is always removed.`;

// ------------------------------------------------------------------------------------------------ arguments
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['help', 'quiet', 'mirror', 'strict'].includes(k)) { o[k] = true; continue; }
    if (k === 'summary') { o.summary = argv[++i]; continue; }
    o[k] = argv[++i];
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.piece && !args.summary && !args.mirror)) { console.log(HELP); process.exit(args.help ? 0 : 1); }

const FPS = Number(args.fps || 60);
// --keydump <file>: every frame with skin inside a key it does not press, as tab-separated lines (t, hand, finger, bone,
// key, depth, the skin's x y z, the key that finger holds or -1)
const KEYDUMP = args.keydump ? [] : null;
// --curldump <file>: (curl round) every frame, every finger: t, hand, finger, held (1 / 0), MCP, PIP, DIP (the thumb: its
// MCP, IP, 0), degrees, and how long it has been free (freeFor: 0 on its key)
const CURLDUMP = args.curldump ? [] : null;
// --posture: hands.js's createHands(piece, handOf, { posture }) (the studio's Hand posture: auto, lyrical, classical,
// legacy); without it, hands.js's default. Revisions before the setting ignore it.
// --keys: the black keys' layout (hands.js KEY_LAYOUTS: piano, the default, or even, the keyboard before the setting);
// revisions without layouts have the even one (and the 1dc8262 one, keys.js BLACK_SHIFT)
const POSTURE_OPT = args.posture || args.keys ? { ...(args.posture ? { posture: args.posture } : {}), ...(args.keys ? { keyLayout: args.keys } : {}) } : undefined;
const TOP = Number(args.top || 10);
const QUIET = !!args.quiet;
const log = (...a) => { if (!QUIET) console.log(...a); };

// ------------------------------------------------------------------------------------------------ thresholds
// (all in key widths, seconds and degrees; see the "definitions" block written into the JSON)
const TH = {
  joltHand: Number(args['jolt-hand'] || 6000),   // u/s^3: at 60 fps, a 0.028-unit (0.65 mm) step off the smooth path in one frame
  joltTip: Number(args['jolt-tip'] || 25000),    // u/s^3: at 60 fps, a 0.116-unit (2.7 mm) step off the smooth path in one frame
  flipFloorHand: 5, flipFloorTip: 20,            // u/s^2: accelerations smaller than this do not count as a sign flip
  float: 0.10,                                   // contact gap above the depressed key that counts as floating (2.4 mm)
  pen: -0.05,                                    // contact gap below which the pad sinks into its key (1.2 mm)
  ikMiss: 0.10,                                  // IK miss that counts (2.4 mm)
  keyPen: 0.03,                                  // skin this deep inside a key it does not press
  railPen: 0.02,                                 // skin this deep inside the front rail, the key bed or the case behind the keys
  fingerPen: 0.03,                               // overlap of adjacent finger capsules
  handPen: 0.05,                                 // depth of one hand's skin inside the other hand
  // natural joint ranges, flexion (toward the palm) positive, degrees
  range: {
    mcp: [-20, 90], pip: [-5, 110], dip: [-10, 80], abd: 30,       // fingers 2-5 (abd: sideways turn at the knuckle, from the model's relaxed rest)
    tmcp: [-10, 60], tip: [-15, 80], cmc: 45,                      // thumb (cmc: turn of the thumb's metacarpal from rest)
  },
};

// ------------------------------------------------------------------------------------------------ temporary module tree
let TMP = null;
function cleanup() { if (TMP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ } TMP = null; } }
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });

const git = (a, opts = {}) => execFileSync('git', a, { cwd: APP, maxBuffer: 1 << 30, ...opts });
function prepareTree(rev) {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-metrics-'));
  let sha = null;
  if (rev) {
    sha = git(['rev-parse', '--verify', `${rev}^{commit}`]).toString().trim();
    const tar = git(['archive', '--format=tar', sha, 'assets/js', 'assets/vendor', 'assets/models']);
    execFileSync('tar', ['-x', '-f', '-', '-C', TMP], { input: tar });
  } else {
    for (const d of ['js', 'vendor', 'models']) fs.cpSync(path.join(APP, 'assets', d), path.join(TMP, 'assets', d), { recursive: true });
  }
  // the IK miss: wrap hands.js's solveFinger so each call reports the tip it was asked for (the copy only)
  const hp = path.join(TMP, 'assets/js/hands.js');
  let src = fs.readFileSync(hp, 'utf8');
  const ikHooked = /function solveFinger\s*\(/.test(src);
  if (ikHooked) src = src.replace(/function solveFinger\s*\(/, 'function __hmSolveFinger(') + '\n;function solveFinger(...a) { const r = __hmSolveFinger(...a); if (globalThis.__hmIK) globalThis.__hmIK(a[1], r); return r; }\n';
  fs.writeFileSync(hp, src);
  return { sha, ikHooked };
}

// fetch() for file: URLs (Node's fetch has none); handmesh.js loads the model with it at the top level
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const url = new URL(String(u?.url ?? u));
  if (url.protocol !== 'file:') return realFetch(u, o);
  url.search = ''; url.hash = '';
  try { return new Response(fs.readFileSync(fileURLToPath(url)), { status: 200 }); } catch { return new Response('', { status: 404 }); }
};

const specOf = (src, name, fallback) => { const m = src.match(new RegExp(`from\\s+['"]([^'"]*${name.replace('.', '\\.')}[^'"]*)['"]`)); return m ? m[1] : fallback; };

// ------------------------------------------------------------------------------------------------ small maths
const pct = (arr, q) => { if (!arr.length) return null; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]; };
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r3 = (x, d = 3) => (x == null || !Number.isFinite(x) ? x : Number(x.toFixed(d)));
const stats = (arr, d = 3) => (arr.length ? { n: arr.length, p50: r3(pct(arr, 0.5), d), p95: r3(pct(arr, 0.95), d), p99: r3(pct(arr, 0.99), d), max: r3(pct(arr, 1), d) } : { n: 0 });
function segPointDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const L = abx * abx + aby * aby + abz * abz;
  let t = L > 0 ? (abx * apx + aby * apy + abz * apz) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}
// closest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9)
function segSegDist(p1, q1, p2, q2) {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2, f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s, t;
  const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; } else if (a <= 1e-12) { s = 0; t = cl(f / e); } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= 1e-12) { t = 0; s = cl(-c / a); } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = a * e - b * b;
      s = den > 1e-12 ? cl((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = cl(-c / a); } else if (t > 1) { t = 1; s = cl((b - c) / a); }
    }
  }
  return Math.hypot(p1[0] + d1[0] * s - p2[0] - d2[0] * t, p1[1] + d1[1] * s - p2[1] - d2[1] * t, p1[2] + d1[2] * s - p2[2] - d2[2] * t);
}
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const pname = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const HN = ['R', 'L'];
const fname = (h, f) => `${HN[h]}${f + 1}`;   // pianists' fingering: 1 = thumb .. 5 = little finger
if (args.summary) { writeSummary(args.summary, args._); process.exit(0); }

// ------------------------------------------------------------------------------------------------ main
const T0 = Date.now();
const tree = prepareTree(args.rev);
const handsFile = path.join(TMP, 'assets/js/hands.js'), keysFile = path.join(TMP, 'assets/js/keys.js');
const handsSrc = fs.readFileSync(handsFile, 'utf8');
const handsURL = pathToFileURL(handsFile).href;
const ikMap = new Map();
globalThis.__hmIK = (target, result) => { if (target && result) ikMap.set(result, [target.x, target.y, target.z]); };
const handsMod = await import(handsURL);
const hmURL = new URL(specOf(handsSrc, 'handmesh.js', './handmesh.js'), handsURL).href;
const HM = await import(hmURL);
const hmSrc = fs.readFileSync(fileURLToPath(hmURL.split('?')[0]), 'utf8');
const THREE = await import(new URL(specOf(hmSrc, 'three.min.js', '../vendor/three.min.js'), hmURL).href);
const midiMod = await import(new URL(specOf(handsSrc, 'midi.js', './midi.js'), handsURL).href);
if (!HM.MODEL || typeof HM.skinnedHands !== 'function') throw new Error('handmesh.js did not load the hand model (assets/models/hand-r.json/.bin)');
if (args.mirror) { runMirror(); cleanup(); process.exit(process.exitCode || 0); }

// ---- the keyboard's geometry, read from keys.js where it can be found (else the values of Nov 2026)
const keysSrc = fs.existsSync(keysFile) ? fs.readFileSync(keysFile, 'utf8') : '';
const num = (re, i, d) => { const m = keysSrc.match(re); return m ? Number(m[i]) : d; };
// the key's angle at full depth: hands.js's KEY_TILT export when it has one (keys.js then uses it), else the regex
const KEY_TILT = handsMod.KEY_TILT && Number.isFinite(handsMod.KEY_TILT.white) && Number.isFinite(handsMod.KEY_TILT.black) ? handsMod.KEY_TILT : null;
const KG = {
  whiteW: num(/whiteGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 1, 0.94),
  whiteH: num(/whiteGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 2, 1),
  // (the keys' rounded edges: the radius RoundedBoxGeometry is given, for the rounded-key variant of skin in other keys)
  whiteR: num(/whiteGeo = new THREE\.RoundedBoxGeometry\([\d.]+,\s*[\d.]+,\s*[\d.]+,\s*\d+,\s*([\d.]+)/, 1, 0.06),
  blackR: num(/blackGeo = new THREE\.RoundedBoxGeometry\([\d.]+,\s*[\d.]+,\s*[\d.]+,\s*\d+,\s*([\d.]+)/, 1, 0.08),
  whiteL: num(/whiteGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 3, 6.2),
  blackW: num(/blackGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 1, 0.56),
  blackH: num(/blackGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 2, 0.72),
  blackL: num(/blackGeo = new THREE\.RoundedBoxGeometry\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/, 3, 3.95),
  blackTop: num(/position\.set\(KX\[p\],\s*black \? ([\d.]+) : 0/, 1, 0.58),
  angBlack: KEY_TILT ? KEY_TILT.black : num(/rotation\.x = dn \* \(k\.black \? ([\d.]+) : ([\d.]+)\)/, 1, 0.055),
  angWhite: KEY_TILT ? KEY_TILT.white : num(/rotation\.x = dn \* \(k\.black \? ([\d.]+) : ([\d.]+)\)/, 2, 0.042),
  release: num(/const down = t < off \? 1 : Math\.max\(0, 1 - \(t - off\) \/ ([\d.]+)\)/, 1, 0.09),
  rail: { y: num(/slip\.position\.set\(cx,\s*([-\d.]+),\s*([-\d.]+)\)/, 1, -0.85), z: num(/slip\.position\.set\(cx,\s*([-\d.]+),\s*([-\d.]+)\)/, 2, 6.75),
    hy: num(/RoundedBoxGeometry\(width \+ 60,\s*([\d.]+),\s*([\d.]+),\s*\d+,\s*([\d.]+)\)/, 1, 1.1) / 2, hz: num(/RoundedBoxGeometry\(width \+ 60,\s*([\d.]+),\s*([\d.]+),\s*\d+,\s*([\d.]+)\)/, 2, 0.9) / 2,
    r: num(/RoundedBoxGeometry\(width \+ 60,\s*([\d.]+),\s*([\d.]+),\s*\d+,\s*([\d.]+)\)/, 3, 0.2) },
  bed: { y: num(/bed\.position\.set\(cx,\s*([-\d.]+),\s*([-\d.]+)\)/, 1, -1.25), z: num(/bed\.position\.set\(cx,\s*([-\d.]+),\s*([-\d.]+)\)/, 2, 3.2),
    hy: num(/new THREE\.BoxGeometry\(width \+ 60,\s*([\d.]+),\s*([\d.]+)\), new THREE\.MeshStandardMaterial/, 1, 0.4) / 2, hz: num(/new THREE\.BoxGeometry\(width \+ 60,\s*([\d.]+),\s*([\d.]+)\), new THREE\.MeshStandardMaterial/, 2, 7.4) / 2 },
  back: { y: 0.12, z: -0.54, hy: 0.65, hz: 0.15 },   // the strip of case behind the keys (Y0 - 0.7, PLANE_Z - 0.22; 1.3 x 0.3)
};

// ---- the piece
function resolvePiece(name) {
  const tries = [name, `${name}.smf`, path.join(APP, 'assets/music', name), path.join(APP, 'assets/music', `${name}.smf`)];
  for (const p of tries) if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.resolve(p);
  throw new Error(`piece not found: ${name}`);
}
const pieceFile = resolvePiece(args.piece);
const buf = fs.readFileSync(pieceFile);
const piece = midiMod.parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const A0 = 21, C8 = 108;
const oneTrack = piece.tracks === 1;
const handOf = (n) => (oneTrack ? (n.pitch < 60 ? 1 : 0) : (n.track === 0 ? 0 : 1)); // keys.js: 0 = right hand, 1 = left hand
const notes = piece.notes.filter((n) => n.pitch >= A0 && n.pitch <= C8);
const tPlan0 = Date.now(), tPlanHR = performance.now();
const hands = handsMod.createHands(piece, handOf, POSTURE_OPT);
const createHandsMs = performance.now() - tPlanHR;
const planMs = Date.now() - tPlan0;
const plan = hands.plan;
const firstOn = Math.min(...notes.map((n) => n.onset)), lastOff = Math.max(...notes.map((n) => n.onset + n.dur));
const FROM = args.from != null ? Number(args.from) : firstOn - 0.3;
const TO = args.to != null ? Number(args.to) : lastOff + 0.3;
const inRange = (t) => t >= FROM && t <= TO;

// key positions (the same formula as keys.js and hands.js): the black keys' layout from hands.js's KEY_LAYOUTS when it has
// them (the one its createHands used); else keys.js's BLACK_SHIFT when it has one (1dc8262); else on the white keys'
// boundaries, as before
const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
const LAYOUT = handsMod.KEY_LAYOUTS ? handsMod.KEY_LAYOUTS[hands.keyLayout || args.keys || 'piano'] : null;
if (LAYOUT) KG.blackW = LAYOUT.blackW;
const BLACK_SHIFT = LAYOUT ? LAYOUT.shift : (() => { const m = keysSrc.match(/BLACK_SHIFT = \[([^\]]*)\]/); const a = m ? m[1].split(',').map(Number) : []; return a.length === 12 && a.every(Number.isFinite) ? a : new Array(12).fill(0); })();
const KX = new Float64Array(128);
{ let n = 0; for (let p = A0; p <= C8; p++) { KX[p] = (isBlack(p) ? n - 0.5 + BLACK_SHIFT[p % 12] : n) - 25.5; if (!isBlack(p)) n++; } }
const whitePitch = []; const blackAt = new Map();
for (let p = A0; p <= C8; p++) { if (isBlack(p)) blackAt.set(Math.round(KX[p]), p); else whitePitch.push(p); }
const keyDims = (p) => (isBlack(p) ? { hw: KG.blackW / 2, h: KG.blackH, L: KG.blackL, top: KG.blackTop, ang: KG.angBlack, r: KG.blackR } : { hw: KG.whiteW / 2, h: KG.whiteH, L: KG.whiteL, top: 0, ang: KG.angWhite, r: KG.whiteR });
// how deep local point (lx, ly, lz) lies inside key kd's rounded box (as keys.js draws it: edges rounded by kd.r), 0 outside
const roundedDepth = (kd, lx, ly, lz) => {
  const qx = Math.abs(lx) - (kd.hw - kd.r), qy = Math.abs(ly + kd.h / 2) - (kd.h / 2 - kd.r), qz = Math.abs(lz - kd.L / 2) - (kd.L / 2 - kd.r);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - kd.r;
  return Math.max(0, -sd);
};

// when each key is down: the hands' own keyDepth(pitch, t) (0..1, the depth the fingertip rides on) when they have one;
// else keys.js's earlier rule ("Sheet music + hands" view): fully down while hands.played holds it, then rising over KG.release s
const KEY_DEPTH = typeof hands.keyDepth === 'function' ? hands.keyDepth : null;
const downIv = new Map();
for (const n of notes) { const pl = hands.played.get(n); if (!pl) continue; if (!downIv.has(n.pitch)) downIv.set(n.pitch, []); downIv.get(n.pitch).push([n.onset, pl.off]); }
for (const iv of downIv.values()) iv.sort((a, b) => a[0] - b[0]);
function downAt(p, t) {
  if (KEY_DEPTH) return KEY_DEPTH(p, t);
  const iv = downIv.get(p); if (!iv) return 0;
  let lo = 0, hi = iv.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (iv[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  let d = 0;
  for (let j = k; j >= 0 && j > k - 8; j--) { const [, off] = iv[j]; d = Math.max(d, t < off ? 1 : Math.max(0, 1 - (t - off) / KG.release)); if (d >= 1) break; }
  return d;
}
// which key (if any) finger f of hand h is holding down at t (a press holds its key from its contact tc, or its onset
// when the plan has no tc, until its release)
const pStart = (pr) => pr.tc ?? pr.on;
function heldPress(h, f, t) {
  const pr = plan[h].presses[f]; let lo = 0, hi = pr.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pStart(pr[m]) <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 && t < pr[k].off ? pr[k] : null;
}
function heldPitch(h, f, t) { const p = heldPress(h, f, t); return p ? p.pitch : -1; }
// (fingers round 1) how long finger f has been free at t: the shorter of the time since its last release and the time to
// its next contact (0 while it holds a key)
function freeFor(h, f, t) {
  const pr = plan[h].presses[f]; let lo = 0, hi = pr.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pStart(pr[m]) <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k >= 0 && t < pr[k].off) return 0;
  return Math.min(k >= 0 ? t - pr[k].off : Infinity, k + 1 < pr.length ? pStart(pr[k + 1]) - t : Infinity);
}
// "finger stretched straight off its key" (fingers round 1; round 2: spread 0.45 -> 0.3 as the task asked, margin 0.13 -> 0.12,
// hands.js spreadIn[1], the time a free finger takes to reach out for its next key; and straightHeld, below): thresholds; rest: hands.js CFG.REST (fingertip x at rest
// from the middle knuckle, in the hand's own frame)
// "finger over-curled" (curl round): a finger whose joint, or whose total curl (MCP + PIP + DIP; the thumb's MCP + IP), is over
// its cap, free or playing: a finger counts as free from CURL.near s after it lets go of a key until CURL.near s before its
// next contact, and as playing on its key and in between. (Curl fix: near 0.2 -> 0.08, hands.js's longest descent onto a
// key and rise off it (wd 0.07, wr 0.08 s): a finger in the air only as long as it strikes or lets go counts as playing,
// any longer as free, in a fast passage too. Of the free frames over a cap, those with a finger less than CURL.far s from
// a key are also reported on their own, freeNearFrames.) The caps are hands.js's curl limit (CFG.curl) plus a tolerance of tol deg: lyrical for
// --posture lyrical, classical (a little rounder) for classical and for auto (the most Auto blends to), lyrical for
// legacy. [MCP, PIP, DIP, total] for fingers 2-5; [MCP, IP, -, total] for the thumb.
const CURL = {
  tol: 2, near: 0.08, far: 0.2,
  lyrical: { free: [70, 36, 18, 85], held: [90, 80, 35, 140], thumbFree: [70, 40, 0, 105], thumbHeld: [70, 40, 0, 105] },
  classical: { free: [70, 40, 22, 90], held: [90, 86, 43, 150], thumbFree: [70, 40, 0, 105], thumbHeld: [70, 40, 0, 105] },
};
const CURL_CAP = CURL[args.posture === 'classical' || !args.posture || args.posture === 'auto' ? 'classical' : 'lyrical'];
const STRETCH = { pip: 8, miss: 0.3, spread: 0.3, margin: 0.12, strike: 0.1, restOut: 0.1, rest: [-2.35, -1.12, 0, 1.02, 2.0], of: [{ frames: 0 }, { frames: 0 }] };

// ---- the mesh, skinned the way the graphics card does it
const { MODEL } = HM; const info = MODEL.info; const NB = info.bones.length; const NV = info.verts;
const BI = Object.fromEntries(info.bones.map((b, i) => [b.name, i]));
const restH = info.bones.map((b) => b.head), restT = info.bones.map((b) => b.tail);
const scene = new THREE.Scene();
const skin = HM.skinnedHands(scene, {});
const K = [new Float64Array(NB * 12), new Float64Array(NB * 12)];
const mTmp = new THREE.Matrix4(), mAcc = new THREE.Matrix4();
function boneMats(h) {
  // three.js: skinned = bindMatrixInverse * sum_i w_i * (bone_i.matrixWorld * boneInverse_i) * bindMatrix * v, then modelMatrix
  const { mesh } = skin.meshes[h]; const sk = mesh.skeleton;
  sk.update();
  const k = K[h];
  for (let i = 0; i < NB; i++) {
    mTmp.fromArray(sk.boneMatrices, i * 16);
    mAcc.multiplyMatrices(mesh.bindMatrixInverse, mTmp).multiply(mesh.bindMatrix).premultiply(mesh.matrixWorld);
    const e = mAcc.elements, o = i * 12;
    k[o] = e[0]; k[o + 1] = e[4]; k[o + 2] = e[8]; k[o + 3] = e[12];
    k[o + 4] = e[1]; k[o + 5] = e[5]; k[o + 6] = e[9]; k[o + 7] = e[13];
    k[o + 8] = e[2]; k[o + 9] = e[6]; k[o + 10] = e[10]; k[o + 11] = e[14];
  }
}
const kApply = (k, i, x, y, z) => { const o = i * 12; return [k[o] * x + k[o + 1] * y + k[o + 2] * z + k[o + 3], k[o + 4] * x + k[o + 5] * y + k[o + 6] * z + k[o + 7], k[o + 8] * x + k[o + 9] * y + k[o + 10] * z + k[o + 11]]; };
// a set of vertices, packed for skinning
const domBone = new Uint8Array(NV), domW = new Float64Array(NV);
for (let v = 0; v < NV; v++) { let bw = -1, bb = 0; for (let j = 0; j < 4; j++) if (MODEL.sw[v * 4 + j] > bw) { bw = MODEL.sw[v * 4 + j]; bb = MODEL.si[v * 4 + j]; } domBone[v] = bb; domW[v] = bw / 255; }
const boneFinger = info.bones.map((b) => { const m = b.name.match(/^finger(\d)-(\d)$/); return m ? Number(m[1]) - 1 : -1; });
function pack(list) {
  const n = list.length, P = new Float64Array(n * 3), B = new Uint8Array(n * 4), W = new Float64Array(n * 4), F = new Int8Array(n);
  list.forEach((v, i) => {
    for (let j = 0; j < 3; j++) P[i * 3 + j] = MODEL.pos[v * 3 + j];
    for (let j = 0; j < 4; j++) { B[i * 4 + j] = MODEL.si[v * 4 + j]; W[i * 4 + j] = MODEL.sw[v * 4 + j] / 255; }   // (normalised bytes: as the shader reads them)
    F[i] = boneFinger[domBone[v]];
  });
  return { n, idx: Int32Array.from(list), P, B, W, F, out: new Float64Array(n * 3) };
}
function skinSel(k, s) {
  const { n, P, B, W, out } = s;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0;
    for (let j = 0; j < 4; j++) {
      const w = W[i * 4 + j]; if (w === 0) continue;
      const o = B[i * 4 + j] * 12;
      ox += w * (k[o] * x + k[o + 1] * y + k[o + 2] * z + k[o + 3]);
      oy += w * (k[o + 4] * x + k[o + 5] * y + k[o + 6] * z + k[o + 7]);
      oz += w * (k[o + 8] * x + k[o + 9] * y + k[o + 10] * z + k[o + 11]);
    }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
  }
  return out;
}
// fingertip pads: vertices weighted mostly (>= 0.5) to the last bone of each finger
const pads = [0, 1, 2, 3, 4].map((f) => { const b = BI[`finger${f + 1}-3`], L = []; for (let v = 0; v < NV; v++) if (domBone[v] === b && domW[v] >= 0.5) L.push(v); return pack(L); });
const padsByHand = [pads, pads.map((p) => pack(Array.from(p.idx)))];   // separate output buffers per hand
// collision set: one vertex per 0.2-unit cell of the rest mesh
const coll = (() => { const seen = new Set(), L = []; for (let v = 0; v < NV; v++) { const c = `${Math.floor(MODEL.pos[v * 3] / 0.2)},${Math.floor(MODEL.pos[v * 3 + 1] / 0.2)},${Math.floor(MODEL.pos[v * 3 + 2] / 0.2)}`; if (!seen.has(c)) { seen.add(c); L.push(v); } } return L; })();
const collSel = [pack(coll), pack(coll)];
// capsule radius of each bone: distances of its strongly weighted (>= 0.6) rest vertices to the bone; 25th and 50th percentiles
const radius = info.bones.map((b, bi) => {
  const d = []; for (let v = 0; v < NV; v++) if (domBone[v] === bi && domW[v] >= 0.6) d.push(segPointDist(MODEL.pos[v * 3], MODEL.pos[v * 3 + 1], MODEL.pos[v * 3 + 2], ...b.head, ...b.tail));
  return { r25: pct(d, 0.25) || 0.2, r50: pct(d, 0.5) || 0.25 };
});
const CAPS = info.bones.map((b, i) => i);   // all bones, for hand-hand tests

// ---- posing at time t: the pose (hands.js), the bones (handmesh.js update), the skinning matrices (three.js)
function evalAt(t) {
  ikMap.clear();
  const P = hands.pose(t);
  skin.update(P);
  scene.updateMatrixWorld(true);
  boneMats(0); boneMats(1);
  return P;
}
const toArr = (v) => [v.x, v.y, v.z];
const handPt = (M, v) => { const e = M.elements; return [e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12], e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13], e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]]; };

// ---- joint angles, in the hand's own frame (fingers along -z, the back of the hand +y; the left hand's frame is mirrored into the right's)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const DEG = 180 / Math.PI;
function flex(dPrev, dNext) { // bend from dPrev to dNext toward the palm (-y), degrees
  const L = norm(cross(dPrev, [0, 1, 0]));
  return Math.atan2(dot(cross(dNext, dPrev), L), dot(dPrev, dNext)) * DEG;
}
const yaw = (d) => Math.atan2(d[0], -d[2]) * DEG;   // sideways direction about the back-of-hand axis
const metaIdx = [null, BI.metacarpal1, BI.metacarpal2, BI.metacarpal3, BI.metacarpal4];
function anglesOf(jh) { // jh[f] = 4 joints in the hand frame -> per finger { a: [3 angles], abd }
  const out = [];
  for (let f = 0; f < 5; f++) {
    const j = jh[f], s0 = norm(sub(j[1], j[0])), s1 = norm(sub(j[2], j[1])), s2 = norm(sub(j[3], j[2]));
    if (f === 0) out.push({ cmcDir: s0, mcp: flex(s0, s1), ip: flex(s1, s2) });
    else { const dm = norm(sub(j[0], restH[metaIdx[f]])); out.push({ mcp: flex(dm, s0), pip: flex(s0, s1), dip: flex(s1, s2), abd: yaw(s0) - yaw(dm) }); }
  }
  return out;
}
const restJoints = [0, 1, 2, 3, 4].map((f) => [restH[BI[`finger${f + 1}-1`]], restH[BI[`finger${f + 1}-2`]], restH[BI[`finger${f + 1}-3`]], restT[BI[`finger${f + 1}-3`]]]);
const REST_ANG = anglesOf(restJoints);
const restCmcDir = REST_ANG[0].cmcDir;

// ------------------------------------------------------------------------------------------------ sanity checks
const sanity = {};
{
  // 1. the model's own rest pose through handmesh.js's update(): every skinned vertex must equal the input
  const restPose = () => ({ joints: restJoints.map((j) => j.map((q) => new THREE.Vector3(...q))), wrist: new THREE.Vector3(...restH[BI.wrist]), elbow: new THREE.Vector3(...restH[BI.lowerarm02]),
    heat: [0, 0, 0, 0, 0], side: 1, toHand: new THREE.Matrix4(), O: new THREE.Vector3(), yaw: 0 });
  skin.update([restPose(), restPose()]); scene.updateMatrixWorld(true); boneMats(0); boneMats(1);
  const all = pack(Array.from({ length: NV }, (_, i) => i));
  let worst = 0;
  for (const h of [0, 1]) { skinSel(K[h], all); for (let i = 0; i < NV * 3; i++) worst = Math.max(worst, Math.abs(all.out[i] - MODEL.pos[i])); }
  sanity.restPoseMaxError = worst;
  // 2. a real pose: this CPU skinning against three.js's own SkinnedMesh.getVertexPosition (both hands, mirrored left)
  const tChk = Math.min(TO, Math.max(FROM, (firstOn + lastOff) / 2));
  evalAt(tChk);
  const v = new THREE.Vector3(); let worst2 = 0; const sample = pack(Array.from({ length: 400 }, (_, i) => Math.floor((i * 7919) % NV)));
  for (const h of [0, 1]) { skinSel(K[h], sample); const { mesh } = skin.meshes[h]; for (let i = 0; i < sample.n; i++) { mesh.getVertexPosition(sample.idx[i], v); v.applyMatrix4(mesh.matrixWorld); worst2 = Math.max(worst2, Math.hypot(v.x - sample.out[i * 3], v.y - sample.out[i * 3 + 1], v.z - sample.out[i * 3 + 2])); } }
  sanity.vsThreeMaxError = worst2; sanity.vsThreeTime = r3(tChk);
  // 3. vertices bound only to a fingertip bone keep their rest distance to the pose's tip joint (the bone follows the joints)
  const P = evalAt(tChk); let worst3 = 0, padToTip = [];
  for (const h of [0, 1]) for (let f = 0; f < 5; f++) {
    const s = padsByHand[h][f]; skinSel(K[h], s); const tip = toArr(P[h].joints[f][3]); const rt = restT[BI[`finger${f + 1}-3`]];
    let near = 1e9;
    for (let i = 0; i < s.n; i++) {
      const vi = s.idx[i], dp = dist3([s.out[i * 3], s.out[i * 3 + 1], s.out[i * 3 + 2]], tip); near = Math.min(near, dp);
      if (domW[vi] > 0.999) worst3 = Math.max(worst3, Math.abs(dp - dist3([MODEL.pos[vi * 3], MODEL.pos[vi * 3 + 1], MODEL.pos[vi * 3 + 2]], rt)));
    }
    padToTip.push(near);
  }
  sanity.rigidPadMaxError = worst3; sanity.nearestPadToTipJoint = { min: r3(Math.min(...padToTip)), max: r3(Math.max(...padToTip)) };
  // 4. the IK hook found every finger's target (0 of 10 means the miss cannot be measured for this hands.js)
  sanity.ikMatched = [0, 1].reduce((n, h) => n + P[h].joints.filter((j) => ikMap.has(j)).length, 0);
  // 5. pose(t) is a pure function of t: the same pose after evaluating other times first, in another order
  const snap = (Q) => Q.flatMap((H) => [H.O, H.wrist, ...H.joints.flat()].flatMap((v) => [v.x, v.y, v.z]));
  const tA = FROM + 0.37 * (TO - FROM), first = snap(hands.pose(tA));
  for (const tb of [TO, FROM, FROM + 0.8 * (TO - FROM), tA - 0.5, tA + 0.013]) hands.pose(tb);
  const again = snap(hands.pose(tA));
  sanity.purityMaxDiff = Math.max(...first.map((x, i) => Math.abs(x - again[i])));
  sanity.restAngles = REST_ANG.map((a, f) => (f === 0 ? { mcp: r3(a.mcp, 1), ip: r3(a.ip, 1) } : { mcp: r3(a.mcp, 1), pip: r3(a.pip, 1), dip: r3(a.dip, 1), abd: r3(a.abd, 1) }));
  sanity.vertexSets = { pads: pads.map((p) => p.n), collision: collSel[0].n, of: NV };
  sanity.ikHooked = tree.ikHooked;
  // rest-pose margins of the finger capsules (adjacent fingers, middle + last bones): positive = apart
  let m = 1e9;
  for (let f = 1; f < 4; f++) for (const s of [2, 3]) for (const s2 of [2, 3]) {
    const a = BI[`finger${f + 1}-${s}`], b = BI[`finger${f + 2}-${s2}`];
    m = Math.min(m, segSegDist(restH[a], restT[a], restH[b], restT[b]) - radius[a].r50 - radius[b].r50);
  }
  sanity.restFingerCapsuleMargin = r3(m);
  // 6. (S2) the key depth on 200 presses spread through the piece: the key is at the bottom at onKey (keyDepth = 1); at the
  // contact tc the press itself adds nothing (pressDepth = 0), so keyDepth(pitch, tc) is 0, or, when the key is struck
  // again while it still rises from an earlier press, exactly that earlier press's depth; and keyDepth is the same when
  // asked again in another order (a pure function of t)
  if (KEY_DEPTH && typeof handsMod.pressDepth === 'function') {
    const all = []; for (const H of plan) for (const pr of H.presses) for (const p of pr) if (Number.isFinite(p.tc) && Number.isFinite(p.onKey)) all.push(p);
    all.sort((a, b) => a.tc - b.tc || a.pitch - b.pitch);
    const pick = all.length <= 200 ? all : Array.from({ length: 200 }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / 200)]);
    const byKey = new Map(); for (const p of all) { if (!byKey.has(p.pitch)) byKey.set(p.pitch, []); byKey.get(p.pitch).push(p); }
    const kd = { n: pick.length, atContact0: 0, atContactRising: 0, atBottom1: 0, fails: 0, worst: 0, impure: 0 };
    const first = pick.map((p) => [KEY_DEPTH(p.pitch, p.tc), KEY_DEPTH(p.pitch, p.onKey)]);
    pick.forEach((p, i) => {
      const [c, b] = first[i], own = handsMod.pressDepth(p, p.tc);
      const others = byKey.get(p.pitch).reduce((m, q) => (q === p || q.tc > p.tc ? m : Math.max(m, handsMod.pressDepth(q, p.tc))), 0);
      const err = Math.max(Math.abs(own), Math.abs(c - others), Math.abs(b - 1));
      kd.worst = Math.max(kd.worst, err); if (err > 1e-12) kd.fails++;
      if (c === 0) kd.atContact0++; else if (Math.abs(c - others) <= 1e-12) kd.atContactRising++;
      if (Math.abs(b - 1) <= 1e-12) kd.atBottom1++;
    });
    pick.slice().reverse().forEach((p, j) => { const i = pick.length - 1 - j; if (KEY_DEPTH(p.pitch, p.onKey) !== first[i][1] || KEY_DEPTH(p.pitch, p.tc) !== first[i][0]) kd.impure++; });
    sanity.keyDepthCheck = kd;
  }
}
log(`hand-metrics: ${path.basename(pieceFile)}  ${tree.sha ? `rev ${tree.sha.slice(0, 10)}` : 'working tree'}  ${r3(FROM, 2)}..${r3(TO, 2)} s at ${FPS} fps`);
log(`  sanity: rest pose max error ${sanity.restPoseMaxError.toExponential(2)}, vs three.js ${sanity.vsThreeMaxError.toExponential(2)}, rigid pad ${sanity.rigidPadMaxError.toExponential(2)} (units); IK hook ${tree.ikHooked ? `on, ${sanity.ikMatched}/10 fingers` : 'OFF'}; purity ${sanity.purityMaxDiff.toExponential(1)}`);
if (sanity.keyDepthCheck) { const k = sanity.keyDepthCheck; log(`  key depth check (${k.n} presses): at the bottom at onKey ${k.atBottom1}/${k.n}; at contact tc 0 for ${k.atContact0}, still rising from an earlier press for ${k.atContactRising}; fails ${k.fails} (worst ${k.worst.toExponential(1)}); impure ${k.impure}`); if (k.fails || k.impure) console.warn('  warning: keyDepth failed its check'); }
if (!tree.ikHooked || sanity.ikMatched < 10) console.warn('  warning: the IK miss could not be matched to every finger (solveFinger renamed, or its result copied); IK numbers are partial');
if (sanity.purityMaxDiff > 1e-9) console.warn(`  warning: pose(t) depends on what was evaluated before (max difference ${sanity.purityMaxDiff}); it should be a pure function of t`);

// ---- --at t1,t2,...: print the pose in detail at those moments, and stop
if (args.at) {
  const f2 = (a) => `(${a.map((x) => x.toFixed(2)).join(', ')})`;
  for (const t of String(args.at).split(',').map(Number)) {
    const P = evalAt(t);
    console.log(`\nt = ${t.toFixed(3)} s`);
    for (const h of [0, 1]) {
      const Ph = P[h];
      const extra = [['pitch', Ph.pitch, DEG, ' deg'], ['roll', Ph.roll, DEG, ' deg'], ['fan', Ph.fan, 1, '']].filter((e) => Number.isFinite(e[1])).map(([k, v, s, u]) => `  ${k} ${(v * s).toFixed(k === 'fan' ? 2 : 1)}${u}`).join('');
      console.log(`  ${HN[h]} hand: origin ${f2(toArr(Ph.O))}  wrist ${f2(toArr(Ph.wrist))}  yaw ${(Ph.yaw * DEG).toFixed(1)} deg${extra}`);
      const ang = anglesOf(Ph.joints.map((j) => j.map((q) => handPt(Ph.toHand, q))));
      for (let f = 0; f < 5; f++) {
        const tip = toArr(Ph.joints[f][3]), tgt = ikMap.get(Ph.joints[f]), held = heldPitch(h, f, t);
        const s = padsByHand[h][f]; skinSel(K[h], s);
        let low = Infinity, lx = 0; for (let i = 0; i < s.n; i++) if (s.out[i * 3 + 1] < low) { low = s.out[i * 3 + 1]; lx = s.out[i * 3]; }
        let gap = '';
        if (held >= 0) { const kd = keyDims(held), a = downAt(held, t) * kd.ang; let mn = Infinity; for (let i = 0; i < s.n; i++) mn = Math.min(mn, (s.out[i * 3 + 1] - kd.top) * Math.cos(a) + s.out[i * 3 + 2] * Math.sin(a)); gap = ` gap ${mn.toFixed(3)} key ${padToKey(h, f, held, t).toFixed(2)}`; }
        const A = ang[f], angs = f === 0 ? `MCP ${A.mcp.toFixed(0)} IP ${A.ip.toFixed(0)}` : `MCP ${A.mcp.toFixed(0)} PIP ${A.pip.toFixed(0)} DIP ${A.dip.toFixed(0)} side ${(A.abd - REST_ANG[f].abd).toFixed(0)}`;
        console.log(`    ${fname(h, f)} ${held >= 0 ? `holds ${pname(held).padEnd(4)}` : 'free      '} tip ${f2(tip)} target ${tgt ? f2(tgt) : '-'} miss ${tgt ? dist3(tgt, tip).toFixed(3) : '-'}  pad low y ${low.toFixed(2)} at x ${lx.toFixed(2)}${gap}  ${angs}`);
      }
    }
  }
  cleanup(); process.exit(0);
}

// ------------------------------------------------------------------------------------------------ events (for the worst moments)
const events = [];
// frame-level problems are gathered into episodes: consecutive frames of the same kind, hand and finger
const open = new Map();
function flag(kind, h, f, t, score, what) {
  const key = `${kind}|${h}|${f}`; const e = open.get(key);
  if (e && t - e.last <= 2.5 / FPS) { e.last = t; e.frames++; if (score > e.score) { e.score = score; e.t = t; e.what = what; } return; }
  if (e) events.push(e);
  open.set(key, { kind, hand: h, finger: f, t, last: t, frames: 1, score, what });
}
const closeAll = () => { for (const e of open.values()) events.push(e); open.clear(); };

// ------------------------------------------------------------------------------------------------ a. contact at the middle of each press
const contact = [0, 1].map(() => ({ gaps: [], dx: [], ik: [], float: 0, pen: 0, offKey: 0, zOut: 0, ikBig: 0, presses: 0, black: 0, betweenBlack: 0, byF: [0, 1, 2, 3, 4].map(() => ({ gaps: [], ik: [], dx: [] })) }));
const midOf = new Map();   // press -> { gap, miss } at the middle of the press (for the version-2 metrics below)
for (const h of [0, 1]) for (let f = 0; f < 5; f++) for (const pr of plan[h].presses[f]) {
  const tm = (pr.on + pr.off) / 2; if (!inRange(tm)) continue;
  const P = evalAt(tm);
  const s = padsByHand[h][f]; skinSel(K[h], s);
  const p = pr.pitch, kd = keyDims(p), d = downAt(p, tm), a = d * kd.ang, ca = Math.cos(a), sa = Math.sin(a);
  // signed distance to the key's top face, turned about its back edge (z = 0)
  let mn = Infinity;
  const sd = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) { sd[i] = (s.out[i * 3 + 1] - kd.top) * ca + s.out[i * 3 + 2] * sa; if (sd[i] < mn) mn = sd[i]; }
  let cx = 0, cz = 0, cn = 0;
  for (let i = 0; i < s.n; i++) if (sd[i] < mn + 0.03) { cx += s.out[i * 3]; cz += s.out[i * 3 + 2]; cn++; }
  cx /= cn; cz /= cn;
  const dx = cx - KX[p];
  const tgt = ikMap.get(P[h].joints[f]);
  const miss = tgt ? dist3(tgt, toArr(P[h].joints[f][3])) : null;
  const C = contact[h];
  midOf.set(pr, { gap: mn, miss });
  C.presses++; C.gaps.push(mn); C.dx.push(Math.abs(dx)); if (miss != null) C.ik.push(miss);
  C.byF[f].gaps.push(mn); C.byF[f].dx.push(Math.abs(dx)); if (miss != null) C.byF[f].ik.push(miss);
  if (isBlack(p)) C.black++;
  const tag = `${fname(h, f)} on ${pname(p)}`;
  if (mn > TH.float) { C.float++; events.push({ kind: 'float', hand: h, finger: f, t: tm, frames: 1, score: mn / TH.float, what: `${tag}: fingertip floats ${mn.toFixed(2)} above its pressed key` }); }
  if (mn < TH.pen) { C.pen++; events.push({ kind: 'sink', hand: h, finger: f, t: tm, frames: 1, score: -mn / -TH.pen, what: `${tag}: fingertip sinks ${(-mn).toFixed(2)} into its key` }); }
  if (Math.abs(dx) > kd.hw) { C.offKey++; events.push({ kind: 'off-key', hand: h, finger: f, t: tm, frames: 1, score: 1 + (Math.abs(dx) - kd.hw) / 0.1, what: `${tag}: contact ${dx.toFixed(2)} from the key's centre (outside the key)` }); }
  if (cz < 0 || cz > kd.L) { C.zOut++; events.push({ kind: 'off-key', hand: h, finger: f, t: tm, frames: 1, score: 1 + Math.max(-cz, cz - kd.L) / 0.2, what: `${tag}: contact at z ${cz.toFixed(2)}, off the key's length` }); }
  if (!isBlack(p) && cz < KG.blackL) C.betweenBlack++;
  if (miss != null && miss > TH.ikMiss) { C.ikBig++; events.push({ kind: 'ik-miss', hand: h, finger: f, t: tm, frames: 1, score: miss / TH.ikMiss, what: `${tag}: IK misses its target by ${miss.toFixed(2)}` }); }
}

// ------------------------------------------------------------------------------------------------ b. notes no finger plays
const unplayed = [0, 1].map(() => ({ notes: 0, unplayed: 0, chord: 0, reach: 0 }));
{
  const kept = new Set(); for (const H of plan) for (const e of H.events) for (const n of e.notes) kept.add(n);
  for (const n of notes) {
    if (!inRange(n.onset)) continue;
    const h = handOf(n), U = unplayed[h]; U.notes++;
    if (hands.played.has(n)) continue;
    U.unplayed++;
    const why = kept.has(n) ? 'out of reach of the planned hand position' : 'dropped from its chord by the fingering: more than 5 notes, or wider than a hand reaches';
    if (kept.has(n)) U.reach++; else U.chord++;
    events.push({ kind: 'unplayed', hand: h, finger: -1, t: n.onset, frames: 1, score: 2, what: `${HN[h]} ${pname(n.pitch)} not played by any finger (${why})` });
  }
}

// ------------------------------------------------------------------------------------------------ a2. through each press (version 2)
// For every press measured in a.: the IK miss just after contact (tc + 0.004) and just before release (off - 0.004); the
// contact gap half-way down the key's descent (tc + d/2) and at the key bottom (onKey + 0.004), for all presses and for
// "reached" presses (IK miss at mid-press < 0.05); and the hand origin's x at contact against the event's planned window
// [lo - 0.2, hi + 0.2]. A plan without tc / onKey / d / ride uses on / on / 0 / 0. These go into their own event list
// (eventsNew), so the version-1 worst moments stay as they were.
const eventsNew = [];
const poseOnly = (t) => { ikMap.clear(); return hands.pose(t); };
function padGap(h, f, p, t) { // (call after evalAt(t)) signed gap from finger f's pad to key p's top face, tilted by its depth at t
  const s = padsByHand[h][f]; skinSel(K[h], s);
  const kd = keyDims(p), a = downAt(p, t) * kd.ang, ca = Math.cos(a), sa = Math.sin(a);
  let mn = Infinity;
  for (let i = 0; i < s.n; i++) { const v = (s.out[i * 3 + 1] - kd.top) * ca + s.out[i * 3 + 2] * sa; if (v < mn) mn = v; }
  return mn;
}
const REACHED = 0.05;   // a press is "reached" when its IK miss at mid-press is below this
const hasWindows = plan.some((H) => H.events.some((e) => Number.isFinite(e.lo) && Number.isFinite(e.hi)));
const thru = [0, 1].map(() => ({
  byF: [0, 1, 2, 3, 4].map(() => ({ presses: 0, ikC: [], ikR: [], gD: [], gB: [], rMid: [], rD: [], rB: [], rFloat: 0, rSink: 0, beta: [] })),
  win: { presses: 0, over03: 0, over10: 0, excess: [] },
  winPath: { presses: 0, over03: 0, over10: 0, excess: [] },
  winWhite: { presses: 0, over03: 0, over10: 0, excess: [] },
}));
// (S4) the planned path's own anchor at contact, when the plan has its curve (plan[h].curves: a uniform cubic B-spline of
// control points x every dtx from T0x, FINAL-SPEC Appendix 1): the hand origin is the anchor only while the hand is not
// turned about a point in front of its knuckles (hands.js's thumb turn, S3)
const pathX = (h, t) => {
  const C = plan[h].curves; if (!C || !C.x || !Number.isFinite(C.T0x) || !(C.dtx > 0) || C.x.length < 4) return null;
  const c = C.x, N = c.length; let u = (t - C.T0x) / C.dtx; u = Math.min(N - 2, Math.max(1, u));
  const k = Math.min(N - 3, Math.floor(u)), f = u - k, g = 1 - f;
  return (g * g * g * c[k - 1] + (3 * f ** 3 - 6 * f * f + 4) * c[k] + (-3 * f ** 3 + 3 * f * f + 3 * f + 1) * c[k + 1] + f ** 3 * c[k + 2]) / 6;
};
for (const h of [0, 1]) {
  const evOf = new Map(); for (const e of plan[h].events) for (const n of e.notes) evOf.set(n, e);
  for (let f = 0; f < 5; f++) for (const pr of plan[h].presses[f]) {
    const mid = midOf.get(pr); if (!mid) continue;
    const B = thru[h].byF[f], tag = `${fname(h, f)} on ${pname(pr.pitch)}`;
    const tc = pr.tc ?? pr.on, onKey = pr.onKey ?? pr.on, d = pr.d ?? 0;
    B.presses++;
    // IK miss just after contact ("arrived late") and just before release ("left early")
    for (const [t, arr, kind] of [[tc + 0.004, B.ikC, 'ik-contact'], [pr.off - 0.004, B.ikR, 'ik-release']]) {
      if (!inRange(t)) continue;
      const P = poseOnly(t), tgt = ikMap.get(P[h].joints[f]); if (!tgt) continue;
      const m = dist3(tgt, toArr(P[h].joints[f][3])); arr.push(m);
      if (m > TH.ikMiss) eventsNew.push({ kind, hand: h, finger: f, t, frames: 1, score: m / TH.ikMiss, what: `${tag}: IK misses its target by ${m.toFixed(2)} just ${kind === 'ik-contact' ? 'after contact (arrives late)' : 'before release (leaves early)'}` });
    }
    // the contact gap half-way down and at the bottom
    let gD = null, gB = null;
    const tD = tc + d / 2, tB = onKey + 0.004;
    if (inRange(tD)) { evalAt(tD); gD = padGap(h, f, pr.pitch, tD); B.gD.push(gD); }
    if (inRange(tB)) {
      const P = evalAt(tB); gB = padGap(h, f, pr.pitch, tB); B.gB.push(gB);
      // the pad's angle: how far the last bone points below horizontal at the key bottom (fingers 2-5 on white keys;
      // 50-75 deg plays on the fleshy pad, steeper on the nail, flatter on the finger's underside)
      if (f && !isBlack(pr.pitch)) { const J = P[h].joints[f], dx = J[3].x - J[2].x, dy = J[3].y - J[2].y, dz = J[3].z - J[2].z; B.beta.push(Math.asin(Math.max(-1, Math.min(1, -dy / (Math.hypot(dx, dy, dz) || 1)))) * DEG); }
    }
    if (mid.miss != null && mid.miss < REACHED) {
      B.rMid.push(mid.gap); if (mid.gap > TH.float) B.rFloat++; if (mid.gap < TH.pen) B.rSink++;
      if (gD != null) B.rD.push(gD); if (gB != null) B.rB.push(gB);
    }
    // the hand at contact against its event's planned window
    const e = evOf.get(pr.note);
    if (hasWindows && e && Number.isFinite(e.lo) && Number.isFinite(e.hi) && inRange(tc)) {
      const x = poseOnly(tc)[h].O.x, ex = Math.max(e.lo - 0.2 - x, x - e.hi - 0.2, 0), W = thru[h].win;
      W.presses++; W.excess.push(ex); if (ex > 0.3) W.over03++; if (ex > 1.0) W.over10++;
      if (!isBlack(pr.pitch)) { const WW = thru[h].winWhite; WW.presses++; WW.excess.push(ex); if (ex > 0.3) WW.over03++; if (ex > 1.0) WW.over10++; }
      if (ex > 0.3) eventsNew.push({ kind: 'window', hand: h, finger: f, t: tc, frames: 1, score: ex / 0.3, what: `${tag}: hand origin x ${x.toFixed(2)} is ${ex.toFixed(2)} outside its window [${(e.lo - 0.2).toFixed(2)}, ${(e.hi + 0.2).toFixed(2)}] at contact` });
      const xp = pathX(h, tc);
      if (xp != null) { const ep = Math.max(e.lo - 0.2 - xp, xp - e.hi - 0.2, 0), WP = thru[h].winPath; WP.presses++; WP.excess.push(ep); if (ep > 0.3) WP.over03++; if (ep > 1.0) WP.over10++; }
    }
  }
}

// ------------------------------------------------------------------------------------------------ c./d. per frame
const N = Math.max(0, Math.floor((TO - FROM) * FPS) + 1);
const series = [0, 1].map(() => ({ O: new Float64Array(N * 3), W: new Float64Array(N * 3), tips: [0, 1, 2, 3, 4].map(() => new Float64Array(N * 3)) }));
const plaus = [0, 1].map(() => ({
  ikAll: [], ikFrames: 0, ikByF: [[], [], [], [], []], abdByF: [[], [], [], [], []],
  joints: { mcp: { out: 0, hyper: 0, worst: 0 }, pip: { out: 0, hyper: 0, worst: 0 }, dip: { out: 0, hyper: 0, worst: 0 }, abd: { out: 0, worst: 0 }, tmcp: { out: 0, hyper: 0, worst: 0 }, tip: { out: 0, hyper: 0, worst: 0 }, cmc: { out: 0, worst: 0 } },
  fingerFrames: 0, crossFrames: 0, crossMax: 0, fingerOverlapFrames: 0, fingerOverlapMax: 0, thumbOverlapFrames: 0, thumbOverlapMax: 0,
  curl: { free: null, held: null, over: { free: 0, freeNear: 0, held: 0, freeFingers: 0, heldFingers: 0, byFinger: [0, 0, 0, 0, 0], byJoint: { free: [0, 0, 0, 0], held: [0, 0, 0, 0] }, worst: new Map() } },
  stretch: { frames: 0, straight: 0, spread: 0, when: [0, 0, 0], byFinger: [0, 0, 0, 0, 0], worst: new Map(), held: 0, heldByFinger: [0, 0, 0, 0, 0] },
  keyPenFrames: 0, keyPenMax: 0, keyPenRoundFrames: 0, keyPenRoundMax: 0, keyPenHeldByOther: 0, railFrames: 0, railMax: 0, bedFrames: 0, bedMax: 0, backFrames: 0, backMax: 0,
}));
for (const Q of plaus) for (const k of ['free', 'held']) Q.curl[k] = [0, 1].map(() => ({ mcp: [], pip: [], dip: [], tot: [] }));   // [thumb, fingers 2-5]
let handsOverlapFrames = 0, handsOverlapMax = 0;
// (S4 fix) keys down with no fingertip on them: at every frame a press holds its key (tc to off: the key goes down,
// stays down and is lit), the distance from its finger's pad (the vertices weighted mostly to the last bone) to the
// key's top face, tilted by its depth at t: over the face, how far above it (0 touching or pressed in); off the face, the
// distance to the face's nearest edge, height included (a pad beside a black key, down at the white keys, is 0.58 from
// its top). A press counts when that exceeds NOFINGER at any frame.
const NOFINGER = 0.3;
const noFinger = [0, 1].map(() => ({ worst: new Map(), frames: 0 }));
function padToKey(h, f, p, t) {
  const s = padsByHand[h][f]; skinSel(K[h], s);
  const kd = keyDims(p), a = downAt(p, t) * kd.ang, ca = Math.cos(a), sa = Math.sin(a);
  let best = Infinity;
  for (let i = 0; i < s.n; i++) {
    const x = s.out[i * 3], y = s.out[i * 3 + 1], z = s.out[i * 3 + 2];
    const ex = Math.max(0, Math.abs(x - KX[p]) - kd.hw), ly = (y - kd.top) * ca + z * sa, lz = -(y - kd.top) * sa + z * ca, ez = Math.max(0, -lz, lz - kd.L);
    const d = ex === 0 && ez === 0 ? Math.max(0, ly) : Math.hypot(ex, ly, ez);
    if (d < best) best = d;
  }
  return best;
}
const poseRg = [0, 1].map(() => ({ roll: [], pitch: [], ulnar: [], fan: [], yaw: [] }));   // (version 2) degrees, fan in units
const rangeOut = (v, [lo, hi]) => (v < lo ? v - lo : v > hi ? v - hi : 0);
const capsW = [[], []];   // per hand, per bone: [head, tail] in world
const sdBox2 = (y, z, cy, cz, hy, hz, r = 0) => { const qy = Math.abs(y - cy) - (hy - r), qz = Math.abs(z - cz) - (hz - r); return Math.hypot(Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qy, qz), 0) - r; };
const tLoop = Date.now();
for (let i = 0; i < N; i++) {
  const t = FROM + i / FPS;
  const P = evalAt(t);
  for (const h of [0, 1]) {
    const Ph = P[h], S = series[h], Q = plaus[h];
    // (version 2) pose ranges: roll, pitch and fan when the pose has them; ulnar deviation = the yaw beyond the arm's line
    const RG = poseRg[h];
    if (Number.isFinite(Ph.roll)) RG.roll.push(Ph.roll * DEG);
    if (Number.isFinite(Ph.pitch)) RG.pitch.push(Ph.pitch * DEG);
    if (Number.isFinite(Ph.fan)) RG.fan.push(Ph.fan);
    if (Number.isFinite(Ph.yaw)) { RG.yaw.push(Ph.yaw * DEG); if (Ph.elbow) RG.ulnar.push(-(Ph.side ?? (h ? -1 : 1)) * (Ph.yaw - 0.55 * Math.atan2(Ph.elbow.x - Ph.O.x, Ph.elbow.z - Ph.O.z)) * DEG); }
    S.O.set(toArr(Ph.O), i * 3); S.W.set(toArr(Ph.wrist), i * 3);
    for (let f = 0; f < 5; f++) S.tips[f].set(toArr(Ph.joints[f][3]), i * 3);
    // (S4 fix) a key held down with its finger's pad more than NOFINGER from it
    for (let f = 0; f < 5; f++) {
      const pr = heldPress(h, f, t); if (!pr) continue;
      const d = padToKey(h, f, pr.pitch, t), NF = noFinger[h], w = NF.worst.get(pr);
      if (d > NOFINGER) NF.frames++;
      if (!w) NF.worst.set(pr, { d, t, f, p: pr.pitch, first: d, last: d });
      else { if (d > w.d) { w.d = d; w.t = t; } w.last = d; }
    }
    // IK miss at every frame
    for (let f = 0; f < 5; f++) {
      const tgt = ikMap.get(Ph.joints[f]); if (!tgt) continue;
      const m = dist3(tgt, toArr(Ph.joints[f][3])); Q.ikAll.push(m); Q.ikByF[f].push(m);
      if (m > TH.ikMiss) Q.ikFrames++;
    }
    // joint angles
    const jh = Ph.joints.map((j) => j.map((q) => handPt(Ph.toHand, q)));
    const ang = anglesOf(jh), R = TH.range, J = Q.joints;
    const chk = (name, v, rg, f, label) => { const o = rangeOut(v, rg); if (o) { J[name].out++; if (o < 0 && 'hyper' in J[name]) J[name].hyper++; if (Math.abs(o) > Math.abs(J[name].worst)) J[name].worst = r3(o, 1); flag('joint', h, f, t, 1 + Math.abs(o) / 10, `${fname(h, f)}: ${label} ${v.toFixed(0)} deg (natural ${rg[0]}..${rg[1]})`); } };
    let cr = 0, crF = -1;
    for (let f = 1; f < 4; f++) { const c = jh[f][3][0] - jh[f + 1][3][0]; if (c > cr) { cr = c; crF = f; } }
    if (cr > 0.1) { Q.crossFrames++; flag('crossed', h, crF, t, 1 + cr / 0.2, `${fname(h, crF)}/${fname(h, crF + 1)}: fingertips crossed by ${cr.toFixed(2)} across the hand`); }
    Q.crossMax = Math.max(Q.crossMax, cr);
    for (let f = 0; f < 5; f++) {
      Q.fingerFrames++;
      const A = ang[f];
      if (f === 0) {
        chk('tmcp', A.mcp, R.tmcp, f, 'thumb MCP bend'); chk('tip', A.ip, R.tip, f, 'thumb IP bend');
        const c = Math.acos(Math.max(-1, Math.min(1, dot(A.cmcDir, restCmcDir)))) * DEG;
        if (c > R.cmc) { J.cmc.out++; J.cmc.worst = Math.max(J.cmc.worst, r3(c - R.cmc, 1)); flag('joint', h, f, t, 1 + (c - R.cmc) / 10, `${fname(h, f)}: thumb metacarpal turned ${c.toFixed(0)} deg from rest (natural <= ${R.cmc})`); }
      } else {
        chk('mcp', A.mcp, R.mcp, f, 'knuckle (MCP) bend'); chk('pip', A.pip, R.pip, f, 'middle joint (PIP) bend'); chk('dip', A.dip, R.dip, f, 'last joint (DIP) bend');
        const ab = A.abd - REST_ANG[f].abd; Q.abdByF[f].push(ab);
        if (Math.abs(ab) > R.abd) { J.abd.out++; if (Math.abs(ab) - R.abd > J.abd.worst) J.abd.worst = r3(Math.abs(ab) - R.abd, 1); flag('joint', h, f, t, 1 + (Math.abs(ab) - R.abd) / 10, `${fname(h, f)}: finger turned ${ab.toFixed(0)} deg sideways at the knuckle (natural +-${R.abd})`); }
      }
    }
    // (curl round) how curled each finger is, free and on its key, and whether a joint or the total is over its cap
    {
      const C = Q.curl, O = C.over;
      let oFree = false, oHeld = false, oNear = false;
      for (let f = 0; f < 5; f++) {
        const A = ang[f], ff = freeFor(h, f, t), held = ff < CURL.near, j = f ? [A.mcp, A.pip, A.dip] : [A.mcp, A.ip, 0], tot = j[0] + j[1] + j[2];
        const B = C[held ? 'held' : 'free'][f ? 1 : 0];
        B.mcp.push(j[0]); B.pip.push(j[1]); if (f) B.dip.push(j[2]); B.tot.push(tot);
        if (CURLDUMP) CURLDUMP.push(`${t.toFixed(4)}\t${h}\t${f}\t${held ? 1 : 0}\t${j[0].toFixed(1)}\t${j[1].toFixed(1)}\t${j[2].toFixed(1)}\t${Math.min(ff, 99).toFixed(3)}`);
        const cap = CURL_CAP[f ? (held ? 'held' : 'free') : held ? 'thumbHeld' : 'thumbFree'], v = [j[0], j[1], f ? j[2] : -1e9, tot];
        let worst = 0, wj = -1;
        for (let q = 0; q < 4; q++) { const e = v[q] - cap[q] - CURL.tol; if (e > 0) { O.byJoint[held ? 'held' : 'free'][q]++; if (e > worst) { worst = e; wj = q; } } }
        if (wj < 0) continue;
        O.byFinger[f]++; if (held) { oHeld = true; O.heldFingers++; } else { oFree = true; O.freeFingers++; if (ff < CURL.far) oNear = true; }
        const k = Math.round(t * 4) * 2 + h, w = O.worst.get(k);
        if (!w || worst > w.score) O.worst.set(k, { t, score: worst, what: `${fname(h, f)} ${ff === 0 ? 'on its key' : held ? 'near a key' : ff < CURL.far ? 'free, near a key' : 'free'}: ${['MCP', f ? 'PIP' : 'IP', 'DIP', 'total'][wj]} ${v[wj].toFixed(0)} deg (cap ${cap[wj]}; MCP ${j[0].toFixed(0)} ${f ? 'PIP' : 'IP'} ${j[1].toFixed(0)}${f ? ` DIP ${j[2].toFixed(0)}` : ''})` });
      }
      if (oFree) O.free++;
      if (oNear) O.freeNear++;
      if (oHeld) O.held++;
    }
    // (fingers round 1) a finger stretched off its key: its middle joint (the thumb's IP) straighter than STRETCH.pip with
    // its tip joint more than STRETCH.miss from its IK target (stretched toward a key it cannot reach), or a free finger
    // whose tip lies more than STRETCH.spread outside its natural spread (hands.js REST, with the fan) away from its middle
    // finger, STRETCH.margin s or more from its last release and its next contact (it reaches for a key). The straight ones
    // are split by when: at the strike (holding a key, up to STRETCH.strike s after it reached the bottom), later in the
    // hold, or free.
    {
      const ST = STRETCH.of[h];
      let bad = false, heldStraight = false;
      for (let f = 0; f < 5; f++) {
        const A = ang[f], tgt = ikMap.get(Ph.joints[f]), m = tgt ? dist3(tgt, toArr(Ph.joints[f][3])) : 0;
        // (a finger on its key that misses it by more than STRETCH.miss counts however it is bent: stretched toward a key it
        // cannot reach)
        const hp = heldPress(h, f, t), held = !!hp, straight = m > STRETCH.miss && (f === 0 ? A.ip : A.pip) < STRETCH.pip;
        // (fingers round 2) a finger 2-5 holding its key dead straight (middle joint under STRETCH.pip), however close to it
        if (held && f > 0 && A.pip < STRETCH.pip) { heldStraight = true; Q.stretch.heldByFinger[f]++; }
        let spread = false;
        if (f > 0 && !held && freeFor(h, f, t) >= STRETCH.margin) {
          // (round 2: the natural spread as hands.js defines it, its rest place plus STRETCH.restOut, and away from the middle
          // finger as hands.js measures it: the index finger outward, the middle finger either way, the others outward)
          const nat = STRETCH.rest[f] + (f === 4 ? Ph.fan || 0 : f === 3 ? 0.4 * (Ph.fan || 0) : 0) + STRETCH.restOut, x = jh[f][3][0];
          const out = f === 1 ? nat - x : f === 2 ? Math.abs(x - nat) : x - nat;
          spread = out > STRETCH.spread;
        }
        if (straight || spread) {
          bad = true; Q.stretch.byFinger[f]++; if (straight) Q.stretch.straight++; else Q.stretch.spread++;
          if (straight) Q.stretch.when[!held ? 2 : t <= (hp.onKey ?? hp.on) + STRETCH.strike ? 0 : 1]++;
          const k = Math.round(t * 4), w = Q.stretch.worst.get(k), sc = straight ? m : 0.5;
          if (!w || sc > w.score) Q.stretch.worst.set(k, { t, f, score: sc, what: straight ? `${fname(h, f)} ${held ? 'on its key' : 'free'}: ${f ? 'PIP' : 'IP'} ${(f ? A.pip : A.ip).toFixed(0)} deg, IK miss ${m.toFixed(2)}` : `${fname(h, f)} free: tip outside its spread` });
        }
      }
      if (bad) ST.frames++;
      if (heldStraight) Q.stretch.held++;
    }
    // bone capsules in the world (from the skinning matrices: head and tail of every bone)
    const kk = K[h];
    for (let b = 0; b < NB; b++) capsW[h][b] = [kApply(kk, b, ...restH[b]), kApply(kk, b, ...restT[b])];
    // adjacent fingers (2-3, 3-4, 4-5): middle and last bones; and the thumb against the other fingers (it may pass under)
    let fo = 0;
    for (let f = 1; f < 4; f++) for (const s of [2, 3]) for (const s2 of [2, 3]) {
      const a = BI[`finger${f + 1}-${s}`], b = BI[`finger${f + 2}-${s2}`];
      const o = radius[a].r50 + radius[b].r50 - segSegDist(capsW[h][a][0], capsW[h][a][1], capsW[h][b][0], capsW[h][b][1]);
      if (o > fo) fo = o;
      if (o > TH.fingerPen) flag('fingers', h, f, t, o / TH.fingerPen, `${fname(h, f)}/${fname(h, f + 1)}: fingers overlap by ${o.toFixed(2)}`);
    }
    if (fo > TH.fingerPen) Q.fingerOverlapFrames++;
    Q.fingerOverlapMax = Math.max(Q.fingerOverlapMax, fo);
    let to = 0;
    for (const s of [2, 3]) for (let f = 1; f < 5; f++) for (const s2 of [1, 2, 3]) {
      const a = BI[`finger1-${s}`], b = BI[`finger${f + 1}-${s2}`];
      const o = radius[a].r50 + radius[b].r50 - segSegDist(capsW[h][a][0], capsW[h][a][1], capsW[h][b][0], capsW[h][b][1]);
      if (o > to) to = o;
    }
    if (to > TH.fingerPen) { Q.thumbOverlapFrames++; flag('thumb', h, 0, t, to / TH.fingerPen, `${fname(h, 0)}: thumb overlaps another finger by ${to.toFixed(2)}`); }
    Q.thumbOverlapMax = Math.max(Q.thumbOverlapMax, to);
  }
  // the skin: keys, rail, key bed, the case behind the keys; then the two hands against each other
  const bb = [];
  for (const h of [0, 1]) {
    const s = collSel[h]; skinSel(K[h], s); const o = s.out, Q = plaus[h];
    let kMax = 0, kWhat = null, rMax = 0, bMax = 0, cMax = 0, kRound = 0;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let v = 0; v < s.n; v++) {
      const x = o[v * 3], y = o[v * 3 + 1], z = o[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      if (y < KG.blackTop + 0.02 && z > -0.1 && z < KG.whiteL + 0.1) {
        const wi = Math.max(0, Math.min(whitePitch.length - 1, Math.round(x + 25.5)));
        const cand = [whitePitch[wi]]; const bp = blackAt.get(Math.round(x)); if (bp != null) cand.push(bp);
        for (const p of cand) {
          const kd = keyDims(p), a = downAt(p, t) * kd.ang, ca = Math.cos(a), sa = Math.sin(a);
          const lx = x - KX[p], ly = (y - kd.top) * ca + z * sa, lz = -(y - kd.top) * sa + z * ca;
          if (Math.abs(lx) >= kd.hw || ly >= 0 || ly <= -kd.h || lz <= 0 || lz >= kd.L) continue;
          const depth = Math.min(kd.hw - Math.abs(lx), -ly, ly + kd.h, lz, kd.L - lz);
          const f = s.F[v];
          if (f >= 0 && heldPitch(h, f, t) === p) continue;   // its own key: measured as contact
          kRound = Math.max(kRound, roundedDepth(kd, lx, ly, lz));
          if (depth > kMax) { kMax = depth; kWhat = { p, f, held: downAt(p, t), v, x, y, z }; }
        }
      }
      if (z > 5) { const d = sdBox2(y, z, KG.rail.y, KG.rail.z, KG.rail.hy, KG.rail.hz, KG.rail.r); if (-d > rMax) rMax = -d; }
      if (y < KG.bed.y + KG.bed.hy + 0.01) { const d = sdBox2(y, z, KG.bed.y, KG.bed.z, KG.bed.hy, KG.bed.hz); if (-d > bMax) bMax = -d; }
      if (z < 0) { const d = sdBox2(y, z, KG.back.y, KG.back.z, KG.back.hy, KG.back.hz); if (-d > cMax) cMax = -d; }
    }
    bb.push([x0, y0, z0, x1, y1, z1]);
    if (kMax > TH.keyPen) {
      Q.keyPenFrames++; if (kWhat.held > 0) Q.keyPenHeldByOther++;
      const who = kWhat.f >= 0 ? fname(h, kWhat.f) : `${HN[h]} palm`;
      flag('key', h, kWhat.f, t, kMax / TH.keyPen, `${who}: skin ${kMax.toFixed(2)} inside ${pname(kWhat.p)} (${kWhat.held > 0 ? 'a key another finger holds down' : 'a key nobody presses'})`);
      if (KEYDUMP) KEYDUMP.push([r3(t), h, kWhat.f, info.bones[domBone[s.idx[kWhat.v]]].name, kWhat.p, r3(kMax), r3(kWhat.x), r3(kWhat.y), r3(kWhat.z), kWhat.f >= 0 ? heldPitch(h, kWhat.f, t) : -1].join('\t'));
    }
    Q.keyPenMax = Math.max(Q.keyPenMax, kMax);
    if (kRound > TH.keyPen) Q.keyPenRoundFrames++;
    Q.keyPenRoundMax = Math.max(Q.keyPenRoundMax, kRound);
    if (rMax > TH.railPen) { Q.railFrames++; flag('rail', h, -1, t, rMax / TH.railPen, `${HN[h]} hand: skin ${rMax.toFixed(2)} inside the front rail`); }
    if (bMax > TH.railPen) { Q.bedFrames++; flag('bed', h, -1, t, bMax / TH.railPen, `${HN[h]} hand: skin ${bMax.toFixed(2)} inside the key bed`); }
    if (cMax > TH.railPen) { Q.backFrames++; flag('back', h, -1, t, cMax / TH.railPen, `${HN[h]} hand: skin ${cMax.toFixed(2)} inside the case behind the keys`); }
    Q.railMax = Math.max(Q.railMax, rMax); Q.bedMax = Math.max(Q.bedMax, bMax); Q.backMax = Math.max(Q.backMax, cMax);
  }
  // hands against each other: skin vertices of one hand inside the other hand's bone capsules (25th-percentile radii)
  const ov = (a, b, m) => a[0] - m < b[3] && b[0] - m < a[3] && a[1] - m < b[4] && b[1] - m < a[4] && a[2] - m < b[5] && b[2] - m < a[5];
  if (ov(bb[0], bb[1], 0)) {
    let hMax = 0, hWho = null;
    for (const [h, g] of [[0, 1], [1, 0]]) {
      const o = collSel[h].out, B = bb[g];
      for (let v = 0; v < collSel[h].n; v++) {
        const x = o[v * 3], y = o[v * 3 + 1], z = o[v * 3 + 2];
        if (x < B[0] || x > B[3] || y < B[1] || y > B[4] || z < B[2] || z > B[5]) continue;
        for (const c of CAPS) { const [A, Bc] = capsW[g][c]; const d = radius[c].r25 - segPointDist(x, y, z, ...A, ...Bc); if (d > hMax) { hMax = d; hWho = [h, collSel[h].idx[v], g, c]; } }
      }
    }
    // (which parts: the skin's bone in one hand, the bone it is inside in the other)
    if (hMax > TH.handPen) { handsOverlapFrames++; flag('hands', -1, -1, t, hMax / TH.handPen, `the two hands interpenetrate by ${hMax.toFixed(2)} (${HN[hWho[0]]} ${info.bones[domBone[hWho[1]]].name} skin in ${HN[hWho[2]]} ${info.bones[hWho[3]].name})`); }
    handsOverlapMax = Math.max(handsOverlapMax, hMax);
  }
}
closeAll();
const loopMs = Date.now() - tLoop;

// ------------------------------------------------------------------------------------------------ smoothness
function motion(arr, joltTh, floor) {
  const n = arr.length / 3, v = [], a = [], j = [];
  let jolts = 0, flips = 0; const joltT = [], at = { vel: [0, FROM], acc: [0, FROM], jerk: [0, FROM] };
  const get = (i, k) => arr[i * 3 + k];
  let pa = null;
  for (let i = 1; i < n - 1; i++) {
    const vv = [0, 1, 2].map((k) => (get(i + 1, k) - get(i - 1, k)) * FPS / 2);
    const aa = [0, 1, 2].map((k) => (get(i + 1, k) - 2 * get(i, k) + get(i - 1, k)) * FPS * FPS);
    const vm = Math.hypot(...vv), am = Math.hypot(...aa); v.push(vm); a.push(am);
    if (vm > at.vel[0]) at.vel = [vm, FROM + i / FPS]; if (am > at.acc[0]) at.acc = [am, FROM + i / FPS];
    if (pa && am > floor && pa.m > floor && dot(aa, pa.a) < 0) flips++;
    pa = { a: aa, m: am };
    if (i < n - 2) {
      const jm = Math.hypot(...[0, 1, 2].map((k) => (get(i + 2, k) - 3 * get(i + 1, k) + 3 * get(i, k) - get(i - 1, k)) * FPS ** 3));
      j.push(jm); if (jm > at.jerk[0]) at.jerk = [jm, FROM + (i + 0.5) / FPS];
      if (jm > joltTh) { jolts++; joltT.push([FROM + (i + 0.5) / FPS, jm]); }
    }
  }
  return { v, a, j, jolts, flips, joltT, at };
}
const dur = Math.max(1e-6, TO - FROM);
const smooth = [0, 1].map((h) => {
  const S = series[h];
  const O = motion(S.O, TH.joltHand, TH.flipFloorHand), W = motion(S.W, TH.joltHand, TH.flipFloorHand);
  const tips = S.tips.map((a) => motion(a, TH.joltTip, TH.flipFloorTip));
  for (const [what, M, f] of [['hand origin', O, -1], ['wrist', W, -1], ...tips.map((m, f) => [`fingertip ${fname(h, f)}`, m, f])]) {
    const th = f < 0 ? TH.joltHand : TH.joltTip;
    let last = null;
    for (const [t, jm] of M.joltT) { // one event per run of jolting frames
      if (last && t - last.t <= 2.5 / FPS) { last.t = t; if (jm > last.jm) { last.jm = jm; last.tp = t; } continue; }
      if (last) events.push({ kind: 'jolt', hand: h, finger: f, t: last.tp, frames: 1, score: last.jm / th, what: `${HN[h]} ${what}: jerk ${Math.round(last.jm)} u/s^3` });
      last = { t, jm, tp: t };
    }
    if (last) events.push({ kind: 'jolt', hand: h, finger: f, t: last.tp, frames: 1, score: last.jm / th, what: `${HN[h]} ${what}: jerk ${Math.round(last.jm)} u/s^3` });
  }
  const sum = (M) => ({ vel: stats(M.v, 2), acc: stats(M.a, 1), jerk: stats(M.j, 0), jolts: M.jolts, joltsPerMin: r3(M.jolts / dur * 60, 1), flipsPerSec: r3(M.flips / dur, 2),
    maxAt: M.at ? { vel: r3(M.at.vel[1]), acc: r3(M.at.acc[1]), jerk: r3(M.at.jerk[1]) } : undefined });
  const pool = { v: tips.flatMap((m) => m.v), a: tips.flatMap((m) => m.a), j: tips.flatMap((m) => m.j), jolts: tips.reduce((s, m) => s + m.jolts, 0), flips: tips.reduce((s, m) => s + m.flips, 0) };
  const tipAt = (k) => { let b = tips[0]; for (const m of tips) if (m.at[k][0] > b.at[k][0]) b = m; return r3(b.at[k][1]); };
  return { origin: sum(O), wrist: sum(W), tips: { ...sum(pool), flipsPerSec: r3(pool.flips / dur / 5, 2), maxAt: { vel: tipAt('vel'), acc: tipAt('acc'), jerk: tipAt('jerk') } }, perTip: tips.map(sum) };
});

// ------------------------------------------------------------------------------------------------ smoothness, version 2
// Moves of a hand: maximal runs of frame-to-frame intervals where the origin's x speed |v_x| = |x[i+1] - x[i]| * fps is
// at least 2 units/s in one direction, each extended on both sides to the nearest local minimum of |v_x| (the slowest
// interval); the move runs from the end of the slowest interval before it to the start of the slowest interval after
// it, so a minimum-jerk move from rest to rest measures its true duration to within 0-2 frames. D = net x
// displacement, T = duration; moves with D < 0.5 are ignored. A jerk sample (the third difference over frames
// i-1..i+2, as in c.) belongs to a move when at least half of its four frames lie in the move. It is a jolt when it
// exceeds J* = max(6000, 1.5 * 60 D / T^3) inside a move (1.5 times the end jerk of a minimum-jerk move of that size
// and time), 6000 elsewhere. The origin's moves are used for the wrist too.
const MOVE = { vMin: 2, dMin: 0.5, factor: 1.5 };
const jerkAt = (arr, i) => Math.hypot(...[0, 1, 2].map((k) => (arr[(i + 2) * 3 + k] - 3 * arr[(i + 1) * 3 + k] + 3 * arr[i * 3 + k] - arr[(i - 1) * 3 + k]) * FPS ** 3));
function movesOf(arr) {
  const n = arr.length / 3, m = n - 1, out = [];
  if (n < 4) return out;
  const u = new Float64Array(m);   // u[i]: x speed over the interval from frame i to frame i + 1
  for (let i = 0; i < m; i++) u[i] = (arr[(i + 1) * 3] - arr[i * 3]) * FPS;
  const au = Array.from(u, Math.abs);
  for (let i = 0; i < m;) {
    if (au[i] < MOVE.vMin) { i++; continue; }
    const sg = Math.sign(u[i]); let b = i;
    while (b + 1 < m && au[b + 1] >= MOVE.vMin && Math.sign(u[b + 1]) === sg) b++;
    let lo = i, hi = b;
    while (lo > 0 && au[lo - 1] < au[lo]) lo--;
    while (hi < m - 1 && au[hi + 1] < au[hi]) hi++;
    const a0 = lo < i ? lo + 1 : lo, b0 = hi > b ? hi : hi + 1;   // frames
    const D = Math.abs(arr[b0 * 3] - arr[a0 * 3]), T = (b0 - a0) / FPS;
    if (D >= MOVE.dMin && T > 0) out.push({ a: a0, b: b0, t0: FROM + a0 / FPS, t1: FROM + b0 / FPS, D, T, jStar: Math.max(TH.joltHand, MOVE.factor * 60 * D / T ** 3) });
    i = b + 1;
  }
  return out;
}
// jolting frames of one series against a per-sample threshold; consecutive frames make one event (at its peak ratio)
function joltRuns(arr, thr, skip, h, f, kind, what) {
  const n = arr.length / 3; let frames = 0; const ev = []; let cur = null;
  for (let i = 1; i < n - 2; i++) {
    const jm = jerkAt(arr, i), th = thr(i); if (!(jm > th)) continue;
    const t = FROM + (i + 0.5) / FPS; if (skip && skip(t)) continue;
    frames++;
    if (cur && t - cur.last <= 2.5 / FPS) { cur.last = t; cur.frames++; if (jm / th > cur.score) { cur.score = jm / th; cur.t = t; cur.jm = jm; cur.th = th; } continue; }
    if (cur) ev.push(cur);
    cur = { t, last: t, frames: 1, score: jm / th, jm, th };
  }
  if (cur) ev.push(cur);
  if (kind) for (const e of ev) eventsNew.push({ kind, hand: h, finger: f, t: e.t, frames: e.frames, score: e.score, what: `${HN[h]} ${what}: jerk ${Math.round(e.jm)} u/s^3 (limit ${Math.round(e.th)})` });
  return { frames, events: ev.length, top: ev.slice().sort((a, b) => b.score - a.score).slice(0, TOP).map((e) => ({ t: r3(e.t), jerk: Math.round(e.jm), limit: Math.round(e.th), frames: e.frames })) };
}
const moveJolts = [0, 1].map((h) => {
  const S = series[h], moves = movesOf(S.O), n = S.O.length / 3;
  const thr = new Float64Array(Math.max(0, n)).fill(TH.joltHand), inMove = new Uint8Array(Math.max(0, n));
  for (const m of moves) for (let i = Math.max(1, m.a - 1); i <= Math.min(n - 3, m.b); i++) { inMove[i] = 1; if (m.jStar > thr[i]) thr[i] = m.jStar; }
  const one = (arr, label) => {
    const r = joltRuns(arr, (i) => thr[i], null, h, -1, 'move-jolt', label);
    let inside = 0; for (let i = 1; i < n - 2; i++) if (inMove[i] && jerkAt(arr, i) > thr[i]) inside++;
    return { jolts: r.frames, joltsPerMin: r3(r.frames / dur * 60, 2), events: r.events, eventsPerMin: r3(r.events / dur * 60, 2), inMoves: inside, outsideMoves: r.frames - inside, top: r.top };
  };
  const O = one(S.O, 'hand origin'), W = one(S.W, 'wrist');
  const Ds = moves.map((m) => m.D), Ts = moves.map((m) => m.T);
  return {
    moves: moves.length, moveD: { p50: r3(pct(Ds, 0.5), 2), max: r3(pct(Ds, 1), 2) }, moveT: { p50: r3(pct(Ts, 0.5), 3), min: r3(pct(Ts, 0), 3) },
    framesInMoves: inMove.reduce((s, x) => s + x, 0),
    origin: O, wrist: W, originPlusWristPerMin: r3((O.jolts + W.jolts) / dur * 60, 2),
  };
});
// fingertip jolts (jerk above TH.joltTip) more than 2 frames from every impact of that finger: tc, onKey, off, off + ride
const tipJoltsOut = [0, 1].map((h) => {
  const per = [0, 1, 2, 3, 4].map((f) => {
    const imp = []; for (const pr of plan[h].presses[f]) imp.push(pr.tc ?? pr.on, pr.onKey ?? pr.on, pr.off, pr.off + (pr.ride ?? 0));
    imp.sort((a, b) => a - b);
    const near = (t) => { let lo = 0, hi = imp.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (imp[m] < t) lo = m + 1; else hi = m; } const w = 2 / FPS + 1e-9; return (lo < imp.length && Math.abs(imp[lo] - t) <= w) || (lo > 0 && Math.abs(imp[lo - 1] - t) <= w); };
    const all = joltRuns(series[h].tips[f], () => TH.joltTip, null, h, f, null, '');
    const out = joltRuns(series[h].tips[f], () => TH.joltTip, near, h, f, 'tip-jolt', `fingertip ${fname(h, f)} (outside impacts)`);
    return { all: all.frames, outside: out.frames, perMin: r3(out.frames / dur * 60, 1), events: out.events, top: out.top };
  });
  const outside = per.reduce((s, p) => s + p.outside, 0), all = per.reduce((s, p) => s + p.all, 0);
  return { jolts: outside, joltsPerMin: r3(outside / dur * 60, 1), allTipJolts: all, nearImpacts: all - outside, perFinger: per.map(({ top, ...p }) => p), top: per.flatMap((p, f) => p.top.map((e) => ({ ...e, finger: fname(h, f) }))).sort((a, b) => b.jerk - a.jerk).slice(0, TOP) };
});

// ------------------------------------------------------------------------------------------------ results
const cSum = (C) => ({
  presses: C.presses, onBlack: C.black,
  gap: { min: r3(pct(C.gaps, 0)), p5: r3(pct(C.gaps, 0.05)), p50: r3(pct(C.gaps, 0.5)), p95: r3(pct(C.gaps, 0.95)), max: r3(pct(C.gaps, 1)) },
  floating: C.float, sinking: C.pen, offKey: C.offKey, offKeyLength: C.zOut, whiteBetweenBlacks: C.betweenBlack,
  offsetFromCentre: { p50: r3(pct(C.dx, 0.5)), p95: r3(pct(C.dx, 0.95)), max: r3(pct(C.dx, 1)) },
  ikMiss: { p50: r3(pct(C.ik, 0.5)), p95: r3(pct(C.ik, 0.95)), max: r3(pct(C.ik, 1)), over: C.ikBig },
  perFinger: C.byF ? C.byF.map((b) => ({ presses: b.gaps.length, gapP50: r3(pct(b.gaps, 0.5)), gapP95: r3(pct(b.gaps, 0.95)), offsetP95: r3(pct(b.dx, 0.95)), ikP50: r3(pct(b.ik, 0.5)), ikP95: r3(pct(b.ik, 0.95)) })) : undefined,
});
const contactAll = { gaps: contact.flatMap((c) => c.gaps), dx: contact.flatMap((c) => c.dx), ik: contact.flatMap((c) => c.ik) };
for (const k of ['float', 'pen', 'offKey', 'zOut', 'ikBig', 'presses', 'black', 'betweenBlack']) contactAll[k] = contact[0][k] + contact[1][k];
const pSum = (Q) => ({
  ikMissAllFrames: { ...stats(Q.ikAll, 3), framesOver: Q.ikFrames, perFinger: Q.ikByF.map((a) => ({ p50: r3(pct(a, 0.5)), p95: r3(pct(a, 0.95)), max: r3(pct(a, 1)) })) },
  sidewaysFromRest: Q.abdByF.map((a, f) => (f === 0 ? null : { p5: r3(pct(a, 0.05), 1), p50: r3(pct(a, 0.5), 1), p95: r3(pct(a, 0.95), 1) })),
  // (percent of the frames of the fingers that have that joint: the thumb's for tmcp, tip, cmc; fingers 2-5 for the others)
  joints: Object.fromEntries(Object.entries(Q.joints).map(([k, v]) => [k, { ...v, pct: r3(100 * v.out / Math.max(1, (Q.fingerFrames / 5) * (['tmcp', 'tip', 'cmc'].includes(k) ? 1 : 4)), 2) }])),
  crossedFingers: { frames: Q.crossFrames, max: r3(Q.crossMax) },
  fingerOverlap: { frames: Q.fingerOverlapFrames, max: r3(Q.fingerOverlapMax) },
  thumbOverlap: { frames: Q.thumbOverlapFrames, max: r3(Q.thumbOverlapMax) },
  keyPenetration: { frames: Q.keyPenFrames, max: r3(Q.keyPenMax), framesInKeyHeldByAnother: Q.keyPenHeldByOther },
  stretchedOffKey: { frames: STRETCH.of[plaus.indexOf(Q)].frames, fingerFrames: Q.stretch.straight + Q.stretch.spread, straight: Q.stretch.straight, straightAtStrike: Q.stretch.when[0], straightLaterInHold: Q.stretch.when[1], straightFree: Q.stretch.when[2], outsideSpread: Q.stretch.spread, byFinger: Q.stretch.byFinger, straightHeld: Q.stretch.held, straightHeldByFinger: Q.stretch.heldByFinger,
    worst: [...Q.stretch.worst.values()].sort((a, b) => b.score - a.score).slice(0, TOP).map((w) => ({ t: r3(w.t), what: w.what })) },
  // (curl round) joint angles, free and on a key (fingers 2-5 and the thumb), and the frames over the curl caps
  curl: (() => {
    const S = (B) => ({ mcp: stats(B.mcp, 1), pip: stats(B.pip, 1), dip: stats(B.dip, 1), total: stats(B.tot, 1) });
    const O = Q.curl.over;
    return { free: { fingers: S(Q.curl.free[1]), thumb: S(Q.curl.free[0]) }, held: { fingers: S(Q.curl.held[1]), thumb: S(Q.curl.held[0]) },
      overCurled: { freeFrames: O.free, freeNearFrames: O.freeNear, heldFrames: O.held, freeFingerFrames: O.freeFingers, heldFingerFrames: O.heldFingers, byFinger: O.byFinger, byJoint: O.byJoint,
        worst: [...O.worst.values()].sort((a, b) => b.score - a.score).slice(0, TOP).map((w) => ({ t: r3(w.t), what: w.what })) } };
  })(),
  // (the same, against the keys as drawn, their edges rounded: a variant, reported beside the boxes above, which stay the measure)
  keyPenetrationRounded: { frames: Q.keyPenRoundFrames, max: r3(Q.keyPenRoundMax) },
  rail: { frames: Q.railFrames, max: r3(Q.railMax) }, keyBed: { frames: Q.bedFrames, max: r3(Q.bedMax) }, caseBehind: { frames: Q.backFrames, max: r3(Q.backMax) },
});
// worst moments: the highest scores, at least 0.25 s apart
// (taken in turn from each kind of problem, the kinds with the worst scores first, so one chronic problem does not fill
// the list; moments closer than 0.25 s to one already listed are skipped)
events.sort((a, b) => b.score - a.score);
const worst = [];
{
  const kinds = [...new Set(events.map((e) => e.kind))], queues = kinds.map((k) => events.filter((e) => e.kind === k));
  while (worst.length < TOP && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && worst.some((w) => Math.abs(w.t - q[0].t) < 0.25)) q.shift();
      if (q.length && worst.length < TOP) worst.push(q.shift());
    }
  }
  worst.sort((a, b) => b.score - a.score);
}
const byKind = {};
for (const e of events) { (byKind[e.kind] ||= { count: 0, top: [] }); byKind[e.kind].count++; if (byKind[e.kind].top.length < 15) byKind[e.kind].top.push({ t: r3(e.t), what: e.what, score: r3(e.score, 2), frames: e.frames }); }

// ---- version 2 results (new top-level fields only: every version-1 field above stays exactly as it was)
const gs = (a) => (a.length ? { n: a.length, min: r3(pct(a, 0)), p5: r3(pct(a, 0.05)), p50: r3(pct(a, 0.5)), p95: r3(pct(a, 0.95)), max: r3(pct(a, 1)) } : { n: 0 });
const ik3 = (a) => (a.length ? { n: a.length, p50: r3(pct(a, 0.5)), p95: r3(pct(a, 0.95)), max: r3(pct(a, 1)), over: a.filter((m) => m > TH.ikMiss).length } : { n: 0 });
const absP95 = (a) => r3(pct(a.map(Math.abs), 0.95));
const reachedOf = (bs) => {
  const mid = bs.flatMap((b) => b.rMid), rD = bs.flatMap((b) => b.rD), rB = bs.flatMap((b) => b.rB), presses = bs.reduce((s, b) => s + b.presses, 0);
  const fl = bs.reduce((s, b) => s + b.rFloat, 0), sk = bs.reduce((s, b) => s + b.rSink, 0);
  return { presses: mid.length, pctOfPresses: r3(100 * mid.length / Math.max(1, presses), 1), gap: gs(mid), floatingPct: r3(100 * fl / Math.max(1, mid.length), 2), sinkingPct: r3(100 * sk / Math.max(1, mid.length), 2),
    gapAtDescent: gs(rD), gapAtBottom: gs(rB), absGapAtDescentP95: absP95(rD), absGapAtBottomP95: absP95(rB) };
};
const thruSum = (bs) => ({
  presses: bs.reduce((s, b) => s + b.presses, 0),
  ikAtContact: ik3(bs.flatMap((b) => b.ikC)), ikAtRelease: ik3(bs.flatMap((b) => b.ikR)),
  padAngle: (() => { const a = bs.flatMap((b) => b.beta); return a.length ? { n: a.length, p5: r3(pct(a, 0.05), 1), p50: r3(pct(a, 0.5), 1), p95: r3(pct(a, 0.95), 1), in50to75Pct: r3(100 * a.filter((x) => x >= 50 && x <= 75).length / a.length, 1), over80Pct: r3(100 * a.filter((x) => x > 80).length / a.length, 1) } : { n: 0 }; })(),
  gapAtDescent: gs(bs.flatMap((b) => b.gD)), gapAtBottom: gs(bs.flatMap((b) => b.gB)),
  reached: reachedOf(bs),
});
const pressPhases = {
  perHand: thru.map((T) => ({ ...thruSum(T.byF), perFinger: T.byF.map((b) => {
    const s = thruSum([b]); return { presses: s.presses, ikAtContact: s.ikAtContact, ikAtRelease: s.ikAtRelease, padAngle: s.padAngle, gapAtDescentP50: s.gapAtDescent.p50 ?? null, gapAtBottomP50: s.gapAtBottom.p50 ?? null, reached: s.reached };
  }) })),
  total: thruSum(thru.flatMap((T) => T.byF)),
};
const winSum = (W) => ({ presses: W.presses, over03: W.over03, over10: W.over10, pct03: r3(100 * W.over03 / Math.max(1, W.presses), 2), pct10: r3(100 * W.over10 / Math.max(1, W.presses), 2), excessP95: r3(pct(W.excess, 0.95)), excessMax: r3(pct(W.excess, 1)) });
const pressesOutsideWindow = hasWindows ? { perHand: thru.map((T) => winSum(T.win)), total: winSum({ presses: thru[0].win.presses + thru[1].win.presses, over03: thru[0].win.over03 + thru[1].win.over03, over10: thru[0].win.over10 + thru[1].win.over10, excess: [...thru[0].win.excess, ...thru[1].win.excess] }) } : null;
const pressesOutsideWindowWhite = hasWindows ? { perHand: thru.map((T) => winSum(T.winWhite)) } : null;
const pressesOutsideWindowPath = hasWindows && thru.some((T) => T.winPath.presses) ? { perHand: thru.map((T) => winSum(T.winPath)), total: winSum({ presses: thru[0].winPath.presses + thru[1].winPath.presses, over03: thru[0].winPath.over03 + thru[1].winPath.over03, over10: thru[0].winPath.over10 + thru[1].winPath.over10, excess: [...thru[0].winPath.excess, ...thru[1].winPath.excess] }) } : null;
// (S4 fix) keys down with no fingertip on them
const keyNoFinger = {
  perHand: noFinger.map((NF, h) => {
    const L = [...NF.worst.values()], bad = L.filter((w) => w.d > NOFINGER);
    for (const w of bad) eventsNew.push({ kind: 'no-finger', hand: h, finger: w.f, t: w.t, frames: 1, score: w.d / NOFINGER, what: `${fname(h, w.f)} on ${pname(w.p)}: the key is down with the pad ${w.d.toFixed(2)} from it` });
    return { presses: L.length, count: bad.length, pct: r3(100 * bad.length / Math.max(1, L.length), 2), frames: NF.frames,
      onBlack: bad.filter((w) => isBlack(w.p)).length, byFinger: [0, 1, 2, 3, 4].map((f) => bad.filter((w) => w.f === f).length),
      atStrike: bad.filter((w) => w.first > NOFINGER).length, atRelease: bad.filter((w) => w.first <= NOFINGER && w.last > NOFINGER).length,
      worst: bad.sort((a, b) => b.d - a.d).slice(0, TOP).map((w) => ({ t: r3(w.t), finger: fname(h, w.f), key: pname(w.p), d: r3(w.d), first: r3(w.first), last: r3(w.last) })) };
  }),
};
const rng = (a, d = 2) => (a.length ? { p1: r3(pct(a, 0.01), d), p99: r3(pct(a, 0.99), d), min: r3(pct(a, 0), d), max: r3(pct(a, 1), d) } : null);
const poseRanges = { perHand: poseRg.map((R) => ({ rollDeg: rng(R.roll), pitchDeg: rng(R.pitch), ulnarDeg: rng(R.ulnar), fan: rng(R.fan, 3), yawDeg: rng(R.yaw) })) };
let handsStats = null;
try { handsStats = hands.stats == null ? null : JSON.parse(JSON.stringify(hands.stats)); } catch (e) { handsStats = { error: String(e.message || e) }; }
// worst moments of the version-2 kinds, chosen the same way as the version-1 list
eventsNew.sort((a, b) => b.score - a.score);
const worstNew = [];
{
  const kinds = [...new Set(eventsNew.map((e) => e.kind))], queues = kinds.map((k) => eventsNew.filter((e) => e.kind === k));
  while (worstNew.length < TOP && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && worstNew.some((w) => Math.abs(w.t - q[0].t) < 0.25)) q.shift();
      if (q.length && worstNew.length < TOP) worstNew.push(q.shift());
    }
  }
  worstNew.sort((a, b) => b.score - a.score);
}
const byKindNew = {};
for (const e of eventsNew) { (byKindNew[e.kind] ||= { count: 0, top: [] }); byKindNew[e.kind].count++; if (byKindNew[e.kind].top.length < 15) byKindNew[e.kind].top.push({ t: r3(e.t), what: e.what, score: r3(e.score, 2), frames: e.frames }); }
const definitionsV2 = {
  keyDepth: KEY_DEPTH ? 'hands.keyDepth(pitch, t)' : 'played map: down from the onset to off, rising over keyGeometry.release s (keys.js rule before S2)',
  keyTilt: KEY_TILT ? 'hands.js KEY_TILT export' : 'regex on keys.js (fallback 0.055 / 0.042)',
  heldKey: 'a press holds its key from tc (on when the plan has no tc) to off',
  moveJolts: `moves: runs of frame-to-frame intervals with |v_x| of the origin >= ${MOVE.vMin} u/s in one direction, extended to the slowest interval on each side (local minima of |v_x|; the move spans the frames between them), net |D| >= ${MOVE.dMin}; a jerk sample with at least 2 of its 4 frames in a move is a jolt above max(${TH.joltHand}, ${MOVE.factor} * 60 D / T^3), elsewhere above ${TH.joltHand}; counts are frames (events = runs of consecutive frames); the origin's moves are used for the wrist`,
  tipJoltsOutsideImpacts: `fingertip jerk above ${TH.joltTip} more than 2 frames (2/fps s) from that finger's tc, onKey, off and off + ride (on, on, off, off when absent)`,
  ikAtContactRelease: 'IK miss at tc + 0.004 s and at off - 0.004 s, per press',
  gapThroughPress: `contact gap at tc + d/2 (descent) and at onKey + 0.004 (key bottom); "reached" = IK miss at mid-press < ${REACHED}; floating > ${TH.float}, sinking < ${TH.pen}`,
  pressesOutsideWindow: 'hand origin x at tc outside [lo - 0.2, hi + 0.2] of the press\'s event by more than 0.3 / 1.0 (null when events have no lo/hi)',
  pressesOutsideWindowPath: 'the same for the planned anchor x(t) (plan[h].curves, a cubic B-spline) instead of the hand origin (null without curves)',
  pressesOutsideWindowWhite: 'the hand origin version (pressesOutsideWindow) for presses of white keys only',
  curl: `joint angles in degrees as in sanity.restAngles (MCP from the metacarpal, PIP, DIP; the thumb MCP and IP; total their sum), split into free (${CURL.near} s or more from its last release and its next contact; freeNearFrames: of those, the frames over a cap with such a finger less than ${CURL.far} s from one) and playing (on its key, or nearer it than that: 'held'); overCurled: hand-frames (and finger-frames) with a finger whose joint or total is more than ${CURL.tol} deg over its cap ${JSON.stringify(CURL_CAP)} ([MCP, PIP, DIP, total]; hands.js CFG.curl: lyrical caps for --posture lyrical and legacy, classical for classical and auto); byJoint: finger-frames over each cap`,
  stretchedOffKey: `hand-frames with a finger whose middle joint (the thumb's IP) is under ${STRETCH.pip} deg with its tip joint more than ${STRETCH.miss} from its IK target (straight: split into atStrike, holding a key up to ${STRETCH.strike} s after onKey; laterInHold; free), or a free finger 2-5 (${STRETCH.margin} s or more from its last release and next contact) whose tip lies more than ${STRETCH.spread} outside its rest place (hands.js REST plus the fan) away from the middle finger; straightHeld (not in frames): hand-frames with a finger 2-5 holding its key with its middle joint under ${STRETCH.pip} deg, whatever its IK miss`,
  keyNoFinger: `presses whose key is held down (tc to off) at some frame while its finger's pad is more than ${NOFINGER} from the key's top face (over the face: the height above it; off it: the distance to its nearest edge, height included); frames: hand-frames with such a key; atStrike: already at the press's first frame; atRelease: only from some later frame through its last`,
  poseRanges: 'p1 / p99 over all frames; ulnar = -side * (yaw - 0.55 * atan2(elbow.x - O.x, elbow.z - O.z)), positive toward the little finger',
};
const runtime = (Date.now() - T0) / 1000;
const pieceName = path.basename(pieceFile).replace(/\.(smf|midi?)$/i, '');
const out = {
  tool: 'hand-metrics', version: VERSION, piece: pieceName, file: path.relative(APP, pieceFile), rev: args.rev || null, sha: tree.sha, posture: args.posture || null, range: { from: r3(FROM), to: r3(TO), seconds: r3(dur, 2) }, fps: FPS,
  frames: N, runtimeSec: r3(runtime, 1), timing: { planMs, frameLoopMs: loopMs },
  notesPerSec: [0, 1].map((h) => r3(unplayed[h].notes / dur, 2)),
  thresholds: TH, keyGeometry: KG, sanity,
  notes: { perHand: unplayed.map((u) => ({ ...u, pct: r3(100 * u.unplayed / Math.max(1, u.notes), 2) })), total: { notes: unplayed[0].notes + unplayed[1].notes, unplayed: unplayed[0].unplayed + unplayed[1].unplayed, pct: r3(100 * (unplayed[0].unplayed + unplayed[1].unplayed) / Math.max(1, unplayed[0].notes + unplayed[1].notes), 2) } },
  contact: { perHand: contact.map(cSum), total: cSum(contactAll) },
  smooth: { perHand: smooth },
  plausibility: { perHand: plaus.map(pSum), handsOverlap: { frames: handsOverlapFrames, max: r3(handsOverlapMax) } },
  worst: worst.map((e) => ({ t: r3(e.t), kind: e.kind, hand: e.hand < 0 ? 'both' : HN[e.hand], finger: e.finger, what: e.what, score: r3(e.score, 2), frames: e.frames })),
  worstTimes: worst.map((e) => r3(e.t, 2)).sort((a, b) => a - b).join(','),
  byKind,
  // version 2 (FINAL-SPEC S0)
  metricsVersion: 2,
  createHandsMs: r3(createHandsMs, 1),
  handsStats,
  definitionsV2,
  moveJolts: { perHand: moveJolts },
  tipJoltsOutsideImpacts: { perHand: tipJoltsOut },
  pressPhases,
  pressesOutsideWindow,
  pressesOutsideWindowPath,
  pressesOutsideWindowWhite,
  keyNoFinger,
  poseRanges,
  worstNew: worstNew.map((e) => ({ t: r3(e.t), kind: e.kind, hand: e.hand < 0 ? 'both' : HN[e.hand], finger: e.finger, what: e.what, score: r3(e.score, 2), frames: e.frames })),
  worstNewTimes: worstNew.map((e) => r3(e.t, 2)).sort((a, b) => a - b).join(','),
  byKindNew,
};

// ------------------------------------------------------------------------------------------------ table
const pad = (s, n) => String(s).padStart(n);
const row = (label, vals) => console.log(label.padEnd(36) + vals.map((v) => pad(v ?? '-', 18)).join(''));
console.log(`\n${pieceName}  (${tree.sha ? `rev ${tree.sha.slice(0, 10)}` : 'working tree'}; ${r3(FROM, 1)}..${r3(TO, 1)} s; ${N} frames at ${FPS} fps; ${runtime.toFixed(1)} s)`);
row('', ['right', 'left', 'total']);
const cs = out.contact.perHand, ct = out.contact.total;
row('notes / unplayed (%)', [0, 1].map((h) => `${unplayed[h].notes}/${out.notes.perHand[h].pct}%`).concat(`${out.notes.total.notes}/${out.notes.total.pct}%`));
row('presses measured', [cs[0].presses, cs[1].presses, ct.presses]);
row('contact gap p5 / p50 / p95', [...cs, ct].map((c) => `${c.gap.p5}/${c.gap.p50}/${c.gap.p95}`));
row(`floating >${TH.float} / sinking <${TH.pen}`, [...cs, ct].map((c) => `${c.floating}/${c.sinking}`));
row('off key (width / length)', [...cs, ct].map((c) => `${c.offKey}/${c.offKeyLength}`));
row('IK miss at press p95 / max', [...cs, ct].map((c) => `${c.ikMiss.p95}/${c.ikMiss.max}`));
const ps = out.plausibility.perHand;
row('IK miss all frames p99 / >0.1', ps.map((p) => `${p.ikMissAllFrames.p99}/${p.ikMissAllFrames.framesOver}`));
for (const [k, lab] of [['origin', 'hand origin'], ['wrist', 'wrist'], ['tips', 'fingertips']]) {
  row(`${lab} vel p95/max (u/s)`, smooth.map((s) => `${s[k].vel.p95}/${s[k].vel.max}`));
  row(`${lab} acc p95/max (u/s2)`, smooth.map((s) => `${s[k].acc.p95}/${s[k].acc.max}`));
  row(`${lab} jerk p99/max (u/s3)`, smooth.map((s) => `${s[k].jerk.p99}/${s[k].jerk.max}`));
  row(`${lab} jolts / acc flips per s`, smooth.map((s) => `${s[k].jolts}/${s[k].flipsPerSec}`));
}
row('joints out of range (finger-frames)', ps.map((p) => Object.values(p.joints).reduce((s, j) => s + j.out, 0)));
row('  hyperextended (MCP/PIP/DIP/thumb)', ps.map((p) => `${p.joints.mcp.hyper}/${p.joints.pip.hyper}/${p.joints.dip.hyper}/${p.joints.tmcp.hyper + p.joints.tip.hyper}`));
row('  sideways at knuckle / thumb CMC', ps.map((p) => `${p.joints.abd.out}/${p.joints.cmc.out}`));
row('crossed fingertips frames / max', ps.map((p) => `${p.crossedFingers.frames}/${p.crossedFingers.max}`));
row('finger overlap frames / max', ps.map((p) => `${p.fingerOverlap.frames}/${p.fingerOverlap.max}`));
row('thumb overlap frames / max', ps.map((p) => `${p.thumbOverlap.frames}/${p.thumbOverlap.max}`));
row('skin in other keys frames / max', ps.map((p) => `${p.keyPenetration.frames}/${p.keyPenetration.max}`));
row('  ... keys with rounded edges', ps.map((p) => (p.keyPenetrationRounded ? `${p.keyPenetrationRounded.frames}/${p.keyPenetrationRounded.max}` : '-')));
row('rail / bed / case frames', ps.map((p) => `${p.rail.frames}/${p.keyBed.frames}/${p.caseBehind.frames}`));
row('hands interpenetrate frames / max', ['', '', `${handsOverlapFrames}/${r3(handsOverlapMax)}`]);
console.log(`\nworst moments (render with --times ${out.worstTimes}):`);
for (const w of out.worst) console.log(`  ${pad(w.t.toFixed(2), 8)} s  ${w.kind.padEnd(8)} ${w.what}${w.frames > 1 ? ` (${w.frames} frames)` : ''}`);
// ---- version 2
{
  const pp = pressPhases, three = (s) => (s && s.n ? `${s.p50}/${s.p95}/${s.max}` : '-'), g3 = (s) => (s && s.n ? `${s.p5}/${s.p50}/${s.p95}` : '-');
  const hands3 = (fn) => [...pp.perHand, pp.total].map(fn);
  console.log(`\nversion 2 metrics (createHands ${createHandsMs.toFixed(1)} ms; key depth from ${KEY_DEPTH ? 'hands.keyDepth' : 'the played map'}, tilt from ${KEY_TILT ? 'KEY_TILT' : 'keys.js'})`);
  row('', ['right', 'left', 'total']);
  row('moves (|D| >= 0.5) / frames in moves', moveJolts.map((m) => `${m.moves}/${m.framesInMoves}`));
  row('move-norm. jolts O / wrist (frames)', moveJolts.map((m) => `${m.origin.jolts}/${m.wrist.jolts}`));
  row('  O + wrist per minute (in moves)', moveJolts.map((m) => `${m.originPlusWristPerMin} (${m.origin.inMoves + m.wrist.inMoves})`));
  row('tip jolts outside impacts (per min)', tipJoltsOut.map((t) => `${t.jolts} (${t.joltsPerMin})`));
  row('  of all tip jolts / near impacts', tipJoltsOut.map((t) => `${t.allTipJolts}/${t.nearImpacts}`));
  row('IK miss at contact p50/p95/max', hands3((s) => three(s.ikAtContact)));
  row('IK miss at release p50/p95/max', hands3((s) => three(s.ikAtRelease)));
  row('pad angle white 2-5 p5/p50/p95 deg', hands3((s) => (s.padAngle.n ? `${s.padAngle.p5}/${s.padAngle.p50}/${s.padAngle.p95}` : '-')));
  row('  pad angle 50-75 % / over 80 %', hands3((s) => (s.padAngle.n ? `${s.padAngle.in50to75Pct}/${s.padAngle.over80Pct}` : '-')));
  row('gap at descent p5/p50/p95', hands3((s) => g3(s.gapAtDescent)));
  row('gap at key bottom p5/p50/p95', hands3((s) => g3(s.gapAtBottom)));
  row('reached presses (IK mid < 0.05)', hands3((s) => `${s.reached.presses} (${s.reached.pctOfPresses}%)`));
  row('  reached gap p50 / float% / sink%', hands3((s) => `${s.reached.gap.p50 ?? '-'}/${s.reached.floatingPct}/${s.reached.sinkingPct}`));
  row('  reached |gap| descent/bottom p95', hands3((s) => `${s.reached.absGapAtDescentP95 ?? '-'}/${s.reached.absGapAtBottomP95 ?? '-'}`));
  row('outside window >0.3 / >1.0', pressesOutsideWindow ? [...pressesOutsideWindow.perHand, pressesOutsideWindow.total].map((w) => `${w.over03}/${w.over10} of ${w.presses}`) : ['n/a (no lo/hi)', 'n/a', 'n/a']);
  if (pressesOutsideWindowPath) row('  planned anchor >0.3 / >1.0', [...pressesOutsideWindowPath.perHand, pressesOutsideWindowPath.total].map((w) => `${w.over03}/${w.over10} of ${w.presses}`));
  if (pressesOutsideWindowWhite) row('  white keys, origin >0.3 / >1.0', pressesOutsideWindowWhite.perHand.map((w) => `${w.over03}/${w.over10} of ${w.presses}`));
  row('stretched off its key (frames: straight at strike/later/free; spread)', out.plausibility.perHand.map((p) => { const s = p.stretchedOffKey; return `${s.frames} (${s.straightAtStrike}/${s.straightLaterInHold}/${s.straightFree}; ${s.outsideSpread})`; }));
  row('  held dead straight (PIP < 8, any miss)', out.plausibility.perHand.map((p) => `${p.stretchedOffKey.straightHeld}`));
  row('finger over-curled (frames: free (near a key) / playing)', out.plausibility.perHand.map((p) => `${p.curl.overCurled.freeFrames} (${p.curl.overCurled.freeNearFrames}) / ${p.curl.overCurled.heldFrames}`));
  row('  free 2-5 PIP p50/p95/max', out.plausibility.perHand.map((p) => { const s = p.curl.free.fingers.pip; return s.n ? `${s.p50}/${s.p95}/${s.max}` : '-'; }));
  row('  free 2-5 total p50/p95/max', out.plausibility.perHand.map((p) => { const s = p.curl.free.fingers.total; return s.n ? `${s.p50}/${s.p95}/${s.max}` : '-'; }));
  row('  playing 2-5 PIP p50/p95/max', out.plausibility.perHand.map((p) => { const s = p.curl.held.fingers.pip; return s.n ? `${s.p50}/${s.p95}/${s.max}` : '-'; }));
  row(`key down, pad >${NOFINGER} away (frames)`, keyNoFinger.perHand.map((k) => `${k.count} of ${k.presses} (${k.frames})`));
  const rr = (r) => (r ? `${r.p1}/${r.p99}` : '-');
  row('roll p1/p99 (deg)', poseRanges.perHand.map((r) => rr(r.rollDeg)));
  row('pitch p1/p99 (deg)', poseRanges.perHand.map((r) => rr(r.pitchDeg)));
  row('ulnar deviation p1/p99 (deg)', poseRanges.perHand.map((r) => rr(r.ulnarDeg)));
  row('fan p1/p99 (units)', poseRanges.perHand.map((r) => rr(r.fan)));
  console.log(`hands.stats: ${handsStats ? JSON.stringify(handsStats) : '(none)'}`);
  console.log(`\nworst moments, version 2 kinds (render with --times ${out.worstNewTimes}):`);
  for (const w of out.worstNew) console.log(`  ${pad(w.t.toFixed(2), 8)} s  ${w.kind.padEnd(10)} ${w.what}${w.frames > 1 ? ` (${w.frames} frames)` : ''}`);
}
if (args.json) { fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true }); fs.writeFileSync(args.json, JSON.stringify(out, null, 1)); log(`\nwrote ${args.json}`); }
if (CURLDUMP) fs.writeFileSync(args.curldump, ['t\thand\tfinger\theld\tmcp\tpip\tdip\tfreeFor', ...CURLDUMP].join('\n') + '\n');
if (KEYDUMP) fs.writeFileSync(args.keydump, ['t\thand\tfinger\tbone\tkey\tdepth\tx\ty\tz\theld', ...KEYDUMP].join('\n') + '\n');
cleanup();

// ------------------------------------------------------------------------------------------------ summary of several runs
function writeSummary(md, files) {
  const runs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  // a short name for each run: its file name without the piece's name (e.g. "baseline", "step-0")
  const label = runs.map((r, i) => { const b = path.basename(files[i]).replace(/\.json$/i, ''); return b.replace(r.piece || '\0', '').replace(/^[-_.]+|[-_.]+$/g, '') || b; });
  const runOf = (r) => label[runs.indexOf(r)];
  const L = [];
  const cell = (r, fn) => { try { const v = fn(r); return v == null ? '-' : v; } catch { return '-'; } };
  const cols = [
    ['piece', (r) => r.piece], ['run', runOf], ['rev', (r) => (r.sha ? r.sha.slice(0, 7) : 'tree')], ['s', (r) => r.range.seconds], ['notes/s R/L', (r) => r.notesPerSec.join('/')],
    ['unplayed %', (r) => r.notes.total.pct], ['gap p5/p50/p95', (r) => { const g = r.contact.total.gap; return `${g.p5}/${g.p50}/${g.p95}`; }],
    ['float/sink', (r) => `${r.contact.total.floating}/${r.contact.total.sinking}`], ['off key', (r) => r.contact.total.offKey + r.contact.total.offKeyLength],
    ['IK miss p95/max', (r) => `${r.contact.total.ikMiss.p95}/${r.contact.total.ikMiss.max}`],
    ['L origin acc p95', (r) => r.smooth.perHand[1].origin.acc.p95], ['L origin jerk p99', (r) => r.smooth.perHand[1].origin.jerk.p99],
    ['tip jerk p99 R/L', (r) => r.smooth.perHand.map((s) => s.tips.jerk.p99).join('/')], ['jolts O+W R/L', (r) => r.smooth.perHand.map((s) => s.origin.jolts + s.wrist.jolts).join('/')],
    ['tip jolts/min R/L', (r) => r.smooth.perHand.map((s) => s.tips.joltsPerMin).join('/')],
    ['joint out %ff R/L', (r) => r.plausibility.perHand.map((p) => r3(Object.values(p.joints).reduce((s, j) => s + j.out, 0) / Math.max(1, r.frames * 5) * 100, 1)).join('/')],
    ['finger ovl fr R/L', (r) => r.plausibility.perHand.map((p) => p.fingerOverlap.frames).join('/')],
    ['key pen fr R/L', (r) => r.plausibility.perHand.map((p) => p.keyPenetration.frames).join('/')],
    ['hands ovl fr', (r) => r.plausibility.handsOverlap.frames], ['runtime s', (r) => r.runtimeSec],
  ];
  L.push(`| ${cols.map((c) => c[0]).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`);
  for (const r of runs) L.push(`| ${cols.map((c) => cell(r, c[1])).join(' | ')} |`);
  // version 2 metrics ('-' for runs made before them)
  const v2 = (fn) => (r) => (r.metricsVersion >= 2 ? fn(r) : null);
  const rr = (x) => (x ? `${x.p1}/${x.p99}` : '-');
  const cols2 = [
    ['piece', (r) => r.piece], ['run', runOf], ['rev', (r) => (r.sha ? r.sha.slice(0, 7) : 'tree')],
    ['createHands ms', v2((r) => r.createHandsMs)],
    ['move-norm. jolts O+W /min R/L', v2((r) => r.moveJolts.perHand.map((m) => m.originPlusWristPerMin).join('/'))],
    ['O jolts R/L (frames)', v2((r) => r.moveJolts.perHand.map((m) => m.origin.jolts).join('/'))],
    ['tip jolts outside impacts /min R/L', v2((r) => r.tipJoltsOutsideImpacts.perHand.map((t) => t.joltsPerMin).join('/'))],
    ['IK contact p50/p95', v2((r) => `${r.pressPhases.total.ikAtContact.p50}/${r.pressPhases.total.ikAtContact.p95}`)],
    ['IK release p50/p95', v2((r) => `${r.pressPhases.total.ikAtRelease.p50}/${r.pressPhases.total.ikAtRelease.p95}`)],
    ['gap descent / bottom p50', v2((r) => `${r.pressPhases.total.gapAtDescent.p50}/${r.pressPhases.total.gapAtBottom.p50}`)],
    ['reached %', v2((r) => r.pressPhases.total.reached.pctOfPresses)],
    ['reached gap p50 / float% / sink%', v2((r) => { const x = r.pressPhases.total.reached; return `${x.gap.p50 ?? '-'}/${x.floatingPct}/${x.sinkingPct}`; })],
    ['reached abs gap desc/bottom p95', v2((r) => { const x = r.pressPhases.total.reached; return `${x.absGapAtDescentP95 ?? '-'}/${x.absGapAtBottomP95 ?? '-'}`; })],
    ['outside window >0.3/>1 R/L', v2((r) => (r.pressesOutsideWindow ? r.pressesOutsideWindow.perHand.map((w) => `${w.over03}/${w.over10}`).join(' ') : 'n/a'))],
    ['planned anchor outside >0.3/>1 R/L', v2((r) => (r.pressesOutsideWindowPath ? r.pressesOutsideWindowPath.perHand.map((w) => `${w.over03}/${w.over10}`).join(' ') : 'n/a'))],
    ['key down, no fingertip R/L', v2((r) => (r.keyNoFinger ? r.keyNoFinger.perHand.map((k) => k.count).join('/') : 'n/a'))],
    ['roll p1/p99 R/L', v2((r) => r.poseRanges.perHand.map((p) => rr(p.rollDeg)).join(' '))],
    ['pitch p1/p99 R/L', v2((r) => r.poseRanges.perHand.map((p) => rr(p.pitchDeg)).join(' '))],
    ['ulnar p1/p99 R/L', v2((r) => r.poseRanges.perHand.map((p) => rr(p.ulnarDeg)).join(' '))],
  ];
  L.push('', `| ${cols2.map((c) => c[0]).join(' | ')} |`, `|${cols2.map(() => '---').join('|')}|`);
  for (const r of runs) L.push(`| ${cols2.map((c) => cell(r, c[1])).join(' | ')} |`);
  fs.writeFileSync(md, L.join('\n') + '\n');
  console.log(L.join('\n'));
}

// ------------------------------------------------------------------------------------------------ --mirror
// A synthetic two-track piece (30 s, right hand around C6) whose left hand plays the mirror image p -> 124 - p (around
// E2) at exactly the same times and velocities. The keyboard is symmetric about D4 (KX[124 - p] = 2 KX[62] - KX[p],
// whites to whites, blacks to blacks), so a hand model with no left/right bias gives a left hand that is the mirror image
// (x -> 2 KX[62] - x) of the right hand at every frame. Reported: the largest distance between them (joints, origin,
// wrist, elbow), the angle mismatches (yaw should flip sign; pitch, roll and fan should be equal), and the presses whose
// finger, time or release differ between the hands.
function mirrorPiece() {
  const R = []; let t = 0.5;
  const seq = (items, rate, legato, vel) => { items.forEach((it, k) => { for (const p of [].concat(it)) R.push({ pitch: p, onset: t + k / rate, dur: legato / rate, vel }); }); t += items.length / rate; };
  const five = [84, 86, 88, 89, 91, 89, 88, 86], oct = [72, 74, 76, 77, 79, 81, 83, 84];
  seq([...five, ...five, 84], 4, 0.9, 0.5); t += 1.4;                                          // five-finger run C6-G6, 4 notes/s
  seq([...five, ...five, ...five, 84], 10, 0.9, 0.7); t += 1.4;                                // the same at 10 notes/s
  seq([[84, 88, 91], [86, 90, 93], [88, 92, 95], [89, 93, 96], [91, 95, 98], [89, 93, 96], [88, 92, 95], [86, 90, 93], [84, 88, 91]], 2, 0.85, 0.6); t += 1.4; // triads (D, E major: black keys)
  seq([...oct, ...oct.slice(0, -1).reverse()].map((p) => [p, p + 12]), 8, 0.8, 0.8); t += 1.4; // octave run C5/C6-C6/C7, 8/s
  seq([72, 96, 72, 96, 72], 2.5, 0.75, 0.9); t += 1.4;                                         // two-octave leaps C5-C7
  seq(Array.from({ length: 24 }, (_, k) => (k % 2 ? 88 : 86)), 12, 0.9, 0.45); t += 1.4;       // trill D6-E6, 12 notes/s
  seq(Array(20).fill(91), 10, 0.6, 0.65); t += 1.0;                                            // repeated G6, 10/s
  for (const p of [84, 88, 91]) R.push({ pitch: p, onset: t, dur: Math.max(0.5, 30 - t), vel: 0.5 });   // last chord, to 30 s
  const notes = [];
  for (const n of R) for (const [track, pitch] of [[0, n.pitch], [1, 124 - n.pitch]]) notes.push({ pitch, name: pname(pitch), onset: n.onset, dur: n.dur, vel: n.vel, track, end: n.onset + n.dur });
  notes.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
  return { source: 'hand-metrics --mirror', duration: Math.max(...notes.map((n) => n.end)), tracks: 2, tempoMap: [{ time: 0, bpm: 120 }], notes, pedal: [] };
}
function runMirror() {
  // (the black keys' shifts, as the main run reads them from keys.js)
  const kSrc = fs.existsSync(keysFile) ? fs.readFileSync(keysFile, 'utf8') : '', mB = kSrc.match(/BLACK_SHIFT = \[([^\]]*)\]/), aB = mB ? mB[1].split(',').map(Number) : [];
  const LM = handsMod.KEY_LAYOUTS ? handsMod.KEY_LAYOUTS[args.keys || 'piano'] : null;
  const BLACK_SHIFT_M = LM ? LM.shift : aB.length === 12 && aB.every(Number.isFinite) ? aB : new Array(12).fill(0);
  const DEG = 180 / Math.PI;   // (local: runMirror runs before the module-level constants further down are set)
  const blk = (p) => [1, 3, 6, 8, 10].includes(p % 12);
  const KXm = new Float64Array(128); { let n = 0; for (let p = 21; p <= 108; p++) { KXm[p] = (blk(p) ? n - 0.5 + BLACK_SHIFT_M[p % 12] : n) - 25.5; if (!blk(p)) n++; } }
  const C2 = 2 * KXm[62];
  let keyboardSymmetryError = 0;
  for (let p = 124 - 108; p <= 108; p++) if (p >= 21 && 124 - p >= 21 && 124 - p <= 108) { keyboardSymmetryError = Math.max(keyboardSymmetryError, Math.abs(KXm[124 - p] - (C2 - KXm[p]))); if (blk(p) !== blk(124 - p)) keyboardSymmetryError = Infinity; }
  const piece = mirrorPiece();
  const handOfM = (n) => (n.track === 0 ? 0 : 1);
  const tP = performance.now();
  const H = handsMod.createHands(piece, handOfM, POSTURE_OPT);
  const cMs = performance.now() - tP;
  const v3 = (v) => [v.x, v.y, v.z], mir = (v) => [C2 - v.x, v.y, v.z];
  const t0 = Math.min(...piece.notes.map((n) => n.onset)) - 0.3, t1 = Math.max(...piece.notes.map((n) => n.onset + n.dur)) + 0.3;
  const N = Math.floor((t1 - t0) * FPS) + 1;
  const mx = { joints: 0, origin: 0, wrist: 0, elbow: 0 }, ang = { yawSum: 0, pitch: null, roll: null, fan: null };
  let framesOver = 0, minGap = Infinity; const perFrame = [];
  for (let i = 0; i < N; i++) {
    const t = t0 + i / FPS, P = H.pose(t), Rh = P[0], Lh = P[1];
    minGap = Math.min(minGap, Rh.O.x - Lh.O.x);
    let fe = 0, fw = '';
    for (let f = 0; f < 5; f++) for (let j = 0; j < 4; j++) { const e = dist3(v3(Rh.joints[f][j]), mir(Lh.joints[f][j])); if (e > fe) { fe = e; fw = `finger ${f + 1} joint ${j}`; } }
    const eO = dist3(v3(Rh.O), mir(Lh.O)), eW = dist3(v3(Rh.wrist), mir(Lh.wrist)), eE = Rh.elbow && Lh.elbow ? dist3(v3(Rh.elbow), mir(Lh.elbow)) : 0;
    mx.joints = Math.max(mx.joints, fe); mx.origin = Math.max(mx.origin, eO); mx.wrist = Math.max(mx.wrist, eW); mx.elbow = Math.max(mx.elbow, eE);
    if (Number.isFinite(Rh.yaw) && Number.isFinite(Lh.yaw)) ang.yawSum = Math.max(ang.yawSum, Math.abs(Rh.yaw + Lh.yaw) * DEG);
    for (const k of ['pitch', 'roll', 'fan']) if (Number.isFinite(Rh[k]) && Number.isFinite(Lh[k])) ang[k] = Math.max(ang[k] ?? 0, Math.abs(Rh[k] - Lh[k]) * (k === 'fan' ? 1 : DEG));
    const worstHere = Math.max(fe, eO, eW, eE);
    if (worstHere > 1e-6) framesOver++;
    perFrame.push([t, worstHere, fe >= Math.max(eO, eW, eE) ? fw : eO >= Math.max(eW, eE) ? 'origin' : eW >= eE ? 'wrist' : 'elbow']);
  }
  const maxError = Math.max(mx.joints, mx.origin, mx.wrist, mx.elbow);
  perFrame.sort((a, b) => b[1] - a[1]);
  const worstFrames = [];
  for (const p of perFrame) { if (p[1] <= 1e-6 || worstFrames.length >= TOP) break; if (worstFrames.every((w) => Math.abs(w.t - p[0]) >= 0.25)) worstFrames.push({ t: r3(p[0]), error: Number(p[1].toPrecision(3)), where: p[2] }); }
  // the fingering and the press timing, finger by finger
  let presses = 0, mismatched = 0; const firstMismatches = [];
  for (let f = 0; f < 5; f++) {
    const L = new Map(H.plan[1].presses[f].map((p) => [`${p.on}|${124 - p.pitch}`, p])), used = new Set();
    for (const p of H.plan[0].presses[f]) {
      presses++;
      const q = L.get(`${p.on}|${p.pitch}`);
      const bad = !q || ['off', 'tc', 'onKey', 'd', 'ride'].some((k) => (p[k] ?? 0) !== (q[k] ?? 0) && Math.abs((p[k] ?? 0) - (q[k] ?? 0)) > 1e-9);
      if (q) used.add(q);
      if (bad) { mismatched++; if (firstMismatches.length < TOP) firstMismatches.push({ t: r3(p.on), right: `${fname(0, f)} ${pname(p.pitch)}`, left: q ? `${fname(1, f)} ${pname(q.pitch)} (timing differs)` : 'another finger' }); }
    }
    mismatched += H.plan[1].presses[f].filter((q) => !used.has(q)).length;
  }
  const unplayed = [0, 1].map((h) => piece.notes.filter((n) => handOfM(n) === h && !H.played.has(n)).length);
  const pass = maxError <= 1e-6;
  const res = {
    tool: 'hand-metrics', mode: 'mirror', metricsVersion: 2, rev: args.rev || null, sha: tree.sha, posture: args.posture || null, fps: FPS, range: { from: r3(t0), to: r3(t1) }, frames: N,
    notesPerHand: piece.notes.length / 2, createHandsMs: r3(cMs, 1), keyboardSymmetryError, minOriginGap: r3(minGap, 2),
    maxError: Number(maxError.toPrecision(4)), maxErrorBy: Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, Number(v.toPrecision(4))])),
    angleMismatchDeg: { yawSum: Number(ang.yawSum.toPrecision(4)), pitch: ang.pitch == null ? null : Number(ang.pitch.toPrecision(4)), roll: ang.roll == null ? null : Number(ang.roll.toPrecision(4)), fanUnits: ang.fan == null ? null : Number(ang.fan.toPrecision(4)) },
    framesOver1e6: framesOver, worstFrames,
    fingering: { presses, mismatched, firstMismatches }, unplayed,
    threshold: 1e-6, pass, note: 'required from S3 on; before that it only reports (fingering ties may break the symmetry)',
  };
  console.log(`hand-metrics --mirror: ${tree.sha ? `rev ${tree.sha.slice(0, 10)}` : 'working tree'}; synthetic piece ${r3(t0 + 0.3, 2)}..${r3(t1 - 0.3, 2)} s, ${res.notesPerHand} notes per hand; ${N} frames at ${FPS} fps; createHands ${cMs.toFixed(1)} ms`);
  console.log(`  keyboard symmetry about D4: max error ${keyboardSymmetryError}; the hands' origins stay ${minGap.toFixed(2)} or more apart`);
  console.log(`  left hand vs mirror image of the right: max error ${maxError.toExponential(3)} units (joints ${mx.joints.toExponential(2)}, origin ${mx.origin.toExponential(2)}, wrist ${mx.wrist.toExponential(2)}, elbow ${mx.elbow.toExponential(2)}); frames over 1e-6: ${framesOver} of ${N}`);
  console.log(`  angles: |yaw_R + yaw_L| max ${ang.yawSum.toExponential(2)} deg${['pitch', 'roll'].map((k) => (ang[k] == null ? '' : `, |${k}_R - ${k}_L| max ${ang[k].toExponential(2)} deg`)).join('')}${ang.fan == null ? '' : `, |fan_R - fan_L| max ${ang.fan.toExponential(2)}`}`);
  console.log(`  fingering: ${mismatched} of ${presses} presses differ between the hands; unplayed R/L ${unplayed.join('/')}`);
  for (const m of firstMismatches) console.log(`    ${m.t.toFixed(3)} s  ${m.right}: left hand ${m.left}`);
  if (worstFrames.length) console.log(`  worst moments: ${worstFrames.map((w) => `${w.t} s ${w.error} (${w.where})`).join('; ')}`);
  console.log(`  ${pass ? 'PASS' : 'OVER'} (threshold 1e-6; ${res.note})`);
  if (args.json) { fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true }); fs.writeFileSync(args.json, JSON.stringify(res, null, 1)); console.log(`  wrote ${args.json}`); }
  if (args.strict && !pass) process.exitCode = 1;
}
