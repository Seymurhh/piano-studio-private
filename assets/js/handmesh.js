// A real hand for the Keys pictures: the MakeHuman base mesh's right hand and a short piece of forearm (CC0 1.0,
// makehumancommunity/makehuman), cut out, subdivided twice and skinned to its own rig (forearm, wrist, four
// metacarpals, three bones for each finger) by tools/build_hand.py. The left hand is the same mesh mirrored.
// Every bone follows the pose that hands.js works out (each finger's joints from its fingering and IK), so the hand
// takes any shape the music asks of it: the palm and metacarpals move with the hand, each finger bone turns to point
// from its joint to the next, keeping the twist of the bone before it, and the forearm points back to the elbow.
import * as THREE from '../vendor/three.min.js?v=7';

async function load() {
  try {
    const base = new URL('../models/', import.meta.url);
    const info = await (await fetch(new URL('hand-r.json?v=5', base))).json();
    const buf = await (await fetch(new URL('hand-r.bin?v=5', base))).arrayBuffer();
    const n = info.verts, t = info.tris;
    let o = 0;
    const pos = new Float32Array(buf, o, n * 3); o += n * 12;
    const si = new Uint8Array(buf, o, n * 4); o += n * 4;
    const sw = new Uint8Array(buf, o, n * 4); o += n * 4;
    const tags = new Uint8Array(buf, o, n * 4); o += n * 4;
    const tri = new Uint32Array(buf.slice(o, o + t * 12)); o += t * 12;
    const detail = new Float32Array(buf.slice(o, o + n * 16));
    let hair = null;
    try {
      const hi = await (await fetch(new URL('hair-r.json?v=3', base))).json(), hb = await (await fetch(new URL('hair-r.bin?v=3', base))).arrayBuffer(), hn = hi.verts;
      let q = 0; const take = (T, k) => { const a = new T(hb.slice(q, q + hn * k * T.BYTES_PER_ELEMENT)); q += hn * k * T.BYTES_PER_ELEMENT; return a; };
      hair = { pos: take(Float32Array, 3), nrm: take(Float32Array, 3), uv: take(Float32Array, 2), si: take(Uint8Array, 4), sw: take(Uint8Array, 4), idx: new Uint32Array(hb.slice(q)) };
    } catch (e) { console.warn('hair not loaded', e); }
    return { info, pos, si, sw, tags, tri, detail, hair };
  } catch (e) { console.warn('hand model not loaded', e); return null; }
}
export const MODEL = await load();

// Slimmer hands, as a pianist's in the reference video: the MakeHuman hand is broad and thick for its length (proximal
// finger bones 19 mm across, the palm up to 43 mm thick). Once, at load, before anything below is worked out from the
// mesh (the pads, the capsules, the normals), each vertex moves toward the centre line of the bones it is bound to, by
// each bone's share of its weight, perpendicular to the bone only: the girth shrinks, while every length, joint, bone
// and skin weight stays as it was. Factors (new girth over old): the fingers' proximal, middle and distal bones (the
// little finger's proximal one a little less thinned), the thumb's metacarpal (thenar) and its own two bones (left as
// they are: thinner, the thumbs grazed the keys beside theirs), the palm's thickness (back to front, about each
// metacarpal's base), its two outer edges (index and little finger sides) pulled in, and the carpus at the wrist.
// Measured at rest (fingers 2-4, with PROPORTIONS below): proximal 0.66-0.69 key widths (MakeHuman's 0.81), middle
// 0.58-0.62 (0.68-0.73), distal 0.54-0.56 (0.61-0.63), as the reference photos' 0.60-0.72 and 0.56; the palm 12 %
// thinner (and narrower still by PROPORTIONS).
export const SLIM = { prox: 0.80, mid: 0.85, dist: 0.89, little1: 0.82, thenar: 0.95, thumb2: 1, thumb3: 1, palmT: 0.88, palmOut: 0.88, wrist: 0.93 };
if (MODEL && SLIM) {
  const bones = MODEL.info.bones, bi = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // per bone: head, unit axis, length, the centre line's offset from the axis, palm bone (metacarpal 1-4) or not, factor
  const B = bones.map((b) => { const d = sub(b.tail, b.head), L = Math.hypot(...d); return { h: b.head, a: d.map((x) => x / L), L, o: [0, 0, 0], meta: 0, s: 1 }; });
  for (let f = 2; f <= 5; f++) { B[bi[`finger${f}-1`]].s = f === 5 ? SLIM.little1 : SLIM.prox; B[bi[`finger${f}-2`]].s = SLIM.mid; B[bi[`finger${f}-3`]].s = SLIM.dist; }
  B[bi['finger1-1']].s = SLIM.thenar; B[bi['finger1-2']].s = SLIM.thumb2; B[bi['finger1-3']].s = SLIM.thumb3;
  for (let m = 1; m <= 4; m++) B[bi[`metacarpal${m}`]].meta = m;
  B[bi.wrist].s = SLIM.wrist;
  const thin = (pos, si, sw, n, centres) => {
    // each bone's centre line: the mean offset from its axis of the skin bound mostly to it, round its middle (a finger's
    // skin does not sit evenly round its bone)
    if (centres) B.forEach((b, j) => {
      if (b.meta || b.s === 1) return;
      const c = [0, 0, 0]; let k = 0;
      for (let v = 0; v < n; v++) {
        let w = -1, d = 0; for (let q = 0; q < 4; q++) if (sw[v * 4 + q] > w) { w = sw[v * 4 + q]; d = si[v * 4 + q]; }
        if (d !== j || w < 128) continue;
        const r = sub([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], b.h), al = dot(r, b.a), t = al / b.L;
        if (t < 0.3 || t > 0.7) continue;
        for (let i = 0; i < 3; i++) c[i] += r[i] - b.a[i] * al;
        k++;
      }
      if (k) b.o = c.map((x) => x / k);
    });
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], dp = [0, 0, 0];
      for (let q = 0; q < 4; q++) {
        const w = sw[v * 4 + q] / 255; if (!w) continue;
        const b = B[si[v * 4 + q]], r = sub(p, b.h), al = dot(r, b.a);
        if (b.meta) {   // the palm: thinner about the metacarpal's base, and its outer edges pulled in
          dp[1] -= w * (1 - SLIM.palmT) * r[1];
          const rx = r[0] - b.a[0] * al;
          if ((b.meta === 1 && rx < 0) || (b.meta === 4 && rx > 0)) dp[0] -= w * (1 - SLIM.palmOut) * rx;
          continue;
        }
        if (b.s === 1) continue;
        for (let i = 0; i < 3; i++) dp[i] -= w * (1 - b.s) * (r[i] - b.a[i] * al - b.o[i]);
      }
      for (let i = 0; i < 3; i++) out[v * 3 + i] = p[i] + dp[i];
    }
    pos.set(out);
  };
  thin(MODEL.pos, MODEL.si, MODEL.sw, MODEL.info.verts, true);
  if (MODEL.hair) thin(MODEL.hair.pos, MODEL.hair.si, MODEL.hair.sw, MODEL.hair.pos.length / 3, false);   // (the hairs, rooted in that skin, follow it)
}

// The hand's proportions, as the pianist's in the reference photos: longer fingers and a smaller palm. Once, at load,
// after SLIM and before anything below is worked out, the rig itself is reshaped and the skin follows it: the palm
// (the wrist and metacarpal bones) is scaled about the middle finger's knuckle, the hand frame's origin, palm.x across
// and palm.z along the hand (narrower, shorter: the knuckles closer together, the wrist nearer the knuckles; the
// forearm moves with the wrist); each finger bone keeps its direction and becomes len[f][s] times as long (the skin
// along it stretched, the skin past its ends carried along), each finger starting at its knuckle's new place. Every
// vertex moves by its own skin weights (the blend of what its bones do), so the skin, the joints, the pads, the
// capsules and the normals all agree with the new rig; ANATOMY gives hands.js the new knuckles and bone lengths.
// The MakeHuman fingers were short for their palm (middle finger, knuckle to tip, 0.85 of the palm's length; its
// proximal bone only 1.28 times its middle bone, against about 1.5-1.6 in real hands): the proximal bones gain most.
// The little finger gains a little more (MakeHuman's was short, 0.66 of the middle finger), and the thumb a little
// (the narrower palm brings the little finger's knuckle 0.15 in, the thumb's base nearer the knuckles: with less, a
// hand's widest chords lost reach). Measured at rest, in key widths (23.5 mm): the middle finger 3.83 -> 4.27 from its
// knuckle, the palm 4.53 -> 4.25 long (wrist joint to that knuckle) and 3.55 -> 3.27 across the knuckles, the thumb
// 4.02 -> 4.31. The shader's patterns (veins, tendons, nails, folds, the sleeve) stay in the old frame (rest0, below),
// so they keep their places on the skin.
export const PROPORTIONS = { palm: { x: 0.92, z: 0.94 }, len: [[1.05, 1.1, 1.06], [1.22, 1.08, 1.02], [1.22, 1.08, 1.02], [1.22, 1.08, 1.02], [1.3, 1.12, 1.05]] };
if (MODEL) {
  MODEL.rest0 = MODEL.pos.slice();                                          // the old (rest) frame, for the shader's patterns
  if (MODEL.hair) MODEL.hair.rest0z = Float32Array.from({ length: MODEL.hair.pos.length / 3 }, (_, i) => MODEL.hair.pos[i * 3 + 2]);
  MODEL.info.bones0 = MODEL.info.bones.map((b) => ({ ...b, head: b.head.slice(), tail: b.tail.slice() }));
}
if (MODEL && PROPORTIONS) {
  const { palm, len } = PROPORTIONS, bones = MODEL.info.bones, bi = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const S = (p) => [p[0] * palm.x, p[1], p[2] * palm.z];
  const W = bones[bi.wrist].head, dW = S(W).map((x, i) => x - W[i]);
  // per bone: what it does to a rest point. 0: the forearm (carried with the wrist), 1: the palm (scaled), 2: a finger bone
  const T = bones.map((b) => ({ kind: b.name === 'lowerarm02' ? 0 : b.name === 'wrist' || b.name.startsWith('metacarpal') ? 1 : 2, h: b.head, h2: null, a: null, L: 0, k: 1 }));
  for (let f = 1; f <= 5; f++) {
    let h2 = S(bones[bi[`finger${f}-1`]].head);
    for (let s = 1; s <= 3; s++) {
      const b = bones[bi[`finger${f}-${s}`]], t = T[bi[`finger${f}-${s}`]], d = b.tail.map((x, i) => x - b.head[i]), L = Math.hypot(...d);
      Object.assign(t, { h2, a: d.map((x) => x / L), L, k: len[f - 1][s - 1] });
      h2 = h2.map((x, i) => x + t.a[i] * L * t.k);
    }
  }
  const map = (p, t) => {
    if (t.kind === 0) return [p[0] + dW[0], p[1] + dW[1], p[2] + dW[2]];
    if (t.kind === 1) return S(p);
    const r = [p[0] - t.h[0], p[1] - t.h[1], p[2] - t.h[2]], al = r[0] * t.a[0] + r[1] * t.a[1] + r[2] * t.a[2];
    const al2 = al < 0 ? al : al <= t.L ? al * t.k : al + t.L * (t.k - 1);   // stretched along the bone only
    return [0, 1, 2].map((i) => t.h2[i] + r[i] + (al2 - al) * t.a[i]);
  };
  const reshape = (pos, si, sw, n) => {
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      let ws = 0;
      for (let q = 0; q < 4; q++) {
        const w = sw[v * 4 + q] / 255; if (!w) continue;
        const m = map(p, T[si[v * 4 + q]]); ws += w;
        for (let i = 0; i < 3; i++) out[v * 3 + i] += w * m[i];
      }
      for (let i = 0; i < 3; i++) out[v * 3 + i] = ws ? out[v * 3 + i] / ws : p[i];
    }
    pos.set(out);
  };
  reshape(MODEL.pos, MODEL.si, MODEL.sw, MODEL.info.verts);
  if (MODEL.hair) reshape(MODEL.hair.pos, MODEL.hair.si, MODEL.hair.sw, MODEL.hair.pos.length / 3);
  // the new rig: each bone where its own map puts it (a finger bone from its new head, its new length on)
  bones.forEach((b, i) => {
    const t = T[i];
    if (t.kind === 2) { b.head = t.h2.slice(); b.tail = t.h2.map((x, j) => x + t.a[j] * t.L * t.k); } else { b.head = map(b.head, t); b.tail = map(b.tail, t); }
  });
  const A = MODEL.info.anatomy, hd = (n) => bones[bi[n]].head.map((x) => +x.toFixed(4));
  A.mcp = [1, 2, 3, 4, 5].map((f) => hd(`finger${f}-1`)); A.cmc = hd('finger1-1'); A.wrist = hd('wrist');
  A.meta = [1, 2, 3, 4].map((m) => hd(`metacarpal${m}`));   // (the metacarpals' bases in the palm)
  A.seg0 = [1, 2, 3, 4, 5].map((f) => [1, 2, 3].map((s) => +T[bi[`finger${f}-${s}`]].L.toFixed(4)));   // (the model's own)
  A.seg = [1, 2, 3, 4, 5].map((f) => [1, 2, 3].map((s) => { const b = bones[bi[`finger${f}-${s}`]]; return +Math.hypot(...b.tail.map((x, j) => x - b.head[j])).toFixed(4); }));
  // how much longer fingers 2-5 are than the model's own (for the hand's place over the keys: hands.js)
  const L0 = [2, 3, 4, 5].reduce((s, f) => s + [1, 2, 3].reduce((u, k) => u + T[bi[`finger${f}-${k}`]].L, 0), 0);
  A.fingerScale = [2, 3, 4, 5].reduce((s, f) => s + A.seg[f - 1].reduce((u, x) => u + x, 0), 0) / L0;
}
export const ANATOMY = MODEL ? MODEL.info.anatomy : null;

// The fingertip pads (FINAL-SPEC S2.3), for hands.js to put the skin, not the tip joint, on the key. For each finger
// (thumb first): where its lowest skin lies from its tip joint (the tail of its last bone) when the last bone points
// betas[i] degrees below horizontal: below[i] how far under the joint (negative: above it, the joint lying just outside
// the skin at the end of the finger), ahead[i] how far behind it, toward the knuckle. Taken from the skin bound mostly
// (weight >= 0.5) to the last bone, as tools/hand-metrics.mjs takes the pad, with the pad facing straight down at rest
// (the thumb's: down and toward the fingers, as it plays on its side). Every 5 deg (the spec's 10 deg steps are too
// coarse for a flat finger, whose lowest point slides quickly along the pad). null without the model.
export const PAD_TABLE = MODEL ? (() => {
  const { info, pos, si, sw } = MODEL, nv = info.verts, bi = Object.fromEntries(info.bones.map((b, i) => [b.name, i]));
  const dom = new Int16Array(nv), domW = new Float32Array(nv);
  for (let v = 0; v < nv; v++) { let w = -1, b = 0; for (let j = 0; j < 4; j++) if (sw[v * 4 + j] > w) { w = sw[v * 4 + j]; b = si[v * 4 + j]; } dom[v] = b; domW[v] = w / 255; }
  const betas = Array.from({ length: 23 }, (_, i) => i * 5);
  return [0, 1, 2, 3, 4].map((f) => {
    const k = bi[`finger${f + 1}-3`], b = info.bones[k], T = new THREE.Vector3(...b.tail);
    const a = T.clone().sub(new THREE.Vector3(...b.head)).normalize();
    const c0 = f === 0 ? new THREE.Vector3(1, -1, 0).normalize() : new THREE.Vector3(0, -1, 0);
    const c = c0.addScaledVector(a, -c0.dot(a)).normalize(), P = new THREE.Vector3(), pts = [];
    for (let v = 0; v < nv; v++) if (dom[v] === k && domW[v] >= 0.5) { P.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).sub(T); pts.push(P.dot(a), P.dot(c)); }
    const below = [], ahead = [];
    for (const deg of betas) {
      const s = Math.sin(deg * Math.PI / 180), q = Math.cos(deg * Math.PI / 180);
      let best = -1e9, at = 0;
      for (let i = 0; i < pts.length; i += 2) { const dn = pts[i] * s + pts[i + 1] * q; if (dn > best) { best = dn; at = pts[i] * q - pts[i + 1] * s; } }
      below.push(best); ahead.push(-at);
    }
    return { betas, below, ahead };
  });
})() : null;

// The table above assumes the lowest skin lies in the last bone's upright plane. That holds for fingers 2-5, but the thumb
// plays on its side: its lowest skin lies to the side of the bone (about 0.3 toward the fingers). padLowest gives the
// lowest skin as the mesh is posed: each finger bone is turned as update() below turns it (from the wrist, through the
// metacarpal, each bone keeping the twist of the one before), and the pad's points are taken through the last bone's turn.
// Its height is the lowest point's exactly (from the pad's corner points); where it lies along and across the pad is the
// average of the points near the bottom (one per 0.035 cell), weighted by exp(-height above the lowest / padSoft), so that it slides smoothly over the pad
// as the finger turns (the lowest point alone jumps from one end of a flat part to the other).
// jh: the finger's four joints in the hand's frame (as update() gets them), upH: the world's up in the hand's frame.
// Returns that point's offset from the tip joint jh[3], in the hand's frame. (null without the model)
const padSoft = 0.025;
const PADS = MODEL ? (() => {
  const { info, pos, si, sw } = MODEL, nv = info.verts, bi = Object.fromEntries(info.bones.map((b, i) => [b.name, i]));
  const H = info.bones.map((b) => new THREE.Vector3(...b.head)), T = info.bones.map((b) => new THREE.Vector3(...b.tail));
  const D = H.map((h, i) => T[i].clone().sub(h).normalize());
  const dirs = [], N = 800, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y); dirs.push([r * Math.cos(ga * i), y, r * Math.sin(ga * i)]); }
  return [0, 1, 2, 3, 4].map((f) => {
    const bones = [1, 2, 3].map((s) => bi[`finger${f + 1}-${s}`]), k = bones[2], P = [];
    for (let v = 0; v < nv; v++) {
      let w = -1, b = 0; for (let j = 0; j < 4; j++) if (sw[v * 4 + j] > w) { w = sw[v * 4 + j]; b = si[v * 4 + j]; }
      if (b === k && w / 255 >= 0.5) P.push([pos[v * 3] - T[k].x, pos[v * 3 + 1] - T[k].y, pos[v * 3 + 2] - T[k].z]);
    }
    const cells = new Map();
    for (const p of P) { const c = p.map((x) => Math.floor(x / 0.035)).join(','); if (!cells.has(c)) cells.set(c, p); }
    const pts = Float32Array.from([...cells.values()].flat());
    // (and the pad's corner points: the points furthest out in some direction, for the lowest height exactly)
    const keep = new Set();
    for (const d of dirs) { let best = -1e9, at = 0; P.forEach((p, i) => { const s = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (s > best) { best = s; at = i; } }); keep.add(at); }
    const hull = Float32Array.from([...keep].flatMap((i) => P[i]));
    return { meta: f ? bi[`metacarpal${f}`] : -1, bones, pts, hull, H, D };
  });
})() : null;
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), va = new THREE.Vector3(), vd = new THREE.Vector3(), vu = new THREE.Vector3();
export function padLowest(f, jh, upH) {
  if (!PADS) return null;
  const { meta, bones, pts, hull, H, D } = PADS[f];
  qa.identity();                                                     // the wrist: not turned (update(): Rq[wr])
  if (meta >= 0) qa.setFromUnitVectors(D[meta], vd.set(jh[0][0] - H[meta].x, jh[0][1] - H[meta].y, jh[0][2] - H[meta].z).normalize());
  for (let s = 0; s < 3; s++) {
    vd.set(jh[s + 1][0] - jh[s][0], jh[s + 1][1] - jh[s][1], jh[s + 1][2] - jh[s][2]).normalize();
    va.copy(D[bones[s]]).applyQuaternion(qa);
    qb.setFromUnitVectors(va, vd); qa.premultiply(qb);
  }
  // the world's up turned back into the last bone's rest frame, so that the pad's points need not be turned one by one
  vu.set(upH[0], upH[1], upH[2]).applyQuaternion(qb.copy(qa).invert());
  let low = Infinity;
  for (let i = 0; i < hull.length; i += 3) { const h = hull[i] * vu.x + hull[i + 1] * vu.y + hull[i + 2] * vu.z; if (h < low) low = h; }
  let sw = 0, sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const e = (pts[i] * vu.x + pts[i + 1] * vu.y + pts[i + 2] * vu.z - low) / padSoft; if (e > 12) continue;
    const w = Math.exp(-e); sw += w; sx += w * pts[i]; sy += w * pts[i + 1]; sz += w * pts[i + 2];
  }
  va.set(sx / sw, sy / sw, sz / sw);
  va.addScaledVector(vu, low - va.dot(vu)).applyQuaternion(qa);   // (at the lowest point's height exactly)
  return [va.x, va.y, va.z];
}


// skin tones (albedo, sRGB): hue about 20-22 degrees, as measured on photographs of real hands; the redder knuckles,
// fingertips and nail folds are painted over this in the shader (in the Short the whole hand comes out at about 17 degrees)
// (fair: pale and a little pink, as the pianist's hands in the reference video: under the warm key light of "Sheet music
// + hands" the back of the hand comes out at about hue 22 degrees, saturation 0.45, theirs at 23 and 0.5)
export const SKIN_TONES = { fair: '#ecc6b8', light: '#e6bca4', medium: '#cc9a80', tan: '#ab7a5e', deep: '#704a36' };
const SKIN_DEFAULT = SKIN_TONES.fair;   // the hands' tone unless one is asked for

// ---- the hand's own (rest) frame, worked out once from the rig: the nails, the joints, the capsules
const REST = (() => {
  if (!MODEL) return null;
  // (the nails and the joints for the shader are in the old frame, as rest0 is; the capsules and the bones' rest
  // directions are in the new one, as the bones are)
  const bones = MODEL.info.bones, bones0 = MODEL.info.bones0, bi = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const V = (a) => new THREE.Vector3(...a);
  const upOf = (f, d) => { const u = f > 1 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(-0.55, 0.83, 0); return u.addScaledVector(d, -u.dot(d)).normalize(); };   // the back of the finger (as tools/build_hand.py)
  // The nails, worked out per pixel from the end bones (not from the baked per-vertex coordinates, whose cut at the edge
  // of the nail made jagged seams). Per finger: [lateral edge |v| (sine of the angle from the back), cuticle a, free-edge
  // end a, lunula length (fraction of the bone)]; a runs along the end bone, 0 at the last joint and 1 at the bone's tail.
  // Fitted to measured nails (Jung et al. 2015): lengths 14.6, 13.3, 13.3, 12.7, 10.7 mm from the thumb to the little
  // finger, about 0.78 of the fingertip's width, visible lunulae about 2.6, 1.5, 1.4, 0.8 and 0 mm.
  const NAIL_SHAPE = [[0.85, 0.47, 1.04, 0.10], [0.78, 0.47, 0.99, 0.06], [0.78, 0.45, 0.94, 0.05], [0.78, 0.55, 1.02, 0.03], [0.80, 0.50, 1.03, 0.0]];
  const nH = [], nD = [], nU = [], nP = [];
  for (let f = 1; f <= 5; f++) {
    const b = bones0[bi[`finger${f}-3`]], h = V(b.head), d = V(b.tail).sub(h), L = d.length(); d.normalize();
    nH.push(new THREE.Vector4(h.x, h.y, h.z, L)); nD.push(d); nU.push(upOf(f, d)); nP.push(new THREE.Vector4(...NAIL_SHAPE[f - 1]));
  }
  // the 14 finger joints (the thumb's two, and three on each finger), each with the bone before it (for how far it bends)
  const joints = [];
  for (let f = 1; f <= 5; f++) for (let s = f === 1 ? 2 : 1; s <= 3; s++) {
    const b = bi[`finger${f}-${s}`], parent = s > 1 ? bi[`finger${f}-${s - 1}`] : bi[`metacarpal${f - 1}`];
    const h = V(bones0[b].head), d = V(bones0[b].tail).sub(h).normalize();
    joints.push({ b, parent, f, s, P: new THREE.Vector4(h.x, h.y, h.z, s === 1 ? 1 : 0), D: new THREE.Vector4(d.x, d.y, d.z, f - 1), U: upOf(f, d) });
  }
  const restVec = bones.map((b) => V(b.tail).sub(V(b.head)));
  // capsules round each finger bone and metacarpal (radii in key widths, from the measured finger widths; fingers 2-5
  // as thin as SLIM made them)
  const CAP_R = [[0.40, 0.37, 0.33], [0.36, 0.31, 0.28], [0.37, 0.32, 0.29], [0.35, 0.30, 0.27], [0.31, 0.27, 0.24]]
    .map((r, f) => (!SLIM || f === 0 ? r : [r[0] * (f === 4 ? SLIM.little1 : SLIM.prox), r[1] * SLIM.mid, r[2] * SLIM.dist]));
  const caps = [];
  for (let f = 1; f <= 5; f++) for (let s = 1; s <= 3; s++) caps.push([bi[`finger${f}-${s}`], CAP_R[f - 1][s - 1]]);
  for (let m = 1; m <= 4; m++) caps.push([bi[`metacarpal${m}`], 0.42]);
  return { nH, nD, nU, nP, joints, restVec, caps };
})();

// ---- what the hands share with the scene around them (keys.js fills these in): the hands' own shadow map, the
// capsules for contact shading, and the hands-only lights (a rim from behind, the light bounced up from the keys)
const v4n = (n, w = 0) => Array.from({ length: n }, () => new THREE.Vector4(0, -99, 0, w));
export const HAND_FX = {
  uniforms: {
    uHandW: { value: 32 }, uHandDepth: { value: 12 }, uKeyTheta: { value: 0.07 },
    uCapA: { value: v4n(38, 0.01) }, uCapB: { value: v4n(38, 0.01) }, uCapS: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uRimDirW: { value: new THREE.Vector3(0.25, 0.55, -0.8).normalize() }, uRimCol: { value: new THREE.Color(0, 0, 0) },
    uBounce: { value: new THREE.Color(0, 0, 0) }, uKeyTint: { value: new THREE.Color(1, 1, 1) }, uShoulder: { value: 1 }, uArmFade: { value: 0 },
    // the dark sleeves (skin and porcelain; glass stays bare): x the cuff (along the arm, the hand's frame: 0.36 key
    // widths, 8 mm, past the wrist joint), y on (1) or off (0), z how far the knit stands off the skin (1.9 mm), w the
    // cuff's ribbing; and the knit's colour
    uSleeve: { value: new THREE.Vector4(4.75, 1, 0.08, 1) }, uSleeveCol: { value: new THREE.Color('#0d0c0d') },
    // the pool of light round the hands, on the keyboard (keys.js moves it): the key light on the keys and the case is
    // full over the stretch of keys each hand covers and falls off away from them, like a lamp held over the hands.
    // uPool: those stretches (world x, white keys: the right hand's from x to y, the left hand's from z to w); uPoolK:
    // x how far the light falls off beyond them (white keys, a Gaussian), y the share left far from both (1: no pool),
    // z the share inside a pool (below 1, the keys a little darker than the hands under the same light), w how far the
    // room's own light on the keys (ambient, reflections) falls off with it too; uPoolZ: toward the back of the keys the
    // light falls to x of itself (from z = y back to 0), so the line where the notes meet the keys lies in soft shade
    // and a struck key's flash shows against it.
    uPool: { value: new THREE.Vector4(0, 0, 0, 0) }, uPoolK: { value: new THREE.Vector4(8, 1, 1, 0) }, uPoolZ: { value: new THREE.Vector2(1, 4) },
  },
  // the sleeves on or off (keys.js; no rebuild)
  setSleeves(on) { HAND_FX.uniforms.uSleeve.value.y = on ? 1 : 0; },
  // fill the capsules from the posed bones (two hands, 19 capsules each) and a bounding sphere round each hand
  capsules(draw) {
    const U = HAND_FX.uniforms, A = U.uCapA.value, B = U.uCapB.value, S = U.uCapS.value;
    if (!REST || !draw?.meshes?.[0]?.bones) return false;
    const e = new THREE.Vector3();
    draw.meshes.forEach(({ bones, mesh }, h) => {
      let k = h * 19; const c = S[h].set(0, 0, 0, 0); let n = 0;
      for (const [i, r] of REST.caps) {
        A[k].setFromMatrixPosition(bones[i].matrixWorld); A[k].w = r;
        e.copy(REST.restVec[i]).applyMatrix4(bones[i].matrixWorld); B[k].set(e.x, e.y, e.z, r);
        c.x += A[k].x + B[k].x; c.y += A[k].y + B[k].y; c.z += A[k].z + B[k].z; n += 2; k++;
      }
      c.x /= n; c.y /= n; c.z /= n;
      let rad = 0; for (let j = h * 19; j < k; j++) rad = Math.max(rad, Math.hypot(A[j].x - c.x, A[j].y - c.y, A[j].z - c.z), Math.hypot(B[j].x - c.x, B[j].y - c.y, B[j].z - c.z));
      c.w = mesh.visible ? rad + 3 : 0;
    });
    return true;
  },
};

// GLSL shared by the skin and the keys: the hands' own shadow, with a penumbra that is sharp where a finger touches and
// widens with distance (worked out from the comparison sampler: the share of the disk blocked at several depths gives
// the mean distance to what blocks the light); on skin, red light spreads further under the surface than green and blue,
// so the edge of a shadow turns warm. Light 1 (a light that only makes this map) is used for light 0 (the key light).
const HAND_SHADOW_GLSL = `
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && NUM_DIR_LIGHT_SHADOWS > 1
#define HAND_SUN 1
uniform float uHandW, uHandDepth, uKeyTheta;
float hsIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 hsVogel(int i, int n, float phi) { float r = sqrt((float(i) + 0.5) / float(n)); float th = float(i) * 2.399963229728653 + phi; return vec2(cos(th), sin(th)) * r; }
vec3 handShadow(sampler2DShadow sm, vec4 sc4, bool skin, float ndl) {
  vec3 sc = sc4.xyz / sc4.w;
  // the receiver's slope in the map, so the taps follow the surface instead of shadowing it
  vec3 dx = dFdx(sc), dy = dFdy(sc);
  mat2 M = mat2(dx.x, dy.x, dx.y, dy.y);
  vec2 g = abs(determinant(M)) > 1e-14 ? inverse(M) * vec2(dx.z, dy.z) : vec2(0.0);
  float gmax = 3.0 * uHandW / uHandDepth, gl = length(g);
  if (gl > gmax) g *= gmax / gl;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || ndl < -0.2) return vec3(1.0);   // (facing away: no key light anyway)
  float z0 = sc.z + directionalLightShadows[ 1 ].shadowBias;
  float K = directionalLightShadows[ 1 ].shadowIntensity;
  float phi = hsIGN(gl_FragCoord.xy) * PI2;
  vec2 uvU = vec2(1.0, 2.0) / uHandW;                      // the frustum is W x W/2 on a 2:1 map
  const float DMAX = 3.0;
  vec2 rs = DMAX * uKeyTheta * uvU;
  float lit0 = 0.0;
  for (int i = 0; i < 12; i++) { vec2 o = hsVogel(i, 12, phi) * rs; lit0 += texture(sm, vec3(sc.xy + o, z0 + dot(g, o))); }
  if (lit0 > 11.99) return vec3(1.0);                       // nothing nearer the light anywhere near: lit
  if (lit0 < 0.01) return vec3(1.0 - K);                    // blocked all round: in the umbra
  float D[4] = float[4](0.08, 0.3, 1.0, 3.0);
  float P0 = 1.0 - lit0 / 12.0, Pp = P0, Dp = 0.0, Ed = 0.0;
  for (int k = 0; k < 4; k++) { float lit = 0.0, dz = D[k] / uHandDepth;
    for (int i = 0; i < 8; i++) { vec2 o = hsVogel(i, 8, phi + 0.7) * rs; lit += texture(sm, vec3(sc.xy + o, z0 + dot(g, o) - dz)); }
    float Pk = 1.0 - lit / 8.0; Ed += 0.5 * (Pp + Pk) * (D[k] - Dp); Pp = Pk; Dp = D[k]; }
  float w = max(clamp(Ed / max(P0, 1e-3), 0.0, DMAX) * uKeyTheta, 1.5 * uHandW / 4096.0);   // penumbra width (key widths)
  float sg = 0.35 * w * 23.5;                                // its Gaussian, in mm
  float Rmm = 2.3 * sg + (skin ? 2.6 : 0.0);
  vec3 s2 = vec3(sg * sg) + (skin ? vec3(1.3, 0.18, 0.05) : vec3(0.0)) + 1e-4;
  vec3 s = vec3(0.0), ws = vec3(0.0);
  for (int i = 0; i < 24; i++) { vec2 o = hsVogel(i, 24, phi + 1.3); float r = length(o) * Rmm; vec3 wt = exp(-r * r / (2.0 * s2));
    vec2 ou = o * (Rmm / 23.5) * uvU; s += wt * texture(sm, vec3(sc.xy + ou, z0 + dot(g, ou))); ws += wt; }
  return mix(vec3(1.0), s / ws, K);
}
#endif`;
// the capsules: soft occlusion of the ambient light by the fingers and the palm (the dark pool under a hand and the spot
// under a pressing fingertip; on skin the webs, the sides of neighbouring fingers and the palm's hollow)
const HAND_CAPS_GLSL = `
uniform vec4 uCapA[38], uCapB[38], uCapS[2];
// x: the ambient light's occlusion; y: the contact term (only what is within a finger's width or so)
vec2 capsAO(vec3 p, vec3 n, bool selfSkip) {
  float occ = 0.0, near = 0.0;
  for (int hd = 0; hd < 2; hd++) {
    vec4 S = uCapS[hd]; if (S.w <= 0.0 || distance(p, S.xyz) > S.w) continue;
    for (int j = 0; j < 19; j++) {
      int i = hd * 19 + j;
      vec3 a = uCapA[i].xyz, ba = uCapB[i].xyz - a; float r = uCapA[i].w;
      float h = clamp(dot(p - a, ba) / dot(ba, ba), 0.0, 1.0); vec3 d = a + h * ba - p; float l = length(d);
      if (selfSkip && l < 1.18 * r) continue;
      l = max(l, 1.02 * r);
      float ff = (r * r) / (l * l) * clamp(dot(n, d) / l, 0.0, 1.0) * (1.0 + 0.8 * clamp(length(ba) / (4.0 * r), 0.0, 1.0));
      occ += ff; near += ff * smoothstep(2.6 * r, 1.3 * r, l);
    }
  }
  return exp(-1.3 * vec2(occ, near));
}`;
// the pool of light round the hands (HAND_FX.uPool, uPoolK, uPoolZ): the share of the key light at world point p
export const HAND_POOL_GLSL = `
uniform vec4 uPool, uPoolK; uniform vec2 uPoolZ;
float hsPoolShape(vec3 p) {   // 1 in a pool, falling off away from the hands and toward the back of the keys
  float d = min(max(0.0, max(uPool.x - p.x, p.x - uPool.y)), max(0.0, max(uPool.z - p.x, p.x - uPool.w)));
  return mix(uPoolK.y, 1.0, exp(-pow(d / uPoolK.x, 2.0))) * mix(uPoolZ.x, 1.0, smoothstep(0.0, uPoolZ.y, p.z));
}
float hsPool(vec3 p) { return uPoolK.z * hsPoolShape(p); }`;
// patch a material of the keyboard to take the hands' shadow and contact shading, and the pool of light round the
// hands (keys.js). Any patch the material already has runs first, and the two cache keys are joined, so another patch
// of the same material is kept.
export function handReceiver(m) {
  if (m.userData.handReceiver) return m;   // (materials shared by many keys: patched once)
  m.userData.handReceiver = true;
  const prev = m.hasOwnProperty('onBeforeCompile') ? m.onBeforeCompile : null;
  // (a patch without its own key is told apart by its code, as three.js's default key does)
  const prevKey = m.hasOwnProperty('customProgramCacheKey') ? m.customProgramCacheKey : prev ? () => prev.toString() : null;
  m.onBeforeCompile = (sh, renderer) => {
    if (prev) prev.call(m, sh, renderer);
    for (const k of ['uHandW', 'uHandDepth', 'uKeyTheta', 'uCapA', 'uCapB', 'uCapS', 'uPool', 'uPoolK', 'uPoolZ']) sh.uniforms[k] = HAND_FX.uniforms[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvKW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = patchShadowLoop(sh.fragmentShader, 'false')
      .replace('#include <common>', '#include <common>\nvarying vec3 vKW;' + HAND_POOL_GLSL + '\n#define HS_TINT vec3( hsPool( vKW ) )\n#define HS_NDL 1.0' + HAND_CAPS_GLSL)
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>' + HAND_SHADOW_GLSL)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { vec2 ao = capsAO(vKW, inverseTransformDirection(normal, viewMatrix), false);
          float room = ao.x * mix(1.0, hsPoolShape(vKW), uPoolK.w);   // (the room's light falls off with the pool too)
          reflectedLight.indirectDiffuse *= room; reflectedLight.indirectSpecular *= room;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= room;
          #endif
          // right under a touching fingertip the soft key light is partly blocked too (the contact spot)
          reflectedLight.directDiffuse *= mix(1.0, ao.y, 0.35); reflectedLight.directSpecular *= mix(1.0, ao.y, 0.35); }`);
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) + '|' : '') + 'hand-receiver2';
  return m;
}
// the key light's line in three.js's directional-light loop, followed by the hands' own shadow for light 0
function patchShadowLoop(src, skin) {
  const line = 'vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!src.includes('#include <lights_fragment_begin>')) throw new Error('hand shadow: no lights_fragment_begin');
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(line)) throw new Error('hand shadow: three.js changed lights_fragment_begin');
  // (light 1 itself adds no light: skip it)
  const open = '\t\tdirectionalLight = directionalLights[ i ];', re = '\t\t#endif\n\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  if (!chunk.includes(open) || !chunk.includes(line + '\n' + re)) throw new Error('hand shadow: three.js changed the directional-light loop');
  return src.replace('#include <lights_fragment_begin>', chunk.replace(open, '\t\t#if !defined( HAND_SUN ) || ( UNROLLED_LOOP_INDEX != 1 )\n' + open).replace(line + '\n' + re, `${line}
		#if defined( HAND_SUN )
		if ( UNROLLED_LOOP_INDEX == 0 && receiveShadow ) directLight.color *= handShadow( directionalShadowMap[ 1 ], vDirectionalShadowCoord[ 1 ], ${skin}, HS_NDL ) * HS_TINT;
		#endif
${re}
		#endif`));
}

// the skin: a physical material with soft sheen, and the build's tags painted in (redder knuckles, a paler palm, where
// the hair grows); surface detail worked out in the hand's own (rest) space so it moves with the skin
// the veins and tendons on the back of the hand and forearm, as segments (x0, z0, x1, z1) in the hand's frame
const poly = (pts) => pts.slice(1).flatMap((q, i) => [pts[i][0], pts[i][1], q[0], q[1]]);
const VEINS = [
  ...poly([[-0.75, 0.7], [-0.85, 1.8], [-0.5, 3.0], [0.25, 4.2], [0.6, 6.0], [0.9, 8.5]]),   // up the thumb side (cephalic)
  ...poly([[0.45, 0.6], [0.35, 1.6], [0.05, 2.5], [-0.55, 2.95]]),
  ...poly([[0.05, 2.5], [0.9, 2.7], [1.6, 2.6]]),                                        // the arch
  ...poly([[1.4, 0.7], [1.25, 1.7], [0.9, 2.7]]),
  ...poly([[1.6, 2.6], [2.0, 3.6], [2.15, 5.0], [2.4, 6.5], [2.8, 8.5]]),                // up the little finger's side (basilic)
  ...poly([[1.1, 4.7], [1.5, 6.5], [1.8, 8.5]]),
];
const TENDONS = [-1.13, 0.5, 0.55, 4.3, 0, 0.4, 0.85, 4.3, 0.93, 0.4, 1.2, 4.3, 1.86, 0.5, 1.6, 4.3];
const v4s = (a) => Array.from({ length: a.length / 4 }, (_, i) => new THREE.Vector4(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]));
const VEIN_V4 = v4s(VEINS), TENDON_V4 = v4s(TENDONS);
const NOISE = `
float hh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh3(i), hh3(i + vec3(1,0,0)), f.x), mix(hh3(i + vec3(0,1,0)), hh3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh3(i + vec3(0,0,1)), hh3(i + vec3(1,0,1)), f.x), mix(hh3(i + vec3(0,1,1)), hh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
// fade a pattern of frequency k out before it gets finer than the pixels (no shimmer)
float lod(float k) { return 1.0 - smoothstep(0.35, 0.9, length(fwidth(vRest)) * k); }
// cellular noise: the distances to the nearest and second-nearest of points jittered in a grid (F2 - F1 is near zero
// along the cells' borders)
vec3 cellR = vec3(0.0);   // (the step from the nearest point to the second: the border between them runs across it)
vec3 hh33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
vec2 cellF(vec3 x) {
  vec3 i = floor(x), f = fract(x), r1 = vec3(0.0), r2 = vec3(0.0); float d1 = 9.0, d2 = 9.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int e = -1; e <= 1; e++) {
    vec3 o = vec3(float(a), float(b), float(e));
    vec3 r = o + 0.1 + 0.8 * hh33(i + o) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; } else if (d < d2) { d2 = d; r2 = r; }
  }
  cellR = r2 - r1;
  return sqrt(vec2(d1, d2));
}`;

// the nail's outline in the hand's rest frame (shared by the vertex stage, for the nail's shape, and the pixels)
const NAIL_GLSL = `
uniform vec4 uNailH[5]; uniform vec3 uNailD[5]; uniform vec3 uNailU[5]; uniform vec4 uNailP[5];
struct NailGeo { float a; float v; float c; float r; float L; int f; float d; };
NailGeo nailGeo(vec3 p) {
  NailGeo g = NailGeo(-1.0, 0.0, -1.0, 1.0, 1.0, 0, 9.0); float best = 1e9;
  for (int f = 0; f < 5; f++) {
    vec3 q = p - uNailH[f].xyz; float L = uNailH[f].w, t = dot(q, uNailD[f]);
    float dSeg = length(q - clamp(t, 0.0, L) * uNailD[f]);
    if (dSeg < best) { best = dSeg; vec3 rad = q - t * uNailD[f]; float rn = max(length(rad), 1e-4);
      g = NailGeo(t / L, dot(rad, cross(uNailD[f], uNailU[f])) / rn, dot(rad, uNailU[f]) / rn, rn, L, f, dSeg); }
  }
  return g;
}
// signed distance (mm) to the nail's outline, negative on the plate: an arched cuticle, sides that tuck under the folds,
// a trimmed free edge with rounded corners
float nailSD(NailGeo g, float cphi, out float tip, out float aC, out float aE, out float vn) {
  vec4 P = uNailP[g.f]; float mm = g.L * 23.5;
  vn = abs(g.v) / P.x;
  float vc = min(vn, 1.0);
  aC = P.y + 0.035 * vc * vc + 0.05 * (1.0 - sqrt(1.0 - 0.96 * vc * vc));   // the cuticle: one smooth arch, turning into the sides
  aE = P.z - 0.035 * vn * vn * vn * vn;
  float dSide = (atan(abs(g.v), g.c) - asin(P.x)) * g.r * 23.5;      // arc length from the lateral edge (also right round to the palm side)
  float dProx = (aC - g.a) * mm, dTip = (g.a - aE) * mm / cphi;
  tip = smoothstep(-0.3, 0.3, dTip - max(dSide, dProx));
  float R = mix(1.4, 2.0, smoothstep(-1.0, 1.0, dProx - dTip));     // rounder where the cuticle meets the sides
  vec2 q = vec2(dSide, max(dProx, dTip)) + R;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R;
  return min(sd, 40.0);   // (continuous everywhere: a jump would spread the mask's antialiasing across the skin)
}
`;
// The mesh's nail stands 0.66 mm proud of the skin all round (tools/build_hand.py raised it by its tag), with its step
// where the old nail's edge was: the outline drawn per pixel crossed that step, which put a notch in the cuticle and a
// bright line along a side. The vertex stage takes the step out and gives the nail its real shape instead: flush with
// the folds at the cuticle and the sides, rising inwards, and proud of the skin only at the free edge. It moves the
// surface at most 0.02 units, only round the nails (the rig, the weights, the normals and the shape of every finger are
// unchanged; the free edge and the fingertip are not moved at all).
const NAIL_VERT = `
// the shift along the normal: the old raise taken out round the cuticle and the sides (the plate rising inwards over
// 2.5 mm), the free edge and the skin beyond it left as they were
float nailShift(vec3 P, vec3 nR, float old) {
  NailGeo g = nailGeo(P);
  float nd = dot(nR, uNailD[g.f]), cphi = sqrt(max(1.0 - nd * nd, 0.0625)), tip, aC, aE, vn;
  float sd = nailSD(g, cphi, tip, aC, aE, vn);
  return smoothstep(aE - 0.08, aE - 0.4, g.a) * clamp(0.028 * smoothstep(0.0, 2.5, -sd) - old, -0.02, 0.02);
}
`;

// the nail, the joints and the skin's relief, worked out once per pixel
const SKIN_GLSL = `
${NAIL_GLSL}
uniform vec4 uJointP[14]; uniform vec4 uJointD[14]; uniform vec3 uJointU[14]; uniform float uFlex[14];
// what the pixel's skin is (set once, in the colour stage, and used by the later stages)
vec3 skinNGeo = vec3(0.0, 0.0, 1.0), skinNCC = vec3(0.0, 0.0, 1.0);
float skinHgt = 0.0, skinHgtCC = 0.0, skinPlate = 0.0, skinFree = 0.0, skinCut = 0.0, skinNailAO = 1.0, skinTip = 0.0, skinPeri = 0.0;
float skinVein = 0.0, skinFold = 0.0, skinTaut = 0.0, skinDist = 0.0, skinOily = 0.0, skinRadMM = 25.0, skinPress = 0.0, skinAO = 1.0, skinHypo = 0.0, skinRim = 0.0;
float skinSlv = 0.0, skinKnit = 1.0;   // the sleeve (0 bare skin, 1 knit) and the knit's own light and dark
vec3 skinNailCol = vec3(0.0);
// the sleeve over the forearm from the cuff on (uSleeve, see HAND_FX): its share, and the knit's relief (mm) and shade.
// The knit's wales run along the arm; the cuff's ribs run round it (46 of them), over its first 0.7 key widths.
float sleeveAt(vec3 P) { return uSleeve.y * smoothstep(uSleeve.x, uSleeve.x + 0.1, P.z); }
float sleeveKnit(vec3 P, out float shade) {
  vec3 c = vec3(1.1151, 0.0, 4.3869) + vec3(1.005, -1.2972, 5.052) * ((P.z - 4.3869) / 5.052);   // the forearm's axis (the rig's lowerarm bone)
  float ang = atan(P.y - c.y, P.x - c.x), cuff = 1.0 - smoothstep(uSleeve.x + 0.2, uSleeve.x + 0.7, P.z);
  float rib = sin(ang * 46.0) * lod(14.0) * cuff * uSleeve.w;
  float wale = abs(sin(ang * 70.0 + 1.3 * vn3(P * 4.0))) * lod(22.0);                             // the stitches' columns
  float n1 = vn3(P * vec3(30.0, 30.0, 8.0)), n2 = vn3(P * vec3(3.0, 3.0, 1.2));                  // fibre and the knit's slight unevenness
  shade = (0.84 + 0.16 * n1) * (0.93 + 0.14 * n2) * (1.0 + 0.12 * rib) * (0.94 + 0.06 * wale);
  return 0.18 * rib + 0.06 * (wale - 0.5) + 0.05 * (n1 - 0.5);
}
// a narrow line exp(-(x/w)^2) widened to the pixel's footprint fw (same units as x), its area kept: it never gets finer
// than a pixel, so it cannot break into dots or dashes
float gLine(float x, float w, float fw) { float w2 = sqrt(w * w + 2.25 * fw * fw); return (w / w2) * exp(-x * x / (w2 * w2)); }
vec3 nailColor(NailGeo g, float cphi, float sd, float tip, float aC, float aE, float vn, float NdotV, float press, vec3 p, float fwT) {
  float mm = g.L * 23.5, fromCut = (g.a - aC) * mm, toEnd = (aE - g.a) * mm / cphi;
  // the bed seen through the plate: pink, lighter than the skin, a little uneven
  vec3 bed = vec3(0.72, 0.38, 0.35) * (0.95 + 0.07 * vn3(vec3(g.v * 9.0, g.a * 1.5, float(g.f))));
  bed *= 0.99 + 0.02 * vn3(vec3(asin(clamp(g.v, -1.0, 1.0)) * g.r * 23.5 * 1.6, g.a * 2.0, float(g.f) * 3.0));   // faint lengthwise unevenness
  // the lunula: a pale, milky half-moon at the base (largest on the thumb), convex towards the tip
  float lunEnd = uNailP[g.f].w * mm * (1.0 - 0.45 * vn * vn);
  bed = mix(bed, vec3(0.76, 0.50, 0.47), 0.6 * smoothstep(lunEnd + 0.8, lunEnd - 0.8, fromCut) * smoothstep(1.0, 0.7, vn) * step(0.05, uNailP[g.f].w));
  // the free edge: ivory where the plate leaves the bed (air beneath it), reaching further back at the corners
  float W = 0.6 + 0.5 * vn * vn, wf = max(0.15, fwT);
  float fe = smoothstep(W + wf, W - wf, toEnd);
  bed = mix(bed, bed * vec3(0.88, 0.66, 0.60), 0.6 * gLine(toEnd - W - 0.4, 0.32, fwT));                   // onychodermal band: warm, not grey
  bed = mix(bed, vec3(0.80, 0.66, 0.55), press * 0.55 * smoothstep(0.35, 0.95, 1.0 - toEnd / max(mm * (aE - aC), 1.0)));  // a pressing finger blanches the front of the bed
  vec3 col = mix(bed, vec3(0.80, 0.72, 0.62) * (0.96 + 0.06 * vn3(p * 40.0)), fe);
  skinFree = fe;
  // the plate itself: milky, whiter at grazing angles; a thin dull cuticle film just beyond the fold
  col = mix(col, vec3(0.80, 0.70, 0.66), (0.08 + 0.3 * pow(1.0 - NdotV, 3.0) * clamp(1.0 - vn, 0.0, 1.0)) * (1.0 - fe));   // (not along the sides, which tuck under skin)
  float cut = smoothstep(1.0, 0.25, fromCut) * smoothstep(-0.2, 0.15, fromCut) * smoothstep(1.0, 0.6, vn);
  skinCut = cut;
  col = mix(col, col * vec3(0.95, 0.92, 0.92) + vec3(0.03, 0.022, 0.02), 0.5 * cut);
  return col;
}
// the nearest finger joint (in rest space): its coordinate along the finger, the back and palm sides, how far it bends
struct JointC { float t; float dors; float pal; float w; float flex; float knuckle; };
JointC jointAt(vec3 p) {
  JointC J = JointC(9.0, 0.0, 0.0, 0.0, 0.0, 0.0); float best = 1e9;
  for (int j = 0; j < 14; j++) {
    vec3 q = p - uJointP[j].xyz, d = uJointD[j].xyz; float tt = dot(q, d);
    vec3 rad = q - tt * d; float rn = max(length(rad), 1e-4);
    float dist = abs(tt) + 0.5 * max(0.0, rn - 0.5);
    if (dist < best) { best = dist; float cu = dot(rad, uJointU[j]) / rn;
      J = JointC(tt, clamp((cu - 0.1) / 0.5, 0.0, 1.0), clamp((-cu - 0.2) / 0.5, 0.0, 1.0), 0.0, uFlex[j], uJointP[j].w); }
  }
  J.w = exp(-pow(J.t / mix(0.24, 0.32, J.knuckle), 2.0));
  return J;
}
// everything about the pixel's skin, once: the nail (geometry, colour, mask), the joints, and the height of the relief
void skinPrep(bool skin) {
  vec3 p = vRest + uSeed * 17.0;                    // per-hand noise (the two hands are not mirror copies)
  skinSlv = sleeveAt(vRest);
  NailGeo g = nailGeo(vRest);
  float nd = dot(normalize(vRestN), uNailD[g.f]), cphi = sqrt(max(1.0 - nd * nd, 0.0625));
  float tip, aC, aE, vn;
  float sd = nailSD(g, cphi, tip, aC, aE, vn);
  float fw = clamp(fwidth(sd), 0.02, 3.0);
  skinPlate = 1.0 - smoothstep(-fw, fw, sd);
  skinTip = smoothstep(0.55, 0.9, g.a) * smoothstep(0.25, -0.35, g.c) * smoothstep(0.7, 0.45, g.d);   // the fingertip's pad
  skinPeri = smoothstep(-fw, fw, sd) * exp(-pow(sd / 2.2, 2.0)) * (1.0 - tip);                 // the skin round the nail
  skinDist = smoothstep(0.05, 0.8, g.a) * smoothstep(0.75, 0.5, g.d);                            // the last finger bone: pinker towards the tip
  skinRadMM = mix(25.0, g.d * 23.5, smoothstep(0.7, 0.45, g.d));
  skinPress = smoothstep(0.3, 0.6, max(uHot[g.f].w, uHot[5 + g.f].w)) * smoothstep(0.7, 0.45, g.d);
  skinOily = clamp(max(vTags.g * 0.7, skinTip), 0.0, 1.0);
  // the nail's colour
  float NdotV = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
  float mmN = g.L * 23.5, fromCut = (g.a - aC) * mmN, fwT = clamp(fwidth((aE - g.a) * mmN / cphi), 0.02, 3.0);
  skinNailCol = skin && sd < 4.0 ? nailColor(g, cphi, sd, tip, aC, aE, vn, NdotV, skinPress, p, fwT) : vec3(1.0);
  if (skinPlate < 0.001) { skinFree = 0.0; skinCut = 0.0; }
  // occlusion in the grooves under the folds, and the line of the hyponychium just beyond the free edge (warm skin in
  // the shade of the free edge: a colour, not grey; at the tip only), each no finer than a pixel
  skinNailAO = 1.0 - 0.3 * gLine(sd, 0.4, fw) * (1.0 - tip) - 0.12 * gLine(sd - 0.3, 0.22, fw) * tip;
  skinHypo = gLine(sd - 0.3, 0.22, fw) * tip * smoothstep(0.8, 0.4, vn);
  skinRim = skinPlate * smoothstep(0.45, 0.95, vn);                                            // the plate's sides, in the folds' shade
  // ---- the height (mm, turned into key widths at the end); hF: the fine relief, which the clear top sees only in part
  float h = 0.0, hF = 0.0;
  JointC J = jointAt(vRest);
  float stretch = smoothstep(0.2, 1.25, J.flex);
  float tm = J.t * 23.5 + 0.7 * (vn3(p * 9.0) - 0.5);                                         // mm along the finger from the joint
  float ftm = fwidth(tm);
  if (skin) {
    // pores, and the skin's net of fine furrows: the edges of irregular cells about 0.8 mm across, drawn out across the
    // finger (the rhomboid pattern of real skin), of varying depth, faded before they shimmer
    float lp = lod(150.0);
    if (lp > 0.0) hF -= smoothstep(0.6, 0.85, vn3(p * 150.0)) * 0.02 * lp;
    float lf = lod(34.0), ce = 1.0, across = 0.0;
    if (lf > 0.0 && skinPlate < 0.999) { vec2 F = cellF(p * vec3(24.0, 30.0, 36.0)); ce = F.y - F.x; across = abs(normalize(cellR).z); }
    float we = max(0.14, 1.5 * fwidth(ce));
    // the borders running across the finger deepest, the ones along it faint; some fade out altogether
    float deep = mix(0.25, 1.0, across * across) * smoothstep(0.15, 0.75, vn3(p * 9.0 + 3.0));
    hF -= (1.0 - smoothstep(0.0, we, ce)) * (0.14 / we) * 0.014 * lf * deep;
    hF += (vn3(p * 60.0) - 0.5) * 0.01 * lod(60.0);
  }
  // folds over the back of each joint: bunched when the finger is straight, stretched out when it curls (as in playing)
  float folds = 0.0;
  float sp = mix(1.15, 1.7, J.knuckle);
  if (J.w > 0.003) for (int k = -2; k <= 2; k++) { float c0 = float(k) * sp + 0.35 * (vn3(vec3(float(k) * 3.1, p.xz * 5.0)) - 0.5);
    folds += exp(-pow((tm - c0) / 0.22, 2.0)) * (1.0 - 0.17 * float(k * k)); }
  float fl = 1.0 - smoothstep(0.25, 0.8, ftm / sp);
  float dorsW = J.dors * J.w;
  h -= folds * dorsW * 0.08 * mix(1.5, 0.55, stretch) * fl * (0.55 + 0.45 * vn3(p * 6.0));
  h -= dorsW * 0.12 * mix(1.0, 0.25, stretch) * exp(-pow(tm / 1.8, 2.0));                     // a broad soft dip across the joint
  skinFold = dorsW * mix(0.9, 0.3, stretch) * (0.4 + 0.6 * folds * fl);
  skinTaut = J.dors * exp(-pow(J.t / 0.42, 2.0)) * stretch;                                  // the skin drawn tight over a bent knuckle: smoother, shinier
  // the palm side: one or two deep creases that close up as the finger curls
  float palW = J.pal * J.w * (1.0 - J.knuckle * 0.5);
  h -= palW * (exp(-pow(tm / 0.3, 2.0)) + 0.6 * exp(-pow((tm - 1.7) / 0.3, 2.0))) * 0.08 * mix(0.6, 1.4, stretch) * (1.0 - smoothstep(0.25, 0.8, ftm / 0.9));
  skinFold = max(skinFold, palW * 0.6);
  // veins on the back of the hand and up the forearm: soft, raised (a Gaussian about 3 mm wide)
  float up = smoothstep(-0.1, 0.35, vRestN.y), upF = smoothstep(-0.6, -0.1, vRestN.y);
  float vmask = mix(up, upF, smoothstep(4.0, 5.0, vRest.z)) * smoothstep(0.3, 0.8, vRest.z), vein = 0.0;
  if (vmask > 0.001) {
    vec2 pw = vRest.xz + 0.16 * vec2(vn3(p * 1.7) - 0.5, vn3(p * 1.7 + 9.0) - 0.5) + 0.05 * vec2(vn3(p * 5.0) - 0.5, 0.0);   // wandering, not ruled
    float dv = 9.0;
    for (int i = 0; i < ${VEINS.length / 4}; i++) { vec4 sg = uVeins[i]; vec2 a = sg.xy, b = sg.zw, q = pw - a, ab = b - a; float k = clamp(dot(q, ab) / dot(ab, ab), 0.0, 1.0); dv = min(dv, length(q - ab * k)); }
    float vs = 0.058 * (0.75 + 0.5 * vn3(p * 2.3));
    vein = exp(-dv * dv / (2.0 * vs * vs)) * (0.45 + 0.55 * vn3(p * 1.3 + 4.0)) * vmask * mix(0.7, 1.0, smoothstep(1.0, 4.0, vRest.z));   // plainer towards the wrist
  }
  vein *= 1.0 - skinSlv;
  skinVein = vein;
  float hV = vein * 0.9;   // (the raised veins and tendons: shading only, mostly; in the clear top their crests made glossy streaks)
  // the tendons fanning from the knuckles towards the wrist: each a soft ridge, the four added up, plainest on the back of
  // the hand and gone before the wrist (at about 3.4 the mesh has a slight seam across the back of the hand, which drew a
  // dark nick on each ridge there)
  float tnd = 0.0;
  if (up > 0.0 && vRest.z > 0.5 && vRest.z < 3.3) for (int i = 0; i < 4; i++) { vec4 sg = uTendons[i]; vec2 a = sg.xy, b = sg.zw, q = vRest.xz - a, ab = b - a; float k = clamp(dot(q, ab) / dot(ab, ab), 0.0, 1.0), dt = length(q - ab * k); tnd += pow(max(0.0, 1.0 - dt * dt / 0.03), 2.0); }
  hV += tnd * 0.75 * up * smoothstep(0.5, 1.1, vRest.z) * smoothstep(3.3, 2.5, vRest.z);
  // the nail: the plate dips into the folds over its last millimetre or so; the folds are a soft roll of skin that
  // overhangs the plate's edge (none past the free edge). The step between them is spread over at least two pixels a
  // side, so the bump never breaks into dashes along the edge.
  float wE = max(2.0 * fw, 0.1), e = smoothstep(-wE, wE, sd);
  float plate = -0.22 * smoothstep(-1.2, 0.0, sd) * (1.0 - tip);
  float fold = (0.05 + 0.16 * gLine(sd - 0.6, 0.5, fw)) * smoothstep(2.5, 1.0, sd) * (1.0 - tip);
  // faint lengthwise ridges, for the clear top only (so they show in the highlight and nowhere else): three uneven
  // spacings, a wandering phase and a strength that comes and goes along the nail; none near the cuticle or the sides
  float sAcross = asin(clamp(g.v, -1.0, 1.0)) * g.r * 23.5, fwS = fwidth(sAcross), ridge = 0.0;
  float rMask = smoothstep(-0.8, -2.0, sd) * smoothstep(0.6, 2.2, fromCut) * (1.0 - smoothstep(0.15, 0.4, fwS * 10.5 / 6.2832));
  if (rMask > 0.0) {
    float s = sAcross + 0.45 * (vn3(vec3(sAcross * 0.9, fromCut * 0.3, float(g.f) * 7.0)) - 0.5);
    float r1 = sin(s * 10.5), r2 = sin(s * 17.3 + 1.7) * (1.0 - smoothstep(0.15, 0.4, fwS * 17.3 / 6.2832)), r3 = sin(s * 6.1 + 4.2);
    ridge = 0.002 * rMask * (0.5 * r1 + 0.3 * r2 + 0.35 * r3) * (0.3 + 0.7 * vn3(vec3(sAcross * 1.3, fromCut * 0.45, float(g.f) * 3.0 + 9.0)));
  }
  // under the sleeve: the knit instead of the skin's relief
  if (skinSlv > 0.0) { float kn = sleeveKnit(vRest, skinKnit); h = mix(h, kn, skinSlv); hF *= 1.0 - skinSlv; }
  skinHgt = mix(plate, h + hV + hF + fold, e) / 23.5;
  skinHgtCC = mix(plate + ridge, h + 0.4 * hV + 0.5 * hF + fold, e) / 23.5;
}`;

function skinMaterial(look, skin, glow) {
  const glass = look === 'glass', porc = look === 'porcelain';
  const m = glass
    ? new THREE.MeshPhysicalMaterial({ color: '#dfe8f4', roughness: 0.06, metalness: 0, transmission: 1, thickness: 0.9, ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.04, attenuationColor: new THREE.Color('#bcd2ee'), attenuationDistance: 3, transparent: true })
    : porc
      ? new THREE.MeshPhysicalMaterial({ color: '#e9eef7', roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.2 })   // a satin glaze (a near-mirror coat over the bumps looked wet); a cool white, which the warm key light of "Sheet music + hands" turns to a warm ivory (neither grey clay nor beige)
      : new THREE.MeshPhysicalMaterial({ color: skin, roughness: 0.56, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffe6da'), clearcoat: 0.4, clearcoatRoughness: 0.4, specularIntensity: 0.4 });   // (the sheen: the soft velvet edge of skin seen in the photographs)
  const hot = { value: Array.from({ length: 10 }, () => new THREE.Vector4(0, -99, 0, 0)) }, hotCol = { value: new THREE.Color(glow) };
  const seed = { value: 0 }, flex = { value: new Float32Array(14) };
  m.userData.hot = hot; m.userData.hotCol = hotCol;
  // each frame: which hand this is (the left hand's mesh has its triangles turned), and how far each joint bends
  const dp = new THREE.Vector3(), dc = new THREE.Vector3();
  m.onBeforeRender = (renderer, scene, camera, geometry, object) => {
    seed.value = MODEL && geometry.index && geometry.index.array !== MODEL.tri ? 1 : 0;
    const bones = object.skeleton && object.skeleton.bones;
    if (!REST || !bones) return;
    REST.joints.forEach((j, k) => {
      dp.copy(REST.restVec[j.parent]).transformDirection(bones[j.parent].matrixWorld);
      dc.copy(REST.restVec[j.b]).transformDirection(bones[j.b].matrixWorld);
      flex.value[k] = Math.acos(Math.min(1, Math.max(-1, dp.dot(dc))));
    });
  };
  const FX = HAND_FX.uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uHot: hot, uHotCol: hotCol, uVeins: { value: VEIN_V4 }, uTendons: { value: TENDON_V4 }, uSkinLook: { value: glass ? 1 : porc ? 2 : 0 }, uSeed: seed, uFlex: flex,
      uNailH: { value: REST ? REST.nH : v4n(5) }, uNailD: { value: REST ? REST.nD : Array.from({ length: 5 }, () => new THREE.Vector3(0, 0, -1)) }, uNailU: { value: REST ? REST.nU : Array.from({ length: 5 }, () => new THREE.Vector3(0, 1, 0)) }, uNailP: { value: REST ? REST.nP : v4n(5) },
      uJointP: { value: REST ? REST.joints.map((j) => j.P) : v4n(14) }, uJointD: { value: REST ? REST.joints.map((j) => j.D) : v4n(14) }, uJointU: { value: REST ? REST.joints.map((j) => j.U) : Array.from({ length: 14 }, () => new THREE.Vector3(0, 1, 0)) } });
    for (const k of Object.keys(FX)) sh.uniforms[k] = FX[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 tags; attribute vec4 detail; attribute vec3 rest0; varying vec4 vTags; varying vec4 vDetail; varying vec3 vHW; varying vec3 vRest; varying vec3 vRestN; uniform vec4 uSleeve; uniform float uSkinLook;\n#define REST_OK ' + (REST ? 'true' : 'false') + NAIL_GLSL + NAIL_VERT)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTags = tags; vDetail = detail; vRest = rest0; vRestN = normal; vHW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float nailDisp = 0.0;
        if (REST_OK && nailGeo(rest0).d < 0.6) nailDisp = nailShift(rest0, normalize(objectNormal), 0.028 * clamp(tags.r * 1.6 - 0.3, 0.0, 1.0));`)
      // (the sleeve's knit stands a little off the skin, from the cuff on, so its edge reads as cloth over the arm)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * (nailDisp + (uSkinLook == 1.0 ? 0.0 : uSleeve.y * uSleeve.z * smoothstep(uSleeve.x, uSleeve.x + 0.3, rest0.z)));')
      // (the shadow maps are drawn from the mesh as it is: the shadow is looked up from the unmoved surface, or the nail's
      // edge, set 0.47 mm into the skin, would fall in its own shadow)
      .replace('#include <shadowmap_vertex>', `#ifdef USE_SHADOWMAP
          vec4 wpHand = worldPosition; worldPosition.xyz -= mat3(modelMatrix) * objectNormal * nailDisp;
        #endif
        #include <shadowmap_vertex>
        #ifdef USE_SHADOWMAP
          worldPosition = wpHand;
        #endif`)
    // three.js's direct light, with two changes for skin: the diffuse sees the bumps less in red than in green and blue
    // (light spreads under the skin, so pores and fine lines barely shade it), and the key light is a soft box, not a
    // point, so the highlights are a little wider (Karis 2013)
    const target = 'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );';
    const lpp = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (!lpp.includes(target) || !lpp.includes('void RE_Direct_Physical(')) throw new Error('skin: three.js changed RE_Direct_Physical');
    const physPars = lpp.replace(target, 'reflectedLight.directDiffuse += skinIrradiance( directLight, geometryNormal, irradiance ) * diffuseBRDF * ( 1.0 - F );')
      .replace('void RE_Direct_Physical(', 'void RE_Direct_Physical_Base(') + `
      void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
        PhysicalMaterial mW = material;
        if (uSkinLook < 0.5) {
          mW.roughness = sqrt(min(1.0, material.roughness * material.roughness + 0.02));
          #ifdef USE_CLEARCOAT
            mW.clearcoatRoughness = sqrt(min(1.0, material.clearcoatRoughness * material.clearcoatRoughness + 0.02));
          #endif
        }
        RE_Direct_Physical_Base( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, mW, reflectedLight );
      }`;
    sh.fragmentShader = patchShadowLoop(sh.fragmentShader, 'uSkinLook < 0.5')
      .replace('getPointLightInfo( pointLight, geometryPosition, directLight );', 'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tif ( uSkinLook < 0.5 ) directLight.color *= 0.45;   // the note flashes: softer on skin')
      .replace('#include <common>', `#include <common>
        varying vec4 vTags; varying vec4 vDetail; varying vec3 vHW; varying vec3 vRest; varying vec3 vRestN;
        uniform vec4 uHot[10]; uniform vec3 uHotCol; uniform float uSkinLook, uSeed; uniform vec4 uVeins[${VEINS.length / 4}]; uniform vec4 uTendons[4];
        uniform vec3 uRimDirW, uRimCol, uBounce, uKeyTint; uniform float uShoulder, uArmFade; uniform vec4 uSleeve; uniform vec3 uSleeveCol;`)
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>
        ${NOISE}
        ${SKIN_GLSL}
        ${HAND_CAPS_GLSL}
        #define HS_TINT ( uSkinLook < 0.5 ? uKeyTint : vec3( 1.0 ) )
        #define HS_NDL ( uSkinLook < 0.5 ? dot( skinNGeo, directLight.direction ) : 1.0 )
        vec3 skinShoulder(vec3 c) {   // identity below 0.72; above, rolls towards 1 and towards cream (no orange clipping)
          float l = max(max(c.r, c.g), c.b); if (l <= 0.72) return c;
          float k = 0.72 + 0.28 * (1.0 - exp(-(l - 0.72) / 0.28));
          return mix(c * (k / l), vec3(k), 0.55 * smoothstep(0.72, 1.6, l));
        }`)
      .replace('#include <lights_physical_pars_fragment>', `
        vec3 skinIrradiance(const in IncidentLight L, vec3 nB, const in vec3 irr) {
          if (uSkinLook > 0.5) return irr;
          vec3 nR = normalize(mix(skinNGeo, nB, mix(0.3, 0.15, skinPlate))), nG = normalize(mix(skinNGeo, nB, mix(0.65, 0.15, skinPlate)));
          nB = normalize(mix(nB, skinNGeo, 0.85 * skinPlate));
          vec3 d = vec3(dot(nR, L.direction), dot(nG, L.direction), dot(nB, L.direction));
          const vec3 w = vec3(0.12, 0.05, 0.025);                    // a soft, slightly warm terminator
          return max((d + w) / ((1.0 + w) * (1.0 + w)), 0.0) * L.color;
        }
        ${physPars}`)
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>' + HAND_SHADOW_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uSkinLook < 0.5 || uSkinLook > 1.5) skinPrep(uSkinLook < 0.5);
        if (uSkinLook < 0.5) {
          vec3 c = diffuseColor.rgb, p = vRest + uSeed * 17.0;
          // colour zones that read even in the Short: knuckles, fingertip pads and the skin round the nails redder,
          // the palm paler, the back of the hand a touch of tan
          float blood = clamp(1.26 * vTags.g + 0.5 * skinTaut + 0.45 * skinTip + 0.45 * skinPeri + 0.35 * skinDist, 0.0, 1.0);
          c *= mix(vec3(1.0), vec3(1.08, 0.84, 0.82), blood);
          c = mix(c, c * vec3(1.05, 1.0, 0.97) + vec3(0.02, 0.012, 0.01), vTags.b * 0.6);
          c *= mix(vec3(1.0), vec3(0.97, 0.95, 0.91), smoothstep(0.6, 3.0, vRest.z) * smoothstep(0.1, 0.6, vRestN.y) * 0.6);
          // blotches at a few sizes, so it is not plastic, and a few faint spots
          float mott = vn3(p * 3.0) * 0.45 + vn3(p * 9.0) * 0.35 + vn3(p * 27.0) * 0.2;
          c *= mix(vec3(0.95, 0.955, 0.965), vec3(1.04, 1.03, 1.02), mott);
          c *= 1.0 - 0.07 * smoothstep(0.62, 0.85, vn3(p * 31.0 + 7.0)) * lod(31.0);
          // the skin over a vein loses some red (it is not blue)
          c *= mix(vec3(1.0), vec3(0.86, 0.92, 0.99), 0.7 * skinVein);
          // the hairy skin a little darker, with its follicles
          c = mix(c, c * vec3(0.93, 0.92, 0.94), vTags.a * 0.25);
          c *= 1.0 - 0.15 * vTags.a * step(0.9, hh3(floor(p * 70.0))) * lod(70.0);
          c *= 1.0 - 0.10 * skinFold;
          // a pressing fingertip's pad pales a little
          c = mix(c, c * vec3(1.03, 1.05, 1.04) + 0.015, skinPress * skinTip * 0.5);
          // the nail: its bed's pink a third of the way back to the skin's own colour (short, natural nails that barely
          // stand out, not manicured ones), the free edge as it is
          c = mix(c, mix(skinNailCol, diffuseColor.rgb, 0.35 * (1.0 - skinFree)), skinPlate);
          c *= mix(vec3(1.0), vec3(0.84, 0.58, 0.52), 0.55 * skinHypo);   // the hyponychium in the free edge's shade: warm
          diffuseColor.rgb = c;
        } else if (uSkinLook > 1.5) {
          diffuseColor.rgb *= (1.0 - 0.06 * vTags.g) * (1.0 - 0.08 * skinFold);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.03, skinPlate);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, uSleeveCol * skinKnit, skinSlv);   // the dark knit sleeve`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        skinNGeo = normal;
        if (uSkinLook < 0.5 || uSkinLook > 1.5) {   // bump the shading normal by the skin's height
          float k = mix(uSkinLook > 1.5 ? 0.15 : 1.0, 1.0, skinSlv), H = skinHgt * k, Hc = skinHgtCC * k;   // (porcelain: only a trace of the veins and folds; the sleeve's knit in full)
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2), gradC = sign(det) * (dFdx(Hc) * r1 + dFdy(Hc) * r2);
          skinNCC = normalize(abs(det) * normal - gradC);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
        #ifdef USE_CLEARCOAT
          if (uSkinLook < 0.5) clearcoatNormal = skinNCC;   // the sharp lobe: the folds, half the fine texture, the nail's ridges (skin only: on porcelain's glaze it drew wet streaks along every vein)
        #endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (uSkinLook < 0.5) {
          roughnessFactor *= 0.92 + 0.16 * vn3((vRest + uSeed * 17.0) * 60.0);
          roughnessFactor += 0.1 * skinFold - 0.06 * skinOily;
          roughnessFactor = mix(roughnessFactor, mix(0.26, 0.42, max(skinFree, skinCut)), skinPlate);
        }
        roughnessFactor = mix(roughnessFactor, 0.85, skinSlv);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        if (uSkinLook < 0.5) {   // two specular lobes by region; the nail is keratin under a smooth, glossy top (n = 1.55)
          float plateGloss = 1.0 - max(skinFree, skinCut);
          #ifdef USE_CLEARCOAT
            material.clearcoat = mix(mix(0.4, 0.5, skinOily) * (1.0 - 0.5 * skinFold) + 0.12 * skinTaut, mix(0.45, 0.6, plateGloss) * (1.0 - 0.7 * skinRim), skinPlate);   // (the plate: a natural sheen, not a lacquered gloss)
            material.clearcoatRoughness = min(1.0, mix(mix(0.37, 0.33, skinOily) + 0.1 * skinFold - 0.06 * skinTaut, mix(0.32, 0.12, plateGloss), skinPlate) + geometryRoughness);
            // (at a grazing angle a full Fresnel swaps the plate's colour for the dim room it reflects: a thumb nail seen
            // side-on got a grey rim. The plate's reflection is held lower there, as the folds and the fingers around it
            // block most of that view in a real hand.)
            material.clearcoatF90 = mix(1.0, 0.4, skinPlate);
          #endif
          material.specularColor = mix(material.specularColor, vec3(0.047), skinPlate);
          material.specularColorBlended = material.specularColor;
          material.specularF90 = mix(material.specularF90, 0.25, skinPlate);
        }
        if (skinSlv > 0.0) {   // the knit: no clear coat, a weak broad specular, and the soft sheen of cloth at the edges
          #ifdef USE_CLEARCOAT
            material.clearcoat *= 1.0 - skinSlv;
          #endif
          #ifdef USE_SHEEN
            material.sheenColor = mix(material.sheenColor, vec3(0.11, 0.105, 0.105) * skinKnit, skinSlv); material.sheenRoughness = mix(material.sheenRoughness, 0.55, skinSlv);
          #endif
          material.specularColor *= 1.0 - 0.5 * skinSlv; material.specularColorBlended = material.specularColor;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uSkinLook > 0.5) { float h = 0.0; for (int i = 0; i < 10; i++) { vec3 q = vHW - uHot[i].xyz; h += uHot[i].w * exp(-dot(q, q) / 0.35); }
          totalEmissiveRadiance += uHotCol * h * (uSkinLook < 1.5 ? 1.6 : 0.35); }`)
      .replace('#include <lights_fragment_end>', `
        if (uSkinLook < 0.5) {
          vec3 nGW = inverseTransformDirection(skinNGeo, viewMatrix);
          skinAO = capsAO(vHW, nGW, true).x;
          // a rim light from behind and above (the hands only), and light passing through thin skin when it comes from behind
          IncidentLight rim; rim.direction = normalize((viewMatrix * vec4(uRimDirW, 0.0)).xyz); rim.color = uRimCol * skinAO; rim.visible = true;
          RE_Direct( rim, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          float tMM = max(0.8, 2.0 * skinRadMM * clamp(-dot(skinNGeo, rim.direction), 0.0, 1.0)), s = 0.22 * tMM, dd = -s * s;
          vec3 T = vec3(0.233, 0.455, 0.649) * exp(dd / 0.0064) + vec3(0.1, 0.336, 0.344) * exp(dd / 0.0484) + vec3(0.118, 0.198, 0.0) * exp(dd / 0.187)
                 + vec3(0.113, 0.007, 0.007) * exp(dd / 0.567) + vec3(0.358, 0.004, 0.0) * exp(dd / 1.99) + vec3(0.078, 0.0, 0.0) * exp(dd / 7.41);
          reflectedLight.directDiffuse += T * rim.color * diffuseColor.rgb * RECIPROCAL_PI * clamp(0.3 + dot(-skinNGeo, rim.direction), 0.0, 1.0) * (1.0 - skinPlate) * (1.0 - skinSlv);
          // light bounced up from the white keys onto the undersides
          reflectedLight.indirectDiffuse += diffuseColor.rgb * RECIPROCAL_PI * uBounce * (0.25 + 0.75 * clamp(-nGW.y, 0.0, 1.0)) * skinAO;
        }
        #include <lights_fragment_end>
        if (uSkinLook < 0.5) {
          // light bounced from skin to skin in the crevices is multiplied by the skin's colour each time: occluded skin
          // is darker and redder (Jimenez et al. 2016)
          vec3 alb = diffuseColor.rgb, x = vec3(skinAO * skinNailAO);
          vec3 mb = max(x, ((x * (2.0404 * alb - 0.3324) + (-4.7951 * alb + 0.6417)) * x + (2.7552 * alb + 0.6903)) * x);
          reflectedLight.indirectDiffuse *= mb;
          reflectedLight.directDiffuse *= mix(vec3(1.0), mb, 0.6) * mix(1.0, skinNailAO, 0.6);
          float so = clamp(skinAO * skinNailAO, 0.0, 1.0);
          vec3 soS = so * mix(vec3(1.0), alb * 1.6, skinRim * 0.7);
          reflectedLight.indirectSpecular *= soS;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= soS;
          #endif
        }`)
      .replace('#include <opaque_fragment>', `
        if (uSkinLook < 0.5 && uShoulder > 0.5) outgoingLight = skinShoulder(outgoingLight - totalEmissiveRadiance) + totalEmissiveRadiance;
        outgoingLight *= 1.0 - uArmFade * smoothstep(7.0, 8.7, vRest.z);   // (the Keys picture: the forearm fades into the dark instead of ending in a cut)
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'hand9-' + look;
  return m;
}

// Hair: short fine hairs on the forearm, the back of the hand and the first finger bones: thin tapered strands
// (built with the hand, tools/build_hand.py) rooted in the skin and leaning toward the fingers, each skinned like the
// skin it grows from, so it moves with the hand; lit with the skin's normal, with a faint highlight along the strand,
// fading at the tip.
function hairMaterial(color) {
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#7a5a44'), 0.45), side: THREE.DoubleSide, transparent: true, depthWrite: false });   // a lighter brown
  // blend the colour only: the picture's alpha stays opaque (otherwise the page shows through each strand)
  Object.assign(m, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSleeve = HAND_FX.uniforms.uSleeve;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vHairUv; varying float vHairZ; uniform vec4 uSleeve;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uSleeve.y > 0.5 && vHairZ > uSleeve.x - 0.02) discard;   // (none under the sleeve)
        float e = 1.0 - pow(abs(vHairUv.x * 2.0 - 1.0), 2.0);
        diffuseColor.a = clamp(e * (1.0 - 0.75 * vHairUv.y) * 0.25, 0.0, 1.0);   // fine, see-through hairs, not black scratches (barely seen, as on the pianist's hands)
        diffuseColor.rgb *= 0.8 + 0.5 * vHairUv.y;`);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 huv; attribute float hz; varying vec2 vHairUv; varying float vHairZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairUv = huv; vHairZ = hz;');
  };
  m.customProgramCacheKey = () => 'hair-strands6';
  return m;
}

const BONE_IDX = (info) => Object.fromEntries(info.bones.map((b, i) => [b.name, i]));

export function skinnedHands(scene, opts = {}) {
  if (!MODEL) return null;
  const { info } = MODEL, bi = BONE_IDX(info), nb = info.bones.length;
  const geo = (mirror) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(MODEL.pos, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(MODEL.si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(MODEL.sw, 4, true));
    g.setAttribute('tags', new THREE.BufferAttribute(MODEL.tags, 4, true));
    g.setAttribute('detail', new THREE.BufferAttribute(MODEL.detail, 4));
    g.setAttribute('rest0', new THREE.BufferAttribute(MODEL.rest0, 3));   // (the old frame, for the shader's patterns: PROPORTIONS)
    g.setIndex(new THREE.BufferAttribute(MODEL.tri, 1));
    g.computeVertexNormals();   // (before any mirroring: the mirror in the bones turns these the right way out)
    if (mirror) { const idx = MODEL.tri.slice(); for (let i = 0; i < idx.length; i += 3) { const a = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = a; } g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    return g;
  };
  // the bones in rest: no rotation, at their heads (the hand's own frame)
  const restH = info.bones.map((b) => new THREE.Vector3(...b.head)), restT = info.bones.map((b) => new THREE.Vector3(...b.tail));
  const restD = restH.map((h, i) => restT[i].clone().sub(h).normalize()), restL = restH.map((h, i) => restT[i].distanceTo(h));
  const root = new THREE.Group(); scene.add(root);
  const look = { id: opts.look || 'skin' };
  const make = (mirror) => {
    const bones = info.bones.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; root.add(b); return b; });
    const inv = restH.map((h) => new THREE.Matrix4().makeTranslation(-h.x, -h.y, -h.z));
    const sk = new THREE.Skeleton(bones, inv);
    const mesh = new THREE.SkinnedMesh(geo(mirror), skinMaterial(look.id, opts.skin || SKIN_DEFAULT, opts.glow || '#ffa040'));
    mesh.bind(sk, new THREE.Matrix4());
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    // the hair, on the same skeleton
    const hair = [];
    if (MODEL.hair) {
      const H0 = MODEL.hair, hg = new THREE.BufferGeometry();
      hg.setAttribute('position', new THREE.BufferAttribute(H0.pos, 3)); hg.setAttribute('normal', new THREE.BufferAttribute(H0.nrm, 3));
      hg.setAttribute('huv', new THREE.BufferAttribute(H0.uv, 2)); hg.setAttribute('hz', new THREE.BufferAttribute(H0.rest0z, 1));
      hg.setAttribute('skinIndex', new THREE.BufferAttribute(H0.si, 4)); hg.setAttribute('skinWeight', new THREE.BufferAttribute(H0.sw, 4, true));
      hg.setIndex(new THREE.BufferAttribute(H0.idx, 1));
      const hm = new THREE.SkinnedMesh(hg, hairMaterial(opts.hair || '#33231a'));
      hm.bind(sk, new THREE.Matrix4()); hm.frustumCulled = false; hm.renderOrder = 3;
      scene.add(hm); hair.push(hm);
    }
    return { mesh, bones, hair };
  };
  const meshes = [make(false), make(true)];
  const toWorld = new THREE.Matrix4(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), qd = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const Rq = Array.from({ length: nb }, () => new THREE.Quaternion()), H = Array.from({ length: nb }, () => new THREE.Vector3());
  // a finger bone the pose makes longer than at rest (hands.js lengthens the thumb's first bone a little: FINAL-SPEC S10(c))
  // stretches along its own length, so the skin follows the joints; K: each bone's length over its rest length
  const K = new Float64Array(nb).fill(1), S = new THREE.Matrix4();
  const stretch = (dir, k) => { const c = k - 1, x = dir.x, y = dir.y, z = dir.z; return S.set(1 + c * x * x, c * x * y, c * x * z, 0, c * x * y, 1 + c * y * y, c * y * z, 0, c * x * z, c * y * z, 1 + c * z * z, 0, 0, 0, 0, 1); };
  const a = new THREE.Vector3(), d = new THREE.Vector3(), e = new THREE.Vector3();
  const finger = (f, s) => bi[`finger${f + 1}-${s}`], meta = (f) => bi[`metacarpal${f}`];
  function update(poses) {
    poses.forEach((P, h) => {
      const { bones, mesh } = meshes[h];
      toWorld.copy(P.toHand).invert();
      const jh = P.joints.map((j) => j.map((q) => q.clone().applyMatrix4(P.toHand)));
      // forearm: from the elbow to the wrist
      const fa = bi.lowerarm02, wr = bi.wrist;
      e.copy(P.elbow).applyMatrix4(P.toHand);
      d.copy(restT[fa]).sub(e).normalize();
      Rq[fa].setFromUnitVectors(restD[fa], d); H[fa].copy(restT[fa]).addScaledVector(d, -restL[fa]);
      Rq[wr].identity(); H[wr].copy(restH[wr]);
      for (let f = 0; f < 5; f++) {
        let parentQ = Rq[wr];
        if (f > 0) { // the metacarpal: from its base in the palm to where this finger's knuckle is now
          const m = meta(f); H[m].copy(restH[m]); d.copy(jh[f][0]).sub(restH[m]).normalize();
          Rq[m].setFromUnitVectors(restD[m], d); parentQ = Rq[m];
        }
        for (let s = 1; s <= 3; s++) {
          const b = finger(f, s);
          H[b].copy(jh[f][s - 1]);
          d.copy(jh[f][s]).sub(jh[f][s - 1]); K[b] = d.length() / restL[b]; d.normalize();
          a.copy(restD[b]).applyQuaternion(parentQ);          // where the parent's turn alone would point it
          qd.setFromUnitVectors(a, d);
          Rq[b].copy(qd).multiply(parentQ);
          parentQ = Rq[b];
        }
      }
      for (let i = 0; i < nb; i++) {
        M.compose(H[i], Rq[i], one);
        if (Math.abs(K[i] - 1) > 1e-3) M.multiply(stretch(restD[i], K[i]));
        bones[i].matrix.multiplyMatrices(toWorld, M);
        bones[i].matrixWorldNeedsUpdate = true;
      }
      if (globalThis.__noHair != null) meshes[h].hair.forEach((hm) => { hm.visible = !globalThis.__noHair; });
      const hot = mesh.material.userData.hot.value;
      for (let f = 0; f < 5; f++) { const tp = P.joints[f][3]; hot[h * 5 + f].set(tp.x, tp.y, tp.z, P.heat[f]); }
    });
  }
  function setLook(id) {
    look.id = id;
    meshes.forEach(({ mesh, hair }) => { const old = mesh.material; mesh.material = skinMaterial(id, opts.skin || SKIN_DEFAULT, opts.glow || '#ffa040'); old.dispose(); mesh.renderOrder = id === 'glass' ? 6 : 2; hair.forEach((hm) => { hm.visible = id === 'skin'; }); });
  }
  setLook(look.id);
  return { update, meshes, setLook, dispose() { meshes.forEach(({ mesh, hair }) => { mesh.geometry.dispose(); mesh.material.dispose(); scene.remove(mesh); hair.forEach((hm) => { hm.material.dispose(); scene.remove(hm); }); }); scene.remove(root); } };
}
