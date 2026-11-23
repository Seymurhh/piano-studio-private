// Real letter shapes for 3D lettering: music symbols (clefs, rests, accidentals, flags, noteheads, time signatures)
// and title text, as THREE.Shape lists that can be extruded into solid symbols standing on the page. This copy of
// three.js has ShapePath and ExtrudeGeometry but no font loader, so the outlines come from two small JSON files made
// from open fonts (assets/glyphs/: music.json from Bravura, text.json from Libre Baskerville; licence in OFL.txt,
// credits in CREDITS.txt).
//
// Units, y up in both: a music symbol is measured in staff spaces (the gap between two staff lines), with its origin
// where the SMuFL standard puts it (y = 0 is the staff line it sits on, x = 0 its left edge). Text is measured in
// ems (size 1 = one em), with the baseline at y = 0 and the first letter starting at x = 0.
import * as THREE from '../vendor/three.min.js?v=7';

const BASE = new URL('../glyphs/', import.meta.url);
const TOKEN = /[MLQCZ]|-?(?:\d+\.?\d*|\.\d+)/g;
let loading = null, music = null, text = null, kern = null;

// Fetch both outline files once (later calls share the same promise). Resolves to { music, text }, the files as
// stored, for their measurements: music.engravingDefaults (line and stem thicknesses), music.glyphs[name].adv /
// .bbox [x0, y0, x1, y1] / .anchors (for example noteheadBlack.anchors.stemUpSE), text.capHeight, text.xHeight.
export function loadGlyphs() {
  if (!loading) {
    const get = (name) => fetch(new URL(name + '.json?v=2', BASE)).then((r) => { if (!r.ok) throw new Error('glyphs: cannot load ' + name + '.json'); return r.json(); });
    loading = Promise.all([get('music'), get('text')]).then(([m, t]) => {
      music = m; text = t; kern = new Map(); // kern.get(left).get(right) = ems
      for (const [left, row] of Object.entries(t.kern || {})) kern.set(left, new Map(Object.entries(row).map(([right, k]) => [right, k / 1000])));
      return { music, text };
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

const ready = () => { if (!music) throw new Error('glyphs: call and await loadGlyphs() first'); };

// Draw one stored outline into a ShapePath, scaled by s and moved by (dx, dy). The outline is an SVG-like path:
// M x y, L x y, Q cx cy x y, C c1x c1y c2x c2y x y, Z, where a repeated command may be left out.
function draw(path, d, s, dx, dy) {
  const t = d.match(TOKEN) || [];
  let i = 0, cmd = '';
  const x = () => dx + t[i++] * s, y = () => dy + t[i++] * s;
  while (i < t.length) {
    if (t[i] >= 'A') { cmd = t[i++]; if (cmd === 'Z') continue; } else if (cmd === 'M') cmd = 'L';
    if (cmd === 'M') path.moveTo(x(), y());
    else if (cmd === 'L') path.lineTo(x(), y());
    else if (cmd === 'Q') path.quadraticCurveTo(x(), y(), x(), y());
    else if (cmd === 'C') path.bezierCurveTo(x(), y(), x(), y(), x(), y());
    else throw new Error('glyphs: bad outline');
  }
  return path;
}

// Filled parts and their holes. Filled contours run counter-clockwise and holes clockwise in the files, and
// toShapes() sorts them out by the non-zero rule, so the counter of an "o" or the loops of the treble clef stay open.
const shapesOf = (d, s, dx, dy) => (d ? draw(new THREE.ShapePath(), d, s, dx, dy).toShapes() : []);

// The shapes of one music symbol by its SMuFL name (for example 'gClef', 'noteheadBlack', 'accidentalSharp',
// 'timeSig3'); size = world units per staff space.
export function musicShapes(name, { size = 1 } = {}) {
  ready();
  const g = music.glyphs[name];
  if (!g) throw new Error('glyphs: no music symbol "' + name + '"');
  return shapesOf(g.d, size, 0, 0);
}

// Signs drawn from the music font when they appear in text: sharps and flats sit on the middle of the capitals,
// note signs (for "♩ = 72") stand on the baseline.
const IN_TEXT = { '♯': 'accidentalSharp', '♭': 'accidentalFlat', '♮': 'accidentalNatural', '♩': 'metNoteQuarterUp', '♪': 'metNote8thUp' };
const SIGN = 0.27, PAD = 0.04; // ems per staff space for those signs, and the space beside them

// Kerning between two characters, in ems: the font's pair as written, or else the pair of their base letters (an
// accented letter kerns like its base letter except where the font kerns it differently; those pairs are listed too).
const base = (c) => c.normalize('NFD').charAt(0);
const pairKern = (a, b) => kern.get(a)?.get(b) ?? kern.get(base(a))?.get(base(b)) ?? 0;

// The shapes of one line of text, in order; the array also gets .width (its advance width in the same units).
// size = world units per em; letterSpacing = extra space after each letter, in ems. Kerning comes from the font.
// A character that is not in the font is drawn as its base letter when that is in the font (ǎ as a), otherwise it
// leaves a space.
export function textShapes(string, { size = 1, letterSpacing = 0, kerning = true } = {}) {
  ready();
  const out = [];
  let x = 0, prev = '';
  for (const ch of String(string).normalize('NFC')) {
    if (IN_TEXT[ch]) {
      const g = music.glyphs[IN_TEXT[ch]], b = g.bbox;
      const lift = ch === '♯' || ch === '♭' || ch === '♮' ? text.capHeight / 2 - ((b[1] + b[3]) / 2) * SIGN : -b[1] * SIGN;
      out.push(...shapesOf(g.d, SIGN * size, (x + PAD) * size, lift * size));
      x += g.adv * SIGN + 2 * PAD + letterSpacing; prev = '';
      continue;
    }
    const g = text.glyphs[ch] || text.glyphs[base(ch)];
    if (!g) { x += text.glyphs[' '].adv + letterSpacing; prev = ''; continue; } // not in the font: leave a space
    if (kerning && prev) x += pairKern(prev, ch);
    out.push(...shapesOf(g.d, size, x * size, 0));
    x += g.adv + letterSpacing; prev = ch;
  }
  out.width = Math.max(0, x - letterSpacing) * size;
  return out;
}

// Extrude shapes into a solid that stands on z = 0 and rises to depth + 2 * bevelThickness, with a rounded bevel of
// bevelSegments steps (bevelOffset < 0 cuts the bevel into the outline instead of growing it outward).
// The geometry has exactly two groups, for a material array [faces, sides]: group 0 = the flat top and bottom faces,
// group 1 = the walls and bevel, so the faces can be black lacquer and the walls chrome. smooth = crease angle in
// degrees: walls meeting at a smaller angle are shaded as one curved surface (0 keeps every facet flat).
// center: true centres the solid on x and y, 'x' only across (a title keeps its baseline at y = 0).
// To lay it on the page: mesh.rotation.x = -Math.PI / 2 (the top face then looks up, the glyph's y runs away from
// the viewer). A title takes tens of milliseconds; build each music symbol once and reuse its geometry for every note.
// geo.userData.shape: which of the shapes each corner (vertex) comes from, by its number in the list.
export function extrude(shapes, { depth = 0.1, bevelThickness = 0.02, bevelSize = 0.015, bevelOffset = 0, bevelSegments = 3, curveSegments = 8, smooth = 40, center = false } = {}) {
  const bevel = bevelThickness > 0 && bevelSize > 0;
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, curveSegments, bevelEnabled: bevel, bevelThickness, bevelSize, bevelOffset, bevelSegments: Math.max(1, bevelSegments) });
  const groups = [0, 1].map((m) => geo.groups.filter((g) => g.materialIndex === m));
  // (three.js adds one face group and one wall group per shape, in order: the shape each corner comes from)
  const owner = new Uint32Array(geo.attributes.position.count);
  { let o = 0; for (const gs of groups) gs.forEach((g, i) => { owner.fill(i, o, o + g.count); o += g.count; }); }
  geo.userData.shape = owner;
  for (const name of Object.keys(geo.attributes)) { // faces first, then walls
    const a = geo.attributes[name], k = a.itemSize, dst = new a.array.constructor(a.array.length);
    let o = 0;
    for (const g of groups.flat()) { dst.set(a.array.subarray(g.start * k, (g.start + g.count) * k), o); o += g.count * k; }
    geo.setAttribute(name, new THREE.BufferAttribute(dst, k));
  }
  const faces = groups[0].reduce((s, g) => s + g.count, 0), all = geo.attributes.position.count;
  geo.clearGroups();
  geo.addGroup(0, faces, 0);
  geo.addGroup(faces, all - faces, 1);
  const p = geo.attributes.position.array, n = geo.attributes.normal.array, mid = depth / 2;
  for (let v = 0; v < faces; v++) n.set([0, 0, p[v * 3 + 2] > mid ? 1 : -1], v * 3); // faces are flat (also mends sliver triangles)
  if (smooth > 0) smoothWalls(geo, faces, all, Math.cos((smooth * Math.PI) / 180));
  geo.translate(0, 0, bevel ? bevelThickness : 0);
  if (center) {
    geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    geo.translate(-c.x, center === 'x' ? 0 : -c.y, 0);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Each wall corner takes the average direction of the wall triangles around it that face within the crease angle
// of its own triangle, so curved walls and the bevel look round while sharp corners stay sharp.
function smoothWalls(geo, from, to, cosLimit) {
  const p = geo.attributes.position.array, nrm = geo.attributes.normal.array;
  const tri = new Float32Array((to - from) * 3), unit = new Float32Array((to - from) * 3); // per corner: its triangle's normal (area-weighted / unit)
  for (let v = from; v < to; v += 3) {
    const a = v * 3, b = a + 3, c = a + 6;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
    for (let k = 0; k < 3; k++) {
      const i = (v - from) * 3 + k * 3;
      tri.set([nx, ny, nz], i); unit.set([nx / l, ny / l, nz / l], i);
    }
  }
  const at = new Map();
  for (let v = from; v < to; v++) {
    const key = p[v * 3] + ',' + p[v * 3 + 1] + ',' + p[v * 3 + 2];
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(v - from);
  }
  for (const list of at.values()) for (const i of list) {
    let x = 0, y = 0, z = 0;
    for (const j of list) {
      if (unit[i * 3] * unit[j * 3] + unit[i * 3 + 1] * unit[j * 3 + 1] + unit[i * 3 + 2] * unit[j * 3 + 2] < cosLimit) continue;
      x += tri[j * 3]; y += tri[j * 3 + 1]; z += tri[j * 3 + 2];
    }
    const l = Math.hypot(x, y, z);
    if (l > 0) nrm.set([x / l, y / l, z / l], (i + from) * 3);
  }
  geo.attributes.normal.needsUpdate = true;
}
