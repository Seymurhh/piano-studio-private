// The score ribbon: the music written as notes on a strip of film that runs across the top of the picture.
// The strip moves from right to left past a line of light, so the eye reads it from left to right as on paper;
// each note lights up as it is played and throws a few sparks. It is drawn on a flat canvas and shown as a
// gently curved strip fixed in front of the camera, so it is part of the picture and of any video made from it.
//
// This is a simplified notation, not engraved sheet music: every note sits at its true height on a treble or bass
// staff with the right accidental, hollow or filled according to its length, but notes are spaced by time (no beams,
// no rests), so a slow passage is wide and a fast one is tight.
import * as THREE from '../vendor/three.min.js?v=7';

const W = 2048, H = 300, SP = 13; // canvas size and the distance between two staff lines
const TREBLE = 112, BASS = 226;   // y of the bottom line of each staff (E4 and G2)
const PXS = 150;                  // pixels of strip per second of music
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11], FLATS = [6, 2, 5, 1, 4, 0, 3], SHARPS = [3, 0, 4, 1, 5, 2, 6]; // letters as C=0 … B=6
export const SIG = { flat: { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] }, sharp: { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] } }; // staff steps of the key signature
const stepY = (step, staff) => (staff ? BASS - (step - 18) * SP / 2 : TREBLE - (step - 30) * SP / 2); // step = octave * 7 + letter; E4 = 30, G2 = 18

// When each bar starts (seconds), where the file gives a tempo and a time signature. Follows changes of time
// signature, so a one-beat pickup bar is its own short bar. Empty when the file does not say.
export function barTimes(piece) {
  const tempo = piece.tempoMap && piece.tempoMap.length ? piece.tempoMap : null;
  if (!tempo || !piece.meter || piece.source !== 'midi') return [];
  const meters = piece.meterMap && piece.meterMap.length ? piece.meterMap : [{ time: 0, meter: piece.meter }];
  const bars = [];
  let t = 0, i = 0, j = 0;
  while (t < piece.duration + 1 && bars.length < 4000) {
    bars.push(t);
    while (j + 1 < meters.length && meters[j + 1].time <= t + 1e-6) j++;
    const per = meters[j].meter[0] * 4 / meters[j].meter[1];
    for (let k = 0; k < Math.round(per * 4); k++) { while (i + 1 < tempo.length && tempo[i + 1].time <= t + 1e-6) i++; t += 15 / tempo[i].bpm; }
  }
  return bars;
}

// Which key fits the notes best, when the file does not say: the one whose scale holds the most of them.
export function guessKey(notes) {
  const count = new Array(12).fill(0);
  for (const n of notes) count[n.pitch % 12]++;
  let best = 0, top = -1;
  for (const sf of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
    const tonic = ((sf * 7) % 12 + 12) % 12, fit = LETTER_PC.reduce((s, pc) => s + count[(pc + tonic) % 12], 0);
    if (fit > top) { top = fit; best = sf; }
  }
  return best;
}
// How a pitch is written in a key: its place on the staff and the sign in front of it, if it needs one.
export function speller(sf) {
  const alter = new Array(7).fill(0);
  for (let i = 0; i < Math.abs(sf); i++) alter[(sf < 0 ? FLATS : SHARPS)[i]] = Math.sign(sf);
  return (pitch) => {
    const pc = pitch % 12;
    let letter = LETTER_PC.findIndex((v, i) => ((v + alter[i]) % 12 + 12) % 12 === pc), acc = '', by = letter >= 0 ? alter[letter] : 0;
    if (letter < 0) {
      if (LETTER_PC.includes(pc)) { letter = LETTER_PC.indexOf(pc); acc = '♮'; by = 0; }
      else if (sf < 0 || (sf === 0 && (pc === 10 || pc === 3))) { letter = LETTER_PC.indexOf(pc + 1); acc = '♭'; by = -1; }
      else { letter = LETTER_PC.indexOf(pc - 1); acc = '♯'; by = 1; }
    }
    return { step: (Math.floor((pitch - by) / 12) - 1) * 7 + letter, acc };
  };
}

// Turn a piece into things to draw: chords (notes struck together on one staff) and bar lines.
function prepare(piece) {
  const sf = piece.key ? piece.key.sf : guessKey(piece.notes), spell = speller(sf), two = piece.tracks === 2;
  const mean = [0, 1].map((k) => { const l = piece.notes.filter((n) => n.track === k); return l.reduce((s, n) => s + n.pitch, 0) / (l.length || 1); }), upper = mean[0] >= mean[1] ? 0 : 1; // with two tracks, the higher one goes on the treble staff
  const tempo = piece.tempoMap.length ? piece.tempoMap : null, beatAt = (t) => { let bpm = tempo ? tempo[0].bpm : 100; for (const m of tempo || []) if (m.time <= t + 0.01) bpm = m.bpm; return 60 / bpm; };
  const marks = [];
  for (const n of piece.notes) {
    const staff = two ? (n.track === upper ? 0 : 1) : n.pitch < 60 ? 1 : 0, last = marks[marks.length - 1], beats = n.dur / beatAt(n.onset);
    const head = { ...spell(n.pitch), pitch: n.pitch };
    if (last && last.staff === staff && Math.abs(last.t - n.onset) < 0.03 && !last.grace) { last.heads.push(head); last.dur = Math.max(last.dur, n.dur); last.beats = Math.max(last.beats, beats); }
    else marks.push({ t: n.onset, dur: n.dur, beats, staff, heads: [head], vel: n.vel, grace: beats < 0.22, color: two ? n.track : n.pitch < 60 ? 1 : 0 });
  }
  const bars = barTimes(piece);
  // for the bouncing dots: where each staff's notes are, in order (grace notes are too quick to land on)
  const landings = [0, 1].map((staff) => marks.filter((m) => m.staff === staff && !m.grace).map((m) => ({ t: m.t, y: Math.max(30, Math.min(H - 30, Math.min(...m.heads.map((h) => stepY(h.step, staff))))) })));
  return { sf, marks, bars, landings };
}

export function buildScore(T, camera) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4; // smaller copies are made each frame, so thin lines stay whole when the strip is shown small
  // size and place: a strip across the upper middle of the view, ten units in front of the camera, its ends curving away
  const viewH = 2 * 10 * Math.tan((camera.fov / 2) * Math.PI / 180), viewW = viewH * camera.aspect, tall = camera.aspect < 1;
  const sw = viewW * (tall ? 1.0 : 0.86), sh = tall ? viewH * 0.2 : sw * H / 1720, used = Math.min(W, Math.round(H * sw / sh)); // tall picture: a thicker strip from edge to edge, showing fewer seconds so the notes are larger
  const geo = new THREE.PlaneGeometry(sw, sh, 48, 1), pos = geo.attributes.position;
  const bow = sw * (tall ? 0.022 : 0.077); // how far the ends curve away; much flatter in the tall picture, where the same curve looked like an arch
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -bow * (pos.getX(i) / (sw / 2)) ** 2);
  tex.repeat.set(used / W, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  mesh.position.set(0, viewH / 2 - viewH * 0.05 - sh / 2, -10); mesh.rotation.x = tall ? -0.04 : -0.1; mesh.renderOrder = 20; mesh.frustumCulled = false;
  camera.add(mesh);

  const colors = T.notes, led = T.led || T.trim, LEFT = 150; // LEFT: where the clefs and key signature end
  const clefOK = (() => { // does this computer have the real clef signs? (if not, plain letters are drawn instead)
    const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true });
    const ink = (ch) => { x.clearRect(0, 0, 40, 40); x.font = '30px serif'; x.fillText(ch, 4, 32); return x.getImageData(0, 0, 40, 40).data.reduce((s, v, i) => s + (i % 4 === 3 ? v : 0), 0); };
    const a = ink('\u{1D11E}'), b = ink('\u{1D122}'), box = ink('\u{10FFFE}');
    return a > 2000 && b > 1500 && Math.abs(a - box) > 200 && Math.abs(a - b) > 200;
  })();
  const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  let prepared = null, of = null;

  function ledgers(x, y, staff) { // short lines for notes above or below the staff
    const bottom = staff ? BASS : TREBLE, top = bottom - 4 * SP;
    g.beginPath();
    for (let ly = bottom + SP; ly <= y + 1; ly += SP) { g.moveTo(x - 14, ly); g.lineTo(x + 14, ly); }
    for (let ly = top - SP; ly >= y - 1; ly -= SP) { g.moveTo(x - 14, ly); g.lineTo(x + 14, ly); }
    g.stroke();
  }
  function head(x, y, hollow, small) {
    const rx = small ? 5.6 : 8.5, ry = small ? 4.1 : 6.1;
    g.beginPath(); g.ellipse(x, y, rx, ry, -0.36, 0, Math.PI * 2);
    if (hollow) { g.lineWidth = 2.6; g.stroke(); } else g.fill();
  }
  // one chord: x on the strip, lit = 0..1 how brightly it is sounding, age = seconds since it was struck (negative = still to come)
  function mark(m, x, lit, age, alpha) {
    const ys = m.heads.map((h) => Math.max(30, Math.min(H - 30, stepY(h.step, m.staff)))), lo = Math.max(...ys), hi = Math.min(...ys);
    const mid = (m.staff ? BASS : TREBLE) - 2 * SP, up = (lo + hi) / 2 > mid, hollow = m.beats >= 1.75 && !m.grace, whole = m.beats >= 3.5;
    // the colours of waiting and past notes are kept below the level where the picture's glow starts, so only sounding notes shine
    const base = age < 0 ? '#cfc8b6' : '#8f979e', hot = colors[m.color % colors.length];
    g.globalAlpha = alpha;
    if (lit > 0.02) { // the dim light behind a sounding note
      const cy = (lo + hi) / 2, r = 34 + (lo - hi) / 2, glow = g.createRadialGradient(x, cy, 0, x, cy, r * 1.6);
      glow.addColorStop(0, hot); glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = alpha * 0.42 * lit; g.fillStyle = glow; g.fillRect(x - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2);
      g.globalAlpha = alpha;
      g.shadowColor = hot; g.shadowBlur = 22 * lit;
    }
    g.fillStyle = g.strokeStyle = lit > 0.02 ? mix(base, lit > 0.6 ? '#ffffff' : hot, Math.min(1, lit * 1.4)) : base;
    g.lineWidth = 1.6;
    for (const y of ys) ledgers(x, y, m.staff);
    m.heads.forEach((h, i) => {
      head(x, ys[i], hollow, m.grace);
      if (h.acc) { g.font = `${m.grace ? 17 : 23}px serif`; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(h.acc, x - (m.grace ? 8 : 12), ys[i] + (h.acc === '♭' ? -3 : 0)); }
    });
    if (!whole) { // stem, and a flag for short notes
      const len = m.grace ? 26 : 41, sx = up ? x + (m.grace ? 5 : 7.6) : x - (m.grace ? 5 : 7.6), a = up ? lo : hi, b = up ? hi - len : lo + len;
      g.lineWidth = 1.9; g.beginPath(); g.moveTo(sx, a); g.lineTo(sx, b); g.stroke();
      if (m.beats < 0.75 || m.grace) { const d = up ? 1 : -1; g.beginPath(); g.moveTo(sx, b); g.quadraticCurveTo(sx + 12, b + 10 * d, sx + 8, b + 22 * d); g.lineWidth = 2.2; g.stroke(); }
      if (m.grace) { g.beginPath(); g.moveTo(sx - 6, b + (up ? 16 : -16)); g.lineTo(sx + 9, b + (up ? 6 : -6)); g.lineWidth = 1.5; g.stroke(); }
    }
    g.shadowBlur = 0;
    if (age >= 0 && age < 0.7) { // sparks: the same every time for the same note, so a video matches what was seen
      const n = 5 + Math.round(5 * m.vel), fade = (1 - age / 0.7) ** 1.5;
      g.fillStyle = hot;
      for (let j = 0; j < n; j++) {
        const an = rnd(m.t * 10, j) * Math.PI * 2, sp = 34 + 80 * rnd(m.t * 10, j + 40), px = x + Math.cos(an) * sp * age, py = (lo + hi) / 2 + Math.sin(an) * sp * age - 20 * age;
        g.globalAlpha = alpha * fade * (0.5 + 0.5 * rnd(j, m.t)); g.beginPath(); g.arc(px, py, 1.7 + 1.6 * fade, 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  const isLanding = (list, t) => { let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; } return list[lo].t <= t && t - list[lo].t < 0.05; };
  const hex = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`; };

  // A dot of light per hand that hops along the music: it comes down on each note exactly as the note is played.
  // The notes come to the line of light, so the dot stays above the line and the hop is up and down.
  // Returns [where it touches down (the top of the note it is over), how high above that it is now], in canvas pixels.
  function hop(list, t, staff) {
    if (!list.length) return [(staff ? BASS : TREBLE) - 2 * SP, 0];
    let lo = 0, hi = list.length - 1;
    if (t < list[0].t) { const u = Math.min(1, (list[0].t - t) / 1.2); return [list[0].y, 44 * Math.sin(u * Math.PI / 2)]; } // falling onto the first note
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; }
    const a = list[lo], b = list[lo + 1];
    if (!b) { const age = t - a.t; return [a.y, 50 * Math.exp(-age * 2.4) * Math.abs(Math.sin(age * 6))]; } // the last note: a few small bounces, then still
    const gap = b.t - a.t, u = (t - a.t) / gap, height = Math.min(52, 16 + 44 * gap); // longer waits, higher hops
    return [a.y + (b.y - a.y) * u, height * 4 * u * (1 - u)];
  }
  // The balls themselves are real spheres floating just in front of the strip (so they catch the light and come toward
  // the viewer at the top of each hop); on the strip only their glow is drawn, where they touch down.
  const R = 11, unit = sh / H; // ball radius in canvas pixels, and the size of one canvas pixel on the strip
  const balls = [0, 1].map((staff) => {
    const c = new THREE.Color(colors[staff % colors.length]);
    const m = new THREE.Mesh(new THREE.SphereGeometry(R * unit, 32, 20), new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: 0.55, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, depthTest: false, fog: false, transparent: true })); // "transparent" only so that it is drawn after the strip, not under it
    m.renderOrder = 21 + staff; m.visible = false; mesh.add(m);
    return m;
  });
  const lamp = new THREE.PointLight('#ffffff', 5, sh * 4, 1); lamp.position.set(-sw * 0.12, sh * 1.1, sh * 1.2); mesh.add(lamp); // a small light of their own, so the balls are shaded like solid things
  function place(staff, x, ground, up, squash, color) {
    const k = Math.max(0, 1 - up / 60);
    const glow = g.createRadialGradient(x, ground, 0, x, ground, 22 + 12 * k); glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.14 + 0.46 * k; g.fillStyle = glow; g.fillRect(x - 40, ground - 40, 80, 80); g.globalAlpha = 1;
    const m = balls[staff], X = (x / used - 0.5) * sw, Y = (0.5 - Math.max(R + 4, ground - R * (1 - 0.3 * squash) - up) / H) * sh; // never off the top of the strip
    m.visible = true;
    m.position.set(X, Y, -bow * (X / (sw / 2)) ** 2 + R * unit * 1.2 + up * unit * 0.45); // rising also brings it toward the viewer
    m.scale.set(1 + 0.22 * squash, 1 - 0.3 * squash, 1 + 0.22 * squash);
  }

  // t = music time (or the clock, when playing live). trail = notes being played live, or null to show the piece.
  function update(t, piece, trail, dots, lines = false) {
    if (!trail && piece && of !== piece) { prepared = prepare(piece); of = piece; }
    const w = used, live = !!trail;
    // Where on the strip "now" is. With the balls on, it travels from the left end to the right end over the whole piece,
    // so the balls move forward as the music does and show how far there is to go. (The notes still come to meet them.)
    const part = piece && piece.duration ? Math.min(1, Math.max(0, t / piece.duration)) : 0;
    const now = Math.round(live ? w * 0.8 : dots && piece ? LEFT + 55 + part * (w - LEFT - 55 - 120) : w * 0.36), sf = live ? 0 : prepared && piece ? prepared.sf : 0;
    g.clearRect(0, 0, W, H);
    // the film: a dark strip with a fine bright edge and sprocket holes that travel with the music
    const band = g.createLinearGradient(0, 0, 0, H); band.addColorStop(0, 'rgb(30,34,43)'); band.addColorStop(0.09, 'rgb(26,30,38)'); band.addColorStop(0.1, 'rgb(7,8,12)'); band.addColorStop(0.9, 'rgb(7,8,12)'); // solid behind the staves, so nothing passing underneath mixes with the notes band.addColorStop(0.91, 'rgb(26,30,38)'); band.addColorStop(1, 'rgb(30,34,43)');
    g.fillStyle = band; g.fillRect(0, 0, w, H);
    g.fillStyle = led; g.globalAlpha = 0.75; g.fillRect(0, 0, w, 2); g.fillRect(0, H - 2, w, 2); g.globalAlpha = 0.22; g.fillRect(0, 26, w, 1); g.fillRect(0, H - 27, w, 1); g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.95)';
    for (let x = -((t * PXS) % 44 + 44) % 44; x < w; x += 44) { g.beginPath(); g.roundRect(x + 13, 6, 19, 13, 3); g.roundRect(x + 13, H - 19, 19, 13, 3); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    // the two staves
    g.strokeStyle = 'rgba(255,246,228,0.26)'; g.lineWidth = 1; g.beginPath();
    for (const bottom of [TREBLE, BASS]) for (let i = 0; i < 5; i++) { g.moveTo(0, bottom - i * SP + 0.5); g.lineTo(w, bottom - i * SP + 0.5); }
    g.stroke();
    if (live || (piece && prepared)) {
      const from = t - (now - LEFT + 30) / PXS, to = t + (w - now + 30) / PXS;
      const fadeAt = (x) => Math.min(1, Math.max(0, (x - LEFT) / 60)) * Math.min(1, Math.max(0, (w - x - 40) / 90));
      if (!live) {
        g.strokeStyle = 'rgba(255,246,228,0.3)'; g.lineWidth = 1.2; g.beginPath();
        for (const b of prepared.bars) { if (b < from || b > to) continue; const x = now + (b - t) * PXS - 22; if (x > LEFT + 20) { g.moveTo(x, TREBLE - 4 * SP); g.lineTo(x, BASS); } }
        g.stroke();
        if (lines) { // flight lines instead of notes: each hand's melody as one line of light, bright where it has been played
          for (const staff of [0, 1]) {
            const land = prepared.landings[staff];
            if (!land.length) continue;
            const hot = colors[staff % colors.length];
            const yAt = (tau) => {
              let a = 0, b = land.length - 1;
              if (tau <= land[0].t) return land[0].y;
              while (a < b) { const m = (a + b + 1) >> 1; if (land[m].t <= tau) a = m; else b = m - 1; }
              const p = land[a], q = land[a + 1];
              if (!q) return p.y;
              let u = Math.min(1, Math.max(0, ((tau - p.t) / (q.t - p.t) - 0.15) / 0.85)); u = u * u * (3 - 2 * u);
              return p.y + (q.y - p.y) * u;
            };
            const path = (x0, x1) => { g.beginPath(); let first = true; for (let x = x0; x <= x1 + 0.1; x += 3) { const y = yAt(t + (x - now) / PXS); if (first) g.moveTo(x, y); else g.lineTo(x, y); first = false; } };
            g.lineCap = g.lineJoin = 'round';
            path(now, w - 40); g.strokeStyle = mix('#cfc8b6', hot, 0.3); g.globalAlpha = 0.5; g.lineWidth = 2; g.stroke(); // still to come: thin and pale
            g.shadowColor = hot; g.shadowBlur = 16; g.strokeStyle = hot; g.lineWidth = 3.6;
            for (let x1 = now; x1 > LEFT; x1 -= 36) { // played: bright, fading as it moves away to the left
              const x0 = Math.max(LEFT, x1 - 36);
              path(x0, x1 + 2); g.globalAlpha = fadeAt(x0) * Math.max(0.18, 1 - (now - x1) / (now - LEFT + 1)); g.stroke();
            }
            g.shadowBlur = 0;
            for (const m of land) { // a bead of light where each note falls
              const x = now + (m.t - t) * PXS;
              if (x < LEFT || x > w - 40) continue;
              const past = m.t <= t, fresh = past && t - m.t < 0.4;
              g.globalAlpha = fadeAt(x) * (past ? 0.95 : 0.55); g.fillStyle = fresh ? '#ffffff' : past ? hot : '#cfc8b6';
              g.beginPath(); g.arc(x, m.y, fresh ? 5 : past ? 3.4 : 2.6, 0, 7); g.fill();
            }
            g.globalAlpha = 1;
          }
        }
        const list = lines ? [] : prepared.marks;
        let lo = 0, hi = list.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < from - 8) lo = m + 1; else hi = m; }
        for (let i = lo; i < list.length && list[i].t < to; i++) {
          const m = list[i], x = now + (m.t - t) * PXS, age = t - m.t;
          if (x < LEFT || m.t + m.dur < from) continue;
          const lit = age < 0 ? 0 : age < m.dur ? Math.max(0.45, 1 - age * 1.2) : Math.max(0, 0.45 - (age - m.dur) * 1.5);
          mark(m, x, lit, age, fadeAt(x) * (age > 0 ? Math.max(0.3, 1 - age * 0.12) : 1));
        }
      } else {
        const spell = speller(0);
        for (const n of trail) {
          const x = now + (n.t0 - t) * PXS;
          if (x < LEFT || n.pitch < 21 || n.pitch > 108) continue;
          const age = t - n.t0, held = n.t1 == null, lit = held ? Math.max(0.75, 1 - age * 0.5) : Math.max(0, 0.75 - (t - n.t1) * 1.2);
          mark({ t: n.t0, dur: 0, beats: 1, staff: n.pitch < 60 ? 1 : 0, heads: [spell(n.pitch)], vel: n.vel, grace: false, color: n.pitch < 60 ? 1 : 0 }, x, lit, age, fadeAt(x) * Math.max(0.3, 1 - age * 0.12));
        }
      }
    }
    for (const m of balls) m.visible = false;
    if (dots && (live || (piece && prepared))) {
      for (const staff of [0, 1]) {
        let ground, up, squash = 0;
        if (live) { // live: the ball of a hand jumps each time one of its keys is struck
          let last = null;
          for (const n of trail) if ((n.pitch < 60 ? 1 : 0) === staff && (!last || n.t0 > last.t0)) last = n;
          if (!last) { ground = (staff ? BASS : TREBLE) - 2 * SP; up = 0; }
          else { const age = t - last.t0; ground = Math.max(30, Math.min(H - 30, stepY(speller(0)(last.pitch).step, staff))); up = 64 * Math.exp(-age * 2.2) * Math.abs(Math.sin(age * 6.5)); squash = Math.max(0, 1 - age * 12); }
        } else {
          const list = prepared.landings[staff];
          [ground, up] = hop(list, t, staff);
          squash = list.length && isLanding(list, t) ? 1 : 0; // flattens for an instant as it lands
        }
        place(staff, now, ground - 7, up, squash, colors[staff % colors.length]);
      }
    }
    // clefs and key signature stay at the left; the line of light marks "now"
    const edge = g.createLinearGradient(0, 0, LEFT + 40, 0); edge.addColorStop(0, 'rgba(6,7,10,0.96)'); edge.addColorStop(0.7, 'rgba(6,7,10,0.9)'); edge.addColorStop(1, 'rgba(6,7,10,0)');
    g.fillStyle = edge; g.fillRect(0, 22, LEFT + 40, H - 44);
    g.strokeStyle = 'rgba(255,246,228,0.34)'; g.lineWidth = 1; g.beginPath();
    for (const bottom of [TREBLE, BASS]) for (let i = 0; i < 5; i++) { g.moveTo(0, bottom - i * SP + 0.5); g.lineTo(LEFT + 40, bottom - i * SP + 0.5); }
    g.stroke();
    g.fillStyle = '#fff3dc'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    if (clefOK) { g.font = '68px serif'; g.fillText('\u{1D11E}', 34, TREBLE + 5); g.font = '52px serif'; g.fillText('\u{1D122}', 36, BASS - 12); }
    else { g.font = 'italic 600 44px Georgia, serif'; g.fillText('G', 40, TREBLE - 10); g.fillText('F', 42, BASS - 18); }
    g.font = '25px serif'; g.textBaseline = 'middle';
    for (let i = 0; i < Math.abs(sf); i++) for (const [staff, name] of [[0, 'treble'], [1, 'bass']]) g.fillText(sf < 0 ? '♭' : '♯', 88 + i * 10, stepY(SIG[sf < 0 ? 'flat' : 'sharp'][name][i], staff) + (sf < 0 ? -4 : 0));
    if (!dots) { // without the balls, a faint line shows where "now" is; with them, the balls mark it and the line is left out
      g.shadowColor = led; g.shadowBlur = 10; g.strokeStyle = led; g.lineWidth = 1.5; g.globalAlpha = 0.45;
      g.beginPath(); g.moveTo(now - 13, 26); g.lineTo(now - 13, H - 26); g.stroke();
    }
    g.shadowBlur = 0; g.globalAlpha = 1;
    // both ends of the strip fade into the dark
    g.globalCompositeOperation = 'destination-in';
    const ends = g.createLinearGradient(0, 0, w, 0); ends.addColorStop(0, 'rgba(0,0,0,0)'); ends.addColorStop(0.02, 'rgba(0,0,0,1)'); ends.addColorStop(0.975, 'rgba(0,0,0,1)'); ends.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ends; g.fillRect(0, 0, w, H);
    g.globalCompositeOperation = 'source-over';
    tex.needsUpdate = true;
  }
  return { mesh, update, dispose() { camera.remove(mesh); geo.dispose(); tex.dispose(); mesh.material.dispose(); for (const m of balls) { m.geometry.dispose(); m.material.dispose(); } } };
}
