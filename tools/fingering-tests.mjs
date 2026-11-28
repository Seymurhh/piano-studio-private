#!/usr/bin/env node
// Fingering suite for the Keys hands (FINAL-SPEC S3.3): the 17 cases of the FM2 prototype
// (tools/out/hands-design/fingering-scripts/fm2.mjs --tests) and its whole-piece statistics (--stats), run against the
// app's own assets/js/fingering.js, with the options hands.js gives it (this rig's forward needs). Plain Node, no installs.
//
//   node tools/fingering-tests.mjs                       the 17 cases (14 synthetic, 3 library passages with edition fingerings)
//   node tools/fingering-tests.mjs --stats [a,b,c]       per piece and hand: position changes per second and more, against
//                                                        the FM2 prototype's values (design-fingering.md section 4.7)
//   node tools/fingering-tests.mjs --piece <name> [--hand R|L] [--from s] [--to s]     print a passage's fingering
//   node tools/fingering-tests.mjs --trace <name> <R|L> <from> <to>                    which costs decide a passage
//   --json <file>   also write the results as JSON
//
// Fingers are printed as pianists number them: 1 = thumb .. 5 = little finger; chord fingers from low to high.
// Exit code 1 if fewer than 13 of the 17 cases match a standard fingering (the S3 acceptance).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// (the app's own module instances: the fingering.js that hands.js imports, with the options hands.js gives it; fetch() for file:
// URLs, which handmesh.js uses to load the hand model)
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { const url = new URL(String(u?.url ?? u)); if (url.protocol !== 'file:') return realFetch(u, o); url.search = ''; url.hash = ''; try { return new Response(fs.readFileSync(fileURLToPath(url)), { status: 200 }); } catch { return new Response('', { status: 404 }); } };
const HS = await import(pathToFileURL(path.join(APP, 'assets/js/hands.js')).href);
const hsSrc = fs.readFileSync(path.join(APP, 'assets/js/hands.js'), 'utf8'), fgSpec = (hsSrc.match(/from '(\.\/fingering\.js[^']*)'/) || [])[1] || './fingering.js';
const FG = await import(new URL(fgSpec, pathToFileURL(path.join(APP, 'assets/js/hands.js'))).href);
const RIG = HS.fingeringOptions ? HS.fingeringOptions() : {};
const { parseMidi, noteName } = await import(pathToFileURL(path.join(APP, 'assets/js/midi.js')).href + '?v=13');
const { eventsOf, fingerHand, planFingering, setTrace, KX } = FG;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const A0 = 21, C8 = 108;
const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);
function loadPiece(name) {
  const f = fs.existsSync(name) ? name : path.join(APP, 'assets/music', name.replace(/\.smf$/, '') + '.smf');
  const buf = fs.readFileSync(f);
  return parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const handOfFor = (piece) => (n) => (piece.tracks === 1 ? (n.pitch < 60 ? 1 : 0) : (n.track === 0 ? 0 : 1));
const planPiece = (piece) => planFingering(piece.notes.filter((n) => n.pitch >= A0 && n.pitch <= C8), handOfFor(piece), RIG);
const nm = (p) => noteName(p).replace('♯', '#').replace('♭', 'b');
function fingString(ev, from, to) {
  return ev.filter((e) => e.t >= from && e.t <= to).map((e) => e.notes.map((n, j) => `${nm(n.pitch)}(${e.fs[j] + 1})`).join('+') + `@${e.anchor}${e.post !== 'N' ? ' ' + e.post : ''}`).join(' ');
}
const out = { tool: 'fingering-tests', cases: [], stats: null };

// ---------------------------------------------------------------- the 17 cases (fm2.mjs --tests, unchanged)
function runTests() {
  const mk = (pitches, ioi, dur = 0.9) => pitches.map((p, i) => (Array.isArray(p) ? p : [p]).map((q) => ({ pitch: q, onset: i * ioi, dur: ioi * dur, vel: 0.7 }))).flat();
  const C = [0, 2, 4, 5, 7, 9, 11], scale = (root, oct, dir = 1) => { const o = []; for (let k = 0; k < oct; k++) for (const s of C) o.push(root + 12 * k + s); o.push(root + 12 * oct); return dir > 0 ? o : o.reverse(); };
  const ebScale = (root, oct) => { const o = []; for (let k = 0; k < oct; k++) for (const s of C) o.push(root + 12 * k + s); o.push(root + 12 * oct); return o; };
  // [name, side, pitches, ioi, accepted fingerings (standard teaching fingerings; '*' = any that never repeats a finger)]
  const T = [
    ['RH C major scale up+down 2 oct, 8/s', 1, [...scale(60, 2), ...scale(60, 2, -1).slice(1)], 0.125, ['12312341231234543213214321321', '12312341231234543214321321321']],
    ['LH C major scale up+down 2 oct, 8/s', -1, [...scale(36, 2), ...scale(36, 2, -1).slice(1)], 0.125, ['54321321432132123123412312345', '54321432132132123123412312345', '54321432132132123412312312345']],
    ['RH E-flat major scale up 2 oct, 10/s', 1, ebScale(63, 2), 0.1, ['312341231234123', '212341231234123']],
    ['RH C major arpeggio up 2 oct, 8/s', 1, [60, 64, 67, 72, 76, 79, 84], 0.125, ['1231235', '1241245']],
    ['LH C major arpeggio up 2 oct, 8/s', -1, [36, 40, 43, 48, 52, 55, 60], 0.125, ['5421421', '5321321']],
    ['RH chromatic scale up, 10/s', 1, Array.from({ length: 13 }, (_, i) => 60 + i), 0.1, ['1313123131312', '1313123131313', '*']],
    ['RH repeated note, 10/s', 1, Array(8).fill(67), 0.1, ['*']],
    ['RH repeated note, 2/s', 1, Array(4).fill(67), 0.5, ['1111', '2222', '3333', '4444', '5555']],
    ['RH trill C-D, 12/s', 1, Array.from({ length: 12 }, (_, i) => (i % 2 ? 74 : 72)), 0.083, ['232323232323', '131313131313', '121212121212']],
    ['LH broken octaves C-C, 10/s', -1, Array.from({ length: 8 }, (_, i) => (i % 2 ? 48 : 36)), 0.1, ['51515151']],
    ['LH octaves descending, 10.7/s', -1, [[47, 59], [43, 55], [41, 53], [38, 50], [35, 47], [36, 48]], 0.094, ['51 51 51 51 51 51', '41 51 41 51 51 41', '51 41 51 41 51 41']],
    ['LH Alberti bass C-G-E-G, 8/s', -1, [48, 55, 52, 55, 48, 55, 52, 55], 0.125, ['51315131']],
    ['RH chords C-F-G-C (triads)', 1, [[60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 64, 67, 72]], 0.5, ['135 135 125 1235', '125 135 124 1235', '135 135 124 1235', '124 135 124 1235']],
    ['LH Revolutionary main figure (C2..Eb4 and back), 10.67/s', -1, [36, 43, 48, 50, 51, 55, 60, 62, 63, 62, 60, 55, 51, 50, 48, 43, 36], 0.0937, ['52132132123123125', '52143213231243125', '52132132123124125']],
  ];
  let ok = 0;
  for (const [name, side, ps, ioi, accept] of T) {
    const ev = eventsOf(mk(ps, ioi), side);
    fingerHand(ev, side, RIG.zneed || undefined);
    const got = ev.map((e) => e.fs.map((f) => f + 1).join('')).join(ev.some((e) => e.notes.length > 1) ? ' ' : '');
    const norep = ev.every((e, i) => !i || e.fs.join() !== ev[i - 1].fs.join());
    const pass = accept.includes(got) || (accept.includes('*') && norep);
    if (pass) ok++;
    out.cases.push({ name, pass, got, accepted: accept });
    console.log(`\n${pass ? 'PASS' : 'MISS'}  ${name}\n  got      ${got}\n  accepted ${accept.join(' | ')}\n  ` + fingString(ev, -1, 1e9));
  }
  // passages of the library with well-known edition fingerings
  const S = [
    ['beethoven-fur-elise', 0, 0.0, 1.75, ['545452431']],
    ['chopin-fantaisie-impromptu', 0, 5.8, 7.06, ['232124542321235']],
    ['mozart-rondo-alla-turca', 0, 0.0, 0.62, ['43235']],
  ];
  for (const [pc, h, a, b, accept] of S) {
    const P = planPiece(loadPiece(pc)), ev = P.hands[h].events.filter((e) => e.t >= a && e.t <= b);
    const got = ev.map((e) => e.fs.map((f) => f + 1).join('')).join('');
    const pass = accept.some((x) => got.startsWith(x));
    if (pass) ok++;
    out.cases.push({ name: `${pc} ${h ? 'L' : 'R'} ${a}-${b} s`, pass, got, accepted: accept });
    console.log(`\n${pass ? 'PASS' : 'MISS'}  ${pc} ${h ? 'L' : 'R'} ${a}-${b} s\n  got      ${got}\n  edition  ${accept.join(' | ')}\n  ` + fingString(P.hands[h].events, a, b));
  }
  const total = T.length + S.length;
  console.log(`\n${ok} of ${total} match a standard fingering (S3 acceptance: at least 13)`);
  out.passed = ok; out.total = total;
  return ok;
}

// ---------------------------------------------------------------- whole pieces (fm2.mjs --stats)
// FM2 prototype's position changes per second (design-fingering.md section 4.7), the S3 limit is 1.1 times these
const FM2_REF = {
  'chopin-revolutionary-etude': [1.23, 4.07], 'chopin-fantaisie-impromptu': [2.07, 1.86], 'chopin-etude-op25-no1': [3.67, 4.10],
  'mozart-rondo-alla-turca': [2.11, null], 'beethoven-moonlight-sonata-3': [1.99, 1.45], 'beethoven-fur-elise': [1.06, null],
};
function summarize(ev) {
  const fcount = [0, 0, 0, 0, 0]; let notes = 0, tb = 0, sameFast = 0, repSameFast = 0, changes = 0, travel = 0, vmax = 0, thumbs = 0;
  const cls = { N: 0, F: 0, S: 0, TB: 0, LB: 0 };
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]; cls[e.post]++;
    e.notes.forEach((n, j) => { const f = e.fs[j]; fcount[f]++; notes++; if (f === 0) { thumbs++; if (isBlack(n.pitch)) tb++; } });
    if (i) {
      const p = ev[i - 1], dt = e.t - p.t, d = Math.abs(e.anchor - p.anchor);
      if (d > 0.26) changes++;
      travel += d; if (dt > 0.02) vmax = Math.max(vmax, d / dt);
      e.notes.forEach((n, j) => p.notes.forEach((pn, q) => { if (p.fs[q] === e.fs[j]) { if (pn.pitch !== n.pitch && dt < 0.25 && e.notes.length === 1 && p.notes.length === 1) sameFast++; if (pn.pitch === n.pitch && dt < 0.16) repSameFast++; } }));
    }
  }
  const dur = ev.length ? ev[ev.length - 1].t - ev[0].t : 1;
  return { events: ev.length, notes, 'f1..f5 %': fcount.map((c) => Math.round((100 * c) / Math.max(1, notes))).join('/'), 'thumb on black %': +(100 * tb / Math.max(1, thumbs)).toFixed(1),
    'pos changes/s': +(changes / dur).toFixed(2), 'anchor travel/s': +(travel / dur).toFixed(2), 'max step speed': +vmax.toFixed(0), 'same finger <0.25s (single notes)': sameFast, 'fast repeat same finger': repSameFast,
    'classes N/F/S/TB/LB': `${cls.N}/${cls.F}/${cls.S}/${cls.TB}/${cls.LB}` };
}
function runStats(list) {
  const rows = []; let over = 0;
  for (const name of list) {
    const piece = loadPiece(name);
    const t0 = performance.now(); const P = planPiece(piece); const ms = performance.now() - t0;
    for (const h of [0, 1]) {
      const H = P.hands[h], s = summarize(H.events);
      const dropped = H.events.reduce((a, e) => a + (e.dropped ? e.dropped.length : 0), 0);
      const ref = (FM2_REF[name] || [])[h];
      const okPc = ref == null || s['pos changes/s'] <= 1.1 * ref + 1e-9;
      if (!okPc) over++;
      rows.push({ piece: `${name} ${h ? 'L' : 'R'}`, ...s, 'FM2 ref': ref ?? '-', 'pc <= 1.1 ref': ref == null ? '-' : okPc ? 'yes' : 'NO', dropped, stretched: H.stats.stretched, rescuedIn: '', ms: h ? '' : +ms.toFixed(0) });
    }
    rows[rows.length - 2].rescuedIn = P.stats.rescued;
  }
  console.table(rows);
  out.stats = rows;
  return over;
}

// ---------------------------------------------------------------- main
if (args.includes('--trace')) {
  const i = args.indexOf('--trace'), [name, hand, from, to] = args.slice(i + 1, i + 5);
  setTrace(true);
  const P = planPiece(loadPiece(name)), ev = P.hands[hand === 'L' ? 1 : 0].events;
  for (const e of ev.filter((q) => q.t >= +from && q.t <= +to)) console.log(`${e.t.toFixed(3)}  ${e.notes.map((n, j) => `${nm(n.pitch)}(${e.fs[j] + 1})`).join('+')} @${e.anchor} ${e.post}  cum ${e.cum?.toFixed(2)}  ${JSON.stringify(Object.fromEntries(Object.entries(e.parts || {}).map(([k, v]) => [k, +v.toFixed(2)])))}`);
  process.exit(0);
}
if (opt('piece')) {
  const P = planPiece(loadPiece(opt('piece'))), from = +opt('from', 0), to = +opt('to', 5);
  for (const h of opt('hand', 'R,L').split(',')) console.log(`\n${h} ${from}-${to} s:\n  ` + fingString(P.hands[h === 'L' ? 1 : 0].events, from, to));
  console.log('\nstats', JSON.stringify(P.stats));
  process.exit(0);
}
let code = 0;
if (args.includes('--stats')) {
  const v = opt('stats'), list = v && !v.startsWith('--') ? v.split(',') : Object.keys(FM2_REF);
  const over = runStats(list);
  console.log(over ? `${over} hand(s) above 1.1 x the FM2 prototype's position changes per second` : 'position changes per second: every hand within 1.1 x the FM2 prototype');
} else if (runTests() < 13) code = 1;
if (opt('json')) { fs.mkdirSync(path.dirname(path.resolve(opt('json'))), { recursive: true }); fs.writeFileSync(opt('json'), JSON.stringify(out, null, 1)); }
process.exit(code);
