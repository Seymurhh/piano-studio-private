// "Flight" view: the music drawn as glowing lines flying through a 3D space, like the path of a bird's song.
// Three axes: left-right = time (newest on the right), up-down = pitch, near-far = the direction the melody is moving
// (rising swings toward you, falling swings away). Thickness and brightness = loudness.
import * as THREE from '../vendor/three.min.js?v=7';
import { noteName } from './midi.js?v=12';

const N = 360, TRAIL = 7, HEADX = 6.5, XS = 2.75, ZS = 3.4, SWING = 0.75, MAXV = 3; // the newest sound is at HEADX; older sound drifts left and away
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const hueOf = (pitch) => (((0.62 - ((pitch - 40) / 50) * 0.67) % 1) + 1) % 1; // low = sapphire, middle = emerald, high = gold then rose

// Turn a piece into up to three melodic lines ("voices"), plus a position for every single note.
export function voicesFromPiece(piece) {
  const groups = [];
  for (const n of piece.notes) {
    const g = groups[groups.length - 1];
    if (g && n.onset - g.t < 0.03 && (piece.tracks === 1 || g.track === n.track)) g.notes.push(n);
    else groups.push({ t: n.onset, track: n.track, notes: [n] });
  }
  const lines = Array.from({ length: Math.min(MAXV, Math.max(2, piece.tracks)) }, () => []);
  for (const g of groups) {
    const top = g.notes.reduce((a, b) => (b.pitch > a.pitch ? b : a)), low = g.notes.reduce((a, b) => (b.pitch < a.pitch ? b : a));
    if (piece.tracks > 1) lines[Math.min(g.track, lines.length - 1)].push(top);
    else { // one track (for example a recording of both hands): upper notes make one line, clearly lower notes another
      if (top.pitch >= 58 || g.notes.length > 1) lines[0].push(top);
      if (low !== top ? top.pitch - low.pitch >= 7 : top.pitch < 58) lines[1].push(low);
    }
  }
  const voices = lines.filter((l) => l.length).map((list) => {
    let x = 0, prev = list[0].pitch;
    return list.map((n) => { x = Math.max(-8, Math.min(8, x * 0.82 + (n.pitch - prev) * 0.45)); prev = n.pitch; return { t: n.onset, off: n.onset + n.dur, pitch: n.pitch, x, vel: n.vel }; });
  });
  // where each single note sits: beside the line that is closest to it in pitch at that moment
  for (const n of piece.notes) {
    let best = null;
    for (const v of voices) { const q = sample(v, n.onset + 0.001); if (q && (!best || Math.abs(q.note - n.pitch) < Math.abs(best.note - n.pitch))) best = q; }
    n.fx = best ? best.x + (n.pitch - best.note) * 0.1 : 0;
  }
  return voices;
}

export function sample(pts, tau) {
  if (!pts || !pts.length || tau < pts[0].t - 0.12) return null;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pts[m].t <= tau) lo = m; else hi = m - 1; }
  const a = pts[lo], b = pts[lo + 1];
  const s = b ? smooth(((tau - a.t) / (b.t - a.t) - 0.12) / 0.88) : 0;
  const since = tau - a.t, sounding = tau < a.off + 0.12;
  const w = a.vel * (sounding ? Math.max(0.35, Math.exp(-since / 1.5)) : Math.max(0.05, 0.35 * Math.exp(-(tau - a.off) / 0.4)));
  return { x: b ? a.x + (b.x - a.x) * s : a.x, pitch: (b ? a.pitch + (b.pitch - a.pitch) * s : a.pitch), w, note: a.pitch, sounding };
}

export function buildFlight(T, tools) {
  const { canvasTex, dot } = tools, scene = new THREE.Scene();
  scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(T.fog, 40, 140);
  const mkGrid = (opacity) => { const g = new THREE.GridHelper(160, 64, T.trim, T.trim); g.material.transparent = true; g.material.opacity = opacity; g.material.depthWrite = false; return g; };
  const floor = mkGrid(0.2); floor.position.set(0, -7.5, -50); scene.add(floor);
  const wall = mkGrid(0.1); wall.rotation.x = Math.PI / 2; wall.position.set(0, 0, -34); scene.add(wall);

  const lines = [];
  for (let v = 0; v < MAXV; v++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    mesh.frustumCulled = false;
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const label = new THREE.Sprite(); label.scale.set(1.7, 0.85, 1); label.renderOrder = 5;
    scene.add(mesh, head, label);
    lines.push({ mesh, head, label });
  }
  const mkPoints = (count, size) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    p.frustumCulled = false; scene.add(p);
    return p;
  };
  const orbs = mkPoints(1500, 0.75);
  const flashes = Array.from({ length: 28 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })); s.visible = false; scene.add(s); return s; });
  const labelMats = new Map(), rulerMats = [];
  const textMat = (text) => {
    if (!labelMats.has(text)) labelMats.set(text, new THREE.SpriteMaterial({ transparent: true, depthTest: false, toneMapped: false,
      map: canvasTex(128, 64, (g) => { g.font = '700 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff8e6'; g.fillText(text, 64, 34); }) }));
    return labelMats.get(text);
  };
  const ruler = [];
  for (let p = 24; p <= 108; p += 12) { const s = new THREE.Sprite(textMat(noteName(p))); s.scale.set(1.5, 0.75, 1); s.material.opacity = 0.75; scene.add(s); ruler.push({ s, p }); rulerMats.push(s.material); }
  const col = new THREE.Color(), bufP = new Float32Array(N), bufS = new Float32Array(N), bufW = new Float32Array(N), tmp = new Float32Array(N);
  // running average over `radius` neighbours, repeated: turns corners into curves
  const soften = (a, radius, passes) => {
    for (let k = 0; k < passes; k++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += a[Math.min(N - 1, Math.max(0, i))];
      for (let i = 0; i < N; i++) { tmp[i] = sum / (2 * radius + 1); sum += a[Math.min(N - 1, i + radius + 1)] - a[Math.max(0, i - radius)]; }
      a.set(tmp);
    }
  };

  // voices: arrays of {t, off, pitch, x, vel}; notes: every note (for the orbs); range: [lowest, highest] pitch to fit on screen
  function render(t, camera, { voices, notes, range, labels, effects, motion }) {
    const [lo, hi] = range, mid = (lo + hi) / 2, scale = Math.min(0.4, 10.5 / (hi - lo + 6));
    const Y = (p) => (p - mid) * scale;
    const back = Math.max(1, (1.1 / camera.aspect)); // a narrow (tall) picture sees less from side to side, so the camera steps back until the whole line fits
    camera.position.set(2 + (motion ? Math.sin(t * 0.17) * 6 : 0), 2.5 + (motion ? Math.sin(t * 0.11) * 1.5 : 0), 24 * back);
    scene.fog.near = 40 * back; scene.fog.far = 140 * back;
    camera.lookAt(-1.5, 0, -8);
    for (const r of ruler) { r.s.visible = r.p >= lo - 6 && r.p <= hi + 6; r.s.position.set(HEADX + 3.4, Y(r.p), 0); }

    lines.forEach((ln, v) => {
      const pts = voices[v], pos = ln.mesh.geometry.attributes.position, color = ln.mesh.geometry.attributes.color;
      const now = pts && sample(pts, t);
      ln.mesh.visible = !!now; ln.head.visible = !!now; ln.label.visible = !!now && labels && now.sounding;
      if (!now) return;
      // 1) read the path, 2) soften it so the line bends instead of cornering, 3) build the ribbon
      let lastP = now.pitch, lastX = now.x;
      for (let i = 0; i < N; i++) {
        const s = sample(pts, t - (i / (N - 1)) * TRAIL);
        if (s) { lastP = s.pitch; lastX = s.x; }
        bufP[i] = lastP; bufS[i] = lastX; bufW[i] = s ? s.w : 0;
      }
      soften(bufP, 7, 3); soften(bufS, 9, 3); soften(bufW, 5, 2);
      let px = HEADX + 0.05, py = Y(bufP[0]), nx = 0, ny = 1;
      for (let i = 0; i < N; i++) {
        const age = (i / (N - 1)) * TRAIL, w = bufW[i];
        const x = HEADX - age * XS, y = Y(bufP[i]), z = bufS[i] * SWING - age * ZS;
        const dx = x - px, dy = y - py, len = Math.hypot(dx, dy) || 1; nx = dy / len; ny = -dx / len;
        const half = w > 0.005 ? 0.05 + 0.34 * w * (v ? 0.8 : 1) : 0, fade = (1 - age / TRAIL) ** 0.9 * (0.45 + 0.55 * Math.min(1, w * 1.6));
        pos.setXYZ(i * 2, x + nx * half, y + ny * half, z); pos.setXYZ(i * 2 + 1, x - nx * half, y - ny * half, z);
        col.setHSL((hueOf(bufP[i]) + age * 0.04) % 1, 1, 0.56).multiplyScalar(fade);
        color.setXYZ(i * 2, col.r, col.g, col.b); color.setXYZ(i * 2 + 1, col.r * 0.55, col.g * 0.55, col.b * 0.55);
        px = x; py = y;
      }
      pos.needsUpdate = true; color.needsUpdate = true;
      const hy = Y(bufP[0]), size = 0.6 + 1.3 * now.w;
      ln.head.position.set(HEADX, hy, bufS[0] * SWING); ln.head.scale.set(size, size, 1); ln.head.material.color.setHSL(hueOf(now.pitch), 1, 0.7);
      if (ln.label.visible) { ln.label.material = textMat(noteName(Math.round(now.note))); ln.label.position.set(HEADX + 0.9, hy + 0.9, bufS[0] * SWING); }
    });

    // every note leaves a small light where it was played; fresh ones flash
    const op = orbs.geometry.attributes;
    let used = 0, f = 0;
    for (const n of effects ? notes : []) {
      const age = t - n.onset;
      if (age < 0 || age > TRAIL || used >= 1500) continue;
      const fade = (1 - age / TRAIL) ** 2 * (0.35 + 0.65 * n.vel);
      op.position.setXYZ(used, HEADX - age * XS, Y(n.pitch), n.fx * SWING - age * ZS);
      col.setHSL(hueOf(n.pitch), 1, 0.6).multiplyScalar(fade); op.color.setXYZ(used, col.r, col.g, col.b); used++;
      if (age < 0.55 && f < flashes.length) {
        const s = flashes[f++], k = age / 0.55, size = (0.8 + 3 * k) * (0.6 + n.vel);
        s.visible = true; s.position.set(HEADX - age * XS, Y(n.pitch), n.fx * SWING - age * ZS); s.scale.set(size, size, 1);
        s.material.color.setHSL(hueOf(n.pitch), 1, 0.62); s.material.opacity = (1 - k) * 0.5;
      }
    }
    for (; f < flashes.length; f++) flashes[f].visible = false;
    orbs.geometry.setDrawRange(0, used); op.position.needsUpdate = true; op.color.needsUpdate = true;
  }
  return { scene, render };
}
