// "Dancer" view: a figure drawn only by its glowing outline dances in the flight-lines space to whatever the studio hears.
// listen.js says where the beat is and which way of moving fits (flowing, swaying, groove, energetic); this file turns
// that into steps. Nothing here is recorded motion: every move is a small formula of the beat, and moves are chained
// in phrases of eight beats, so the dance follows the music's tempo exactly and changes character when the music does.
import * as THREE from '../vendor/three.min.js?v=7';
import { STYLES } from './listen.js?v=8';

const TAU = Math.PI * 2, W = 0.017; // W = thickness of the outline, in metres
// A girl of about ten, roughly 1.45 m tall. The moves below were written for a taller figure, so their distances are scaled by S.
const HIP = 0.76, THIGH = 0.37, SHIN = 0.36, ANKLE = 0.06, TORSO = 0.4, SHOULDER = 0.15, HIPW = 0.08, UPPER = 0.235, FORE = 0.215, S = 0.86;
const sin1 = (x) => Math.sin(TAU * x), frac = (x) => x - Math.floor(x);
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const dip = (b) => (0.5 + 0.5 * Math.cos(TAU * b)) ** 2; // 1 exactly on the beat, 0 between beats
const up = (x) => Math.max(0, x);

// A pose is a list of numbers. Hands are measured from their own shoulder (x = out to the side, y = up, z = forward);
// feet from their place under the hips (x = to the dancer's left, y = lifted, z = forward).
const KEYS = ['hx', 'hy', 'hz', 'tw', 'lean', 'side', 'ctw', 'nod', 'tilt', 'lx', 'ly', 'lz', 'rx', 'ry', 'rz', 'flx', 'fly', 'flz', 'frx', 'fry', 'frz', 'face', 'spin'];
const REST = { hx: 0, hy: 0, hz: 0, tw: 0, lean: 0, side: 0, ctw: 0, nod: 0, tilt: 0, lx: 0.07, ly: -0.52, lz: 0.05, rx: 0.07, ry: -0.52, rz: 0.05, flx: 0.03, fly: 0, flz: 0, frx: -0.03, fry: 0, frz: 0, face: 0, spin: 0 };
const pose = (o) => ({ ...REST, ...o });

// step to the left, close, step back, close: four counts
function stepTouch(c, size, lift) {
  const p = frac(c / 4) * 4, arc = (a) => { const u = (p - a) / 0.6; return u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0; };
  const L = size * (ease(p / 0.6) - ease((p - 3) / 0.6)), R = size * (ease((p - 1) / 0.6) - ease((p - 2) / 0.6));
  return { flx: 0.03 + L, frx: -0.03 + R, fly: lift * (arc(0) + arc(3)), fry: lift * (arc(1) + arc(2)), hx: (L + R) / 2 };
}

const MOVES = {
  idle: [(b, t) => pose({ hy: 0.006 * Math.sin(t * 1.6), hx: 0.015 * Math.sin(t * 0.5), side: 0.02 * Math.sin(t * 0.5), nod: 0.02 * Math.sin(t * 0.8) })],
  flow: [
    (b) => { // long arcs of the arms, one after the other
      const a = 0.5 - 0.5 * Math.cos(TAU * b / 8), c = 0.5 - 0.5 * Math.cos(TAU * (b / 8 + 0.5));
      return pose({ hx: 0.06 * sin1(b / 8), hy: 0.012 * sin1(b / 4), side: 0.1 * sin1(b / 8), lean: -0.03, tilt: 0.1 * sin1(b / 8), nod: -0.05,
        lx: 0.1 + 0.34 * Math.sin(Math.PI * a), ly: -0.4 + 0.85 * a, lz: 0.12, rx: 0.1 + 0.34 * Math.sin(Math.PI * c), ry: -0.4 + 0.85 * c, rz: 0.12,
        flx: 0.07, frx: -0.07, face: 0.45 * sin1(b / 16) });
    },
    (b) => { // a slow turn on one leg, arms held round
      return pose({ hy: 0.025 + 0.01 * sin1(b / 4), side: 0.04 * sin1(b / 4), lx: 0.4, ly: -0.1 + 0.07 * sin1(b / 4), lz: 0.22, rx: 0.4, ry: -0.1 - 0.07 * sin1(b / 4), rz: 0.22,
        fry: 0.16, frz: 0.05, frx: 0.02, tilt: 0.06, spin: 1 / 8 });
    },
    (b) => { // wide stance, the body leans from side to side with the arms as one line
      const s = sin1(b / 8);
      return pose({ hx: 0.2 * s, hy: -0.05 * Math.abs(s), side: -0.2 * s, tilt: -0.12 * s, flx: 0.2, frx: -0.2,
        lx: 0.42, ly: 0.05 + 0.36 * s, lz: 0.06, rx: 0.42, ry: 0.05 - 0.36 * s, rz: 0.06, face: 0.2 * sin1(b / 16) });
    },
    (b) => { // one leg reaches back while both arms open forward and up
      const a = ease(up(sin1(b / 8)) * 1.4), c = ease(up(-sin1(b / 8)) * 1.4);
      return pose({ lean: 0.16 * (a + c), hz: 0.05 * (a + c), frz: -0.38 * a, fry: 0.2 * a, flz: -0.38 * c, fly: 0.2 * c,
        lx: 0.22 + 0.15 * (a + c), ly: -0.45 + 0.75 * (a + c), lz: 0.25, rx: 0.22 + 0.15 * (a + c), ry: -0.45 + 0.6 * (a + c), rz: 0.3, nod: -0.1 * (a + c) });
    },
  ],
  sway: [
    (b) => { // step, close, step, close; arms swing loosely
      const s = stepTouch(b, 0.24, 0.05);
      return pose({ ...s, hy: -0.02 * dip(b), side: 0.07 * sin1(b / 4), tilt: 0.06 * sin1(b / 4), lx: 0.1, ly: -0.45, lz: 0.05 + 0.16 * sin1(b / 2), rx: 0.1, ry: -0.45, rz: 0.05 - 0.16 * sin1(b / 2) });
    },
    (b) => { // arms overhead, swaying
      const s = sin1(b / 4);
      return pose({ hx: -0.08 * s, hy: -0.015 * dip(b), side: 0.13 * s, tilt: 0.1 * s, flx: 0.13, frx: -0.13,
        lx: 0.12 + 0.2 * s, ly: 0.5, lz: 0.05, rx: 0.12 - 0.2 * s, ry: 0.5, rz: 0.05 });
    },
    (b) => { // the same step, turning a quarter each bar, arms opening and closing
      const s = stepTouch(b, 0.22, 0.05), o = 0.5 - 0.5 * Math.cos(TAU * b / 4);
      return pose({ ...s, hy: -0.02 * dip(b), side: 0.05 * sin1(b / 4), lx: 0.15 + 0.25 * o, ly: -0.4 + 0.3 * o, lz: 0.12, rx: 0.15 + 0.25 * o, ry: -0.4 + 0.3 * o, rz: 0.12, spin: 1 / 16 });
    },
    (b) => { // hips lead, one hand draws a slow wave
      const s = sin1(b / 4);
      return pose({ hx: 0.1 * s, tw: 0.18 * s, ctw: -0.12 * s, hy: -0.02 * dip(b), flx: 0.1, frx: -0.1, lx: 0.3, ly: 0.05 + 0.2 * sin1(b / 2), lz: 0.2, rx: 0.1, ry: -0.4, rz: 0.08, tilt: 0.06 * s });
    },
  ],
  groove: [
    (b) => { // two-step with a bounce, elbows pumping
      const s = stepTouch(b * 2, 0.2, 0.06);
      return pose({ ...s, hy: -0.05 * dip(b), ctw: 0.25 * sin1(b / 2), nod: 0.08 * dip(b), lx: 0.13, ly: -0.22 + 0.11 * sin1(b), lz: 0.24, rx: 0.13, ry: -0.22 - 0.11 * sin1(b), rz: 0.24 });
    },
    (b) => { // hips twist, hands clap on two and four
      const c = dip(b / 2 + 0.5), s = sin1(b / 2);
      return pose({ hy: -0.06 * dip(b), tw: 0.3 * s, ctw: -0.2 * s, flx: 0.15, frx: -0.15, nod: 0.06 * dip(b),
        lx: 0.3 - 0.47 * c, ly: -0.25 + 0.2 * c, lz: 0.3, rx: 0.3 - 0.47 * c, ry: -0.25 + 0.2 * c, rz: 0.3 });
    },
    (b) => { // one arm points up and out, then the other
      const a = ease(up(sin1(b / 4)) * 2), c = ease(up(-sin1(b / 4)) * 2);
      return pose({ hx: 0.1 * (a - c), hy: -0.04 * dip(b), side: -0.1 * (a - c), flx: 0.14, frx: -0.14, tilt: 0.08 * (c - a),
        lx: 0.12 + 0.3 * a, ly: -0.38 + 0.85 * a, lz: 0.08, rx: 0.12 + 0.3 * c, ry: -0.38 + 0.85 * c, rz: 0.08 });
    },
    (b) => { // travelling to the side and back with small quick steps
      const s = sin1(b / 2);
      return pose({ hx: 0.3 * sin1(b / 8), flx: 0.05 + 0.3 * sin1((b - 0.35) / 8), frx: -0.05 + 0.3 * sin1((b - 0.35) / 8), fly: 0.08 * up(s), fry: 0.08 * up(-s), hy: -0.04 * dip(b),
        ctw: 0.2 * s, lx: 0.14, ly: -0.3, lz: 0.1 + 0.2 * s, rx: 0.14, ry: -0.3, rz: 0.1 - 0.2 * s });
    },
  ],
  energy: [
    (b) => { // jumping on every beat, fists overhead in turn
      const j = Math.sin(Math.PI * frac(b)) ** 0.8, a = 0.5 + 0.5 * sin1(b / 2);
      return pose({ hy: 0.1 * j - 0.05 * dip(b), fly: 0.09 * j, fry: 0.09 * j, flx: 0.08, frx: -0.08, nod: 0.1 * dip(b),
        lx: 0.1, ly: 0.1 + 0.42 * a, lz: 0.1, rx: 0.1, ry: 0.1 + 0.42 * (1 - a), rz: 0.1 });
    },
    (b) => { // high knees, the opposite arm punching forward
      const l = up(sin1(b / 2)) ** 0.7, r = up(-sin1(b / 2)) ** 0.7;
      return pose({ hy: 0.03 * Math.abs(sin1(b / 2)) - 0.02, lean: 0.07, fly: 0.34 * l, flz: 0.2 * l, fry: 0.34 * r, frz: 0.2 * r,
        lx: 0.08, ly: -0.12, lz: 0.14 + 0.34 * r, rx: 0.08, ry: -0.12, rz: 0.14 + 0.34 * l });
    },
    (b) => { // wide and low, both arms thrown up every two beats
      const a = 0.5 - 0.5 * Math.cos(TAU * b / 2);
      return pose({ hy: -0.12 * dip(b) - 0.03, flx: 0.27, frx: -0.27, lean: 0.08 + 0.1 * dip(b), nod: 0.18 * dip(b), lx: 0.3, ly: -0.3 + 0.8 * a, lz: 0.1, rx: 0.3, ry: -0.3 + 0.8 * a, rz: 0.1 });
    },
    (b) => { // jumps while turning, arms flung wide
      const j = Math.sin(Math.PI * frac(b)) ** 0.8;
      return pose({ hy: 0.09 * j - 0.04 * dip(b), fly: 0.08 * j, fry: 0.08 * j, flx: 0.1, frx: -0.1, lx: 0.46, ly: 0.05 + 0.12 * sin1(b), lz: 0.02, rx: 0.46, ry: 0.05 - 0.12 * sin1(b), rz: 0.02, spin: 1 / 4 });
    },
  ],
};
const PHRASE = { flow: 16, sway: 8, groove: 8, energy: 8 };

function styled(style, b, t) { // the pose a style asks for at beat b, cross-fading from one move to the next over a beat
  const list = MOVES[style], n = PHRASE[style], k = Math.floor(b / n), w = ease(frac(b / n) * n / 2); // two beats to melt from one move into the next
  const now = list[(k * 3 + 1) % list.length](b, t); // the order 1, 0, 3, 2: no move twice in a row
  if (w >= 1 || k === 0) return now;
  const before = list[((k - 1) * 3 + 1) % list.length](b, t);
  for (const key of KEYS) now[key] = before[key] + (now[key] - before[key]) * w;
  return now;
}


// How quickly each part of the body follows what a move asks of it (higher = quicker). The hips and feet lead,
// the hands and head arrive a little later: that overlap is most of what makes movement look alive.
const QUICK = { hx: 15, hy: 19, hz: 15, tw: 13, lean: 12, side: 12, ctw: 11, nod: 9, tilt: 8, lx: 12, ly: 12, lz: 12, rx: 12, ry: 12, rz: 12, flx: 20, fly: 24, flz: 20, frx: 20, fry: 24, frz: 20, face: 5, spin: 4 };
const POSITIONS = new Set(['hx', 'hy', 'hz', 'lx', 'ly', 'lz', 'rx', 'ry', 'rz', 'flx', 'fly', 'flz', 'frx', 'fry', 'frz']);

export function buildDancer(T, tools) {
  const { canvasTex, dot } = tools, scene = new THREE.Scene();
  scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(T.fog, 7, 26);
  const grid = (opacity) => { const g = new THREE.GridHelper(48, 48, T.trim, T.trim); g.material.transparent = true; g.material.opacity = opacity; g.material.depthWrite = false; return g; };
  const floor = grid(0.2); scene.add(floor);
  const wall = grid(0.08); wall.rotation.x = Math.PI / 2; wall.position.set(0, 0, -9); scene.add(wall);

  // ----- the figure. Every part is a black shape wrapped in a slightly larger shell that is seen only from inside.
  // The shells are drawn first, then all the black shapes are drawn over everything, so the only light left is the
  // line around the whole body: one unbroken outline, with no joints or seams showing. -----
  const figure = new THREE.Group(); scene.add(figure);
  const skin = new THREE.MeshBasicMaterial({ color: '#010102', fog: false });
  const cover = new THREE.MeshBasicMaterial({ color: '#010102', fog: false, depthTest: false, depthWrite: false });
  const line = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, fog: false, toneMapped: false });
  const part = (inner, outer) => {
    const g = new THREE.Group(), a = new THREE.Mesh(inner, skin), b = new THREE.Mesh(outer, line), c = new THREE.Mesh(inner, cover);
    b.renderOrder = 1; c.renderOrder = 2; g.add(a, b, c); figure.add(g);
    return g;
  };
  const bone = (r, len, r2 = r) => { // r2: a different thickness at the far end (a calf narrows to the ankle)
    const make = (grow) => { const g = new THREE.CapsuleGeometry(r + grow, len, 8, 20), p = g.attributes.position; if (r2 !== r) { for (let i = 0; i < p.count; i++) { const k = 1 + ((r2 + grow) / (r + grow) - 1) * Math.min(1, Math.max(0, p.getY(i) / len + 0.5)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } } return g; };
    return part(make(0), make(W));
  };
  const ball = (x, y, z) => part(new THREE.SphereGeometry(1, 24, 16).scale(x, y, z), new THREE.SphereGeometry(1, 24, 16).scale(x + W, y + W, z + W));
  const B = { spine: bone(0.088, TORSO - 0.1, 0.078), chest: ball(0.142, 0.125, 0.092), pelvis: ball(0.122, 0.09, 0.094), neck: bone(0.033, 0.06), head: ball(0.097, 0.114, 0.103),
    hair: ball(0.106, 0.108, 0.112), tail1: bone(0.04, 0.12, 0.034), tail2: bone(0.034, 0.12, 0.02),
    skirt: part(new THREE.CylinderGeometry(0.1, 0.27, 0.27, 28), new THREE.CylinderGeometry(0.1 + W, 0.27 + W, 0.27 + W * 2, 28)) };
  for (const s of ['l', 'r']) Object.assign(B, { [s + 'sh']: ball(0.05, 0.05, 0.05), [s + 'up']: bone(0.04, UPPER, 0.034), [s + 'fo']: bone(0.034, FORE, 0.026), [s + 'ha']: ball(0.03, 0.045, 0.022),
    [s + 'th']: bone(0.066, THIGH, 0.05), [s + 'sn']: bone(0.049, SHIN, 0.033), [s + 'ft']: bone(0.034, 0.12, 0.028) });
  const v = () => new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), tmp = v(), tmp2 = v(), tmp3 = v(), mat = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const J = Object.fromEntries(['pel', 'che', 'nk', 'hd', 'dir', 'pr', 'cr', 'lsh', 'rsh', 'lel', 'rel', 'lha', 'rha', 'lhi', 'rhi', 'lkn', 'rkn', 'lan', 'ran', 'lto', 'rto', 'pole', 'fw', 'waist', 'hem', 'root', 't1', 't2'].map((k) => [k, v()]));
  const between = (g, a, b) => { g.position.copy(a).add(b).multiplyScalar(0.5); g.quaternion.setFromUnitVectors(Y, tmp.copy(b).sub(a).normalize()); };
  const oriented = (g, at, right, upv) => { tmp3.copy(upv).addScaledVector(right, -upv.dot(right)).normalize(); tmp.crossVectors(right, tmp3).normalize(); mat.makeBasis(right, tmp3, tmp); g.quaternion.setFromRotationMatrix(mat); g.position.copy(at); };
  // the middle joint of an arm or leg: a is the shoulder or hip, t the hand or ankle (moved closer if out of reach)
  function reach(a, t, l1, l2, pole, mid) {
    tmp.copy(t).sub(a);
    const far = tmp.length() || 1e-6, full = (l1 + l2) * 0.99, soft = full * 0.82;
    // near full stretch the limb gives way gradually and never quite straightens: locked elbows and knees look stiff, and a hard stop shows as a jerk
    const d = Math.max(Math.abs(l1 - l2) + 0.02, far < soft ? far : soft + (full - soft) * (1 - Math.exp(-(far - soft) / (full - soft))));
    tmp.multiplyScalar(1 / far); t.copy(a).addScaledVector(tmp, d);
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    tmp2.copy(pole).addScaledVector(tmp, -pole.dot(tmp)).normalize();
    mid.copy(a).addScaledVector(tmp, x).addScaledVector(tmp2, h);
  }

  // ----- light around the dancer -----
  const add = { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false };
  const ringGeo = new THREE.RingGeometry(0.975, 1, 96).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ ...add, opacity: 0 })); m.position.y = 0.01; scene.add(m); return { m, born: -9 }; });
  const pool = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, ...add, opacity: 0.25 })); pool.scale.set(2.2, 0.75, 1); pool.position.set(0, 0.02, 0); scene.add(pool);
  const NB = 48, barGeo = new THREE.BoxGeometry(0.045, 1, 0.045).translate(0, 0.5, 0);
  const bars = Array.from({ length: NB }, (_, i) => { const m = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ ...add, opacity: 0.8 })); const a = (i / NB) * TAU; m.position.set(Math.sin(a) * 3.1, 0, Math.cos(a) * 3.1 - 0.4); scene.add(m); return m; });
  const NT = 60; // ribbons that follow the hands, as in the flight-lines view
  const trails = ['lha', 'rha'].map((k) => {
    const g = new THREE.BufferGeometry(), idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NT * 6), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NT * 6), 3));
    for (let i = 0; i < NT - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...add })); m.frustumCulled = false; m.renderOrder = 3; scene.add(m);
    return { k, m, pts: [] };
  });

  const colors = { flow: new THREE.Color(T.notes[0]), sway: new THREE.Color(T.notes[2]), groove: new THREE.Color(T.notes[1]), energy: new THREE.Color(T.notes[3]), idle: new THREE.Color(T.led || T.trim) };
  const col = new THREE.Color(), cur = { ...REST }, vel = Object.fromEntries(KEYS.map((k) => [k, 0])), want = { ...REST };
  const D = { last: 0, presence: 0, yaw: 0, yawRate: 0, lastBeat: 0, ring: 0, trailAt: 0, t: 0, beat: null, started: false };
  // hair and skirt are small weights on strings: they swing behind the movement and settle by themselves
  const tail = [{ p: v(), q: v() }, { p: v(), q: v() }], hem = { p: v(), q: v() };
  function swing(node, anchor, length, dt, drag) { // one weight hanging from `anchor` on a string of `length`
    tmp.copy(node.p).sub(node.q).multiplyScalar(Math.max(0, 1 - drag * dt)); node.q.copy(node.p);
    node.p.add(tmp); node.p.y -= 9.8 * dt * dt;
    tmp.copy(node.p).sub(anchor); const d = tmp.length() || 1e-6; node.p.copy(anchor).addScaledVector(tmp, length / d);
  }

  // Everything that moves, advanced by dt seconds. Kept apart from drawing so it can be checked without a screen.
  function step(dt, M, opts) {
    D.t += dt;
    const forced = opts.style && STYLES.includes(opts.style) ? opts.style : null, period = 60 / (M.step || 100);
    // The listener nudges its beat count now and then to stay in time. Follow it smoothly instead of jumping with it.
    if (D.beat == null || Math.abs(M.beat - D.beat) > 2) D.beat = M.beat;
    D.beat += dt / period + (M.beat - D.beat) * Math.min(1, dt * 1.5);
    const b = D.beat + 0.09 / period; // ask for each pose a little early: the body takes about that long to arrive
    D.presence += ((M.active ? 1 : 0) - D.presence) * Math.min(1, dt * (M.active ? 2 : 0.9));
    // 1) the pose the music asks for: the styles blended by how much each applies, then blended with standing still
    const idle = MOVES.idle[0](b, D.t), size = (0.72 + 0.36 * M.level) * (1 + 0.09 * Math.sin(D.t * 0.37) + 0.05 * Math.sin(D.t * 0.91 + 1)); // never exactly the same twice
    let total = 0; col.setRGB(0, 0, 0);
    const acc = Object.fromEntries(KEYS.map((k) => [k, 0]));
    for (const s of STYLES) {
      const w = forced ? (s === forced ? 1 : 0) : M.mix[s] || 0;
      if (w < 0.01) continue;
      const p = styled(s, b, D.t);
      for (const k of KEYS) acc[k] += p[k] * w;
      col.r += colors[s].r * w; col.g += colors[s].g * w; col.b += colors[s].b * w; total += w;
    }
    for (const k of KEYS) {
      const moved = total > 0 ? acc[k] / total : idle[k], big = REST[k] + (moved - REST[k]) * (k === 'spin' ? 1 : size);
      want[k] = idle[k] + (big - idle[k]) * (total > 0 ? D.presence : 0);
    }
    if (total > 0) col.multiplyScalar(1 / total); else col.copy(colors.idle);
    col.lerp(colors.idle, 1 - D.presence);
    // 2) the body follows on springs: each number is pulled toward its target and keeps its speed, so nothing starts or stops abruptly
    for (let left = dt; left > 1e-5; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      for (const k of KEYS) { const w = QUICK[k]; vel[k] += (w * w * (want[k] - cur[k]) - 2 * w * vel[k]) * h; cur[k] += vel[k] * h; }
    }
    // turning: a move may spin the dancer; afterwards they come round to face the front again
    const before = D.yaw;
    if (Math.abs(cur.spin) > 0.004) D.yaw += cur.spin * TAU * (dt / period);
    else D.yaw += (Math.round(D.yaw / TAU) * TAU - D.yaw) * Math.min(1, dt * 2);
    D.yawRate += ((D.yaw - before) / dt - D.yawRate) * Math.min(1, dt * 6);
    figure.rotation.y = D.yaw + cur.face;

    // 3) from the pose to the joints
    const p = cur, liftL = Math.max(0, p.fly), liftR = Math.max(0, p.fry);
    // the weight moves over the standing leg, the hip of the lifted leg rises, and the chest leans back the other way to keep the head level
    const roll = Math.max(-0.22, Math.min(0.22, 1.1 * (liftL - liftR) + 0.012 * vel.hx)), shift = 0.22 * (liftR - liftL);
    J.pel.set(p.hx * S + shift * S, HIP + p.hy * S, p.hz * S);
    const side = p.side - roll * 0.55;
    J.dir.set(Math.sin(side), Math.cos(side) * Math.cos(p.lean), Math.sin(p.lean)).normalize();
    J.pr.set(Math.cos(p.tw), roll, -Math.sin(p.tw)).normalize();
    const a = -p.tw * 0.35 + p.ctw; // shoulders turn against the hips
    J.cr.set(Math.cos(a), -roll * 0.5, -Math.sin(a)); J.cr.addScaledVector(J.dir, -J.cr.dot(J.dir)).normalize();
    J.che.copy(J.pel).addScaledVector(J.dir, TORSO);
    J.nk.copy(J.che).addScaledVector(J.dir, 0.075);
    J.fw.set(p.tilt + J.dir.x * 0.45, 1, p.nod + J.dir.z * 0.45).normalize(); // the head stays more upright than the spine
    J.hd.copy(J.nk).addScaledVector(J.fw, 0.105);
    for (const [s, sign] of [['l', 1], ['r', -1]]) {
      const sh = J[s + 'sh'].copy(J.che).addScaledVector(J.cr, sign * SHOULDER), ha = J[s + 'ha'], hi = J[s + 'hi'].copy(J.pel).addScaledVector(J.pr, sign * HIPW), an = J[s + 'an'];
      sh.y += 0.035 * Math.max(0, Math.min(1, p[s + 'y'] / 0.4)); // a raised arm lifts its shoulder
      ha.set(sh.x + sign * p[s + 'x'] * S, sh.y + p[s + 'y'] * S, sh.z + p[s + 'z'] * S);
      const high = Math.max(0, Math.min(1, (p[s + 'y'] + 0.1) / 0.5)); // elbows point down and back when the hand is low, out to the side when it is high
      reach(sh, ha, UPPER, FORE, J.pole.set(sign * (0.45 + 0.6 * high), -0.6 + 0.5 * high, -0.6 + 0.35 * high), J[s + 'el']);
      an.set(sign * HIPW + p['f' + s + 'x'] * S, ANKLE + Math.max(0, p['f' + s + 'y']) * S, p['f' + s + 'z'] * S);
      reach(hi, an, THIGH, SHIN, J.pole.set(sign * 0.22, 0, 1), J[s + 'kn']);
      const lifted = Math.min(1, (an.y - ANKLE) / 0.1); // a lifted foot points its toes
      J[s + 'to'].set(an.x + sign * 0.03, an.y - 0.028 - 0.085 * lifted, an.z + 0.125 - 0.06 * lifted);
      between(B[s + 'up'], sh, J[s + 'el']); between(B[s + 'fo'], J[s + 'el'], ha); between(B[s + 'th'], hi, J[s + 'kn']); between(B[s + 'sn'], J[s + 'kn'], an); between(B[s + 'ft'], an, J[s + 'to']);
      B[s + 'sh'].position.copy(sh);
      B[s + 'ha'].position.copy(ha).addScaledVector(tmp.copy(ha).sub(J[s + 'el']).normalize(), 0.035); B[s + 'ha'].quaternion.setFromUnitVectors(Y, tmp);
    }
    J.waist.copy(J.pel).addScaledVector(J.dir, 0.1);
    between(B.spine, J.waist, tmp2.copy(J.che).addScaledVector(J.dir, -0.04));
    oriented(B.chest, tmp2.copy(J.che).addScaledVector(J.dir, -0.085), J.cr, J.dir);
    oriented(B.pelvis, J.pel, J.pr, Y);
    between(B.neck, J.che, J.nk);
    B.head.position.copy(J.hd); B.head.quaternion.setFromUnitVectors(Y, J.fw);
    B.hair.position.copy(J.hd).addScaledVector(J.fw, 0.014); B.hair.position.z -= 0.014; B.hair.quaternion.copy(B.head.quaternion);

    // 4) ponytail and skirt, swung in the room (not in the dancer's own turning frame) so that a spin throws them outward
    figure.updateMatrixWorld(); inv.copy(figure.matrixWorld).invert();
    J.root.copy(J.hd).addScaledVector(J.fw, 0.095); J.root.z -= 0.06; // a high ponytail J.root.applyMatrix4(figure.matrixWorld);
    tmp2.copy(J.pel).applyMatrix4(figure.matrixWorld); tmp2.y += 0.06; // the top of the skirt
    if (!D.started) { D.started = true; tail[0].p.copy(J.root).y -= 0.13; tail[1].p.copy(J.root).y -= 0.26; hem.p.copy(tmp2).y -= 0.27; for (const n of [...tail, hem]) n.q.copy(n.p); }
    swing(tail[0], J.root, 0.13, dt, 5); swing(tail[1], tail[0].p, 0.13, dt, 5); swing(hem, tmp2, 0.27, dt, 9);
    J.t1.copy(tail[0].p).applyMatrix4(inv); J.t2.copy(tail[1].p).applyMatrix4(inv); J.root.applyMatrix4(inv); J.hem.copy(hem.p).applyMatrix4(inv);
    between(B.tail1, J.root, J.t1); between(B.tail2, J.t1, J.t2);
    tmp2.applyMatrix4(inv); between(B.skirt, J.hem, tmp2); // the cylinder's wide end is its lower end
    const flare = 1 + Math.min(0.5, Math.abs(D.yawRate) * 0.1) + 0.5 * Math.max(0, -vel.hy); // spinning or dropping opens the skirt
    B.skirt.scale.set(flare, 1, flare);
    return b;
  }

  function render(camera, music, opts) {
    const clock = opts.now ?? performance.now() / 1000, dt = Math.min(0.1, Math.max(0.001, clock - (D.last || clock))); D.last = clock;
    const M = music || { active: false, level: 0, hit: 0, beat: 0, step: 100, mix: {}, bands: [] };
    step(dt, M, opts);
    const p = cur;
    line.color.copy(col).multiplyScalar(1.15 + 0.4 * M.hit * D.presence);

    // light: a ring on the floor at every beat, bars for the spectrum, ribbons behind the hands
    if (Math.floor(D.beat) !== D.lastBeat) { D.lastBeat = Math.floor(D.beat); if (M.active && opts.effects) { rings[D.ring].born = clock; rings[D.ring].m.material.color.copy(col); D.ring = (D.ring + 1) % rings.length; } }
    for (const r of rings) { const k = (clock - r.born) / 1.8; r.m.visible = k < 1; if (k < 1) { const s = 0.3 + 3.4 * k ** 0.7; r.m.scale.set(s, 1, s); r.m.position.set(p.hx * S, 0.01, p.hz * S); r.m.material.opacity = 0.6 * (1 - k) ** 2; } }
    pool.material.color.copy(col); pool.material.opacity = 0.12 + 0.22 * M.level * D.presence; pool.position.x = p.hx * S;
    bars.forEach((m, i) => { const j = i < NB / 2 ? i : NB - 1 - i, h = opts.effects ? (M.bands[j] || 0) * D.presence : 0; m.visible = h > 0.02; m.scale.y = 0.02 + 1.1 * h; m.material.color.copy(col).multiplyScalar(0.35 + 0.65 * h); });
    const push = clock - D.trailAt > 1 / 60;
    if (push) D.trailAt = clock;
    for (const tr of trails) {
      if (push) { tr.pts.unshift(J[tr.k].clone().applyMatrix4(figure.matrixWorld)); if (tr.pts.length > NT) tr.pts.pop(); }
      const pos = tr.m.geometry.attributes.position, c = tr.m.geometry.attributes.color, n = tr.pts.length;
      tr.m.visible = opts.effects && n > 3 && D.presence > 0.05;
      for (let i = 0; i < NT && tr.m.visible; i++) {
        const q = tr.pts[Math.min(i, n - 1)], nx = tr.pts[Math.min(i + 1, n - 1)], f = 0.6 * (1 - i / (NT - 1)) ** 1.6 * D.presence, half = 0.022 * (1 - i / NT);
        tmp.copy(nx).sub(q); tmp2.copy(camera.position).sub(q); tmp.cross(tmp2).normalize();
        pos.setXYZ(i * 2, q.x + tmp.x * half, q.y + tmp.y * half, q.z + tmp.z * half); pos.setXYZ(i * 2 + 1, q.x - tmp.x * half, q.y - tmp.y * half, q.z - tmp.z * half);
        c.setXYZ(i * 2, col.r * f, col.g * f, col.b * f); c.setXYZ(i * 2 + 1, col.r * f * 0.5, col.g * f * 0.5, col.b * f * 0.5);
      }
      pos.needsUpdate = true; c.needsUpdate = true;
    }
    const tall = camera.aspect < 1, far = tall ? 4.9 : 3.9, turn = opts.motion ? 0.4 * Math.sin(D.t * 0.13) : 0;
    camera.position.set(Math.sin(turn) * far, 1.12 + (opts.motion ? 0.1 * Math.sin(D.t * 0.21) : 0), Math.cos(turn) * far);
    camera.lookAt(p.hx * S * 0.5, 0.8, 0);
  }
  return { scene, render, joints: J };
}
