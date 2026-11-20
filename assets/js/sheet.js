// "Sheet music in light": the written music lies on a dark glass floor, engraved in warm ivory, and the camera glides
// along it. Each note catches fire in its hand's colour the moment it is played and keeps a soft glow afterwards. For
// each hand a path of light hops from note to note, landing on every note exactly as it sounds, with a small lantern
// that lights the music around it. Everything depends only on the music time t, so a video export draws exactly
// what playback shows.
//
// The notation is worked out from the MIDI file: written lengths from how long each note is held and when the next
// one comes, eighths and shorter beamed by the beat, stems up or down by position (two voices on one staff get one
// each), dots, ledger lines, accidentals in the key, and bar lines from the time signature. Rests and ties are not
// drawn: a tied note shows as one longer note. Spacing follows the rhythm, wider for long notes, as in print.
import * as THREE from '../vendor/three.min.js?v=7';
import { barTimes, guessKey, speller, SIG } from './score.js?v=19';

const TB = 11;                                 // page height of the treble staff's bottom line (the bass staff's is 0)
const MID = [TB + 2, 2];                       // the middle line of each staff
const TOP = [TB + 4, 4], BOTTOM = [TB, 0];
const pageY = (step, staff) => (staff ? (step - 18) / 2 : TB + (step - 30) / 2); // step = octave * 7 + letter; E4 = 30, G2 = 18
const VALUES = [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4]; // written lengths in beats
const SPACE = 3.2;                             // staff spaces per beat (long notes get less, by a power law, as in print)
const INK = 0.03;                              // how far the printing stands above the glass
const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const W = (x, y, h = INK) => new THREE.Vector3(x, h, -y); // page (x, y) to the world: the page lies flat, its top away from the viewer

// ---------- reading the music ----------
function engrave(piece) {
  const sf = piece.key ? piece.key.sf : guessKey(piece.notes), spell = speller(sf), two = piece.tracks === 2;
  const mean = [0, 1].map((k) => { const l = piece.notes.filter((n) => n.track === k); return l.reduce((s, n) => s + n.pitch, 0) / (l.length || 1); }), upper = mean[0] >= mean[1] ? 0 : 1;
  const tempo = piece.tempoMap.length ? piece.tempoMap : [{ time: 0, bpm: 100 }];
  const beatAt = (t) => { let bpm = tempo[0].bpm; for (const m of tempo) if (m.time <= t + 0.01) bpm = m.bpm; return 60 / bpm; };
  const bars = barTimes(piece);
  const meters = piece.meterMap && piece.meterMap.length ? piece.meterMap : [{ time: 0, meter: piece.meter || [4, 4] }];
  const meterAt = (t) => { let m = meters[0].meter; for (const k of meters) if (k.time <= t + 0.01) m = k.meter; return m; };
  const barStart = (t) => { let b = 0; for (const x of bars) { if (x <= t + 0.01) b = x; else break; } return b; };
  const staffOf = (n) => (two ? (n.track === upper ? 0 : 1) : n.pitch < 60 ? 1 : 0);

  // notes struck together on one staff
  const events = [[], []];
  for (const n of piece.notes) {
    const list = events[staffOf(n)], last = list[list.length - 1];
    if (last && Math.abs(last.t - n.onset) < 0.03) last.notes.push(n); else list.push({ t: n.onset, notes: [n] });
  }
  // chords with a written length and a voice: 1 = upper (stems up), 2 = lower (stems down), 0 = alone (stem by position)
  const chords = [];
  for (const staff of [0, 1]) {
    const list = events[staff];
    let held = [];
    list.forEach((e, i) => {
      const beat = beatAt(e.t), gap = list[i + 1] ? (list[i + 1].t - e.t) / beat : Infinity, groups = new Map();
      for (const n of e.notes) {
        const d = n.dur / beat;
        let v = d >= 0.7 * gap && d <= 1.45 * gap ? gap : d; // held until the next note: it lasts until then; much longer: another voice
        v = VALUES.reduce((a, b) => (Math.abs(Math.log(b / v)) < Math.abs(Math.log(a / v)) ? b : a));
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v).push(n);
      }
      held = held.filter((h) => h.end > e.t + 0.03);
      const gs = [...groups].map(([v, ns]) => ({ v, ns, top: Math.max(...ns.map((n) => n.pitch)), low: Math.min(...ns.map((n) => n.pitch)) })).sort((a, b) => b.top - a.top);
      const made = gs.map((g, k) => {
        let voice = 0;
        if (gs.length > 1) voice = k === 0 ? 1 : 2;
        else if (held.length) voice = g.top <= Math.min(...held.map((h) => h.low)) ? 2 : g.low >= Math.max(...held.map((h) => h.top)) ? 1 : 0;
        const heads = g.ns.map((n) => { const s = spell(n.pitch); return { pitch: n.pitch, step: s.step, acc: s.acc, y: pageY(s.step, staff) }; }).sort((a, b) => a.y - b.y);
        return { t: e.t, staff, v: g.v, voice, heads, beat, end: e.t + g.v * beat, vel: Math.max(...g.ns.map((n) => n.vel)), top: g.top, low: g.low, pos: (e.t - barStart(e.t)) / beat, meter: meterAt(e.t) };
      });
      chords.push(...made); held.push(...made);
    });
  }
  chords.sort((a, b) => a.t - b.t || a.staff - b.staff);

  // horizontal places: one per moment something is struck, spaced by the rhythm
  const keyW = Math.abs(sf) * 0.85, START = 5.2 + keyW + 2.4 + 2.2; // after the clefs, key signature and time signature
  const times = [], accAt = [];
  for (const c of chords) {
    if (!times.length || c.t - times[times.length - 1] > 0.03) { times.push(c.t); accAt.push(false); }
    c.ti = times.length - 1;
    if (c.heads.some((h) => h.acc)) accAt[c.ti] = true;
  }
  const X = new Float64Array(times.length);
  let x = START, b = 0;
  const inner = bars.filter((t) => t > times[0] + 0.03);
  for (let i = 0; i < times.length; i++) {
    if (i) {
      const beats = (times[i] - times[i - 1]) / beatAt(times[i - 1]);
      let w = Math.max(accAt[i] ? 2.6 : 1.9, SPACE * Math.pow(Math.max(beats, 0.125), 0.62));
      if (accAt[i]) w += 0.6;
      while (b < inner.length && inner[b] <= times[i] + 0.03) { if (inner[b] > times[i - 1] + 0.03) w += 1.7; b++; }
      x += w;
    }
    X[i] = x;
  }
  const last = times.length - 1;
  const rateA = SPACE / beatAt(times[0]), rateB = SPACE / beatAt(times[last]);
  const xOf = (t) => {
    if (t <= times[0]) return X[0] - (times[0] - t) * rateA;
    if (t >= times[last]) return X[last] + (t - times[last]) * rateB;
    let lo = 0, hi = last;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
    return X[lo] + (X[lo + 1] - X[lo]) * (t - times[lo]) / (times[lo + 1] - times[lo]);
  };
  for (const c of chords) c.x = X[c.ti];
  // bar lines: just before the first note of a bar, or where the bar begins inside a held note
  const barX = [];
  let finalX = null;
  for (const t of inner) {
    if (t > times[last] + 0.03) { finalX = xOf(t) - 1; break; }
    const j = times.findIndex((s) => s >= t - 0.03);
    barX.push(Math.abs(times[j] - t) < 0.03 ? X[j] - (accAt[j] ? 2.3 : 1.5) : xOf(t));
  }
  if (finalX == null) { const c = chords.filter((k) => k.ti === last); finalX = X[last] + Math.max(4, Math.max(...c.map((k) => k.v)) * SPACE * 0.8); }

  // beams: eighths and shorter that follow one another in the same voice, grouped by the beat
  // (eighths by the half bar in 2/4 and 4/4, by the dotted beat in 6/8, 9/8 and 12/8)
  const level = (v) => (v <= 0.125 ? 3 : v <= 0.25 || v === 0.375 ? 2 : 1);
  const windowOf = (c) => { const [n, d] = c.meter; if (d === 8 && n % 3 === 0) return 1.5; return d === 4 && n % 2 === 0 && c.v >= 0.5 ? 2 : 1; };
  const groups = [];
  for (const staff of [0, 1]) for (const voice of [0, 1, 2]) {
    const list = chords.filter((c) => c.staff === staff && c.voice === voice);
    let cur = null;
    for (const c of list) {
      const short = c.v < 1;
      if (cur && short) {
        const p = cur[cur.length - 1], win = windowOf(cur[0]);
        if (Math.abs(p.end - c.t) < 0.04 && Math.floor(c.pos / win + 1e-6) === Math.floor(cur[0].pos / win + 1e-6) && c.pos >= cur[0].pos) { cur.push(c); continue; }
      }
      if (cur) groups.push(cur);
      cur = short ? [c] : null;
      if (!short) groups.push([c]);
    }
    if (cur) groups.push(cur);
  }
  // landing places for the paths of light: per hand, the top note (right hand) or the bottom note (left hand) of each moment
  const landings = [0, 1].map((staff) => {
    const out = [];
    for (const c of chords) {
      if (c.staff !== staff) continue;
      const y = staff ? c.heads[0].y : c.heads[c.heads.length - 1].y, l = out[out.length - 1];
      if (l && l.t === c.t) { l.y = staff ? Math.min(l.y, y) : Math.max(l.y, y); l.vel = Math.max(l.vel, c.vel); }
      else out.push({ t: c.t, x: c.x, y, vel: c.vel });
    }
    return out;
  });
  const shown = meters.length > 1 && meters[1].time < 4 * beatAt(0) + 0.01 ? meters[1].meter : meters[0].meter; // a pickup bar does not change the printed time signature
  return { sf, chords, groups, barX, finalX, xOf, level, start: START, keyW, meter: shown, landings, end: X[last] };
}


// ---------- the picture ----------
const R = 0.38;                        // ball radius, in staff spaces
const REST = 0.16 + R;                 // height of a ball's centre at the moment it touches a note
const G = 60, HMAX = 2.4;              // gravity (staff spaces per second²) and the highest a hop may go
const TAIL = 1.0, NT = 110;            // the thin tail of light: seconds, points
const DT = 1 / 110, LIFE = 0.9;        // comet sparks: one shed every DT seconds, each glowing for LIFE seconds
const HIT = 0.75, HITN = 22;           // sparks thrown up where a ball lands
const PLIFE = 2.4, PN = 150;            // powder: how long it glows, and grains per landing
const DUST = 260, POOL = 12;
const hopHeight = (gap) => { const h = (G * gap * gap) / 8; return HMAX * (1 - Math.exp(-h / HMAX)); }; // a true gravity arc, capped softly for long notes

// The sky around the music: an aurora of slow curtains over the far horizon, or a band of the Milky Way with clouds
// of colour and dark lanes of dust. (Stars are separate points, so they stay sharp.) Colours come from the theme.
const SKY_FRAG = `
uniform float uTime, uMode; uniform vec3 uA, uB, uC;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.z, d.x), el = asin(clamp(d.y, -1.0, 1.0));
  vec3 col = vec3(0.0);
  if (uMode > 1.5 && uMode < 2.5) {
    for (int k = 0; k < 3; k++) {
      float fk = float(k), x = az * (2.2 + fk * 0.6) + fk * 2.1;
      float wave = fbm(vec2(x * 1.6 + uTime * (0.03 + 0.01 * fk), fk * 4.0 + uTime * 0.02));
      float h = el - (0.04 + 0.16 * fbm(vec2(x * 0.7, 9.0 + fk)));
      float curtain = smoothstep(0.42, 0.75, wave);
      float body = smoothstep(-0.015, 0.02, h) * exp(-max(h, 0.0) * (5.0 + fk * 2.0));
      float rays = 0.55 + 0.45 * noise(vec2(az * 140.0 + fk * 7.0, uTime * 0.25));
      vec3 c = mix(k == 0 ? uA : (k == 1 ? uC : uB), uB, clamp(h * 3.0, 0.0, 1.0));
      col += c * curtain * body * rays * 0.8;
    }
  }
  if (uMode > 2.5) {
    vec3 n = normalize(vec3(-0.25, 0.75, 0.6));
    float b = dot(d, n), band = exp(-b * b * 14.0);
    vec2 q = vec2(az * 3.0 + uTime * 0.004, b * 8.0);
    float neb = fbm(q * 1.5), lane = smoothstep(0.5, 0.72, fbm(q * 3.0 + 5.0));
    col += mix(uB, uC, neb) * band * (0.1 + 0.45 * neb * neb) * (1.0 - 0.7 * lane * band);
    col += vec3(1.0, 0.92, 0.8) * exp(-b * b * 60.0) * 0.05 * (1.0 - lane);
    col += uA * exp(-pow(length(d - normalize(vec3(0.6, 0.35, -0.7))) * 2.2, 2.0)) * 0.1 * fbm(vec2(az * 6.0, el * 6.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;
const SKIES = { plain: 0, stars: 1, aurora: 2, galaxy: 3 };
// Camera places, as [offset of the camera, offset of the point it looks at, depth of field range], relative to the
// music being played. Travelling glides between them: higher, low, higher, from above, and round again.
const CAMS = {
  wide: { low: [[-11, 6.2, 11.5], [5.5, 0.6, -8], 9], side: [[-7, 13, 15], [5, 0, -8], 12], top: [[-1, 27, 9], [3.5, 0, -7.5], 16] },
  tall: { low: [[-15, 12, -7.5], [6, 0, -7.5], 11], side: [[-21, 22, -7.5], [6, 0, -7.5], 14], top: [[-5, 36, -7.5], [4, 0, -7.5], 18] },
};
const TOUR = ['side', 'low', 'side', 'top'];

export function buildSheet(T, tools, piece) {
  const { canvasTex, dot, env } = tools, scene = new THREE.Scene();
  scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(T.fog, 36, 115);
  scene.environment = env; scene.environmentIntensity = 0.12;
  const WHITE = new THREE.Color('#ffffff');
  const hands = [new THREE.Color(T.notes[0]), new THREE.Color(T.notes[1 % T.notes.length])];
  const inkColor = new THREE.Color('#e9dcc0').lerp(new THREE.Color(T.trim), 0.12);
  const S = piece && piece.notes.length ? engrave(piece) : null;
  const flat = (geo) => geo.rotateX(-Math.PI / 2);
  const additive = (extra = {}) => ({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, ...extra });

  // The score is printed on a long slab of dark glass; a polished floor lies far below it.
  const x0 = -40, x1 = (S ? S.finalX : 60) + 60;
  const glass = new THREE.MeshPhysicalMaterial({ color: '#05060a', roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.32, transparent: true, opacity: 0.84 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.6, 25), glass);
  slab.position.set((x0 + x1) / 2, -0.3, -7.5); slab.renderOrder = 1; scene.add(slab);
  const edgeMat = new THREE.MeshBasicMaterial({ color: inkColor.clone().multiplyScalar(0.32) });
  for (const z of [5, -20]) { const e = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.025, 0.05), edgeMat); e.position.set((x0 + x1) / 2, 0, z); scene.add(e); }
  const floor = new THREE.Mesh(flat(new THREE.PlaneGeometry(1, 1)), new THREE.MeshStandardMaterial({ color: '#030305', roughness: 0.45, metalness: 0.3 }));
  floor.scale.set(4000, 1, 600); floor.position.set(0, -5, -60); scene.add(floor);
  scene.add(new THREE.AmbientLight('#ffffff', 0.18));
  const keyLight = new THREE.DirectionalLight('#fff1dc', 0.45); scene.add(keyLight, keyLight.target);
  const lamp = new THREE.PointLight('#fff4e2', 5, 26, 1.6); scene.add(lamp);      // a reading lamp that travels with the music
  const backLight = new THREE.PointLight('#ffe9c8', 7, 70, 1.3); scene.add(backLight); // far ahead: catches the glass edge and the balls' rims

  const ink = new THREE.MeshStandardMaterial({ color: inkColor, roughness: 0.38, metalness: 0.55, emissive: inkColor, emissiveIntensity: 0.32, side: THREE.DoubleSide });
  const bead = new THREE.MeshPhysicalMaterial({ color: inkColor, roughness: 0.2, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, emissive: inkColor, emissiveIntensity: 0.18 });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff', ...additive() });

  // ---- the printed music ----
  const bar = flat(new THREE.PlaneGeometry(1, 1));
  const solidHead = new THREE.SphereGeometry(0.5, 28, 14).scale(1.24, 0.42, 0.96).rotateY(0.36).translate(0, 0.12, 0);
  const openHead = new THREE.TorusGeometry(0.4, 0.12, 10, 36).scale(1.32, 0.98, 0.9).rotateX(-Math.PI / 2).rotateY(0.36).translate(0, 0.1, 0);
  const wholeHead = new THREE.TorusGeometry(0.44, 0.15, 10, 36).scale(1.38, 0.9, 0.9).rotateX(-Math.PI / 2).translate(0, 0.1, 0);
  const dotGeo = new THREE.SphereGeometry(0.17, 12, 8).scale(1, 0.6, 1);
  const flagShape = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(0.15, -0.9, 1.25, -1.2, 0.95, -2.6); s.bezierCurveTo(1.05, -1.7, 0.4, -1.25, 0, -1.1); s.lineTo(0, 0); return flat(new THREE.ShapeGeometry(s, 12)); })();
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const lists = { line: [], solid: [], open: [], whole: [], dot: [], flagUp: [], flagDown: [], sharp: [], flat: [], natural: [] };
  const rect = (a0, b0, a1, b1) => lists.line.push([(a0 + a1) / 2, (b0 + b1) / 2, Math.max(0.001, Math.abs(a1 - a0)), Math.max(0.001, Math.abs(b1 - b0)), 0]);
  const slabLine = (a0, b0, a1, b1, thick) => lists.line.push([(a0 + a1) / 2, (b0 + b1) / 2, Math.hypot(a1 - a0, b1 - b0), thick, Math.atan2(b1 - b0, a1 - a0)]);
  const glowHeads = [];
  if (S) {
    const { groups, level } = S;
    const stemX = (c, d) => c.x + d * 0.6;
    const dirOf = (cs) => {
      const v = cs[0].voice;
      if (v === 1) return 1;
      if (v === 2) return -1;
      const mid = MID[cs[0].staff], hi = Math.max(...cs.map((c) => c.heads[c.heads.length - 1].y)) - mid, lo = mid - Math.min(...cs.map((c) => c.heads[0].y));
      return hi > lo ? -1 : 1;
    };
    const drawHeads = (c, d) => {
      const order = d > 0 ? c.heads : [...c.heads].reverse();
      let prev = null;
      for (const h of order) { h.dx = prev && Math.abs(h.step - prev.step) === 1 && !prev.dx ? d * 1.18 : 0; prev = h; } // a step apart: either side of the stem
      const kind = c.v >= 4 ? 'whole' : c.v >= 2 ? 'open' : 'solid', dotted = [0.375, 0.75, 1.5, 3].includes(c.v);
      let accCol = 0, lastAccY = Infinity;
      for (const h of [...c.heads].reverse()) {
        const hx = c.x + h.dx;
        glowHeads.push([kind, c]); lists[kind].push([hx, h.y]);
        if (dotted) lists.dot.push([c.x + 1.05 + Math.max(0, ...c.heads.map((k) => k.dx)), Number.isInteger(h.y) ? h.y + 0.5 : h.y]);
        for (let ly = BOTTOM[c.staff] - 1; ly >= h.y - 0.01; ly--) rect(hx - 0.95, ly - 0.05, hx + 0.95, ly + 0.05);
        for (let ly = TOP[c.staff] + 1; ly <= h.y + 0.01; ly++) rect(hx - 0.95, ly - 0.05, hx + 0.95, ly + 0.05);
        if (h.acc) {
          accCol = lastAccY - h.y < 3 ? accCol + 1 : 0; lastAccY = h.y;
          lists[h.acc === '♯' ? 'sharp' : h.acc === '♭' ? 'flat' : 'natural'].push([c.x - 1.45 - accCol * 0.95 + Math.min(0, h.dx), h.y]);
        }
      }
    };
    for (const g of groups) {
      const d = dirOf(g), lv = g.map((c) => level(c.v));
      g.forEach((c) => drawHeads(c, d));
      if (g[0].v >= 4) continue;
      const far = (c) => (d > 0 ? c.heads[0].y : c.heads[c.heads.length - 1].y), near = (c) => (d > 0 ? c.heads[c.heads.length - 1].y : c.heads[0].y);
      if (g.length === 1) {
        const c = g[0], extra = c.v < 1 ? (lv[0] - 1) * 0.6 : 0;
        let end = near(c) + d * (3.5 + extra);
        end = d > 0 ? Math.max(end, MID[c.staff]) : Math.min(end, MID[c.staff]);
        const sx = stemX(c, d);
        rect(sx - 0.065, Math.min(far(c), end), sx + 0.065, Math.max(far(c), end));
        if (c.v < 1) for (let k = 0; k < lv[0]; k++) lists[d > 0 ? 'flagUp' : 'flagDown'].push([sx, end - d * k * 0.8]);
        continue;
      }
      const deep = Math.max(...lv), xs = g.map((c) => stemX(c, d)), f = g[0], l = g[g.length - 1];
      const y0 = near(f) + d * 3.5, y1 = near(l) + d * 3.5, slope = Math.max(-0.16, Math.min(0.16, ((y1 - y0) / (xs[xs.length - 1] - xs[0])) * 0.5));
      let base = y0;
      g.forEach((c, i) => { const need = near(c) + d * (3.0 + (deep - 1) * 0.8), at = base + slope * (xs[i] - xs[0]); if ((need - at) * d > 0) base += need - at; });
      const at = (x) => base + slope * (x - xs[0]);
      g.forEach((c, i) => rect(xs[i] - 0.065, Math.min(far(c), at(xs[i])), xs[i] + 0.065, Math.max(far(c), at(xs[i]))));
      for (let L = 1; L <= deep; L++) {
        const off = -d * (L - 1) * 0.8, seg = (xa, xb) => slabLine(xa, at(xa) + off - d * 0.25, xb, at(xb) + off - d * 0.25, 0.5);
        if (L === 1) { seg(xs[0] - 0.065, xs[xs.length - 1] + 0.065); continue; }
        for (let i = 0; i < g.length; i++) {
          if (lv[i] < L) continue;
          if (i + 1 < g.length && lv[i + 1] >= L) seg(xs[i], xs[i + 1]);
          else if (!(i > 0 && lv[i - 1] >= L)) seg(i + 1 < g.length ? xs[i] : xs[i] - 1.1, i + 1 < g.length ? xs[i] + 1.1 : xs[i]);
        }
      }
    }
    for (const bx of S.barX) rect(bx - 0.07, 0, bx + 0.07, TOP[0]);
    rect(S.finalX - 0.75, 0, S.finalX - 0.6, TOP[0]); rect(S.finalX - 0.3, 0, S.finalX + 0.12, TOP[0]);
    for (let i = 0; i < Math.abs(S.sf); i++) for (const staff of [0, 1]) lists[S.sf < 0 ? 'flat' : 'sharp'].push([5.6 + i * 0.85, pageY(SIG[S.sf < 0 ? 'flat' : 'sharp'][staff ? 'bass' : 'treble'][i], staff)]);
  }
  const left = 0.6, right = S ? S.finalX : 60;
  rect(left - 0.07, 0, left + 0.07, TOP[0]);
  for (const b of [TB, 0]) for (let i = 0; i < 5; i++) rect(left, b + i - 0.045, right, b + i + 0.045);
  const printed = [];
  const inst = (geo, mat, items, place) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    m.count = items.length;
    items.forEach((it, i) => { place(it); m.setMatrixAt(i, M); });
    m.frustumCulled = false; scene.add(m); printed.push(m);
    return m;
  };
  inst(bar, ink, lists.line, ([x, y, w, h, a]) => M.compose(V.set(x, INK, -y), Q.setFromAxisAngle(UP, a), SC.set(w, 1, h)));
  const headPlace = ([x, y]) => M.compose(V.set(x, INK, -y), Q.identity(), SC.set(1, 1, 1));
  const glows = {}, heads = {};
  for (const [kind, geo] of [['solid', solidHead], ['open', openHead], ['whole', wholeHead]]) {
    heads[kind] = inst(geo, bead, lists[kind], headPlace); // tinted with the hand's colour once played (the matte look)
    heads[kind].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, lists[kind].length) * 3).fill(1), 3);
    glows[kind] = inst(geo, glowMat, lists[kind], ([x, y]) => M.compose(V.set(x, INK + 0.02, -y), Q.identity(), SC.set(1.14, 1.3, 1.14)));
    glows[kind].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, lists[kind].length) * 3), 3);
    glows[kind].renderOrder = 3;
  }
  inst(dotGeo, bead, lists.dot, ([x, y]) => M.compose(V.set(x, INK + 0.05, -y), Q.identity(), SC.set(1, 1, 1)));
  inst(flagShape, ink, lists.flagUp, ([x, y]) => M.compose(V.set(x - 0.06, INK, -y), Q.identity(), SC.set(1, 1, 1)));
  inst(flagShape, ink, lists.flagDown, ([x, y]) => M.compose(V.set(x - 0.06, INK, -y), Q.identity(), SC.set(1, 1, -1)));
  const signs = canvasTex(384, 128, (g) => { g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '96px serif'; ['♯', '♭', '♮'].forEach((s, i) => g.fillText(s, 64 + i * 128, s === '♭' ? 50 : 64)); });
  const signMat = new THREE.MeshBasicMaterial({ map: signs, color: inkColor, transparent: true, depthWrite: false, alphaTest: 0.1 });
  ['sharp', 'flat', 'natural'].forEach((name, i) => {
    const geo = flat(new THREE.PlaneGeometry(1.5, 1.5)), uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 3);
    inst(geo, signMat, lists[name], ([x, y]) => M.compose(V.set(x, INK + 0.01, -y), Q.identity(), SC.set(1.3, 1, 2.2)));
  });
  const PX = 48, cardW = 12, cardTop = TOP[0] + 3.5, cardBottom = -3.5;
  const clefOK = (() => { const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true }); const ink2 = (ch) => { x.clearRect(0, 0, 40, 40); x.font = '30px serif'; x.fillText(ch, 4, 32); return x.getImageData(0, 0, 40, 40).data.reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0); }; const a = ink2('\u{1D11E}'), b2 = ink2('\u{1D122}'), box = ink2('\u{10FFFE}'); return a > 2000 && b2 > 1500 && Math.abs(a - box) > 200 && Math.abs(a - b2) > 200; })();
  const card = canvasTex(cardW * PX, (cardTop - cardBottom) * PX, (g) => {
    const Y = (y) => (cardTop - y) * PX;
    g.fillStyle = '#fff';
    if (clefOK) { g.font = `${5.2 * PX}px serif`; g.fillText('\u{1D11E}', 1.2 * PX, Y(TB - 0.4)); g.font = `${4 * PX}px serif`; g.fillText('\u{1D122}', 1.3 * PX, Y(0.95)); }
    else { g.font = `italic 600 ${3.2 * PX}px Georgia, serif`; g.fillText('G', 1.4 * PX, Y(TB + 0.6)); g.fillText('F', 1.5 * PX, Y(1.2)); }
    if (S) {
      const [n, d] = S.meter, tx = (5.6 + S.keyW + 1.0) * PX;
      g.font = `700 ${2.6 * PX}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const b of [TB, 0]) { g.fillText(String(n), tx, Y(b + 3)); g.fillText(String(d), tx, Y(b + 1)); }
    }
  });
  const cardMesh = new THREE.Mesh(flat(new THREE.PlaneGeometry(cardW, cardTop - cardBottom)), new THREE.MeshBasicMaterial({ map: card, color: inkColor, transparent: true, depthWrite: false }));
  cardMesh.position.set(left + cardW / 2 - 0.2, INK + 0.01, -(cardTop + cardBottom) / 2); scene.add(cardMesh);

  // ---- the balls: glowing spheres with a reflection in the glass, a pool of light beneath, and a thin tail ----
  const ballGeo = new THREE.SphereGeometry(R, 40, 24);
  const ribbon = (mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NT * 2 * 3), 3));
    const idx = []; for (let i = 0; i < NT - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; scene.add(m);
    return m;
  };
  const balls = hands.map((c) => {
    const hot = c.clone().lerp(WHITE, 0.3);
    const ball = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ color: hot, emissive: hot, emissiveIntensity: 1.0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, toneMapped: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: c, opacity: 0.12, ...additive() }));
    const twin = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.7), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, fog: false }));
    const pool = new THREE.Mesh(flat(new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: dot, color: c, ...additive() }));
    const light = new THREE.PointLight(c, 0, 9, 1.7);
    const tail = ribbon(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...additive() }));
    const tailTwin = ribbon(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...additive() }));
    ball.renderOrder = 6; halo.renderOrder = 7; pool.renderOrder = 4; tail.renderOrder = 5; twin.renderOrder = tailTwin.renderOrder = -1;
    scene.add(ball, halo, twin, pool, light);
    return { ball, halo, twin, pool, light, tail, tailTwin };
  });
  const points = (count, size, order) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, ...additive() }));
    p.frustumCulled = false; p.renderOrder = order; scene.add(p);
    return p;
  };
  const SPARKS = 1400, sparks = points(SPARKS, 0.13, 8), sparkTwin = points(SPARKS, 0.13, -1);
  const GRAINS = 9000, powder = points(GRAINS, 0.15, 8), powderTwin = points(GRAINS, 0.15, -1); // fine glowing powder
  const clouds = Array.from({ length: 24 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, ...additive() })); s.renderOrder = 7; s.visible = false; scene.add(s); return s; });
  const dust = points(DUST, 0.08, 2);
  const flashes = Array.from({ length: POOL }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, ...additive() })); s.renderOrder = 9; s.visible = false; scene.add(s); return s; });
  const ringGeo = flat(new THREE.RingGeometry(0.86, 1, 48));
  const rings = Array.from({ length: POOL }, () => { const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, ...additive() })); r.renderOrder = 4; r.visible = false; scene.add(r); return r; });

  // ---- the sky ----
  const sky = new THREE.Group(); scene.add(sky);
  const nc = T.notes.length;
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 }, uMode: { value: 0 }, uA: { value: new THREE.Color(T.notes[1 % nc]) }, uB: { value: new THREE.Color(T.notes[2 % nc]) }, uC: { value: new THREE.Color(T.notes[0]) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: SKY_FRAG });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat); dome.renderOrder = -10; dome.frustumCulled = false; sky.add(dome);
  const starLayers = [[900, 2.2, 0], [420, 3.2, 0], [160, 4.6, 0], [1100, 1.9, 1]].map(([count, size, inBand], layer) => { // the last layer crowds along the galaxy's band
    const g = new THREE.BufferGeometry(), pos = new Float32Array(count * 3), base = [];
    const n = new THREE.Vector3(-0.25, 0.75, 0.6).normalize(), d = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const zz = rnd(i, layer * 7 + 1) * 2 - 1, ang = rnd(i, layer * 7 + 2) * Math.PI * 2, rr = Math.sqrt(1 - zz * zz); // an even spread over the sphere
      d.set(rr * Math.cos(ang), zz, rr * Math.sin(ang));
      if (inBand) { d.addScaledVector(n, -d.dot(n) * (0.75 + 0.25 * rnd(i, 40))).normalize(); }
      pos.set([d.x * 420, d.y * 420, d.z * 420], i * 3);
      const warm = rnd(i, layer * 7 + 4), k = 0.6 + 1.1 * rnd(i, layer * 7 + 5) ** 2;
      base.push([k * (0.85 + 0.15 * warm), k * 0.92, k * (1.05 - 0.2 * warm), rnd(i, layer * 7 + 6) * 6.28, 0.6 + 2.2 * rnd(i, layer * 7 + 8)]);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    p.frustumCulled = false; p.renderOrder = -9; sky.add(p);
    return { p, base, size, inBand };
  });

  // ---- notes played live (no piece): heads that appear where and when they are played ----
  const LIVE = 400, spell0 = speller(0);
  const liveHeads = new THREE.InstancedMesh(solidHead, bead, LIVE), liveGlow = new THREE.InstancedMesh(solidHead, glowMat, LIVE);
  liveGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LIVE * 3), 3);
  liveHeads.count = liveGlow.count = 0; liveHeads.frustumCulled = liveGlow.frustumCulled = false; scene.add(liveHeads, liveGlow);
  const liveLines = Array.from({ length: 10 }, (_, i) => { const m = new THREE.Mesh(bar, ink); m.position.set(0, INK, -((i < 5 ? TB : 0) + (i % 5))); m.scale.set(200, 1, 0.09); m.visible = false; scene.add(m); return m; });

  // where the camera looks: the place of the music, smoothed so the glide is even when the rhythm is not
  const camAt = (() => {
    if (!S) return () => 14;
    const step = 0.05, t0 = -4, t1 = (piece.duration || 0) + 6, n = Math.ceil((t1 - t0) / step) + 1, a = new Float64Array(n), tmp = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = S.xOf(t0 + i * step);
    const RW = Math.round(0.9 / step);
    for (let pass = 0; pass < 3; pass++) { for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - RW); j <= Math.min(n - 1, i + RW); j++) { s += a[j]; k++; } tmp[i] = s / k; } a.set(tmp); }
    return (t) => { const u = Math.min(n - 1, Math.max(0, (t - t0) / step)), i = Math.floor(u), f = u - i; return i + 1 < n ? a[i] + (a[i + 1] - a[i]) * f : a[i]; };
  })();

  // A ball's flight at time tau, as [x, page y, height of its centre]. Between two notes it follows a gravity arc
  // (straight across the page, a parabola in height); before the first note it drops in; after the last it settles.
  function fly(list, tau) {
    if (tau < list[0].t) { const a = list[0].t - tau; return [S.xOf(tau), list[0].y, REST + Math.min(HMAX + 2, 0.5 * G * a * a)]; }
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= tau) lo = m; else hi = m - 1; }
    const a = list[lo], b = list[lo + 1];
    if (!b) { // smaller and smaller bounces, each lasting 0.6 as long as the one before
      let tt = tau - a.t, span = 0.5;
      while (tt > span && span > 0.03) { tt -= span; span *= 0.6; }
      return [a.x, a.y, span > 0.03 ? REST + 0.5 * G * tt * (span - tt) * 0.35 : REST];
    }
    const u = (tau - a.t) / (b.t - a.t);
    return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, REST + hopHeight(b.t - a.t) * 4 * u * (1 - u)];
  }
  const at = (f) => V.set(f[0], f[2], -f[1]); // flight to world

  const col = new THREE.Color(), P = new THREE.Vector3(), Pn = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3(), tang = new THREE.Vector3(), vel = new THREE.Vector3(), q = new THREE.Quaternion();
  const glowLevel = (c, t) => {
    const age = t - c.t;
    if (age < 0) return 0;
    const len = Math.max(0.15, c.end - c.t);
    const k = age < 0.1 ? 2.8 - 8 * age : age < len ? 1.1 + 0.7 * Math.exp(-(age - 0.1) / 0.5) : 0.3 + 0.8 * Math.exp(-(age - len) / 1.1);
    return k * (0.55 + 0.6 * c.vel);
  };
  const firstIndex = (list, from) => { let lo = 0, hi = list.length; while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < from) lo = m + 1; else hi = m; } return lo; };

  function render(t, camera, { live, effects, motion, paths: showBalls, cam = 'side', glow = 0.45, sky: skyName = 'stars', px = 1, landing = 'sparks' }) {
    const doSparks = landing !== 'powder', doPowder = landing !== 'sparks';
    let pu = 0, nc2 = 0;
    const pp = powder.geometry.attributes, pm = powderTwin.geometry.attributes;
    const grain = (x, y, z, c) => { if (pu >= GRAINS) return; pp.position.setXYZ(pu, x, y, z); pp.color.setXYZ(pu, c.r, c.g, c.b); pm.position.setXYZ(pu, x, -y, z); pm.color.setXYZ(pu, c.r * 0.22, c.g * 0.22, c.b * 0.22); pu++; };
    const GL = Math.max(0, Math.min(1, glow)), lift2 = 0.35 + GL; // GL: how much the notes, balls and sparks glow (0 = matte)
    const tall = camera.aspect < 1, sway = motion ? 1 : 0;
    let xc, used = 0, nf = 0, nr = 0;
    const sp = sparks.geometry.attributes, sm = sparkTwin.geometry.attributes;
    const spark = (x, y, z, c) => { if (used >= SPARKS) return; sp.position.setXYZ(used, x, y, z); sp.color.setXYZ(used, c.r, c.g, c.b); sm.position.setXYZ(used, x, -y, z); sm.color.setXYZ(used, c.r * 0.22, c.g * 0.22, c.b * 0.22); used++; };
    for (const b of balls) for (const o of [b.ball, b.halo, b.twin, b.pool, b.tail, b.tailTwin]) o.visible = false;
    for (const b of balls) b.light.intensity = 0;
    if (live) {
      const xl = (s) => s * 5;
      xc = xl(t) - 6;
      let k = 0;
      for (let i = live.length - 1; i >= 0 && k < LIVE; i--) {
        const n = live[i], x = xl(n.t0);
        if (x < xc - 40) break;
        if (n.pitch < 21 || n.pitch > 108) continue;
        const staff = n.pitch < 60 ? 1 : 0, y = pageY(spell0(n.pitch).step, staff), held = n.t1 == null, age = t - n.t0;
        M.compose(V.set(x, INK, -y), Q.identity(), SC.set(1, 1, 1)); liveHeads.setMatrixAt(k, M);
        M.compose(V.set(x, INK + 0.02, -y), Q.identity(), SC.set(1.14, 1.3, 1.14)); liveGlow.setMatrixAt(k, M);
        const lvl = (held ? Math.max(1.1, 2.6 - age * 4) : 0.3 + 0.8 * Math.exp(-(t - n.t1) / 1.1)) * (0.55 + 0.6 * n.vel);
        col.copy(hands[staff]).multiplyScalar(lvl); liveGlow.instanceColor.setXYZ(k, col.r, col.g, col.b);
        k++;
      }
      liveHeads.count = liveGlow.count = k;
      liveHeads.instanceMatrix.needsUpdate = liveGlow.instanceMatrix.needsUpdate = liveGlow.instanceColor.needsUpdate = true;
      for (const m of liveLines) { m.visible = true; m.position.x = xc + 20; }
      for (const m of printed) m.visible = false;
      cardMesh.visible = false;
    } else {
      xc = camAt(t);
      liveHeads.count = liveGlow.count = 0;
      for (const m of liveLines) m.visible = false;
      for (const m of printed) m.visible = true;
      cardMesh.visible = true;
      if (S) {
        // notes light up as they are played
        const counters = { solid: 0, open: 0, whole: 0 };
        for (const [kind, c] of glowHeads) {
          const k = glowLevel(c, t), i = counters[kind]++, tint = Math.min(1, k / 1.1) * 0.9;
          col.copy(hands[c.staff]).multiplyScalar(k * GL * 1.5); glows[kind].instanceColor.setXYZ(i, col.r, col.g, col.b);
          col.setRGB(1, 1, 1).lerp(hands[c.staff], tint); heads[kind].instanceColor.setXYZ(i, col.r, col.g, col.b);
        }
        for (const kind of ['solid', 'open', 'whole']) glows[kind].instanceColor.needsUpdate = heads[kind].instanceColor.needsUpdate = true;
        S.landings.forEach((list, hand) => {
          if (!showBalls || !list.length || t < list[0].t - 1.4) return;
          const B = balls[hand], c = hands[hand];
          // the ball: stretched along its flight when it moves fast, squashed for an instant when it lands
          const f = fly(list, t), fa = fly(list, t - 0.006), fb = fly(list, t + 0.006);
          P.copy(at(f)); vel.copy(at(fb)).sub(Pn.copy(at(fa))).divideScalar(0.012);
          const li = firstIndex(list, t + 1e-6) - 1, since = li >= 0 ? t - list[li].t : 9, squash = Math.max(0, 1 - since / 0.08);
          const speed = vel.length(), stretch = Math.min(0.3, speed / 70) * (1 - squash);
          if (squash > 0) { B.ball.quaternion.identity(); B.ball.scale.set(1 + 0.28 * squash, 1 - 0.34 * squash, 1 + 0.28 * squash); B.ball.position.set(P.x, P.y - R * 0.34 * squash, P.z); }
          else { q.setFromUnitVectors(UP, tang.copy(vel).normalize()); B.ball.quaternion.copy(q); B.ball.scale.set(1 - stretch * 0.4, 1 + stretch, 1 - stretch * 0.4); B.ball.position.copy(P); }
          B.twin.position.set(B.ball.position.x, -B.ball.position.y, B.ball.position.z); B.twin.scale.copy(B.ball.scale); B.twin.quaternion.copy(B.ball.quaternion); B.twin.quaternion.x *= -1; B.twin.quaternion.z *= -1;
          B.halo.position.copy(P); B.halo.scale.setScalar(1.5);
          const lift = Math.max(0, P.y - REST), near = Math.exp(-lift * 0.9);
          B.pool.position.set(P.x, INK + 0.012, P.z); B.pool.scale.set(1 + lift * 0.9, 1, 1 + lift * 0.9); B.pool.material.opacity = 0.8 * near * GL; B.ball.material.emissiveIntensity = 0.25 + GL; B.halo.material.opacity = 0.26 * GL; B.pool.material.color.copy(c);
          B.light.position.set(P.x, P.y + 0.4, P.z); B.light.intensity = (2.2 + 5 * squash) * lift2;
          for (const o of [B.ball, B.halo, B.twin, B.pool, B.tail, B.tailTwin]) o.visible = true;
          // the thin tail, brightest just behind the ball, and its reflection
          const pos = B.tail.geometry.attributes.position, tc = B.tail.geometry.attributes.color, pos2 = B.tailTwin.geometry.attributes.position, tc2 = B.tailTwin.geometry.attributes.color;
          for (let i = 0; i < NT; i++) {
            const age = i / (NT - 1), tau = t - age * TAIL;
            P.copy(at(fly(list, tau))); Pn.copy(at(fly(list, tau + 0.01)));
            tang.subVectors(Pn, P); view.subVectors(camera.position, P); side.crossVectors(tang, view).normalize();
            const half = 0.006 + 0.03 * (1 - age) ** 1.6, k = (1 - age) ** 2.2 * 0.7;
            pos.setXYZ(i * 2, P.x + side.x * half, P.y + side.y * half, P.z + side.z * half); pos.setXYZ(i * 2 + 1, P.x - side.x * half, P.y - side.y * half, P.z - side.z * half);
            pos2.setXYZ(i * 2, P.x + side.x * half, -P.y - side.y * half, P.z + side.z * half); pos2.setXYZ(i * 2 + 1, P.x - side.x * half, -P.y + side.y * half, P.z - side.z * half);
            col.copy(c).lerp(WHITE, 0.4 * (1 - age) ** 4).multiplyScalar(k * lift2);
            tc.setXYZ(i * 2, col.r, col.g, col.b); tc.setXYZ(i * 2 + 1, col.r, col.g, col.b);
            tc2.setXYZ(i * 2, col.r * 0.2, col.g * 0.2, col.b * 0.2); tc2.setXYZ(i * 2 + 1, col.r * 0.2, col.g * 0.2, col.b * 0.2);
          }
          for (const a of [pos, tc, pos2, tc2]) a.needsUpdate = true;
          if (!effects) return;
          // comet sparks: shed from the ball as it flies, they drift back, fall, glow white-hot and go out
          for (let j = Math.floor(t / DT); j * DT > t - LIFE; j--) {
            const e = j * DT, a = t - e;
            if (e < list[0].t - 1.4) break;
            const p0 = at(fly(list, e)), px = p0.x, py = p0.y, pz = p0.z, p1 = at(fly(list, e + 0.004));
            const vx = (p1.x - px) / 0.004, vy = (p1.y - py) / 0.004, vz = (p1.z - pz) / 0.004;
            const r1 = rnd(j, hand * 3 + 1), r2 = rnd(j, hand * 3 + 2), r3 = rnd(j, hand * 3 + 3), th = r1 * Math.PI * 2, ph = Math.acos(2 * r2 - 1), sp0 = 0.25 + 0.9 * r3;
            let x = px + (-vx * 0.05 + Math.sin(ph) * Math.cos(th) * sp0) * a, y = py + (-vy * 0.05 + Math.cos(ph) * sp0 + 0.3) * a - 2.6 * a * a, z = pz + (-vz * 0.05 + Math.sin(ph) * Math.sin(th) * sp0) * a;
            if (y < 0.03) y = 0.03 + (0.03 - y) * 0.25;
            const heat = 1 - a / LIFE;
            col.copy(c).lerp(WHITE, heat ** 3 * 0.85).multiplyScalar(heat ** 1.8 * (0.7 + 0.6 * rnd(j, hand + 9)) * lift2);
            spark(x, y, z, col);
          }
          // where the ball lands: a flash, a ripple across the glass, and sparks that bounce and skid
          for (let j = firstIndex(list, t - (doPowder ? PLIFE : HIT)); j < list.length && list[j].t <= t; j++) {
            const L = list[j], a = t - L.t, k = a / HIT, seed = L.t * 31 + hand;
            if (doPowder && a < PLIFE) {
              // powder: a burst of fine glowing grains that races out across the glass, puffs up a little, swirls as it
              // slows, then settles and slowly goes out; a soft cloud of light hangs over it for a moment
              const life = a / PLIFE, many = Math.round(PN * (0.6 + 0.6 * L.vel));
              if (a < 0.9 && nc2 < clouds.length) { const cl = clouds[nc2++], u = a / 0.9; cl.visible = true; cl.position.set(L.x, 0.35 + 0.5 * u, -L.y); cl.scale.setScalar(1 + 3.2 * Math.sqrt(u)); cl.material.color.copy(c).multiplyScalar(0.5 * lift2); cl.material.opacity = 0.5 * (1 - u) ** 2; }
              for (let s = 0; s < many; s++) {
                const r1 = rnd(seed + 7, s), r2 = rnd(s, seed + 3), r3 = rnd(s + 70, seed), r4 = rnd(seed, s + 140);
                const v0 = 1.5 + 10 * r2 * r2, drag = 3.2 + 2 * r3, dist = (v0 * (1 - Math.exp(-drag * a))) / drag;
                const an = r1 * Math.PI * 2 + (r4 - 0.5) * 1.4 * (1 - Math.exp(-1.5 * a)); // a gentle swirl as it slows
                let y = 0.06 + ((0.4 + 2.2 * r3 * r4) * (1 - Math.exp(-3 * a))) / 3 - 0.18 * a * a;
                if (y < 0.035) y = 0.035;
                const glowK = (1 - life) ** 1.2 * (0.45 + 0.55 * r4) * lift2 * 2.6 * (1 + 2.2 * Math.exp(-a * 5)); // vivid as it bursts, gentle as it settles
                col.copy(c).lerp(WHITE, Math.max(0, 1 - a * 3) * 0.6).multiplyScalar(glowK);
                grain(L.x + Math.cos(an) * dist, y, -(L.y + Math.sin(an) * dist * 0.85), col);
              }
            }
            if (a >= HIT) continue;
            if (a < 0.16 && nf < POOL) { const s = flashes[nf++], u = a / 0.16; s.visible = true; s.position.set(L.x, REST - R + 0.1, -L.y); s.scale.setScalar(0.6 + 2.0 * Math.sqrt(u)); s.material.color.copy(c).lerp(WHITE, 0.5).multiplyScalar(1.6 * lift2 - 0.4); s.material.opacity = (1 - u) ** 1.5; }
            if (a < 0.7 && nr < POOL) { const r = rings[nr++], u = a / 0.7, rad = 0.35 + 1.5 * u ** 0.6; r.visible = true; r.position.set(L.x, INK + 0.015, -L.y); r.scale.set(rad, 1, rad); r.material.color.copy(c).multiplyScalar(0.6 * lift2 * (1 - u) ** 2); }
            for (let s = 0; s < (doSparks ? HITN : 0); s++) {
              const an = rnd(seed, s) * Math.PI * 2, v = 1.2 + 3.4 * rnd(s, seed), vy = 1 + 3.2 * rnd(s + 50, seed), d = (v * (1 - Math.exp(-2.4 * a))) / 2.4;
              let y = 0.2 + vy * a - 4.5 * a * a;
              if (y < 0.03) y = 0.03 + (0.03 - y) * 0.2;
              const heat = 1 - k;
              col.copy(c).lerp(WHITE, heat ** 2 * 0.75).multiplyScalar(heat ** 1.5 * 1.5 * lift2);
              spark(L.x + Math.cos(an) * d, y, -(L.y + Math.sin(an) * d * 0.8), col);
            }
          }
        });
      }
    }
    sparks.geometry.setDrawRange(0, used); sparkTwin.geometry.setDrawRange(0, used);
    powder.geometry.setDrawRange(0, pu); powderTwin.geometry.setDrawRange(0, pu);
    pp.position.needsUpdate = pp.color.needsUpdate = pm.position.needsUpdate = pm.color.needsUpdate = true;
    for (let i = nc2; i < clouds.length; i++) clouds[i].visible = false;
    sp.position.needsUpdate = sp.color.needsUpdate = sm.position.needsUpdate = sm.color.needsUpdate = true;
    for (let i = nf; i < POOL; i++) flashes[i].visible = false;
    for (let i = nr; i < POOL; i++) rings[i].visible = false;
    // dust in the air: fixed in space, so it drifts past at its own depth as the camera moves
    dust.visible = effects;
    if (effects) {
      const dp = dust.geometry.attributes;
      for (let i = 0; i < DUST; i++) {
        const x = xc - 30 + ((((rnd(i, 1) * 80 - (xc - 30)) % 80) + 80) % 80), k = 0.06 + 0.12 * rnd(i, 4);
        dp.position.setXYZ(i, x + Math.sin(t * 0.21 + i) * 0.3, 0.6 + rnd(i, 2) * 10 + Math.sin(t * 0.3 + i * 1.7) * 0.25, 7 - rnd(i, 3) * 32);
        dp.color.setXYZ(i, k * 1.1, k, k * 0.8);
      }
      dp.position.needsUpdate = dp.color.needsUpdate = true;
    }
    // Cameras. Wide (YouTube): low and to the side, looking along the music, which recedes into the distance.
    // Tall (Shorts): behind and above, so the music runs up the picture like a road.
    const sx = Math.sin(t * 0.13) * sway, sy = Math.sin(t * 0.09 + 1) * sway, set = CAMS[tall ? 'tall' : 'wide'];
    let pose = set[cam] || set.side;
    if (cam === 'move') { // hold each place for a while, then glide to the next
      const ph = (((t + 8) / 14) % TOUR.length + TOUR.length) % TOUR.length, i = Math.floor(ph), f = smooth((ph - i - 0.55) / 0.45);
      const A = set[TOUR[i]], B = set[TOUR[(i + 1) % TOUR.length]], mix = (a, b) => a.map((v, k) => v + (b[k] - v) * f);
      pose = [mix(A[0], B[0]), mix(A[1], B[1]), A[2] + (B[2] - A[2]) * f];
    }
    const [po, lo] = pose;
    camera.position.set(xc + po[0] + sx * (tall ? 1 : 1.5), po[1] + sy * 0.6, po[2] + (tall ? sx * 1.8 : -sx * 0.8));
    camera.lookAt(xc + lo[0], lo[1], lo[2]);
    // the sky travels with the camera, so it is infinitely far away
    const mode = SKIES[skyName] ?? 1;
    sky.position.copy(camera.position); sky.visible = mode > 0; dome.visible = mode > 1; floor.visible = mode === 0; // with a sky, the glass floats in space
    skyMat.uniforms.uTime.value = t; skyMat.uniforms.uMode.value = mode;
    if (mode > 0) for (const L of starLayers) {
      L.p.visible = !L.inBand || mode === 3;
      if (!L.p.visible) continue;
      L.p.material.size = L.size * Math.max(0.8, px);
      const cc = L.p.geometry.attributes.color;
      L.base.forEach(([r, g, b, phase, rate], i) => { const tw = 0.72 + 0.28 * Math.sin(t * rate + phase); cc.setXYZ(i, r * tw, g * tw, b * tw); });
      cc.needsUpdate = true;
    }
    lamp.position.set(xc + 4, 9, -12);
    backLight.position.set(xc + 40, 16, -9);
    keyLight.position.set(xc - 20, 30, 25); keyLight.target.position.set(xc, 0, -7);
    floor.position.x = xc;
    const focus = camera.position.distanceTo(V.set(xc + 1, 0, -7.5));
    return { focus, range: pose[2], sky: mode > 0, point: new THREE.Vector3(xc + 1, 0, -7.5) };
  }
  return { scene, render };
}
