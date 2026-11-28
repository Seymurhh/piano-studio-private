// Fingering for the Keys hands (FINAL-SPEC S3): which finger of which hand plays each note, and where the hand is meant
// to be for it. A joint Viterbi over (fingering, hand anchor) per event ("FM2", tools/out/hands-design/design-fingering.md
// section 4, ported from fingering-scripts/fm2.mjs with Parncutt's span table PST unchanged and its weights W but three
// (below)), with the reach bands measured on this rig and four posture classes (S3.2), and a small rescue that gives the
// other hand a note its own hand cannot play (S3.4). Imports only midi.js, so Node can load it directly
// (tools/fingering-tests.mjs). Measured corrections to the spec are explained where they are made (OPT, rescueLeaps).
//
// Units: one white key width; x across the keyboard (KX[pitch]); seconds of music.
// Each hand is worked out in its own lateral coordinate u: the right hand's is x, the left hand's the mirror image of x
// about D4 (2 KX[62] - x: whites map to whites and blacks to blacks). Inside, both hands then run the same code with the
// thumb toward lower u, and ties break the same way for both, so a left hand that plays the mirror image of the right
// hand gets the mirror image of its fingering exactly (the mirror test, S0).
import { isBlack } from './midi.js?v=13';

const A0 = 21, C8 = 108;
// The keyboard's layouts (the studio's "Black keys" setting; shared by keys.js and hands.js): where each black key sits
// from the boundary of its two white keys (by pitch class) and how wide it is.
// - 'piano': as on a real piano, spread a little within each group (C sharp and D sharp 0.085 out from their boundaries,
//   F sharp and A sharp 0.125 out, G sharp centred) and 0.5 wide (a real one is about 0.42 across its top and 0.57 at its
//   foot), so the white keys' narrow parts between them are all 0.6-0.67 wide;
// - 'even': on the white keys' boundaries, 0.56 wide (the keyboard before the setting): the narrow parts of C, E, F and B
//   0.69 wide, of D, G and A 0.44, narrower than a fingertip.
// Both are mirror-symmetric about D (the mirror test). setKeyLayout(id) fills KX in place for that layout.
export const KEY_LAYOUTS = {
  piano: { shift: [0, -0.085, 0, 0.085, 0, 0, -0.125, 0, 0, 0, 0.125, 0], blackW: 0.5 },
  even: { shift: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], blackW: 0.56 },
};
export const KEY_LAYOUT_DEFAULT = 'piano';
export const KX = new Array(128).fill(0);
export function setKeyLayout(id) {
  const L = KEY_LAYOUTS[id] || KEY_LAYOUTS[KEY_LAYOUT_DEFAULT];
  for (let p = A0, n = 0; p <= C8; p++) { KX[p] = (isBlack(p) ? n - 0.5 + L.shift[p % 12] : n) - 25.5; if (!isBlack(p)) n++; }
  return L;
}
setKeyLayout(KEY_LAYOUT_DEFAULT);
const BLK = Array.from({ length: 128 }, (_, p) => isBlack(p));
const MIR = 2 * KX[62];
const uOf = (side, x) => (side > 0 ? x : MIR - x);          // world x <-> the hand's lateral coordinate (its own inverse)

// ---------------------------------------------------------------- the hand (FINAL-SPEC B3, S3.2)
// fingertip lateral rest places from the middle finger, thumb to little finger (five adjacent white keys)
export const REST = [-2.35, -1.12, 0, 1.02, 2.0];
// Practical reach of each fingertip from its rest place, by posture class: delta = u - REST[f], + toward the little finger.
// FM2's own bands intersected with what this rig reaches (FINAL-SPEC A2.4, S3.2):
//   N  normal posture;
//   F  the hand 0.6 further in (the thumb reaches 0.7 further out);
//   S  spread: low, turned 10 deg toward the little finger, the little finger fanned out (octaves; span 7.2 + slack);
//   TB the thumb on a black key (the hand far in: the thumb reaches only inward of its rest place);
//   LB the little finger on a black key (the hand 0.85 in: F's reach).
export const BANDS = {
  N: [[-0.10, 2.40], [-1.20, 0.60], [-0.60, 0.60], [-0.50, 0.70], [-0.40, 0.70]],
  F: [[-0.80, 2.40], [-1.20, 0.60], [-0.60, 0.60], [-0.50, 0.70], [-0.40, 0.75]],
  S: [[-1.40, 1.00], [-1.00, 0.60], [-0.60, 0.60], [-0.50, 0.70], [-0.40, 1.40]],
  TB: [[0.15, 2.40], [-1.20, 0.60], [-0.60, 0.60], [-0.50, 0.70], [-0.40, 0.75]],
};
BANDS.LB = BANDS.F;
// comfortable reach (beyond it a state costs 1 per unit), all classes; S has its own for the thumb and little finger
const COMFORT = [[-0.10, 0.90], [-0.60, 0.30], [-0.30, 0.30], [-0.25, 0.40], [-0.20, 0.50]];
const COMFORT_S = [[-1.20, 0.50], [-0.60, 0.30], [-0.30, 0.30], [-0.25, 0.40], [-0.20, 1.20]];
export const COMFORTS = { N: COMFORT, F: COMFORT, TB: COMFORT, LB: COMFORT, S: COMFORT_S };
// how far in (toward the fallboard) the hand must come for each finger to play a black key (FINAL-SPEC B3), and for each
// posture class; the event's need ("zneed") is the larger. (Relative needs, for the cost of the hand pumping in and out;
// hands.js has the rig's own values for the motion.)
export const ZNEED_BLACK = [2.1, 0.3, 0, 0, 0.85];
export const CLASS_Z = { N: 0, F: 0.6, S: 0.8, TB: 2.1, LB: 0.85 };
const CLASS_COST = { F: 0.3, S: 0.6 };      // extra cost of a class tried because the ones before it cannot reach the keys
const SPREAD_MIN = 5.0;                     // S only for events whose thumb-side to little-side extent is at least this
const STRETCH_COST = 20;                    // a chord no class reaches, stretched (within OPT.stretchTol): its least-short fingering

// Parncutt et al. (1997) span table, right hand, semitones: [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
const PST = { '0,1': [-5, -3, 1, 5, 8, 10], '0,2': [-4, -2, 3, 7, 10, 12], '0,3': [-3, -1, 5, 9, 12, 14], '0,4': [-1, 1, 7, 10, 13, 15],
  '1,2': [1, 1, 1, 2, 3, 5], '1,3': [1, 1, 3, 4, 5, 7], '1,4': [2, 2, 5, 6, 8, 10], '2,3': [1, 1, 1, 2, 2, 4], '2,4': [1, 1, 3, 4, 5, 7], '3,4': [1, 1, 1, 2, 3, 5] };
const ST = 0.585;
const PU = Array.from({ length: 5 }, (_, a) => Array.from({ length: 5 }, (_, b) => (a < b ? PST[`${a},${b}`].map((s) => s * ST) : null)));
// Weights ("points"; one point = one Parncutt point): fm2.mjs's, with three retuned for this rig's narrower reach (FINAL-SPEC
// S3 acceptance: "if lower, tune"; F section 4.8; the bands are never widened). With the rig's bands and fm2.mjs's weights
// the suite (tools/fingering-tests.mjs) matches 12 of 17 cases; with these three, 14 (FM2 itself: 14):
// - moveDrift 0.8 -> 2.5: a half-key shift of the whole hand costs more than a finger stretching inside its band;
// - runCross 0.5 -> 0.4: a thumb crossing inside a run is how this hand covers distance (its thumb cannot reach outward);
// - leapfrog 2 -> 3: the same finger on notes 1 and 3 (e.g. 1-4-3-1-3 in the Revolutionary's figure) loses to a crossing.
const W = {
  postureQ: 0.15, postureLin: 1.0, weak4: 0.4, weak5: 0.4, thumbBlack: 1, thumbBlackNb: 2, fiveBlackNb: 2, threeFour: 1, fourOnBlack: 1, thumbPass: 1, thumbPassBad: 3,
  moveCnt: 4.0, moveDrift: 2.5, moveSize: 0.5, moveBreath: 0.35, vScale: 30, forced: 0, leap: 1.0, passDiscount: 0,
  fingerTravel: 2.0, travelFree: 0.5, crossAgain: 7.0, crossWin: 0.5, sameFingerFast: 8, repSameFast: 3, repSameMid: 1, repChangeSlow: 0.8, cut: 3, zPump: 0.6, horizCap: 8, shift: 16, blockMove: 1.0, runCross: 0.4, leapfrog: 3.0, vHard: 35, vHardW: 0.02,
};
export const WEIGHTS = W;
const GRID = 0.5, MAXB = 7;

function combos(k) { const out = []; const rec = (s, acc) => { if (acc.length === k) { out.push(acc.slice()); return; } for (let f = s; f < 5; f++) { acc.push(f); rec(f + 1, acc); acc.pop(); } }; rec(0, []); return out; }
const COMBOS = [null, combos(1), combos(2), combos(3), combos(4), combos(5)];

// pair cost between finger fa at u = xa and finger fb at u = xb (Parncutt rules: Stretch, Small-Span, Large-Span), in the
// hand's own coordinate. Infinity beyond the practical limits (unless soft: between consecutive notes the hand can move).
export function pairCost(fa, xa, ba, fb, xb, bb, soft = false) {
  if (fa === fb) return 0;
  let lo = fa, hi = fb, d = xb - xa;
  if (fa > fb) { lo = fb; hi = fa; d = -d; }
  const T = PU[lo][hi];
  const slack = ba && bb ? 0.1 : ba || bb ? 0.15 : 0.25;          // fingers can use a key's edges (white keys are wide)
  let de = d;
  if (de > T[3]) de = Math.max(T[3], de - slack); else if (de < T[2]) de = Math.min(T[2], de + slack);
  if (!soft && (de > T[5] + 1e-9 || de < T[0] - 1e-9)) return Infinity;
  let c = 0;
  if (de > T[4]) c += 2 * (de - T[4]) / ST; else if (de < T[1]) c += 2 * (T[1] - de) / ST;
  const k = lo === 0 ? 1 : 2;
  if (de > T[3]) c += k * (de - T[3]) / ST; else if (de < T[2]) c += k * (T[2] - de) / ST;
  return c;
}

// each finger's last use along the best path into a state: its deviation from rest and the time
export function memAfter(sp, s, e) {
  const m = sp ? sp.mem.slice() : [null, null, null, null, null];
  e.ns.forEach((n, j) => { const f = s.F[j]; m[f] = { d: e.us[j] - s.a - REST[f], t: e.t, p: n.pitch, k: e.ns.length }; });
  return m;
}
// a thumb pass between two single-note events (the thumb on the far side of the finger before or after it)
export function isCross(sp, s, pe, e) {
  if (pe.ns.length !== 1 || e.ns.length !== 1) return false;
  const pf = sp.F[0], f = s.F[0];
  if (pf !== 0 && f !== 0) return false;
  if (pf === f) return false;
  const px = pe.us[0], x = e.us[0];
  const tx = pf === 0 ? px : x, ox = pf === 0 ? x : px;
  return tx - ox > 0;
}
const nearestIdx = (ns, p) => { let bi = 0; for (let q = 1; q < ns.length; q++) if (Math.abs(ns[q].pitch - p) < Math.abs(ns[bi].pitch - p)) bi = q; return bi; };

// ---------------------------------------------------------------- events
// Notes within 35 ms make one event (a key struck twice in it is one press: the later note is kept in e.dups with the
// note it joins). An event of more than 5 notes keeps the 2 nearest the thumb and the 3 nearest the little finger (the
// right hand's lowest 2 and highest 3); the rest are e.dropped (FINAL-SPEC B2; the rescue runs first).
// (OPT.chain: within 35 ms of the event's latest note, while the event spans at most chainMax s: a rolled chord is one
// hand position. Counted from the first note only, Alla Turca's rolled left-hand chords, A2 C#3 E3 A3 over 41 ms, came
// apart into two events whose hand places were 3.5 keys apart, and the hand jumped between them in 13 ms, the index
// finger dragged 78 deg sideways on E3. It merges 51 of Alla Turca's 533 left-hand events and 30 of Moonlight's 1836
// right-hand ones; none in the other pieces.)
export function eventsOf(notes, side = 1) {
  const ev = [];
  for (const n of notes) {
    const l = ev[ev.length - 1];
    if (l && (n.onset - l.t < 0.035 || (OPT.chain && n.onset - l.last < 0.035 && n.onset - l.t <= OPT.chainMax))) {
      const same = l.notes.find((m) => m.pitch === n.pitch);
      if (same) (l.dups ||= []).push([n, same]); else l.notes.push(n);
      l.last = n.onset;
    } else ev.push({ t: n.onset, last: n.onset, notes: [n] });
  }
  for (const e of ev) {
    e.notes.sort((a, b) => a.pitch - b.pitch);
    if (e.notes.length > 5) {
      const ns = side > 0 ? e.notes : e.notes.slice().reverse();
      e.dropped = ns.slice(2, -3); const keep = new Set([...ns.slice(0, 2), ...ns.slice(-3)]);
      e.notes = e.notes.filter((n) => keep.has(n));
      if (e.dups) e.dups = e.dups.filter(([, m]) => keep.has(m));
    }
  }
  return ev;
}

// Two corrections to S3.2, each measured (tools/out/hands-design/step-3.md):
// - slack: a window allows a key to be struck a little off its centre (FINAL-SPEC B3's key-width slack for windows, at the
//   rig's values: hands.js strikePoint strikes there). Without it, an octave chord of four notes (span exactly 7.0) misses
//   the spread posture by 0.03 and is stretched.
// - figure: an octave broken over notes in turn is played in the spread posture S, as a chord is. S is offered (+0.6) to
//   an event when its notes and those of up to figN events either side within figGap s span SPREAD_MIN or more. Without
//   it, figures such as Op. 25 No. 1's E-flat4 A-flat4 C5 E-flat5 (1 2 4 5) made the hand jump 2.5 keys and back every
//   0.1 s (this hand reaches an octave only spread, FINAL-SPEC A2.4).
// - settle: the hand places along the best path are settled: where consecutive places differ by at most one grid step
//   (settleDrift) and every window of the run shares a point, the whole run gets one place, the mean of theirs kept inside
//   that common part. With this rig's narrow bands, two events in turn often share only a sliver of their windows with no
//   grid point in it (Moonlight's left hand: A-flat2 by 5 in [-10.46, -8.54], A-flat3 by 1 in [-8.81, -6.29]); on the grid
//   the hand stepped half a key back and forth at every note (2.15 position changes per second, FM2 1.45; now 1.17). The
//   fingering itself is unchanged. (Window ends as extra grid places did as well, but then the path chose places where a
//   finger is at the end of its reach, and with the old track's lag Moonlight's little fingers met their keys 0.2 short.)
// - beam: states of the last event whose cost is more than this above its best are not continued (0: off).
// - stretchTol: a chord that no posture class reaches is played stretched (FINAL-SPEC S3.2's stretched state) only while its
//   least-short fingering, with the hand placed so that the largest shortfall is least, leaves no finger more than this
//   beyond its practical band. A wider chord lets go of notes from the thumb's side (inner voices) until one hand position
//   reaches the rest (reduceWide), and they are dropped and counted (stats.wideDropped). Before that, rescueWide gives the
//   other hand the notes on its side of any chord no class reaches, when it can get there. (Stretched across the whole
//   chord, a finger lay up to 8 keys from its key and the key went down with nothing on it: Moonlight 198.38 s, F#1 A1 D2
//   A3 D4 in the left hand, the thumb straight out past the keyboard's front, IK miss 10. 1.2: a tenth, as Moonlight's B3
//   A-flat4 E-flat5, 1.15, is played stretched, the thumb and little finger straight and within half a key of their keys;
//   at 0.7, before rescueWide took stretched chords too, Moonlight dropped 25 notes, 0.51 %.)
// - farV: in rescueWide the other hand may go further than RESCUE.near from where it lazily is, by this speed (units/s: a
//   minimum-jerk move whose peak speed is RESCUE.vCap) times its free time either side beyond RESCUE.clear.
export const OPT = { slack: true, figure: true, figGap: 0.5, figN: 2, settle: true, settleDrift: 0.5, beam: 0, chain: true, chainMax: 0.1, stretchTol: 1.2, farV: 75 };
// how far from a key's centre finger f may strike it (hands.js strikePoint does): the thumb strikes a white key at its centre
export const SLACK = { white: 0.12, black: 0.06, thumbWhite: 0 };
const slackOf = (f, p) => (BLK[p] ? SLACK.black : f === 0 ? SLACK.thumbWhite : SLACK.white);
// the anchors (u of the middle finger's rest place) from which fingers F reach notes ns at us with bands B: [lo, hi]
function windowOf(F, us, B, ns = null) {
  let lo = -Infinity, hi = Infinity;
  for (let a = 0; a < F.length; a++) {
    const f = F[a], r = REST[f], [pl, ph] = B[f], sl = ns && OPT.slack ? slackOf(f, ns[a].pitch) : 0;
    const l = us[a] - r - ph - sl, h = us[a] - r - pl + sl;
    if (l > lo) lo = l; if (h < hi) hi = h;
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- the model
let TRACE = false;
export function setTrace(v) { TRACE = v; }
const addp = (parts, k, v) => { if (parts && v) parts[k] = (parts[k] || 0) + v; return v; };
// the cost of going from state sp (previous event) to state s (this event); the held notes it lets go are left in ctx.cut.
// Every term is >= 0, so it stops (Infinity) as soon as the sum exceeds `bound` (the best so far: the same choice, faster)
export function transCost(sp, s, ctx, parts, bound = Infinity) {
  const { i, t, dt, k, pk, xs, e, pe, trans } = ctx;
  ctx.cut = null;
  let c = sp.cost + addp(parts, 'state', s.sc) + addp(parts, 'fingers', trans(sp, s));
  if (c > bound) return Infinity;
  // hand movement
  const d = Math.abs(s.a - sp.a);
  if (d > 1e-6) {
    let cnt = d <= GRID + 1e-6 ? W.moveDrift : W.moveCnt;
    if (dt >= 0.35) cnt *= W.moveBreath;
    // speed: only the move the two reach windows make unavoidable (the path stage spreads the rest over the notes)
    const dreq = Math.max(0, s.lo - sp.hi, sp.lo - s.hi), v = dreq / dt;
    if (dreq > 0.05 && dt < 0.25) c += addp(parts, 'forced', W.forced);
    c += addp(parts, 'moveCount', cnt) + addp(parts, 'moveSize', W.moveSize * d) + addp(parts, 'moveSpeed', 2 * (v / W.vScale) ** 2 + W.vHardW * Math.max(0, v - W.vHard) ** 2) + addp(parts, 'leap', dreq > 3 ? W.leap : 0);
  }
  if (dt < 0.3) c += addp(parts, 'zPump', W.zPump * Math.abs(s.zneed - sp.zneed));
  if (c > bound) return Infinity;
  // notes still held from before: their fingers are busy, and the hand must stay where it can hold them
  let cut = null;
  const B = BANDS[s.post];
  for (const b of sp.live) {
    const m = s.F.indexOf(b.f);
    let lose = false;
    if (m >= 0) { if (e.ns[m].pitch !== b.p && b.ev < i - 1) lose = true; else continue; }
    else { const dl = b.x - s.a - REST[b.f]; if (dl < B[b.f][0] - 1e-9 || dl > B[b.f][1] + 1e-9) lose = true; }
    if (lose) { c += addp(parts, 'cutHeld', W.cut * Math.min(1, (b.until - t) / 0.3)); (cut ||= []).push(b); }
  }
  ctx.cut = cut;
  if (c > bound) return Infinity;
  // a finger moving sideways relative to the hand (leapfrogging fingers) is slow: Parncutt's position-change rule made physical
  for (let q = 0; q < k; q++) {
    const f = s.F[q], m = sp.mem[f];
    if (!m || t - m.t > 0.6) continue;
    const dl = xs[q] - s.a - REST[f];
    const tr = Math.abs(dl - m.d) - W.travelFree;
    if (tr > 0) c += addp(parts, 'fingerTravel', W.fingerTravel * tr * (t - m.t < 0.3 ? 1 : 0.5));
    // Parncutt's position-change rule for notes 1 and 3 by the same finger (leapfrogging, e.g. 1-2-1 on C-D-E)
    if (k === 1 && pk === 1 && m.k === 1 && m.p !== e.ns[q].pitch && sp.F[0] !== f && t - m.t < 0.4 && pe.t > m.t + 1e-6 && sp.mem.every((o, g) => !o || g === f || g === sp.F[0] || o.t <= m.t + 1e-6)) c += addp(parts, 'leapfrog', W.leapfrog);
  }
  if (t - sp.lastCross < W.crossWin && ctx.single && isCross(sp, s, pe, e)) c += addp(parts, 'crossAgain', W.crossAgain * (1 - (t - sp.lastCross) / W.crossWin));
  return c;
}

// The candidate fingerings of event e (notes in the hand's order, e.ns at u = e.us): monotone (fingers rise with u, so a
// chord never crosses), passing Parncutt's vertical pair rules, each with its posture class and reach window: class N
// (or TB with the thumb on a black key, LB with the little finger on one); if it cannot reach, F (+0.3), then S (+0.6,
// events at least SPREAD_MIN wide). None: the fingering that falls least short, stretched (cost 20, one anchor: where the
// largest shortfall is least), if that shortfall is at most OPT.stretchTol; else none (fingerHand's reduceWide).
function candidates(e, stats, Z) {
  const k = e.ns.length, xs = e.us, bs = e.ns.map((n) => BLK[n.pitch]), extent = xs[k - 1] - xs[0];
  const cands = [];
  for (const F of COMBOS[k]) {
    let vc = 0, ok = true;
    for (let a = 0; a < k && ok; a++) for (let b = a + 1; b < k; b++) {
      if (b !== a + 1 && !(a === 0 && b === k - 1)) continue;
      const pc = pairCost(F[a], xs[a], bs[a], F[b], xs[b], bs[b]);
      if (!isFinite(pc)) { ok = false; break; }
      vc += pc;
    }
    if (!ok) continue;
    const thumbBlack = F[0] === 0 && bs[0], littleBlack = F[k - 1] === 4 && bs[k - 1];
    const wide = Math.max(extent, OPT.figure ? e.figExt || 0 : 0) >= SPREAD_MIN;
    let post = thumbBlack ? 'TB' : littleBlack ? 'LB' : 'N', [lo, hi] = windowOf(F, xs, BANDS[post], e.ns), extra = 0;
    const alt = [];
    if (lo > hi + 1e-9 && post === 'N') { post = 'F'; [lo, hi] = windowOf(F, xs, BANDS.F, e.ns); extra = CLASS_COST.F; }
    if (lo > hi + 1e-9 && wide) { post = 'S'; [lo, hi] = windowOf(F, xs, BANDS.S, e.ns); extra = CLASS_COST.S; }
    else if (OPT.figure && wide && post !== 'S') { const w = windowOf(F, xs, BANDS.S, e.ns); if (w[0] <= w[1] + 1e-9) alt.push(['S', w, CLASS_COST.S]); }
    let rc = vc, cs = 0;
    for (let a = 0; a < k; a++) {
      const f = F[a];
      cs += xs[a] - REST[f];
      const outer = k > 1 && a === k - 1;
      if (f === 3) rc += k === 1 ? W.weak4 : 0.5 * W.weak4;
      if (f === 4) rc += k === 1 ? W.weak5 : outer ? 0 : 0.5 * W.weak5;
      if (f === 0 && bs[a]) rc += W.thumbBlack;
    }
    if (lo <= hi + 1e-9) cands.push({ F, lo, hi, astar: cs / k, rc: rc + extra, post, zneed: zneedOf(F, bs, post, Z) });
    for (const [p2, [l2, h2], x2] of alt) cands.push({ F, lo: l2, hi: h2, astar: cs / k, rc: rc + x2, post: p2, zneed: zneedOf(F, bs, p2, Z) });
  }
  if (!cands.length) {
    // (for each fingering the window of its fingers' bands is empty: the anchor half-way between its two crossing ends
    // leaves the largest shortfall, half their distance, least. The fingering whose shortfall is least, the spread-out one
    // on a tie: Moonlight's B4 A-flat5 B-flat5 B5 is 1 3 4 5, short by 0.55, where 1 2 4 5 was short by 1.1.)
    const post = extent >= SPREAD_MIN ? 'S' : 'N';
    let F = COMBOS[k][0].map((_, j) => (k === 1 ? 2 : Math.round((j * 4) / (k - 1)))), [lo, hi] = windowOf(F, xs, BANDS[post], e.ns);
    for (const G of COMBOS[k]) { const w = windowOf(G, xs, BANDS[post], e.ns); if (w[0] - w[1] < lo - hi - 1e-9) { F = G; [lo, hi] = w; } }
    if ((lo - hi) / 2 <= OPT.stretchTol) {
      const at = (lo + hi) / 2;
      stats.stretched++;
      cands.push({ F, lo: at, hi: at, astar: at, rc: STRETCH_COST, post, zneed: zneedOf(F, bs, post, Z), stretched: true });
    }
  }
  return cands;
}
// the event's forward need: its class's, and each finger's on its key (Z: { black, white } per finger, the rig's own when
// hands.js gives them: the cost of the hand pumping in and out should be what the hand really does)
const ZDEF = { black: ZNEED_BLACK, white: [0, 0, 0, 0, 0] };
function zneedOf(F, bs, post, Z = ZDEF) { let z = CLASS_Z[post]; for (let a = 0; a < F.length; a++) z = Math.max(z, (bs[a] ? Z.black : Z.white)[F[a]]); return z; }

// The best fingering of one hand's events (side +1 right, -1 left). Fills each event with (FINAL-SPEC S3.2):
//   fs (the finger of each note, e.notes order: by pitch), anchor (the middle finger's rest place, world x), lo / hi (the
//   practical window of anchors, world x), clo / chi (the comfortable one), post (N F S TB LB), zneed, cross (per note:
//   'under' for a thumb passing under, 'over' for a finger crossing over it, else null) and cuts (notes held from
//   earlier events that this event's hand place lets go: their keys are out of reach).
export function fingerHand(ev, side, Z = ZDEF) {
  const N = ev.length;
  const stats = { states: 0, trans: 0, stretched: 0, wide: 0, total: 0 };
  if (!N) return { ev, stats };
  for (const e of ev) {
    e.ns = side > 0 ? e.notes.slice() : e.notes.slice().reverse();      // the hand's order: thumb side first
    e.us = e.ns.map((n) => uOf(side, KX[n.pitch]));
  }
  // the figure around each event: the width of its notes and those of the events just before and after it (when they
  // follow within figGap s): an octave broken over notes in turn is played in the spread posture as a chord is
  ev.forEach((e, i) => {
    let lo = e.us[0], hi = e.us[e.us.length - 1];
    for (let j = Math.max(0, i - OPT.figN); j <= Math.min(ev.length - 1, i + OPT.figN); j++) { const o = ev[j]; if (Math.abs(o.t - e.t) <= OPT.figGap) { lo = Math.min(lo, o.us[0]); hi = Math.max(hi, o.us[o.us.length - 1]); } }
    e.figExt = hi - lo;
  });
  // each event's candidate fingerings; an event that no hand position reaches, even stretched, is cut down (reduceWide)
  for (const e of ev) { e.cands = candidates(e, stats, Z); if (!e.cands.length) reduceWide(e, stats, Z); }
  let prev = null;                         // previous layer: array of states
  const layers = [];
  for (let i = 0; i < N; i++) {
    const e = ev[i], k = e.ns.length, xs = e.us;
    const cands = e.cands;
    // states: (fingering, anchor on the grid inside the window)
    const states = [];
    cands.forEach((c, ci) => {
      const a0 = Math.ceil(c.lo / GRID - 1e-9) * GRID, a1 = Math.floor(c.hi / GRID + 1e-9) * GRID;
      let anchors = [];
      if (a0 > a1) anchors = [Math.min(Math.max(c.astar, c.lo), c.hi)];
      else for (let a = a0; a <= a1 + 1e-9; a += GRID) anchors.push(a);
      if (anchors.length > MAXB) anchors = anchors.sort((p, q) => Math.abs(p - c.astar) - Math.abs(q - c.astar)).slice(0, MAXB);
      const BC = COMFORTS[c.post];
      for (const a of anchors) {
        let pc = 0;
        for (let j = 0; j < k; j++) {
          const f = c.F[j], dlt = xs[j] - a - REST[f];
          pc += W.postureQ * dlt * dlt + W.postureLin * Math.max(0, dlt - BC[f][1], BC[f][0] - dlt);
        }
        states.push({ ci, F: c.F, a, lo: c.lo, hi: c.hi, post: c.post, sc: c.rc + pc, zneed: c.zneed, stretched: !!c.stretched, cost: 0, from: -1, busy: null });
      }
    });
    stats.states += states.length;
    if (!prev) {
      for (const s of states) { s.cost = s.sc; s.busy = e.ns.map((n, j) => ({ f: s.F[j], x: xs[j], p: n.pitch, until: n.onset + n.dur, ev: i, n })); s.mem = memAfter(null, s, e); s.lastCross = -9; }
      states.nC = cands.length; layers.push(states); prev = states; continue;
    }
    const pe = ev[i - 1], dt = Math.max(0.03, e.t - pe.t), pk = pe.ns.length;
    // (cached by the two states' candidate fingerings: an index into this layer's and the last layer's candidates)
    const nC = cands.length, tcache = new Float64Array(prev.nC * nC).fill(NaN);
    const ppe = ev[i - 2], runDir = ppe && ppe.ns.length === 1 && pk === 1 ? Math.sign(pe.us[0] - ppe.us[0]) : 0;
    // transition costs that depend only on the two fingerings
    const trans = (sp, s) => {
      const key = sp.ci * nC + s.ci, hit = tcache[key]; if (hit === hit) return hit;
      const pF = sp.F, F = s.F;
      let c = 0;
      const single = pk === 1 && k === 1;
      for (let a = 0; a < pk; a++) {
        const pn = pe.ns[a], pf = pF[a], px = pe.us[a], pb = BLK[pn.pitch];
        const held = pn.onset + pn.dur > e.t + 0.02;
        const wh = held ? 1 : dt <= 0.15 ? 1 : dt >= 0.45 ? 0 : (0.45 - dt) / 0.3;
        for (let b = 0; b < k; b++) {
          const n = e.ns[b], f = F[b], x = xs[b], bl = BLK[n.pitch];
          if (pf === f) {
            if (pn.pitch !== n.pitch && pk > 1 && k > 1) c += W.blockMove;     // chord to chord: the hand moves as a block
            else if (pn.pitch !== n.pitch) c += dt < 0.15 ? 12 : dt < 0.25 ? W.sameFingerFast : dt < 0.6 ? W.sameFingerFast - ((dt - 0.25) / 0.35) * 6 : dt < 1.2 ? 2 - ((dt - 0.6) / 0.6) * 1.5 : 0.5;
            else c += dt < 0.16 ? W.repSameFast : dt < 0.3 ? W.repSameMid : 0;
            continue;
          }
          if (pn.pitch === n.pitch) { c += dt >= 0.3 ? W.repChangeSlow : 0; continue; }
          // melodic connections only: between single notes, or from a single note to the nearest note of a chord
          const melodic = single || (pk === 1 && b === nearestIdx(e.ns, pn.pitch)) || (k === 1 && a === nearestIdx(pe.ns, n.pitch));
          if (wh > 0 && melodic) {
            // two fingers other than the thumb landing in reverse order (e.g. 2 then 5 above it) is a shift of the whole
            // hand, never a crossing: costlier than any thumb crossing (so is a finger 4 or 5 "crossing" over the thumb
            // further than Parncutt's practical limit)
            const reversed = pf !== 0 && f !== 0 && (f - pf) * (x - px) < 0;
            const other = pf === 0 ? f : pf;
            const farOver = (pf === 0 || f === 0) && other >= 3 && (pf === 0 ? x - px : px - x) < 0 && !isFinite(pairCost(pf, px, pb, f, x, bl));
            let pcost = reversed || farOver ? W.shift : Math.min(W.horizCap, pairCost(pf, px, pb, f, x, bl, true));
            // a thumb crossing inside a run that keeps its direction (scales, arpeggios): the hand is already travelling
            if (single && !reversed && !farOver && (pf === 0 || f === 0) && (pf === 0 ? px - x : x - px) > 0 && runDir !== 0 && Math.sign(x - px) === runDir) pcost *= W.runCross;
            c += wh * pcost;
          }
          if (single) {
            // Parncutt sequence rules for melodic steps
            if (pf === 2 && f === 3) c += W.threeFour;
            if ((pf === 2 && f === 3 && !pb && bl) || (pf === 3 && f === 2 && pb && !bl)) c += W.fourOnBlack;
            if (pf === 0 && pb && !bl) c += W.thumbBlackNb;
            if (f === 0 && bl && !pb) c += W.thumbBlackNb;
            if (pf === 4 && pb && !bl) c += W.fiveBlackNb;
            if (f === 4 && bl && !pb) c += W.fiveBlackNb;
            // thumb passing (thumb under / finger over): the thumb is on the far side of the other finger
            if (pf === 0 || f === 0) {
              const tx = pf === 0 ? px : x, ox = pf === 0 ? x : px, tb = pf === 0 ? pb : bl, ob = pf === 0 ? bl : pb;
              if (tx - ox > 0) c += tb === ob ? W.thumbPass : (!ob && tb) ? W.thumbPassBad : 0;
            }
          }
        }
      }
      tcache[key] = c; return c;
    };
    const t = e.t;
    for (const sp of prev) sp.live = sp.busy.filter((b) => b.until > t + 0.03);     // busy notes still held now
    const ctx = { i, t, dt, k, pk, xs, e, pe, trans, single: pk === 1 && k === 1 };
    // (the last event's states cheapest first, so that the search for each state's best predecessor can stop early: a
    // state's cost is at least its predecessor's plus its own; ties go to the lower index, exactly as in a plain scan)
    const order = prev.map((_, j) => j).sort((a, b) => prev[a].cost - prev[b].cost || a - b);
    const pmax = OPT.beam > 0 ? prev[order[0]].cost + OPT.beam : Infinity;
    for (const s of states) {
      let best = Infinity, from = -1, bestCut = null, bestParts = null;
      for (const j of order) {
        const pc = prev[j].cost;
        if (pc > pmax || pc + s.sc > best) break;
        const parts = TRACE ? {} : null;
        const c = transCost(prev[j], s, ctx, parts, best);
        stats.trans++;
        if (c < best || (c === best && j < from)) { best = c; from = j; bestCut = ctx.cut; bestParts = parts; }
      }
      if (TRACE) s.parts = bestParts;
      s.cost = best; s.from = from;
      const sp = prev[from];
      s.mem = memAfter(sp, s, e); s.lastCross = isCross(sp, s, pe, e) ? t : sp.lastCross;
      s.busy = sp.live.filter((b) => !(bestCut && bestCut.includes(b)) && !s.F.includes(b.f));
      e.ns.forEach((n, j) => s.busy.push({ f: s.F[j], x: xs[j], p: n.pitch, until: n.onset + n.dur, ev: i, n }));
    }
    for (const sp of prev) { sp.busy = null; sp.live = null; sp.mem = null; }
    states.nC = cands.length; layers.push(states); prev = states;
  }
  // trace back
  const path = new Array(N);
  let j = prev.reduce((bi, s, q) => (s.cost < prev[bi].cost ? q : bi), 0);
  stats.total = prev[j].cost;
  for (let i = N - 1; i >= 0; i--) { path[i] = layers[i][j]; j = path[i].from; }
  // the hand places, settled (OPT.settle)
  const A = path.map((s) => s.a);
  if (OPT.settle) for (let i = 0; i < N;) {
    let L = path[i].lo, H = path[i].hi, j = i + 1;
    while (j < N && Math.abs(A[j] - A[j - 1]) <= OPT.settleDrift + 1e-9 && Math.max(L, path[j].lo) <= Math.min(H, path[j].hi) + 1e-9) { L = Math.max(L, path[j].lo); H = Math.min(H, path[j].hi); j++; }
    if (j - i > 1) { let m = 0; for (let k = i; k < j; k++) m += A[k]; m = Math.min(Math.max(m / (j - i), L), H); for (let k = i; k < j; k++) A[k] = m; }
    i = j;
  }
  // the events' outputs, in world x and in each event's note order (by pitch)
  const toPitchOrder = (arr) => (side > 0 ? arr : arr.slice().reverse());
  const wx = (u) => uOf(side, u);
  let busy = [];
  for (let i = 0; i < N; i++) {
    const e = ev[i], s = path[i], k = e.ns.length;
    e.fs = toPitchOrder(s.F); e.anchor = wx(A[i]); e.post = s.post; e.zneed = s.zneed; e.stretched = s.stretched;
    [e.lo, e.hi] = side > 0 ? [s.lo, s.hi] : [wx(s.hi), wx(s.lo)];
    let [clo, chi] = windowOf(s.F, e.us, COMFORTS[s.post], e.ns);
    if (clo > chi) clo = chi = Math.min(Math.max((clo + chi) / 2, s.lo), s.hi);
    [e.clo, e.chi] = side > 0 ? [clo, chi] : [wx(chi), wx(clo)];
    const cr = i > 0 && isCross(path[i - 1], s, ev[i - 1], e) ? (s.F[0] === 0 ? 'under' : 'over') : null;
    e.cross = e.notes.map(() => cr);
    if (TRACE) { e.parts = s.parts; e.cum = s.cost; }
    // held notes this hand place lets go (as the model's held-note rule, along the chosen path)
    const t = e.t, B = BANDS[s.post];
    e.cuts = [];
    busy = busy.filter((b) => {
      if (b.until <= t + 0.03) return false;
      const m = s.F.indexOf(b.f);
      if (m >= 0) return false;                                        // the finger plays again: it lets go anyway
      const dl = b.x - A[i] - REST[b.f];
      if (dl < B[b.f][0] - 1e-9 || dl > B[b.f][1] + 1e-9) { e.cuts.push(b.n); return false; }
      return true;
    });
    e.ns.forEach((n, q) => busy.push({ f: s.F[q], x: e.us[q], p: n.pitch, until: n.onset + n.dur, n }));
  }
  for (const e of ev) { delete e.ns; delete e.us; delete e.figExt; delete e.last; delete e.cands; }
  return { ev, stats };
}
// An event no hand position reaches, even stretched (OPT.stretchTol): it lets go of its notes from the thumb's side, one at
// a time, until the rest have a candidate fingering. The little finger's side is the outer voice (the right hand's top, the
// left hand's bass) and is always kept; the notes let go of are inner voices, on the other hand's side: they are e.wide
// (rescueWide offers them to the other hand) and e.dropped. (Keeping the longest run instead dropped the melody, Satie's
// Gymnopedie 11.82 s: B3 D4 F#4 kept, F#5 dropped, and the bass octave, Chopin's E minor Prelude 103.93 s: E1 E2.)
function reduceWide(e, stats, Z) {
  for (let a0 = 1; a0 < e.ns.length; a0++) {
    const sub = { stretched: 0 }, part = { ns: e.ns.slice(a0), us: e.us.slice(a0), figExt: e.figExt }, c = candidates(part, sub, Z);
    if (!c.length) continue;
    const keep = new Set(part.ns), drop = e.ns.filter((n) => !keep.has(n));
    e.wide = drop; e.dropped = (e.dropped || []).concat(drop);
    e.notes = e.notes.filter((n) => keep.has(n));
    if (e.dups) e.dups = e.dups.filter(([, n]) => keep.has(n));
    e.ns = part.ns; e.us = part.us; e.cands = c;
    stats.stretched += sub.stretched; stats.wide += drop.length;
    return;
  }
}

// ---------------------------------------------------------------- the two hands, with the rescue (FINAL-SPEC S3.4)
const RESCUE = { span: 7.6, near: 4.0, clear: 0.12, vCap: 140, lunge: 1.0, lateMax: 0.04 };
const groupsOf = (list) => { const g = []; for (const n of list) { const l = g[g.length - 1]; if (l && n.onset - l.t < 0.035) l.notes.push(n); else g.push({ t: n.onset, notes: [n] }); } return g; };
const centroid = (ns) => ns.reduce((s, n) => s + KX[n.pitch], 0) / ns.length;
const byTime = (a, b) => a.onset - b.onset || a.pitch - b.pitch;
// Can hand o take note n at time t? It has no event within RESCUE.clear s, and n lies within RESCUE.near of where it lazily
// is then (between the centroids of its events before and after t). groups: o's events (35 ms groups). far (rescueWide):
// n may lie further from each of those events' centroids, by OPT.farV times the time to it beyond RESCUE.clear (a key hand o
// still holds then is let go of, as in (a): the fingering's cuts).
function canTake(groups, n, t, far = false) {
  if (!groups.length) return false;
  let lo = 0, hi = groups.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (groups[m].t <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  const a = groups[k], b = groups[k + 1];
  if ((a && t - a.t < RESCUE.clear) || (b && b.t - t < RESCUE.clear)) return false;
  if (far) {
    const ok = (g) => !g || Math.abs(KX[n.pitch] - centroid(g.notes)) <= RESCUE.near + OPT.farV * Math.max(0, Math.abs(t - g.t) - RESCUE.clear);
    return ok(a) && ok(b);
  }
  const lazy = a && b ? centroid(a.notes) + ((t - a.t) / (b.t - a.t)) * (centroid(b.notes) - centroid(a.notes)) : centroid((a || b).notes);
  return Math.abs(KX[n.pitch] - lazy) <= RESCUE.near;
}
// (a) chords of more than 5 notes, or wider than the spread posture reaches: their outer notes on the other hand's side go
// to the other hand while it can take them (canTake) and the chord still needs it. Returns the notes moved.
function rescueChords(lists) {
  const moved = [];
  for (const h of [0, 1]) {
    const o = 1 - h, groups = groupsOf(lists[o]), mv = new Set();
    for (const g of groupsOf(lists[h])) {
      const ns = g.notes.slice().sort((a, b) => a.pitch - b.pitch);
      const take = [];
      // the right hand gives its lowest notes, the left hand its highest
      while (ns.length > 1) {
        const span = KX[ns[ns.length - 1].pitch] - KX[ns[0].pitch];
        if (ns.length <= 5 && span <= RESCUE.span) break;
        const n = h === 0 ? ns[0] : ns[ns.length - 1];
        const all = [...take, n], tspan = Math.max(...all.map((m) => KX[m.pitch])) - Math.min(...all.map((m) => KX[m.pitch]));
        if (all.length > 5 || tspan > RESCUE.span || !canTake(groups, n, g.t)) break;
        take.push(n); ns.splice(h === 0 ? 0 : ns.length - 1, 1);
      }
      for (const n of take) mv.add(n);
    }
    if (mv.size) { lists[h] = lists[h].filter((n) => !mv.has(n)); lists[o] = lists[o].concat([...mv]).sort(byTime); moved.push(...mv); }
  }
  return moved;
}
// (b) leaps no hand could make in time, even lunging and striking late: the notes of the event after it (else before it)
// go to the other hand when it can take them (canTake). dOf(vel): a key's descent time (the contact is that long before the
// onset). Returns the notes moved.
// (The contact tc as S2.1 makes it: a key's descent time, but at most 0.45 of the time since its finger let go of its last
// key, which S3.1's release rule puts min(0.04, 0.45 of the time between the two onsets) before this one. With the descent
// time alone, the left hand's octave leap D2+D3 -> E-flat3+E-flat4 in the Revolutionary (10.69 s) had 0.014 s and its
// E-flat4 went to the right hand; with its fingers' real contact it has 0.056 s, enough with a lunge and a late strike.)
// (Never across this hand: as in (a), the right hand gives its lowest notes and the left hand its highest, from the outside
// in while the other hand can take them, and a note goes only if it lies on the other hand's side of what this hand keeps
// then: the event's other notes, or, when the whole event goes, where this hand lazily is between its events before and
// after it. Any note of the event used to go: in Interstellar (Gabriel Piano's version) at 160.37 s the right hand's
// F1 F2 A3 gave its A3 to the left hand, still up at E4, and the hands crossed by 14 keys. stats.refused counts the events
// refused for this.)
function rescueLeaps(lists, H, dOf, stats) {
  const moved = [];
  for (const h of [0, 1]) {
    const ev = H[h].events, o = 1 - h, side = H[h].side, groups = groupsOf(lists[o]), mv = new Set(), last = [null, null, null, null, null];
    // (where this hand lazily is at event j's time without it: between the centroids of the nearest events either side
    // that keep a note)
    const kept = (e) => e.notes.filter((n) => !mv.has(n));
    const lazyAt = (j) => {
      let a = j - 1, b = j + 1;
      while (a >= 0 && !kept(ev[a]).length) a--;
      while (b < ev.length && !kept(ev[b]).length) b++;
      const A = a >= 0 ? ev[a] : null, B = b < ev.length ? ev[b] : null;
      if (!A && !B) return null;
      if (!A || !B) return centroid(kept(A || B));
      return centroid(kept(A)) + ((ev[j].t - A.t) / (B.t - A.t)) * (centroid(kept(B)) - centroid(kept(A)));
    };
    const dIn = (e, n, k) => {
      const p = last[e.fs[k]]; let d = dOf(n.vel ?? 0.7);
      if (p) { const off = Math.max(p.onset + 0.05, Math.min(p.onset + p.dur, e.t - Math.min(0.04, 0.45 * (e.t - p.onset)))); d = Math.min(d, Math.max(0.012, 0.45 * (e.t - off))); }
      return d;
    };
    if (ev.length) ev[0].notes.forEach((n, k) => { last[ev[0].fs[k]] = n; });
    for (let i = 1; i < ev.length; i++) {
      const a = ev[i - 1], b = ev[i];
      const g = Math.max(0, b.lo - a.hi, a.lo - b.hi);
      const tc = b.t - Math.max(...b.notes.map((n, k) => dIn(b, n, k))), A = tc - (a.t + 0.02);
      b.notes.forEach((n, k) => { last[b.fs[k]] = n; });
      if (1.875 * (g - RESCUE.lunge) / RESCUE.vCap <= A + RESCUE.lateMax) continue;
      for (const [e, j] of [[b, i], [a, i - 1]]) {
        const ns = kept(e).sort((x, y) => side * (x.pitch - y.pitch)), take = [];      // the other hand's side first
        for (const n of ns) { if (!canTake(groups, n, e.t)) break; take.push(n); }
        if (!take.length) continue;
        const ref = take.length < ns.length ? KX[ns[take.length].pitch] : lazyAt(j);
        if (ref != null && take.some((n) => side * (ref - KX[n.pitch]) <= 0)) { stats.refused++; continue; }
        take.forEach((n) => mv.add(n)); break;
      }
    }
    if (mv.size) { lists[h] = lists[h].filter((n) => !mv.has(n)); lists[o] = lists[o].concat([...mv]).sort(byTime); moved.push(...mv); }
  }
  return moved;
}

// (c) chords that no posture class reaches (FINAL-SPEC S3.2's stretched state, or wider still: fingerHand's reduceWide),
// and chords of more than 5 notes, run on each hand's events at least 6 wide, before the fingering (so that it runs once):
// their notes on the other hand's side go to the other hand, from the outside in, while the rest still need it and the
// other hand can get there in time (canTake far) and reaches all it takes without stretching (or, striking a chord at
// that moment, that chord with them). Returns the notes moved. (FINAL-SPEC S3.4 (a), its reach of 4.0 widened by the time
// the other hand has. Stretched over the whole chord, a finger lay up to 8 keys from its key and the key went down with
// nothing on it: Moonlight 198.38 s, F#1 A1 D2 A3 D4 in the left hand; now the right hand, free, takes A3 D4 and more of
// that eight-note chord. In Interstellar (Gabriel Piano's version) at 160.37 s the left hand takes the right hand's F1 F2
// and the right hand keeps its A3; in Satie's Gymnopedie the left hand takes the right hand's chords under the melody.
// Run after the fingering, it cost a second fingering of both hands: Moonlight's createHands 0.41 -> 0.6 s.)
function rescueWide(lists, Z) {
  const moved = [];
  // (hand so's candidate fingerings of notes ns as one chord)
  const cands = (ns, so) => {
    if (ns.length > 5) return [];
    const q = ns.slice().sort((a, b) => so * (a.pitch - b.pitch)), us = q.map((n) => uOf(so, KX[n.pitch]));
    return candidates({ ns: q, us, figExt: us[us.length - 1] - us[0] }, { stretched: 0 }, Z);
  };
  for (const h of [0, 1]) {
    const side = h ? -1 : 1, o = 1 - h, groups = groupsOf(lists[o]), mv = new Set();
    for (const e of eventsOf(lists[h], side)) {
      const ns = [...e.notes, ...(e.dropped || [])].sort((a, b) => side * (a.pitch - b.pitch));     // the other hand's side first
      if (side * (KX[ns[ns.length - 1].pitch] - KX[ns[0].pitch]) < 6) continue;
      const g = groups.find((q) => Math.abs(q.t - e.t) < 0.035), take = [];
      while (ns.length > 1) {
        const c = cands(ns, side);
        if (c.length && !c[0].stretched) break;
        // (while the rest is played stretched, the other hand takes notes only when it is free and reaches them without
        // stretching: striking at that moment, it is in its own figure, and the Revolutionary's left hand, running in
        // sixteenths, took the right hand's B-flat4 at 49.88 s into its B3 and leapt away from it. While the rest would lose
        // notes, it takes them stretched too, or into a chord it strikes then.)
        const all = [...take, ns[0]], ok = (q) => { const d = cands(q, -side); return d.length > 0 && !(c.length && d[0].stretched); };
        if (g ? c.length || !ok([...g.notes, ...all]) : !(canTake(groups, ns[0], e.t, true) && ok(all))) break;
        take.push(ns.shift());
      }
      for (const n of take) { mv.add(n); if (g) g.notes.push(n); }
      if (e.dups) for (const [d, m] of e.dups) if (mv.has(m)) mv.add(d);       // (a key struck twice in the event goes with it)
    }
    if (mv.size) { lists[h] = lists[h].filter((n) => !mv.has(n)); lists[o] = lists[o].concat([...mv]).sort(byTime); moved.push(...mv); }
  }
  return moved;
}

// (d) thumbs crossed between the hands (S5): the right thumb on a key left of the left thumb's (or on the same key) while
// both are in use, from THUMBX.pre s before each strikes until it lets go (its note's end, or its next note). The two
// thumbs then lie across each other, each stretched toward the other hand's side, and no place of the hands parts them:
// Op. 25 No. 1 18.72 s, the right thumb on E flat 3 and the left on G3; Interstellar 163.3 s, D3 and B3. One of the two
// notes goes to the other hand, on that hand's own side of its thumb (the right thumb's note lies below the left thumb's,
// the left thumb's above the right's), so that hand plays it beside its own thumb: in a chord with a note of its own
// struck with it (within 35 ms), the chord then of 5 notes at most and widened to no more than THUMBX.span (a note within
// the chord's own span is taken whatever its width: Clair de lune's C5 inside the right hand's A flat 4 - A flat 5 at
// 115.5 s; wider, the fingering dropped it, Moonlight's E flat 4 at 216 s, or the hand reached early for an octave,
// Moonlight's F sharp 3 under F sharp 4 at 95.9 s), and among the keys that hand plays within THUMBX.near s (so its path does
// not change: given an E4 above its arpeggio, Moonlight's left hand reached up for it at 281.0 s and jolted); the nearer
// of the two. (Any note it played within 0.3 s would do, without the chord, and Op. 25's parallel arpeggios at 100.2-100.8
// s gave the left hand the right hand's C4, C5 and C6 between its own notes: it leapt for each, 3 jolts.) Not where the hands themselves are crossed, the right
// hand's place (the fingering's anchor) more than THUMBX.crossed left of the left hand's: in a written crossing
// (Interstellar 159.8 s, the left thumb on E4 over the right hand's C3) the thumbs lie so because the whole hand crosses,
// which S5 plays as a crossing. Returns the notes moved.
const THUMBX = { pre: 0.03, near: 0.3, edge: 0.5, span: 5.0, crossed: 2.0 };
function rescueThumbs(lists, H) {
  const ivs = H.map((Hh) => {
    const a = [];
    const at = new Map();
    for (const e of Hh.events) e.notes.forEach((n, k) => { if (e.fs && e.fs[k] === 0) { a.push(n); at.set(n, e.anchor); } });
    a.sort(byTime);
    return a.map((n, i) => ({ n, x: at.get(n), t0: n.onset - THUMBX.pre, t1: Math.min(n.onset + n.dur, a[i + 1] ? a[i + 1].onset : Infinity) }));
  });
  const moved = [new Set(), new Set()], used = new Set();
  // (how far note n lies from the nearest note hand o strikes with it, within 35 ms; Infinity: none, the chord would then
  // have more than 5 notes or span more than THUMBX.span, or n lies outside the keys hand o plays within THUMBX.near s,
  // widened by THUMBX.edge: there it would have to reach out for it)
  const fit = (o, n) => {
    let d = Infinity, k = 1, lo = KX[n.pitch], hi = lo, rlo = Infinity, rhi = -Infinity, clo = Infinity, chi = -Infinity;
    for (const m of lists[o]) {
      if (m.onset < n.onset - THUMBX.near) continue;
      if (m.onset > n.onset + THUMBX.near) break;
      rlo = Math.min(rlo, KX[m.pitch]); rhi = Math.max(rhi, KX[m.pitch]);
      if (Math.abs(m.onset - n.onset) >= 0.035 || m.pitch === n.pitch) continue;
      d = Math.min(d, Math.abs(KX[m.pitch] - KX[n.pitch])); k++; lo = Math.min(lo, KX[m.pitch]); hi = Math.max(hi, KX[m.pitch]);
      clo = Math.min(clo, KX[m.pitch]); chi = Math.max(chi, KX[m.pitch]);
    }
    const inside = KX[n.pitch] >= rlo - THUMBX.edge && KX[n.pitch] <= rhi + THUMBX.edge;
    return d < Infinity && inside && k <= 5 && hi - lo <= Math.max(THUMBX.span, chi - clo) ? d : Infinity;
  };
  let j0 = 0;
  for (const A of ivs[0]) {
    while (j0 < ivs[1].length && ivs[1][j0].t1 < A.t0) j0++;
    for (let j = j0; j < ivs[1].length && ivs[1][j].t0 <= A.t1; j++) {
      const B = ivs[1][j];
      if (B.t1 < A.t0 || KX[A.n.pitch] > KX[B.n.pitch] || !(A.x - B.x > -THUMBX.crossed) || used.has(A.n) || used.has(B.n)) continue;
      const dA = fit(1, A.n), dB = fit(0, B.n);
      if (dA === Infinity && dB === Infinity) continue;
      if (dA <= dB) moved[0].add(A.n); else moved[1].add(B.n);
      used.add(A.n); used.add(B.n);
    }
  }
  const out = [];
  for (const h of [0, 1]) if (moved[h].size) { const o = 1 - h; lists[h] = lists[h].filter((n) => !moved[h].has(n)); lists[o] = lists[o].concat([...moved[h]]).sort(byTime); out.push(...moved[h]); }
  return out;
}

// The whole fingering of a piece: notes -> hands (handOf: 0 right, 1 left; the rescue may give a note to the other hand),
// events, and each hand's best fingering. opts.dOf(vel): a key's descent time in s (for the leap rescue); opts.zneed:
// { black, white }, how far forward the hand must come for each finger on a black / white key (default: B3's ZNEED_BLACK).
// Returns { hands: [{ side, events, stats }, ...] (0 right, 1 left), rescued: notes the other hand plays, stats }.
export function planFingering(notes, handOf, opts = {}) {
  const dOf = opts.dOf || (() => 0.04), Z = opts.zneed || ZDEF;
  const lists = [0, 1].map((h) => notes.filter((n) => handOf(n) === h).sort(byTime));
  const rescued = rescueChords(lists);
  rescued.push(...rescueWide(lists, Z));
  const plan = () => [0, 1].map((h) => { const side = h ? -1 : 1, events = eventsOf(lists[h], side); return { side, events, stats: fingerHand(events, side, Z).stats }; });
  let H = plan();
  const stats = { rescued: 0, refused: 0, thumbsCrossed: 0, spreadEvents: 0, stretched: 0, wideDropped: 0, classes: { N: 0, F: 0, S: 0, TB: 0, LB: 0 } };
  const more = rescueLeaps(lists, H, dOf, stats);
  if (more.length) { rescued.push(...more); H = plan(); }
  // (S5: twice at most, as a new fingering may cross two other thumbs)
  for (let r = 0; r < 2; r++) {
    const th = rescueThumbs(lists, H);
    if (!th.length) break;
    rescued.push(...th); stats.thumbsCrossed += th.length; H = plan();
  }
  stats.rescued = rescued.length;
  for (const Hh of H) { stats.stretched += Hh.stats.stretched; stats.wideDropped += Hh.stats.wide; for (const e of Hh.events) { stats.classes[e.post]++; if (e.post === 'S') stats.spreadEvents++; } }
  return { hands: H, rescued, stats };
}
