// The "Keys" picture: a grand piano's keyboard seen from above, with the notes falling onto it as bars of molten glass.
// Each bar is a glass shell with hot liquid glass flowing inside; where it reaches the keys it glows white-hot, the key
// goes down and warms, and embers fly up. Everything is a pure function of the music time t, so a video export draws
// exactly what playback shows.
import * as THREE from '../vendor/three.min.js?v=7';
import { isBlack } from './midi.js?v=13';
import { createHands, handMeshes, KEY_TILT, KEY_LAYOUTS, KEY_LAYOUT_DEFAULT } from './hands.js?v=59';
import { skinnedHands } from './handmesh.js?v=41';
import * as HANDMESH from './handmesh.js?v=41';   // (its newer helpers are looked up by name, so an older cached copy still loads)

const A0 = 21, C8 = 108;
const Y0 = 0.82;          // height of the line where the notes meet the keys (just above the black keys' tops)
const PLANE_Z = -0.32;    // the notes fall in this upright plane, just behind the keys
const LEAD = 1.9;         // seconds a note is visible before it reaches the keys
// Where the picture's bottom edge crosses the hands: the wrist joint's height and place along the keys when the hand
// plays the white keys (measured over five pieces: the wrist is 0.42-0.75 high, at z 7.8-11.45, mostly 10.3-11.1). The
// joint then sits on the edge; reaching in over the black keys, a little of the forearm shows; its end never does.
const WRIST = { y: 0.47, z: 11.2 };
// The cameras (elev: degrees above the level, looking down; fov: the lens, degrees up the picture; tilt: the plane the
// glass bars fall in, leaning back to face the camera).
// "Keys + hands": above the keys, looking down at them and up the wall of falling notes; the keyboard at least
// minW white keys across [wide, tall] and the camera aimed `up` above the key line [wide, tall].
const KEYS_CAM = { elev: 70, fov: 30, tilt: 58, minW: [44, 0], up: [1.0, 7.5] };
const PORC_KEYS = '#c4c1ba';   // porcelain's colour in the Keys picture
// The skin's tone in the Keys picture. The pale "fair" tone (handmesh.js, the default) is tuned for the warm, low light
// of "Sheet music + hands"; under this picture's brighter, neutral light and its own tone mapping it came out almost
// white-pink (the back of the hand at saturation 0.12). This deeper, slightly pinker tone brings the back of the hand to
// hue 21 degrees, saturation 0.34, as the reference's hue (21-22; its candle light makes it 0.55 saturated); "medium",
// used here before, came out at hue 25 (yellower), saturation 0.28.
const KEYS_SKIN = '#d08c74';
const GLASS_COMB = 0.85;       // how much light glass hands let through in "Sheet music + hands" (1 elsewhere)
const GLASS_ENV = 0.3;         // and their own share of the room's reflections there (with only the dark room's, it went smoky)
// "Sheet music + hands": a camera behind and above the pianist's hands, lower than the Keys picture's so the curved
// fingers read as fingers, through a longer lens from further off so the keyboard has little perspective (its keys
// stand nearly upright from end to end). wide: still, its keys `fill` of the width; tall: following the hands.
const COMB_CAM = { wide: { elev: 54, fov: 6, tilt: 48, fill: 0.92 }, tall: { elev: 54, fov: 24, tilt: 48 } };
// The floor under the keyboard in "Sheet music + hands", round the wrists: dark wood, in deep shade, so the keys and
// hands glow out of the dark as in the candle-lit reference. Its colour: the paper's (linear) times k, warmed toward
// walnut (tint), and never darker than min (on a dark paper the grain would vanish); its grain (walnut: long soft
// streaks along the keyboard, with fine fibres) changes it by up to `grain` either way. It lies in the pool of light
// round the hands too, more softly (its share far from them: `pool`, from the keys' floor up to 1).
const FLOOR = { k: 0.022, tint: [1.12, 0.96, 0.8], min: '#0d0907', grain: 0.4, pool: 0.35 };
// The rail in front of the keys (the key slip) in "Sheet music + hands": dark walnut under clear lacquer, nearly black
// but with its grain showing in the light (colour, grain as for the floor).
const SLIP = { color: '#2a1a0f', grain: 0.6, roughness: 0.38 };
// The pool of light round the hands (handmesh.js HAND_FX.uPool): the key light on the keys and the case is full round
// each hand and falls to `floor` of itself away from them (`w` white keys beyond a hand, 63% of the way there: a
// Gaussian), and toward the back of the keys to `back` (from z 4 back to z 0), so the keys away from the hands lie in
// soft shade and a struck key's light stands out. Each hand's pool covers the keys its hand (its middle finger's
// knuckle) passes over within `reach` s either side, smoothed by a Gaussian of `sigma` s on a `dt` grid: a pure
// function of t that stretches over a run and drifts like a lamp moved over the hands, never lagging behind a fast run
// nor chasing each leap. peak: the share inside a pool (the keys a little darker than the hands under the same light);
// room: how far the room's own light on the keys (ambient, reflections) falls off with the pool too. Per picture: comb
// ("Sheet music + hands"), keys ("Keys + hands", whose white keys under its own bright light take it more softly).
const POOL = { comb: { w: 6, floor: 0.34, back: 0.6, peak: 0.9, room: 0.7 }, keys: { w: 9, floor: 0.42, back: 0.75, peak: 1, room: 0.7 }, dt: 0.1, reach: 0.35, sigma: 0.5 };
// How brightly a played key glows in its hand's colour, for its heat: [black key, white key], per picture.
const KEY_GLOW = { comb: [0.8, 0.5], keys: [0.7, 0.32] };
// The walnut grain (floor and key slip): a share either way (-0.5 .. 0.5) at world point p.
const GRAIN_GLSL = `
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(gh(i), gh(i + vec2(1, 0)), f.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), f.x), f.y); }
float gfbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * gn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float walnut(vec2 p) {          // p: along the grain, across it (world units)
  vec2 q = p * vec2(0.08, 0.7);
  float w = gfbm(q + vec2(3.0 * gfbm(q * 0.5 + 4.1), 0.0));
  float rings = 0.5 + 0.5 * sin(w * 24.0 + p.y * 1.3);
  float fibre = gn(p * vec2(1.2, 16.0));
  return 0.55 * (rings - 0.5) + 0.3 * (fibre - 0.5) + 0.7 * (w - 0.5);
}`;
// The key light of "Sheet music + hands": one warm, low light from the pianist's left and in front, like the candle-lit
// reference video (about 3000 K, 25 degrees up), so each finger and black key throws a long soft shadow to the right
// and up the keys, and the fingers are lit on one side and shaded on the other; the veins and tendons, which need a
// grazing light, show. A darker room round it (ambient, env), its penumbra wide (theta: a candle is a large, soft source),
// and on skin the light a touch cooler (tint), or warm light on warm skin turns it orange. pos: from the middle of the
// keys; target (cx, 0, 2). On the skin the fill is weaker still, so the side of the hand away from the light falls into
// shade as in the photographs: a faint rim from behind (rim), the light the keys throw back up onto the undersides
// (bounce), and the room's reflections at skinEnv (the skin has its own share of them; the rest of the scene has env).
const COMB_LIGHT = { color: '#ffd2a0', intensity: 2.4, pos: [-22, 12, 16], ambient: 0.015, env: 0.08, theta: 0.12, tint: [1, 1, 1.04], rim: [0.3, 0.26, 0.22], bounce: [0.18, 0.155, 0.125], skinEnv: 0.04 };

// The keys' places: the black keys by the studio's "Black keys" setting (hands.js / fingering.js KEY_LAYOUTS: 'piano',
// spread within each group as on a real piano and 0.5 wide, the default; or 'even', on the white keys' boundaries and
// 0.56 wide, as before the setting). buildKeys fills KX in place for its layout (opts.keyLayout), and the hands it plans
// use the same one.
export const KX = new Array(128).fill(0);
function layoutKeys(id) {
  const L = KEY_LAYOUTS[id] || KEY_LAYOUTS[KEY_LAYOUT_DEFAULT];
  for (let p = A0, n = 0; p <= C8; p++) { KX[p] = (isBlack(p) ? n - 0.5 + L.shift[p % 12] : n) - 25.5; if (!isBlack(p)) n++; }
  return L;
}
layoutKeys(KEY_LAYOUT_DEFAULT);
const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Molten glass: two temperature ramps (from cooling glass to white-hot), one for each hand.
export const GLASS_STYLES = {
  molten: {
    name: 'Molten glass',
    right: ['#2a0a02', '#c2420a', '#ffa42a', '#fff0c0'],   // amber and gold
    left: ['#24040a', '#a8241e', '#ff6a40', '#ffe0cc'],    // copper and rose
    seam: '#ff9a3a', wall: ['#0b0604', '#030202'], line: '#5a2a10', ember: '#ffb040',
  },
};

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
`;

const NOTE_VERT = `
attribute float iX, iW, iOn, iDur, iVel, iHand, iSeed, iBlack;
uniform float uTime, uSpeed, uPad; uniform vec3 uUp, uN, uBase;
varying vec2 vP; varying float vW, vH, vYw, vVel, vHand, vSeed, vOn, vDur;
void main() {
  float h = max(iDur * uSpeed, 0.18);
  float yb = (iOn - uTime) * uSpeed;  // distance along the wall from the keys
  vec2 local = vec2(position.x * (iW + 2.0 * uPad), position.y * (h + 2.0 * uPad) - uPad); // the quad, with room for the glow
  vP = vec2(local.x, local.y);
  vW = iW; vH = h; vVel = iVel; vHand = iHand; vSeed = iSeed; vOn = iOn; vDur = iDur;
  float s = yb + local.y;
  vec3 w = uBase + vec3(iX + local.x, 0.0, 0.0) + uUp * s + uN * (iBlack * 0.06);
  vYw = s;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const NOTE_FRAG = `
uniform float uTime, uTop, uGain;
uniform vec3 uR0, uR1, uR2, uR3, uL0, uL1, uL2, uL3;
varying vec2 vP; varying float vW, vH, vYw, vVel, vHand, vSeed, vOn, vDur;
${NOISE}
vec3 ramp(float k, vec3 a, vec3 b, vec3 c, vec3 d) {
  k = clamp(k, 0.0, 1.0);
  return k < 0.33 ? mix(a, b, k / 0.33) : k < 0.72 ? mix(b, c, (k - 0.33) / 0.39) : mix(c, d, (k - 0.72) / 0.28);
}
void main() {
  if (vYw < 0.0) discard;                               // the part that has gone into the keys
  vec2 c = vec2(vP.x, vP.y - vH * 0.5);
  float r = min(min(vW * 0.42, vH * 0.5), 0.32);
  vec2 q = abs(c) - vec2(vW * 0.5, vH * 0.5) + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;     // distance to the bar's outline (negative inside)
  float aa = fwidth(d) * 0.9;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  bool sounding = uTime >= vOn;
  float contact = sounding ? exp(-vYw / 0.9) : 0.0;  // white heat where it meets the keys
  float glow = exp(-max(d, 0.0) / 0.10) * (0.18 + 0.5 * contact) * (1.0 - inside);
  if (inside < 0.002 && glow < 0.004) discard;
  // the outline's slope, for the bevel of the glass
  vec2 g = q.x > 0.0 || q.y > 0.0 ? normalize(max(q, 0.0) + 1e-5) * sign(c) : (q.x > q.y ? vec2(sign(c.x), 0.0) : vec2(0.0, sign(c.y)));
  float bw = min(0.16, vW * 0.26);
  float b = clamp(-d / bw, 0.0, 1.0);                                // 0 at the edge, 1 in the middle
  vec3 n = normalize(vec3(g * (1.0 - b) * 1.8, 1.0));
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
  float rim = pow(1.0 - b, 2.2);
  // the liquid glass inside flows down a little faster than the bar falls, in veins that swirl around a hot channel
  float xr = vP.x / max(vW, 0.2);                                   // -0.5 .. 0.5 across the bar
  vec2 f = vec2(xr * 1.8 + vSeed * 7.0, vYw * 0.38 + uTime * 0.9);
  float n1 = fbm(f * vec2(1.2, 1.0));
  float n2 = fbm(f * vec2(2.4, 1.6) + vec2(n1 * 2.2, -uTime * 0.45));
  float veins = smoothstep(0.42, 0.78, n2);                         // bright threads of liquid
  float channel = exp(-pow((xr + 0.12 * sin(vYw * 1.3 + vSeed * 9.0 + uTime * 1.5)) / 0.2, 2.0)); // the hot core, meandering
  float core = smoothstep(0.0, 0.8, b);
  float temp = 0.1 + 0.3 * n1 + 0.32 * veins + 0.26 * channel * (0.7 + 0.3 * vVel) + 0.1 * vVel + 0.7 * contact;
  vec3 hot = vHand > 0.5 ? ramp(temp, uL0, uL1, uL2, uL3) : ramp(temp, uR0, uR1, uR2, uR3);
  vec3 col = hot * mix(0.3, 1.05, core) * (1.0 + 1.5 * contact);
  // the glass shell: clear at the edge, with a thin bright outline, a long highlight down the left side and a soft one on the right
  float edgeLine = smoothstep(0.16, 0.0, b) * smoothstep(-aa * 2.0, 0.0, -abs(d + 0.012) + 0.012);
  float streak = exp(-pow((xr + 0.27) / 0.07, 2.0)) * smoothstep(0.0, 0.5, vP.y) * smoothstep(vH, vH - 0.5, vP.y);
  float streak2 = exp(-pow((xr - 0.3) / 0.05, 2.0)) * 0.35;
  col += vec3(1.0, 0.95, 0.86) * (rim * 0.22 + spec * 0.9 + (streak + streak2) * 0.55 + edgeLine * 0.6);
  col += hot * glow * 3.0;
  float alpha = inside * mix(0.42, 1.0, core) + glow;
  float top = smoothstep(uTop, uTop - 2.5, vYw);                    // appear softly at the top of the picture
  gl_FragColor = vec4(col * uGain, clamp(alpha, 0.0, 1.0) * top);
}`;

const WALL_FRAG = `
uniform vec3 uA, uB, uLine, uUp, uBase; uniform float uTime, uPedal, uEnergy; uniform float uC[16]; uniform int uNC;
varying vec3 vW;
${NOISE}
void main() {
  float y = dot(vW - uBase, uUp);
  vec3 col = mix(uA, uB, clamp(y / 26.0, 0.0, 1.0));
  col *= 0.85 + 0.3 * fbm(vec2(vW.x * 0.05, y * 0.04 - uTime * 0.03));      // a slow, faint heat haze
  float lines = 0.0;
  for (int i = 0; i < 16; i++) { if (i >= uNC) break; float dx = abs(vW.x - uC[i]); lines += smoothstep(0.05, 0.0, dx); }
  col += uLine * lines * (0.35 + 0.65 * exp(-y / 7.0));
  col += uLine * 2.2 * exp(-max(y, 0.0) / 1.6) * (0.25 + 0.5 * uPedal + 0.4 * uEnergy);  // warm light pooling above the keys
  gl_FragColor = vec4(col, 1.0);
}`;

// the pool of light round the hands (HAND_FX.uPool; a stand-in when an older cached handmesh.js has none)
const POOL_U = HANDMESH.HAND_FX?.uniforms?.uPoolK ? HANDMESH.HAND_FX.uniforms : { uPool: { value: new THREE.Vector4() }, uPoolK: { value: new THREE.Vector4(8, 1, 1, 0) }, uPoolZ: { value: new THREE.Vector2(1, 4) } };
const POOL_GLSL = HANDMESH.HAND_POOL_GLSL || 'float hsPool(vec3 p) { return 1.0; }';
// the floor's colour for a paper colour (FLOOR)
const floorColor = (hex) => { const c = new THREE.Color(hex || '#3b3a38').multiplyScalar(FLOOR.k), m = new THREE.Color(FLOOR.min), [r, g, b] = FLOOR.tint; return c.setRGB(Math.max(c.r * r, m.r), Math.max(c.g * g, m.g), Math.max(c.b * b, m.b)); };
// Walnut grain on a material (the floor and the key slip): its colour changed by up to `amp` either way along world
// coordinates `uv` (GLSL, of vGW, the world point); with `pool` (an unlit material), the pool of light round the hands
// too, its share far from them raised by `pool` toward 1 (lit materials take the pool with the key light, handReceiver).
function woodGrain(m, name, amp, uv, pool = null) {
  m.onBeforeCompile = (sh) => {
    if (pool != null) for (const k of ['uPool', 'uPoolK', 'uPoolZ']) sh.uniforms[k] = POOL_U[k];
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW;' + GRAIN_GLSL + (pool != null ? POOL_GLSL : ''))
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= max(0.0, 1.0 + ${(2 * amp).toFixed(3)} * walnut(${uv}))${pool != null ? ` * (1.0 - (1.0 - hsPool(vGW)) * ${(1 - pool).toFixed(3)})` : ''};`);
  };
  m.customProgramCacheKey = () => `wood-${name}-${amp}-${pool}`;
  return m;
}
// the shadow-casting lights of the last keyboard built: their shadow maps (16 and 32 MB) are freed when the next one is
// built, as the stage replaces its keyboard without disposing it
let lastLights = [];
export function buildKeys(T, { canvasTex, dot, env }, piece, opts = {}) {
  const style = GLASS_STYLES[opts.style] || GLASS_STYLES.molten;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(style.wall[1]);
  scene.environment = env; scene.environmentIntensity = 0.35;

  // (the black keys' layout, opts.keyLayout: 'piano' by default)
  const keyLayout = KEY_LAYOUTS[opts.keyLayout] ? opts.keyLayout : KEY_LAYOUT_DEFAULT, LAY = layoutKeys(keyLayout);
  // ---- what the picture frames: the part of the keyboard the piece uses, at least three octaves
  let lo = 48, hi = 84;
  if (piece && piece.notes.length) { lo = Math.min(...piece.notes.map((n) => n.pitch)); hi = Math.max(...piece.notes.map((n) => n.pitch)); }
  lo = Math.max(A0, Math.floor(lo / 12) * 12); hi = Math.min(C8, Math.ceil((hi + 1) / 12) * 12);
  while (hi - lo < 36) { if (lo > A0 + 5) lo = Math.max(A0, lo - 12); if (hi - lo < 36) hi = Math.min(C8, hi + 12); }
  const x0 = KX[lo] - 0.5, x1 = KX[hi] + 0.5, width = x1 - x0, cx = (x0 + x1) / 2;

  // ---- the wall behind the falling notes (the dark lid of the piano), with a faint line at every C
  const cs = [];
  for (let p = 24; p <= C8; p += 12) if (p >= lo && p <= hi) cs.push(KX[p] - 0.5);
  const wallU = { uA: { value: new THREE.Color(style.wall[0]) }, uB: { value: new THREE.Color(style.wall[1]) }, uLine: { value: new THREE.Color(style.line) },
    uTime: { value: 0 }, uPedal: { value: 0 }, uEnergy: { value: 0 }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uBase: { value: new THREE.Vector3(0, Y0, PLANE_Z) }, uC: { value: [...cs, ...Array(16).fill(0)].slice(0, 16) }, uNC: { value: Math.min(16, cs.length) } };
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(400, 200).translate(0, 100, 0), new THREE.ShaderMaterial({ uniforms: wallU,
    vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: WALL_FRAG, depthWrite: true }));
  scene.add(wall);
  // In the "Sheet music + hands" picture the wall gives way to the paper itself: a backdrop in the paper's colour, with
  // its grain, fading out at the top where the sheet music above shows through.
  const combined = !!opts.combined;
  let backU = null, floorMat = null;
  if (combined) {
    wall.visible = false; scene.background = null;
    backU = { uTop: { value: new THREE.Color(opts.backdrop?.top || '#b9bfe0') }, uBot: { value: new THREE.Color(opts.backdrop?.bottom || '#9aa0c4') }, uFade: { value: 0.2 }, uGrain: { value: 0.035 } };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: backU, depthTest: true, depthWrite: false, transparent: true,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uBot; uniform float uFade, uGrain; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() { vec3 c = mix(uBot, uTop, vUv.y); c *= 1.0 + uGrain * (h(floor(gl_FragCoord.xy)) - 0.5); gl_FragColor = vec4(c, smoothstep(1.0, 1.0 - uFade, vUv.y)); }` }));
    back.frustumCulled = false; back.renderOrder = -10; if (!opts.noBackdrop) scene.add(back); else backU = null;
    // the floor under the keyboard's front, round the hands' wrists: dark wood in the paper's own colour (opts.floor),
    // in deep shade (FLOOR), unlit (and something solid for the glass hands to show through)
    floorMat = woodGrain(new THREE.MeshBasicMaterial({ color: floorColor(opts.floor) }), 'floor', FLOOR.grain, 'vec2(vGW.x, vGW.z)', FLOOR.pool);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(width + 60, 80).rotateX(-Math.PI / 2).translate(cx, -1.46, 6.9 + 40), floorMat));
  }

  // ---- light
  scene.add(new THREE.AmbientLight('#fff4ea', combined ? COMB_LIGHT.ambient : 0.1));
  if (combined) scene.environmentIntensity = COMB_LIGHT.env;   // a dark room: the keys and hands come out of shadow
  const keyLight = new THREE.DirectionalLight(combined ? COMB_LIGHT.color : '#fff1e0', combined ? COMB_LIGHT.intensity : 1.4);
  if (combined) keyLight.position.set(cx + COMB_LIGHT.pos[0], COMB_LIGHT.pos[1], COMB_LIGHT.pos[2]); else keyLight.position.set(cx - 10, 26, 18);
  keyLight.target.position.set(cx, 0, 2);
  keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.015; keyLight.shadow.radius = 3;
  Object.assign(keyLight.shadow.camera, { left: -width / 2 - 4, right: width / 2 + 4, top: 14, bottom: -14, near: 1, far: 80 });
  scene.add(keyLight, keyLight.target);
  const flashes = Array.from({ length: 5 }, () => { const l = new THREE.PointLight('#ffb060', 0, 6, 1.8); scene.add(l); return l; });

  // ---- the keyboard: keys pivot at the back like real ones
  const lacquer = new THREE.MeshPhysicalMaterial({ color: '#050505', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05 });
  // (the rail in front of the keys: in "Sheet music + hands" dark walnut with its grain, SLIP)
  const slipMat = combined ? woodGrain(new THREE.MeshPhysicalMaterial({ color: SLIP.color, roughness: SLIP.roughness, clearcoat: 1, clearcoatRoughness: 0.06 }), 'slip', SLIP.grain, 'vec2(vGW.x, vGW.y + vGW.z)') : lacquer;
  const slip = new THREE.Mesh(new THREE.RoundedBoxGeometry(width + 60, 1.1, 0.9, 3, 0.2), slipMat); // the rail in front of the keys
  slip.position.set(cx, -0.85, 6.75); slip.receiveShadow = true; scene.add(slip);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(width + 60, 0.4, 7.4), new THREE.MeshStandardMaterial({ color: '#0b0908', roughness: 0.9 }));
  bed.position.set(cx, -1.25, 3.2); bed.receiveShadow = true; scene.add(bed);
  const seamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(style.seam).multiplyScalar(2.2), toneMapped: false });
  const seam = new THREE.Mesh(new THREE.BoxGeometry(width + 60, 0.05, 0.05), seamMat);
  seam.position.set(cx, Y0 - 0.02, PLANE_Z + 0.04); scene.add(seam);
  const back = new THREE.Mesh(new THREE.BoxGeometry(width + 60, 1.3, 0.3), lacquer); // the strip of case behind the keys
  back.position.set(cx, Y0 - 0.7, PLANE_Z - 0.22); scene.add(back);

  const whiteGeo = new THREE.RoundedBoxGeometry(0.94, 1, 6.2, 2, 0.06).translate(0, -0.5, 3.1);
  const blackGeo = new THREE.RoundedBoxGeometry(LAY.blackW, 0.72, 3.95, 2, 0.08).translate(0, -0.36, 1.975);
  const keys = [];
  for (let p = A0; p <= C8; p++) {
    const black = isBlack(p);
    const mat = new THREE.MeshPhysicalMaterial({ color: black ? '#070707' : '#f3efe8', roughness: black ? 0.25 : 0.32, clearcoat: black ? 1 : 0.6, clearcoatRoughness: 0.12, emissive: '#000000' });
    const m = new THREE.Mesh(black ? blackGeo : whiteGeo, mat);
    m.position.set(KX[p], black ? 0.58 : 0, 0);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); keys[p] = { mesh: m, black };
  }

  // ---- the notes: one instanced quad per note, drawn as molten glass by the shader
  const list = piece ? [...piece.notes].filter((n) => n.pitch >= A0 && n.pitch <= C8).sort((a, b) => a.onset - b.onset) : [];
  const oneTrack = !piece || piece.tracks === 1;
  const handOf = (n) => (oneTrack ? (n.pitch < 60 ? 1 : 0) : (n.track === 0 ? 0 : 1)); // 0 = right hand, 1 = left hand
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position'));
  const N = Math.max(1, list.length);
  const att = (name, f) => { const a = new Float32Array(N); list.forEach((n, i) => { a[i] = f(n, i); }); geo.setAttribute(name, new THREE.InstancedBufferAttribute(a, 1)); };
  att('iX', (n) => KX[n.pitch]);
  att('iW', (n) => (isBlack(n.pitch) ? 0.6 : 0.88));
  att('iOn', (n) => n.onset); att('iDur', (n) => n.dur); att('iVel', (n) => n.vel ?? 0.7);
  att('iHand', handOf); att('iSeed', (n, i) => rnd(i, n.pitch)); att('iBlack', (n) => (isBlack(n.pitch) ? 1 : 0));
  geo.instanceCount = list.length;
  const C = (h) => new THREE.Color(h);
  const tiltUp = new THREE.Vector3(0, 1, 0), tiltN = new THREE.Vector3(0, 0, 1), base = new THREE.Vector3(0, Y0, PLANE_Z);
  const noteU = { uTime: { value: 0 }, uSpeed: { value: 8 }, uPad: { value: 0.35 }, uTop: { value: 30 }, uGain: { value: 1 }, uUp: { value: tiltUp }, uN: { value: tiltN }, uBase: { value: base },
    uR0: { value: C(style.right[0]) }, uR1: { value: C(style.right[1]) }, uR2: { value: C(style.right[2]) }, uR3: { value: C(style.right[3]) },
    uL0: { value: C(style.left[0]) }, uL1: { value: C(style.left[1]) }, uL2: { value: C(style.left[2]) }, uL3: { value: C(style.left[3]) } };
  const notes = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: noteU, vertexShader: NOTE_VERT, fragmentShader: NOTE_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: true }));
  notes.frustumCulled = false; notes.renderOrder = 3; notes.visible = !combined || !!opts.bars;
  scene.add(notes);

  // ---- flares where the notes meet the keys, and embers
  const flareMat = new THREE.SpriteMaterial({ map: dot, color: '#ffb060', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flares = Array.from({ length: 24 }, () => { const s = new THREE.Sprite(flareMat.clone()); s.visible = false; s.renderOrder = 4; scene.add(s); return s; });
  const EMBERS = 1600;
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
  eg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ size: 0.16, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  embers.frustumCulled = false; embers.renderOrder = 5; scene.add(embers);

  // ---- the glass hands
  // (opts.handPosture: the hands' posture, hands.js HAND_POSTURES: 'auto' by default; on this layout's keys)
  const hands = opts.hands === false ? null : createHands(piece, handOf, { posture: opts.handPosture || 'auto', keyLayout });
  const handDraw = hands ? (skinnedHands(scene, { look: opts.handLook || 'skin', glow: '#ffa040', skin: combined ? undefined : KEYS_SKIN }) || handMeshes(scene, { look: opts.handLook || 'skin', glow: '#ffa040' })) : null;
  const pedal = piece ? [...(piece.pedal || [])].sort((a, b) => a.time - b.time) : [];
  const pedalAt = (t) => { let d = false; for (const p of pedal) { if (p.time > t) break; d = p.down; } return d; };
  const handCol = opts.handColors ? opts.handColors.map((c) => new THREE.Color(c)) : [C(style.right[2]), C(style.left[2])];
  // In "Sheet music + hands" a pressing fingertip glows in its hand's own colour, as its key does (in the Keys picture,
  // amber, the molten glass's), and glass hands let a little less through (GLASS_COMB), so over the dark floor their
  // backs and wrists stay pale glass rather than dark. In the Keys picture, whose bloom would blow its white out,
  // porcelain is a little greyer (PORC_KEYS). Again after each change of look, which makes the materials anew.
  let handLook = opts.handLook || 'skin';
  const tuneHands = () => {
    if (!handDraw?.meshes) return;
    handDraw.meshes.forEach(({ mesh }, h) => {
      if (combined) {
        mesh.material.userData.hotCol?.value.copy(handCol[h]);
        if (handLook === 'glass') Object.assign(mesh.material, { transmission: GLASS_COMB, envMap: scene.environment, envMapIntensity: GLASS_ENV });
        else if (handLook === 'skin') Object.assign(mesh.material, { envMap: scene.environment, envMapIntensity: COMB_LIGHT.skinEnv });
      }
      else if (handLook === 'porcelain') mesh.material.color.set(PORC_KEYS);
    });
  };
  tuneHands();

  // ---- the hands' own shadow and contact shading. A second light from the key light's direction makes a shadow map of
  // the hands alone (it adds no light), fitted round them every frame, so their shadows are crisp (0.2 mm texels instead of
  // 0.5) and start right at a touching fingertip (its bias is 0.07 mm instead of 0.7). The keys and the skin filter it with
  // a penumbra that is sharp at the touch and widens with distance (handmesh.js). The key light's wide map keeps the keys'
  // shadows on each other. Capsules round the finger bones darken the ambient light under the hands (the contact spot under
  // a pressing fingertip; black keys stop mirroring the room). Hands-only lights: the key light a little warmer and stronger
  // on skin, a rim from behind, and the light bounced up from the white keys.
  const FX = HANDMESH.HAND_FX && HANDMESH.handReceiver && handDraw?.meshes?.[0]?.bones ? HANDMESH.HAND_FX : null;
  let handSun = null;
  if (FX) {
    const U = FX.uniforms;
    handSun = new THREE.DirectionalLight(0xffffff, 0);
    handSun.castShadow = true; handSun.shadow.mapSize.set(4096, 2048);
    handSun.shadow.bias = -0.0002; handSun.shadow.normalBias = 0.006;
    handSun.shadow.intensity = opts.handLook === 'glass' ? 0.35 : 1;
    handSun.shadow.camera.layers.set(1);
    scene.add(handSun, handSun.target);          // after keyLight: shadow map 1
    keyLight.shadow.camera.layers.set(2);        // the wide map: the keys only
    keyLight.shadow.radius = 2;
    // a tighter depth range: its bias is 0.4 mm, not 0.7 (the low light of "Sheet music + hands" looks along the keyboard,
    // which then reaches further through the map's depth and up its height)
    Object.assign(keyLight.shadow.camera, combined ? { near: 2, far: 64, top: 22, bottom: -22 } : { near: 10, far: 50 });
    keys.forEach((k) => { if (k) { k.mesh.layers.enable(2); HANDMESH.handReceiver(k.mesh.material); } });
    [lacquer, slipMat, bed.material].forEach(HANDMESH.handReceiver);
    handDraw.meshes.forEach(({ mesh }) => mesh.layers.enable(1));
    U.uKeyTint.value.setRGB(...(combined ? COMB_LIGHT.tint : [1.1, 1.08, 1.06]));   // the key light on skin (Keys picture: a little warmer)
    U.uRimCol.value.setRGB(...(combined ? COMB_LIGHT.rim : [0.8, 0.72, 0.62]));
    U.uBounce.value.setRGB(...(combined ? COMB_LIGHT.bounce : [0.3, 0.28, 0.26]));
    if (U.uKeyTheta) U.uKeyTheta.value = combined ? COMB_LIGHT.theta : 0.07;
    U.uShoulder.value = combined ? 1 : 0;        // (the Keys picture has its own tone mapping)
    U.uArmFade.value = combined ? 0 : 1;         // (in the Keys picture the short forearm fades into the dark)
    const P = new THREE.Vector3(), Ld = new THREE.Vector3(), Ax = new THREE.Vector3(), Ay = new THREE.Vector3();
    scene.onBeforeRender = () => {
      if (!FX.capsules(handDraw)) return;
      // the light's frame; the frustum fitted round all the bones (with room for their shadows), its size in steps and its
      // centre on whole texels, so the shadows' edges do not crawl as the hands move
      Ld.subVectors(keyLight.target.position, keyLight.position).normalize();
      Ax.set(0, 1, 0).cross(Ld).normalize(); Ay.crossVectors(Ld, Ax);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, d0 = 1e9, d1 = -1e9;
      for (const { mesh, bones } of handDraw.meshes) {
        if (!mesh.visible) continue;
        for (const b of bones) {
          P.setFromMatrixPosition(b.matrixWorld);
          const x = P.dot(Ax), y = P.dot(Ay), d = P.dot(Ld);
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
        }
      }
      if (x0 > x1) return;
      const W = 4 * Math.ceil(Math.max(32, x1 - x0 + 8, 2 * (y1 - y0 + 8)) / 4), texel = W / 4096;
      const cx = Math.round((x0 + x1) / 2 / texel) * texel, cy = Math.round((y0 + y1) / 2 / texel) * texel;
      const dn = Math.floor((d0 - 2) / 2) * 2, df = Math.ceil((d1 + 5) / 2) * 2;
      handSun.position.copy(Ax).multiplyScalar(cx).addScaledVector(Ay, cy).addScaledVector(Ld, dn - 10);
      handSun.target.position.copy(handSun.position).add(Ld);
      Object.assign(handSun.shadow.camera, { left: -W / 2, right: W / 2, top: W / 4, bottom: -W / 4, near: 10, far: 10 + df - dn });
      handSun.shadow.camera.updateProjectionMatrix(); handSun.updateMatrixWorld(); handSun.target.updateMatrixWorld();
      U.uHandW.value = W; U.uHandDepth.value = df - dn;
    };
  }
  const hotCol = C(style.right[3]);
  // how brightly a played key glows in its hand's colour, for its heat [black, white]: in "Sheet music + hands", where
  // the keys round it lie in the pool's shade, the white keys more, so a played key reads as lit, not merely tinted
  const GLOW = combined ? KEY_GLOW.comb : KEY_GLOW.keys;

  lastLights.forEach((l) => l.dispose()); lastLights = [keyLight, handSun].filter(Boolean);

  // ---- the camera: a little above and in front of the keys, looking down at them and up the wall of falling notes.
  // "Keys + hands": KEYS_CAM. "Sheet music + hands": COMB_CAM, per picture shape. In every picture the bottom edge
  // passes through the wrist line WRIST, so below the keys the hands show down to the wrist and the forearms run on out
  // of the picture (their ends never show).
  const view = { ...(combined ? COMB_CAM.wide : KEYS_CAM) };
  // In the tall combined picture the camera follows the music along the keyboard, framing about three octaves around
  // where the hands are playing (a smooth weighted average of the notes near time t, so it never jumps).
  function follow(t) {
    let sw = 0, sx = 0, sxx = 0;
    for (let i = Math.max(0, first - 400); i < list.length; i++) {
      const n = list[i]; if (n.onset < t - 3) continue; if (n.onset > t + 3) break;
      const w = Math.exp(-(((n.onset - t) / 1.4) ** 2)), x = KX[n.pitch];
      sw += w; sx += w * x; sxx += w * x * x;
    }
    if (sw < 1e-4) return { c: cx, w: Math.min(width, 26) };
    const m = sx / sw, sd = Math.sqrt(Math.max(0, sxx / sw - m * m));
    return { c: m, w: Math.max(15, Math.min(width, 28, 2.6 * sd + 9)) };
  }
  // In the tall "Sheet music + hands" picture the whole keyboard would be a thin strip, so the camera comes closer and
  // glides along the keys with the hands: it frames the keys they are playing (each note from `after` s before it is
  // struck to `before` s after, or as long as its key is held), `margin` white keys to spare on each side, at least
  // `min` white keys across (`piece`: with "The piece's keys (closer)") and at most `max`. Worked out once on a `dt`
  // grid from the notes (each hand is taken to reach at least `hand` white keys either side of the middle of its keys, as
  // a hand played by its thumb or little finger does), held `hold` s either side (so the camera is there before a leap and stays for the last notes;
  // the width, which changes rarely, longer), then smoothed by Gaussians of `sigma` s (place, width): a pure function of
  // t, never a jump. The picture's bottom edge passes through the wrist line (WRIST); the width is measured along the
  // front edge of the keys (z = front).
  const FOLLOW = { dt: 0.1, after: 0.8, before: 0.6, hand: 4, margin: 1, min: 26, max: 40, piece: [22, 34], hold: [0.5, 2.5], sigma: [0.55, 1.4], front: 6.2 };
  let fol = null;
  function followAt(t) {
    const [mn, mx] = opts.keyRange === 'piece' ? FOLLOW.piece : [FOLLOW.min, FOLLOW.max], kx0 = KX[A0] - 0.5, kx1 = KX[C8] + 0.5;
    if (!fol) {
      const dt = FOLLOW.dt, t0 = (list.length ? list[0].onset : 0) - 4, t1 = (list.length ? Math.max(...list.map((n) => n.onset + n.dur)) : 0) + 4;
      const N = Math.max(2, Math.ceil((t1 - t0) / dt) + 1), lo = new Float64Array(N).fill(Infinity), hi = new Float64Array(N).fill(-Infinity);
      for (const hand of [0, 1]) { // the keys each hand has in play at each moment
        const hl = new Float64Array(N).fill(Infinity), hh = new Float64Array(N).fill(-Infinity);
        for (const n of list) {
          if (handOf(n) !== hand) continue;
          const pl = hands ? hands.played.get(n) : { on: n.onset, off: n.onset + n.dur };
          if (!pl) continue;
          const a = Math.max(0, Math.ceil((pl.on - FOLLOW.after - t0) / dt)), b = Math.min(N - 1, Math.floor((Math.max(pl.on + FOLLOW.before, pl.off) - t0) / dt)), x = KX[n.pitch];
          for (let i = a; i <= b; i++) { if (x < hl[i]) hl[i] = x; if (x > hh[i]) hh[i] = x; }
        }
        // (a hand with nothing to play waits where it played last or will play next, whichever is nearer in time)
        const last = new Int32Array(N).fill(-1), next = new Int32Array(N).fill(-1);
        for (let i = 0, k = -1; i < N; i++) { if (hh[i] >= hl[i]) k = i; last[i] = k; }
        for (let i = N - 1, k = -1; i >= 0; i--) { if (hh[i] >= hl[i]) k = i; next[i] = k; }
        for (let i = 0; i < N; i++) { // (the hand itself: its keys, and at least `hand` white keys either side of their middle)
          const k = last[i] < 0 ? next[i] : next[i] < 0 ? last[i] : i - last[i] <= next[i] - i ? last[i] : next[i];
          if (k >= 0) { const mid = (hl[k] + hh[k]) / 2; lo[i] = Math.min(lo[i], hl[k], mid - FOLLOW.hand); hi[i] = Math.max(hi[i], hh[k], mid + FOLLOW.hand); }
        }
      }
      for (let i = 0; i < N; i++) if (!(hi[i] >= lo[i])) lo[i] = hi[i] = KX[60]; // (no notes at all: middle C)
      const held = (src, r, f) => Float64Array.from(src, (_, i) => { let v = src[i]; for (let j = Math.max(0, i - r); j <= Math.min(N - 1, i + r); j++) v = f(v, src[j]); return v; });
      const smooth = (src, sigma) => {
        const g = Math.round((3 * sigma) / dt), w = Array.from({ length: 2 * g + 1 }, (_, j) => Math.exp(-0.5 * (((j - g) * dt) / sigma) ** 2));
        return Float64Array.from(src, (_, i) => { let s = 0, ws = 0; for (let j = -g; j <= g; j++) { const q = Math.min(N - 1, Math.max(0, i + j)); s += src[q] * w[j + g]; ws += w[j + g]; } return s / ws; });
      };
      const rP = Math.round(FOLLOW.hold[0] / dt), L = held(lo, rP, Math.min), H = held(hi, rP, Math.max), m = FOLLOW.margin + 0.5;
      const w = Float64Array.from(smooth(held(Float64Array.from(L, (l, i) => H[i] - l + 2 * m), Math.round(FOLLOW.hold[1] / dt), Math.max), FOLLOW.sigma[1]), (v) => Math.min(mx, Math.max(mn, v)));
      // the place: the middle of the keys in play, smoothed; then kept where those keys (with the margin) fit, when they
      // can, and smoothed a little again
      const c = smooth(Float64Array.from(L, (l, i) => (l + H[i]) / 2), FOLLOW.sigma[0]);
      for (let i = 0; i < N; i++) { const a = H[i] + m - w[i] / 2, b = L[i] - m + w[i] / 2; if (a <= b) c[i] = Math.min(b, Math.max(a, c[i])); }
      fol = { t0, N, c: smooth(c, 0.25), w };
    }
    const u = Math.min(fol.N - 1, Math.max(0, (t - fol.t0) / FOLLOW.dt)), i = Math.min(fol.N - 2, Math.floor(u)), f = u - i;
    const w = fol.w[i] + (fol.w[i + 1] - fol.w[i]) * f, c = fol.c[i] + (fol.c[i + 1] - fol.c[i]) * f;
    return { c: Math.min(kx1 - w / 2, Math.max(kx0 + w / 2, c)), w };
  }
  // the pool of light round the hands (POOL): the stretch of keys each hand's pool covers at time t ([right from, to,
  // left from, to], world x). Each hand's middle-finger knuckle (hands.pose, a pure function of t) is sampled on a dt
  // grid, filled in as it is needed (a few samples after a seek, then one every dt); the stretch runs from the least to
  // the most of it within `reach` s either side, each end smoothed by a Gaussian of `sigma` s.
  let poolG = null;
  function poolAt(t) {
    if (!hands) { const a = KX[A0] - 1, b = KX[C8] + 1; return [a, b, a, b]; }   // (no hands: the whole keyboard lit)
    if (!poolG) {
      const dt = POOL.dt, t0 = (list.length ? list[0].onset : 0) - 4, t1 = (list.length ? list[list.length - 1].onset + list[list.length - 1].dur : 0) + 4;
      const N = Math.max(2, Math.ceil((t1 - t0) / dt) + 1), g = Math.round((3 * POOL.sigma) / dt), r = Math.round(POOL.reach / dt);
      poolG = { t0, N, g, r, w: Array.from({ length: 2 * g + 1 }, (_, j) => Math.exp(-0.5 * (((j - g) * dt) / POOL.sigma) ** 2)), x: [new Float64Array(N).fill(NaN), new Float64Array(N).fill(NaN)] };
    }
    const G = poolG, X = G.x, clampI = (i) => Math.min(G.N - 1, Math.max(0, i));
    const raw = (i) => { if (Number.isNaN(X[0][i])) { const ps = hands.pose(G.t0 + i * POOL.dt); X[0][i] = ps[0].joints[2][0].x; X[1][i] = ps[1].joints[2][0].x; } };
    const span = (i) => { // [right lo, hi, left lo, hi] within reach of grid point i
      const o = [Infinity, -Infinity, Infinity, -Infinity];
      for (let j = i - G.r; j <= i + G.r; j++) { const q = clampI(j); raw(q); for (const h of [0, 1]) { o[2 * h] = Math.min(o[2 * h], X[h][q]); o[2 * h + 1] = Math.max(o[2 * h + 1], X[h][q]); } }
      return o;
    };
    const at = (i) => { const s = [0, 0, 0, 0]; let ws = 0; for (let j = -G.g; j <= G.g; j++) { const o = span(clampI(i + j)), w = G.w[j + G.g]; for (let k = 0; k < 4; k++) s[k] += o[k] * w; ws += w; } return s.map((v) => v / ws); };
    const u = Math.min(G.N - 1, Math.max(0, (t - G.t0) / POOL.dt)), i = Math.min(G.N - 2, Math.floor(u)), f = u - i, A = at(i), B = at(i + 1);
    return A.map((a, k) => a + (B[k] - a) * f);
  }
  const poolK = combined ? POOL.comb : POOL.keys;
  POOL_U.uPoolK.value.set(poolK.w, poolK.floor, poolK.peak, poolK.room); POOL_U.uPoolZ.value.set(poolK.back, 4);

  let camT = 0; const camDbg = {};
  // The camera s back along the picture's bottom ray from the wrist line (WRIST), at x, s chosen so that the keys'
  // front edge (z = FOLLOW.front, on the floor) is `across` white keys wide in the picture.
  function fromWrist(camera, x, across, e, vf, hf) {
    const be = e + vf, s = (across / (2 * Math.tan(hf)) - WRIST.y * Math.sin(e) - (WRIST.z - FOLLOW.front) * Math.cos(e)) / Math.cos(vf);
    camera.position.set(x, WRIST.y + s * Math.sin(be), WRIST.z + s * Math.cos(be));
    camera.lookAt(x, camera.position.y - Math.sin(e), camera.position.z - Math.cos(e));
    return s;
  }
  function placeCamera(camera) {
    if (combined) Object.assign(view, camera.aspect < 1.5 ? COMB_CAM.tall : COMB_CAM.wide);
    if (camera.fov !== view.fov) { camera.fov = view.fov; camera.updateProjectionMatrix(); }
    const vf = (camera.fov / 2) * Math.PI / 180, hf = Math.atan(Math.tan(vf) * camera.aspect);
    const e = view.elev * Math.PI / 180;
    let fx = cx, fw = width;
    if (combined && !globalThis.__keysZoom && camera.aspect < 1.5) {
      // the tall picture: closer, following the hands (see FOLLOW), the keys' front edge F.w white keys across
      const F = followAt(camT);
      camDbg.dist = fromWrist(camera, F.c, F.w, e, vf, hf);
      camDbg.fx = F.c; camDbg.fw = F.w; camDbg.aspect = camera.aspect;
    } else if (combined && !globalThis.__keysZoom) {
      // The wide "Sheet music + hands" picture: the camera stays still, looking down on the whole keyboard through a
      // long lens (little perspective); its 88 keys fill COMB_CAM.wide.fill of the picture's width, a little smaller
      // than the whole width, so the hands fit down to the wrist under them.
      let kx0 = KX[21] - 0.5, kx1 = KX[108] + 0.5;
      if (opts.keyRange === 'piece') { // just the keys the piece uses (and a little more, at least three octaves), closer
        const pad = Math.max(1.5, (22 - width) / 2); kx0 = Math.max(kx0, x0 - pad); kx1 = Math.min(kx1, x1 + pad);
      }
      camDbg.dist = fromWrist(camera, (kx0 + kx1) / 2, (kx1 - kx0) / view.fill, e, vf, hf);
      camDbg.fx = (kx0 + kx1) / 2; camDbg.fw = kx1 - kx0; camDbg.aspect = camera.aspect;
    } else {
    if (combined && globalThis.__keysZoom) { fw = globalThis.__keysZoom; fx = globalThis.__keysX != null ? globalThis.__keysX : follow(camT).c; } // (a close look, for testing)
    if (!combined) fw = Math.max(fw, camera.aspect < 1 ? view.minW[1] : view.minW[0]);
    const dist = (fw / 2) / Math.tan(hf) * 0.98 + 4.0;
    camDbg.fx = fx; camDbg.fw = fw; camDbg.aspect = camera.aspect; camDbg.dist = dist;
    let zT = 4.2;
    if (combined) { const zb = 12.4; zT = zb - dist * Math.cos(e) + (dist * Math.sin(e)) / Math.tan(e + vf); }
    const target = combined ? new THREE.Vector3(fx, 0, zT) : new THREE.Vector3(cx, Y0 + (camera.aspect < 1 ? view.up[1] : view.up[0]), 0);
    if (!combined) { // "Keys + hands": the target slid along z (keeping its height) until the bottom ray meets the wrist line
      const be = e + vf, lam = (target.y + Math.sin(e) * dist - WRIST.y) / Math.sin(be);
      target.z = WRIST.z + lam * Math.cos(be) - dist * Math.cos(e);
    }
    camera.position.set(target.x, target.y + Math.sin(e) * dist, target.z + Math.cos(e) * dist);
    camera.lookAt(target);
    }
    camera.updateMatrixWorld();
    // The notes fall in a plane leaning back so that it faces the camera: they run straight down the picture.
    const a = view.tilt * Math.PI / 180;
    tiltUp.set(0, Math.cos(a), -Math.sin(a)); tiltN.set(0, Math.sin(a), Math.cos(a));
    wallU.uUp.value.copy(tiltUp);
    wall.position.copy(base).addScaledVector(tiltUp, -1.2).addScaledVector(tiltN, -0.9); wall.position.x = camera.position.x;
    wall.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tiltN);
    // how far up the plane the top of the picture reaches: the notes start there
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 1), camera);
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(tiltN, base), hit = new THREE.Vector3();
    const top = ray.ray.intersectPlane(pl, hit) ? hit.clone().sub(base).dot(tiltUp) : 30;
    noteU.uTop.value = top; noteU.uSpeed.value = top / LEAD;
  }

  let first = 0; // index of the first note that may still matter (sorted by onset)
  // o.flash, o.powder: how strong the flash and the powder (here the embers) at a struck key are, as multiples of their
  // usual strength (stage.js, from the Look tab's sliders; 1 by default; 0 none)
  function render(t, camera, o = {}) {
    camT = t;
    placeCamera(camera);
    const FM = Math.max(0, o.flash ?? 1), PM = Math.max(0, o.powder ?? 1);
    POOL_U.uPool.value.fromArray(poolAt(t));
    noteU.uTime.value = t; wallU.uTime.value = t;
    const speed = noteU.uSpeed.value;
    while (first > 0 && list[first - 1].onset + list[first - 1].dur > t - 3) first--;
    while (first < list.length && list[first].onset + Math.max(list[first].dur, 0.1) < t - 3) first++;
    // how hot each key is, from its notes (heat, flares, embers and energy start with the sound, at the onset: a steady
    // glow while the key is held, and the flash as it is struck, FM times its usual strength); how far
    // down it is comes from the fingers (hands.keyDepth: the key starts down when the fingertip meets it, before the sound,
    // and reaches the bottom at the onset). fb: the depth of keys no finger plays, by the notes' timing ("Keys + hands"
    // only; in "Sheet music + hands" those keys stay up)
    const press = new Map(), fb = new Map(); let energy = 0;
    const active = [];
    for (let i = first; i < list.length; i++) {
      const n = list[i];
      if (n.onset > t + 0.25) break;
      const pl = hands ? hands.played.get(n) : null;
      if (hands && combined && !pl) continue;              // no finger on it: the key stays up
      const off = pl ? pl.off : n.onset + n.dur, age = t - n.onset;
      if (age < 0) continue;
      const down = t < off ? 1 : Math.max(0, 1 - (t - off) / 0.09);
      if (!pl) fb.set(n.pitch, Math.max(fb.get(n.pitch) || 0, down));
      const heat = t < off ? 0.35 + 0.65 * FM * Math.exp(-age / 0.5) : Math.max(0, 0.35 * (1 - (t - off) / 0.6));
      if (down > 0 || heat > 0) {
        const cur = press.get(n.pitch) || { down: 0, heat: 0, hand: handOf(n), vel: n.vel ?? 0.7 };
        cur.down = Math.max(cur.down, down); cur.heat = Math.max(cur.heat, heat * (0.6 + 0.6 * (n.vel ?? 0.7)));
        press.set(n.pitch, cur);
      }
      if (age < 1.8) active.push({ n, i, age });
      if (t < off) energy += 0.25 + 0.5 * (n.vel ?? 0.7);
    }
    energy = Math.min(1.5, energy / 6);
    for (let p = A0; p <= C8; p++) {
      const k = keys[p], s = press.get(p), m = k.mesh;
      const dn = hands ? Math.max(hands.keyDepth(p, t), fb.get(p) || 0) : fb.get(p) || 0;
      m.rotation.x = dn * (k.black ? KEY_TILT.black : KEY_TILT.white);
      if (s && s.heat > 0.001) m.material.emissive.copy(handCol[s.hand]).multiplyScalar(s.heat * (k.black ? GLOW[0] : GLOW[1]));
      else m.material.emissive.setRGB(0, 0, 0);
    }
    // flares and the light they throw
    let fi = 0;
    const lit = [...press.entries()].filter(([, s]) => s.down > 0).sort((a, b) => b[1].heat - a[1].heat);
    for (const [p, s] of lit) {
      if (fi >= flares.length) break;
      const f = flares[fi++]; f.visible = true;
      const sz = 0.55 + 1.1 * s.heat;
      f.position.set(KX[p], base.y + 0.1 * tiltUp.y + 0.45 * tiltN.y, base.z + 0.1 * tiltUp.z + 0.45 * tiltN.z); f.scale.set(sz * 1.5, sz, 1);
      f.material.color.copy(handCol[s.hand]).lerp(hotCol, 0.15).multiplyScalar(0.3 + 0.75 * s.heat);
    }
    for (; fi < flares.length; fi++) flares[fi].visible = false;
    flashes.forEach((l, i) => {
      const h = lit[i];
      l.intensity = h ? (combined ? 9 : 3.5) * h[1].heat : 0;
      if (h) { l.color.copy(handCol[h[1].hand]); if (combined) { l.position.set(KX[h[0]], 2.6, 2.2); l.distance = 9; } else l.position.set(KX[h[0]], Y0 + 1.2, 1.4); }
    });
    // embers: each struck note throws a few, which rise, drift and cool
    const pos = eg.attributes.position.array, col = eg.attributes.color.array;
    let e = 0;
    if (o.effects !== false) {
      for (const { n, i, age } of active) {
        const count = Math.round((4 + 10 * (n.vel ?? 0.7)) * PM);
        for (let j = 0; j < count && e < EMBERS; j++) {
          const life = 0.7 + 1.0 * rnd(i, j + 3);
          if (age > life) continue;
          const k = age / life;
          const vx = (rnd(i, j) - 0.5) * 1.6, vy = 1.2 + 2.6 * rnd(j, i + 1), vz = 0.2 + 1.4 * rnd(i + 7, j);
          const x = KX[n.pitch] + vx * age + 0.25 * Math.sin(age * 5 + j), up = vy * age - 0.9 * age * age, out = 0.3 + vz * age;
          pos[e * 3] = x; pos[e * 3 + 1] = base.y + tiltUp.y * up + tiltN.y * out; pos[e * 3 + 2] = base.z + tiltUp.z * up + tiltN.z * out;
          const c = handCol[handOf(n)], fade = (1 - k) ** 1.6 * 1.6;
          col[e * 3] = (c.r * 0.6 + 0.4) * fade; col[e * 3 + 1] = (c.g * 0.7 + 0.2) * fade; col[e * 3 + 2] = c.b * 0.6 * fade;
          e++;
        }
      }
    }
    for (let j = e; j < EMBERS; j++) { pos[j * 3 + 1] = -999; }
    eg.attributes.position.needsUpdate = true; eg.attributes.color.needsUpdate = true;
    eg.setDrawRange(0, Math.max(1, e));
    if (hands) handDraw.update(hands.pose(t));
    const pd = pedalAt(t) ? 1 : 0;
    wallU.uPedal.value += (pd - wallU.uPedal.value) * 0.5;
    wallU.uEnergy.value = energy;
    seamMat.color.set(style.seam).multiplyScalar(1.6 + 1.4 * Math.min(1, energy) + 0.6 * pd);
    return { energy };
  }

  function dispose() {
    scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
    [keyLight, handSun].forEach((l) => l && l.dispose());   // (their shadow maps)
  }
  // where a key meets the line the notes come down to (world), for the light between the sheet and the keys
  const keyPoint = (pitch, out = new THREE.Vector3()) => out.set(KX[pitch], base.y + 0.15, base.z + 0.2);
  // the keyboard's top edge in the picture (the back edge of the strip of case behind the keys: nothing of the keyboard
  // stands higher), world; and the camera as it stands at time t, placed without drawing (for fitting the music above
  // the keys; the next render places its own camera again)
  const topEdge = (out = new THREE.Vector3()) => out.set(cx, Y0 - 0.05, PLANE_Z - 0.37);
  const place = (t, camera) => { const keep = camT; camT = t; placeCamera(camera); camT = keep; return camera; };
  // a different paper under "Sheet music + hands": the floor takes its colour
  const setFloor = (hex) => { if (floorMat) floorMat.color.copy(floorColor(hex)); };
  // the dark sleeves over the forearms (skin and porcelain hands), on unless opts.sleeves is false
  const setSleeves = (on) => { HANDMESH.HAND_FX?.setSleeves?.(on !== false); };
  setSleeves(opts.sleeves);
  return { scene, render, dispose, camDbg, poolAt, backdrop: backU, bloom: [0.55, 0.5, 0.85], setHandLook: (id) => { handLook = id; if (handDraw) { handDraw.setLook(id); tuneHands(); } if (handSun) handSun.shadow.intensity = id === 'glass' ? 0.35 : 1; }, setSleeves, keyPoint, topEdge, place, setFloor, handOf, list, hands, played: (n) => (hands ? hands.played.get(n) || null : { on: n.onset, off: n.onset + n.dur }) };
}
