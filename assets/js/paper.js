// "Paper": the written music lies on a long sheet of soft lavender-slate paper, printed in blue-black ink, and the
// camera glides along it like a dolly on rails, looking diagonally down the music. The title, clefs, brace and signs
// stand a little above the paper on short silver pins, black lacquer with a thin chrome rim. One soft light travels
// with the camera, so the paper is brightest just below the picture and sinks into darkness toward the top.
// One small ball of light per hand (right pink, left ice-cyan) hops from note to note; each note lights up white-hot
// the instant its ball touches it and stays lit. The balls show in the semi-gloss paper as soft streaks and on the
// glossy ink as small spots; at the end the camera cranes up, the balls fly away and the picture fades to black.
// Everything is a pure function of the music time t, so a video export draws exactly what playback shows.
//
// Played live (no piece, or someone playing over a paused piece), the camera glides along endless systems of a grand
// staff and each note appears, lit, where it is played. The hands' colours come in a few calm pairs (HAND_PAIRS); the
// tall (phone) picture has its own camera (CAM.tall); "Gentle camera movement" off keeps the camera's height and heading.
//
// Layout: proportional to time (see engrave() in sheet.js, option linear): x = start + speed * (t - t0), one speed per
// piece, so the camera glides at a constant speed and the place being played stays at a fixed spot in the picture.
//
// Units: one world unit = one staff space (ss). The page lies in the x / -z plane (page x = world x, page y = world
// -z, its top away from the viewer), y is up. The bass staff's bottom line is page y 0, the treble staff's is TB.
//
// Built from: engrave() (sheet.js) for the notation, glyphs.js for real letter and music-symbol outlines (Libre
// Baskerville, Bravura), extruded once per symbol and drawn as instances. Thin lines (staff lines, stems, ledger and
// bar lines) are flat ribbons drawn by a small shader that never lets them get thinner than about one pixel on screen
// (it fades them instead), so they do not shimmer as they glide past at a grazing angle.
import * as THREE from '../vendor/three.min.js?v=7';
import { engrave } from './sheet.js?v=7';
import { SIG, speller } from './score.js?v=19';
import { musicShapes, textShapes, extrude } from './glyphs.js?v=1';

const TB = 11;                                   // page y of the treble staff's bottom line (the bass staff's is 0)
const MID = [TB + 2, 2], TOP = [TB + 4, 4], BOTTOM = [TB, 0];
const DEG = Math.PI / 180;
const NONE = [];
const CHUNK = 96;                                // the printed music is cut into pieces this long (ss), so the graphics card skips what is out of view
const NEAR = 2, FAR = 700;                       // camera clipping range (ss): the camera never comes nearer than ~20 ss to the paper

// ---- the look, as measured from the reference (sRGB unless marked) ----
const PAL = {
  ink: '#090a13',           // blue-black ink, near and far alike
  face: '#07070a',          // the lacquered black faces of the raised pieces
  chrome: '#b4b4ba',        // their rims and the pins
  fleck: '#7a7a82',         // the rims of the small signs in the music (accidentals)
  hueK: 0.867,              // paper hue 232 deg: green sits at this fraction between blue (max) and red (min)
  satNear: 0.20, satFar: 0.29,
};
// The two hands' light, right hand (pink) first, as measured: the clipped core of a lit note (linear, above 1 clips to
// white; the one channel below 1 gives the faint tint, #ffeaff / #eefdff), the tint just outside it (#ffbbcd / #d0ffe3)
// and the saturated outer halo (#ff3d79 rose / #1bffc3 aqua); the ball's core, rim (#d8b3ce / #a9c7d4) and halo; and
// the colour of its reflection in the paper. Tints are sRGB; buildPaper turns them into linear colours (the rim and halo
// scaled to the same brightness for both hands).
const HANDS = [
  { core: [1.7, 0.8, 1.6], rim: '#ffbbcd', halo: '#ff3d79', ball: [1.3, 0.85, 1.3], ballRim: '#e2b4d6', ballHalo: '#ff5c9a', refl: '#ff8fc4' },
  { core: [0.8, 1.05, 1.35], rim: '#d0ffe3', halo: '#1bffc3', ball: [0.85, 1.25, 1.3], ballRim: '#a9d9e8', ballHalo: '#38e8ff', refl: '#7fe8ff' },
];
// Calm pairs of colours for the two hands, offered under Look (right hand first; the first pair is the measured one).
// Each hand is described as in HANDS, so every pair keeps the same brightness and the same white-hot cores; chips =
// the two colours shown on its button.
export const HAND_PAIRS = [
  { id: 'rose', name: 'Rose and ice', chips: ['#ff7fb4', '#7fe8ff'], hands: HANDS },
  { id: 'gold', name: 'Gold and sky', chips: ['#ffc65a', '#8fb8ff'], hands: [
    { core: [1.7, 1.3, 0.72], rim: '#ffe2b0', halo: '#ffb21f', ball: [1.35, 1.1, 0.75], ballRim: '#e6cf9e', ballHalo: '#ffb43a', refl: '#ffcf7a' },
    { core: [0.8, 0.95, 1.6], rim: '#cfe2ff', halo: '#3d8bff', ball: [0.85, 1.0, 1.35], ballRim: '#a9bfe8', ballHalo: '#5a9cff', refl: '#8fb8ff' }] },
  { id: 'lilac', name: 'Lilac and mint', chips: ['#c49bff', '#7dffc0'], hands: [
    { core: [1.45, 0.9, 1.7], rim: '#e3c8ff', halo: '#a35bff', ball: [1.2, 0.95, 1.35], ballRim: '#cbb4e6', ballHalo: '#b27bff', refl: '#c9a3ff' },
    { core: [0.85, 1.6, 0.92], rim: '#c8ffe0', halo: '#2dff9a', ball: [0.9, 1.3, 1.0], ballRim: '#a9e6c4', ballHalo: '#3dffaa', refl: '#8fffc8' }] },
  { id: 'pearl', name: 'Pearl and amber', chips: ['#fff0dc', '#ffae5c'], hands: [
    { core: [1.7, 1.5, 0.92], rim: '#fff1dc', halo: '#ffd9a8', ball: [1.4, 1.3, 1.1], ballRim: '#e8dcc8', ballHalo: '#ffe0b8', refl: '#fff0d8' },
    { core: [1.7, 0.92, 0.62], rim: '#ffd2a0', halo: '#ff8a1f', ball: [1.35, 1.0, 0.7], ballRim: '#e6c29a', ballHalo: '#ff9a3d', refl: '#ffbe7a' }] },
];
// The halo around a lit note, as excess light (linear) at distance d (ss) outside the lit shape: three exponentials,
// k * exp(-d / w), fitted to the measured radial profile (half maximum ~0.2 ss out, 10% at 1.1-1.25 ss from the centre,
// a faint tail to 2 ss). grow: the clipped core reaches this far beyond the ink. tint: ss over which the colour goes
// from the pale rim to the saturated halo. R: half the size of the square each halo is drawn in; win: where it fades out.
// bloom: the stage's bloom pass for this look (strength, radius, threshold: only the white-hot cores and balls), using
// only its smallest blurs (bloomMips), a spread of a few pixels on screen that widens the glow a little across the
// staff, as the camera's own glow does in the reference (half maximum 1.61 x 1.55 ss, clipped core 1.37 x 1.18 ss).
const GLOW = { k: [0.8, 0.12, 0.02], w: [0.09, 0.3, 1.0], rimLum: 0.8, haloLum: 0.5, grow: 0.08, tint: 0.28, R: 2.4, win: [1.45, 2.35], texels: 128, bloom: [0.6, 0, 0.9], bloomMips: [1, 0.4, 0.1, 0, 0] };
// The balls: radius (with the bloom, the clipped core is 0.40 ss across, as measured), centre height at contact, hop
// rise k * T^p (capped at hMax). Entry: inT seconds before its first note it comes in at the left edge of the picture,
// inH ss high, and glides straight to the note at a constant speed, sinking fast at first and gently at the end
// (height ~ (1 - inA) u^inP + inA u, u = time left / inT: still sinking a little when it touches). After its hand's
// last note it rises to `hover` ss and keeps its place in the picture; when the camera cranes up it flies away from
// the camera (away ss/s, easing in over awayT s) and a little upward (rise ss/s).
const BALL = { r: 0.17, z0: 0.3, k: 1.25, p: 0.7, hMax: 4.5, inH: 6.5, inT: 1.6, inP: 1.7, inA: 0.2, hover: 1.3, hoverT: 0.45, away: 26, awayT: 0.35, rise: 1.0 };
// The semi-gloss paper and glossy ink mirror the balls: gloss = the spread of the reflection (radians of the half
// vector; broad, so a ball 1 ss up leaves a soft streak ~2-3 ss long), k = how bright it is (the ball is a light: its
// reflection peaks ~+40% over the paper at 1 ss up), narrow = how much narrower it is sideways (a vertical streak);
// diffuse = how much the ball's own light tints the paper around it; ink* and line* = the sharper spots on glossy ink
// (noteheads, beams, lacquer) and the glints along the thin lines. The shadow (from the key light) shows only when the
// ball is high: strength, the heights over which it appears, its radius at the paper and how it grows with height.
const REFL = { gloss: 0.25, k: 4.6, narrow: 0.7, diffuse: 0.006, inkGloss: 0.02, inkK: 0.9, lineGloss: 0.05, lineK: 1.6 };
const SHADOW = { strength: 0.34, from: 1.2, to: 3.5, r0: 0.27, rk: 0.025 };
// The light pool travels with the camera: brightness falls off exponentially with slant distance D from the camera,
// V = vNear * exp(-(D - Dnear) / (LAM * h)), where Dnear is the distance to the bottom-centre of the picture and h the
// camera height. That keeps near:far at about 4x and halves the brightness about a quarter of the way down from the
// top, at any height, and the near paper dims as the camera rises (vNear ~ 1/h, then a soft cap: near paper luma ~122
// at h 20 and ~100 at h 27, #757892 at its brightest), as in the reference.
const LIGHT = { vNear: 0.67, h0: 22, hExp: 1.0, lam: 1.5, cap: 0.66, elev: 51, off: 5, key: 2.2, edge: 1.4 };
const LAYOUT = { minSpeed: 13.5, maxSpeed: 32, minGap: 2.6 };
// Camera: a fixed lens, fixed tilt, no roll and no shake. It runs alongside the music at the layout speed, with its
// height and heading drifting slowly (cosines over about two minutes; the heading changes by at most ~0.35 deg/s).
// at = where the current left-hand (bass) note sits in the picture, as fractions of width and height from the top left;
// live = how far (ss) ahead of that place notes played live appear (nothing is coming, so more of what was played shows).
export const CAM = {
  wide: { fov: 22.9, tilt: 26.5, yaw: 52, yawAmp: 6, yawPeriod: 110, h: 24, hAmp: 3.8, hPeriod: 130, rise: 4, at: [0.57, 0.53], y: MID[1], live: 6 },
  // Tall (phone, 9:16): the narrow picture cannot show the two staves side by side across it, so the camera looks
  // more along the music (the staves climb steeply toward the top right, with more of what is coming in view) from a
  // little further back with a wider lens; the right hand plays at about (0.31 W, 0.40 H), the left at (0.70, 0.46).
  tall: { fov: 38, tilt: 33, yaw: 30, yawAmp: 3, yawPeriod: 110, h: 31, hAmp: 2.5, hPeriod: 130, rise: 4, at: [0.70, 0.46], y: MID[1], live: 2 },
};
// "Gentle camera movement" switched off: the same lens and place, without the slow drift of height and heading.
const still = (c) => ({ ...c, yawAmp: 0, hAmp: 0 });
// Live playing (no piece, or someone playing over a paused piece): the camera glides at the slowest layout speed
// along endless systems of a grand staff, each `system` seconds long with a brace and clefs at its start and `gap` ss
// of blank paper after its closing bar line; notes appear where they are played (the place the bass ball usually
// is), lit at once, and stay lit. Notes struck within `chord` s on one staff stand together as a chord; notes more
// than `behind` ss behind the camera's place are out of the picture and not drawn. `period`: the page is re-centred
// every so many seconds (a whole number of systems), so its numbers stay small however long the studio is open.
const LIVE = { system: 30, gap: 6, chord: 0.06, behind: 90, period: 300, heads: 256, ledgers: 512, signs: 96, pins: 288 };
// The ending. Over the last `over` s the camera slows a little and rises, falling `lag` ss behind the music by the
// final note (so the last chord sits a little right of the usual place, whatever the speed); after the final note its
// glide dies away (time constant `settle` s). It cranes straight up (12 ss/s, easing in) at tc, timed so that the
// picture has faded out when the final notes stop sounding (`out` s after tc), but no sooner than wait[0] and no later
// than wait[1] s after the final note. The picture fades (`fade`, s after tc), the balls last (`ballFade`); all within
// the 2.5 s the app plays after the end of the piece.
const ENDING = { lag: 7, over: 10, crane: 12, settle: 1, wait: [0.15, 3], out: 1.75, fade: [0.75, 1.55], ballFade: [0.95, 1.75] };
// Opening: `at` seconds before the first note (when playback starts) the camera looks at the start of the system, the
// bass end of the brace near the bass anchor, `margin` ss before it; the lead fades from `before` s before the first
// note to `after` s after it.
const OPENING = { at: 1.5, margin: 1, before: 4, after: 5 };

// ---- sizes of the printing (ss) ----
const INK = { depth: 0.03, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2, curveSegments: 6 }; // 0.11 high, flush-looking
const RAISED = { depth: 0.09, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 2, curveSegments: 8, lift: 0.35, pin: 0.055 };
const TITLE = { cap: 12, maxW: 110, minScale: 0.45, rowScale: 0.7, depth: 0.46, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, curveSegments: 10, lift: 0.8, pin: 0.14, gap: 8.5, x: 6 };
// The semi-gloss paper mirrors the raised title and its pins softly: a dim copy below the paper, added to the paper's
// colour and fading quickly with depth (k = strength, fall = ss over which it dims to 1/e, cap = the brightest it may
// be, linear: a soft reflection never sparkles, even where a chrome facet catches the key light for a moment).
const MIRROR = { k: 0.25, fall: 0.45, cap: 0.045 };
const LINE = { staff: 0.1, stem: 0.11, ledger: 0.13, bar: 0.14, system: 0.16, lift: 0.004 };
const HEAD_W = 1.18, STEM_DX = 0.53, STEM_DY = 0.168; // Bravura notehead width; stem centre and start relative to the head centre

// ---- shaders ----
const PAPER_VERT = `
varying vec3 vW; varying vec4 vClip;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vClip = projectionMatrix * viewMatrix * w; gl_Position = vClip; }`;
const PAPER_FRAG = `
uniform vec3 uCam; uniform float uVn, uDn, uLam, uCap, uSatNear, uSatFar, uHueK, uFade;
// The balls: uBall = (x, height, z, radius; 0 = none), uBallColor = the colour they cast; uShadow = (x, z, radius,
// strength) of each ball's shadow; uRefl = (brightness, gloss in radians, diffuse light, sideways narrowing).
uniform vec4 uBall[2], uShadow[2], uRefl; uniform vec3 uBallColor[2];
varying vec3 vW; varying vec4 vClip;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); } // fixed dither against banding
void main() {
  float D = distance(vW, uCam);
  float v = uVn * exp(-(D - uDn) / uLam);
  vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;                     // place in the picture, 0..1 from the bottom left
  float cx = mix(0.38, 0.5, uv.y), dx = uv.x - cx;
  v *= 1.0 - mix(dx < 0.0 ? 0.1 : 0.34, 0.45, uv.y) * dx * dx;    // slight vignette, as measured
  v = v / pow(1.0 + pow(v / uCap, 4.0), 0.25);                  // never brighter than about 130/255
  for (int i = 0; i < 2; i++) {                                  // the balls' soft shadows (only when they fly high)
    vec4 sh = uShadow[i];
    if (sh.w > 0.0) { vec2 q = (vW.xz - sh.xy) / sh.z; v *= 1.0 - sh.w * exp(-dot(q, q)); }
  }
  float s = mix(uSatFar, uSatNear, smoothstep(0.15, 0.55, v));
  vec3 c = v * vec3(1.0 - s, 1.0 - s * uHueK, 1.0);              // lavender slate, hue ~232 deg
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  vec3 col = toLinear(max(c, 0.0));
  // Semi-gloss: each ball shows as a soft streak of its colour on the paper, below it and toward the camera. The
  // reflection is a blurred mirror image: a lobe around the mirrored view ray, narrower sideways by the cosine of the
  // incidence angle (which is what stretches it into a streak), widened by the ball's own size as seen from here.
  vec3 V = normalize(vW - uCam), R = vec3(V.x, -V.y, V.z);
  vec3 side = normalize(vec3(-V.z, 0.0, V.x)), up = cross(R, side);
  float ci = max(-V.y, 0.12), se = 2.0 * uRefl.y, ss = se * ci * uRefl.w;
  for (int i = 0; i < 2; i++) {
    vec4 b = uBall[i];
    if (b.w <= 0.0) continue;
    vec3 d = b.xyz - vW;
    float L2 = dot(d, d), L = sqrt(L2), a2 = 0.25 * b.w * b.w / L2;
    vec3 dd = d / L - R;
    float de = dot(dd, up), ds = dot(dd, side), ve = se * se + a2, vs = ss * ss + a2;
    float refl = a2 / sqrt(ve * vs) * exp(-0.5 * (de * de / ve + ds * ds / vs));
    float lit = (b.y + 0.3) / pow(L2 + 0.09, 1.5);               // and a little of its light falls on the paper around it
    col += uBallColor[i] * (uRefl.x * refl + uRefl.z * lit);
  }
  gl_FragColor = vec4(col * uFade, 1.0);
}`;
// Thin lines: each is a flat ribbon on the paper. On screen it is widened to at least uMinPx (drawing pixels) across,
// and made fainter by the same factor, so its coverage stays right while it can never break up into dashes. The ribbon
// is drawn one pixel wider on each side and its edges are shaded by how much of each pixel the line covers (vAcross =
// pixels from its middle, vHalf = its half width), which keeps a thin line at a shallow angle smooth instead of
// beaded, even when the picture is drawn at one pixel per screen pixel.
const LINE_VERT = `
attribute vec3 aOff; attribute vec3 aDir; attribute float aSide;
uniform vec2 uRes; uniform float uMinPx;
varying float vAlpha, vAcross, vHalf; varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 c0 = pv * w, c1 = pv * (w + vec4(aOff, 0.0)), c2 = pv * (w + vec4(aDir, 0.0));
  vec2 p0 = c0.xy / c0.w * uRes * 0.5, p1 = c1.xy / c1.w * uRes * 0.5, p2 = c2.xy / c2.w * uRes * 0.5;
  vec2 along = normalize(p2 - p0 + vec2(1e-6)), off = p1 - p0;
  float hw = abs(off.x * along.y - off.y * along.x);            // half the width across the line, in pixels
  float k = max(1.0, 0.5 * uMinPx / max(hw, 1e-3));
  vAlpha = 1.0 / k;
  vHalf = hw * k; vAcross = aSide * (vHalf + 1.0);
  w.xyz += aOff * aSide * (vHalf + 1.0) / max(hw, 1e-3);
  vW = w.xyz;
  gl_Position = pv * w;
}`;
// The glossy ink of a line catches a small coloured glint of a ball passing over it (the paper's mirror lobe, sharper:
// uGlint = brightness, gloss in radians; uBall and uBallColor are the paper's).
const LINE_FRAG = `
uniform vec3 uColor, uCam; uniform float uFar0, uFar1, uFarFade, uOpacity; uniform vec4 uBall[2]; uniform vec3 uBallColor[2]; uniform vec2 uGlint;
varying float vAlpha, vAcross, vHalf; varying vec3 vW;
void main() {
  float a = vAlpha * clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * uOpacity * (1.0 - uFarFade * smoothstep(uFar0, uFar1, distance(vW, uCam)));
  vec3 V = normalize(vW - uCam), R = vec3(V.x, -V.y, V.z), col = uColor;
  for (int i = 0; i < 2; i++) {
    vec4 b = uBall[i];
    if (b.w <= 0.0) continue;
    vec3 d = b.xyz - vW; float L2 = dot(d, d), a2 = 0.25 * b.w * b.w / L2, v = 4.0 * uGlint.y * uGlint.y + a2;
    col += uBallColor[i] * uGlint.x * (a2 / v) * exp(-(1.0 - dot(d * inversesqrt(L2), R)) / v);
  }
  gl_FragColor = vec4(col, a);
}`;
// The glow around a lit note: a square lying on the paper around each notehead, drawn (adding light) only once the
// note has been played. aHead = (x, page y, time it lights, kind + 3 * hand); kind 0 solid, 1 half, 2 whole picks a
// cell of uSdf, the signed distance (ss) from the notehead's outline (negative inside). The lit notehead itself is
// the ink head drawn white (see headMaterial); this adds the halo around it, and the light in a hollow head's slot.
const HALO_VERT = `
attribute vec4 aHead; uniform float uTime, uR, uLift;
varying vec2 vLocal; varying float vCell, vHand;
void main() {
  if (aHead.z > uTime) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); vCell = 0.0; vHand = 0.0; return; } // not played yet
  vHand = floor(aHead.w / 3.0 + 0.01); vCell = aHead.w - 3.0 * vHand;
  vLocal = position.xy * uR;
  gl_Position = projectionMatrix * viewMatrix * vec4(aHead.x + vLocal.x, uLift, -(aHead.y + vLocal.y), 1.0);
}`;
const HALO_FRAG = `
uniform sampler2D uSdf; uniform float uR, uGrow, uTintD, uFade; uniform vec3 uK, uW, uRim[2], uHalo[2]; uniform vec2 uWin;
varying vec2 vLocal; varying float vCell, vHand;
void main() {
  vec2 uv = vec2((vLocal.x / (2.0 * uR) + 0.5 + vCell) / 3.0, vLocal.y / (2.0 * uR) + 0.5);
  float d = max(texture2D(uSdf, uv).r - uGrow, 0.0);
  float e = dot(uK, exp(-d / uW)) * (1.0 - smoothstep(uWin.x, uWin.y, length(vLocal)));
  vec3 tint = vHand < 0.5 ? mix(uRim[0], uHalo[0], smoothstep(0.0, uTintD, d)) : mix(uRim[1], uHalo[1], smoothstep(0.0, uTintD, d));
  gl_FragColor = vec4(tint * e * uFade, 1.0);
}`;
// A ball: a small square that always faces the camera. Inside the radius a white-hot core whose edge takes the hand's
// colour; outside, a tinted halo about one radius wide. q = distance from the centre in ball radii.
const BALL_VERT = `
uniform float uSize; varying vec2 vQ;
void main() { vQ = position.xy; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`;
const BALL_FRAG = `
uniform vec3 uCore, uRim, uHalo; uniform float uQ, uAlpha; varying vec2 vQ;
void main() {
  float q = length(vQ) * uQ, aa = max(fwidth(q), 1e-4);
  float core = 1.0 - smoothstep(0.8 - aa, 1.0 + aa, q);
  float rim = exp(-pow((q - 1.0) / 0.2, 2.0));
  float halo = exp(-max(q - 1.0, 0.0) / 0.3) * (1.0 - smoothstep(1.4, 2.2, q));
  vec3 col = uCore * core + (1.0 - core) * (uRim * rim + uHalo * halo);
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;
// Glossy black (ink, lacquer) mirrors the balls as small sharp spots: added to MeshStandardMaterial shaders. uSpot =
// the balls in view space (xyz, radius; 0 = none), uSpotColor their colour, uSpotK = (brightness, gloss in radians).
const SPOT_DECL = 'uniform vec4 uSpot[2]; uniform vec3 uSpotColor[2]; uniform vec2 uSpotK;\n';
const SPOT_CODE = `
  { vec3 P = -vViewPosition, Rd = reflect(normalize(P), normalize(normal));
    for (int i = 0; i < 2; i++) {
      vec4 b = uSpot[i];
      if (b.w <= 0.0) continue;
      vec3 d = b.xyz - P; float L = length(d), a2 = 0.25 * b.w * b.w / (L * L), v = 4.0 * uSpotK.y * uSpotK.y + a2;
      float th2 = 2.0 * (1.0 - dot(Rd, d / L));
      gl_FragColor.rgb += uSpotColor[i] * uSpotK.x * (a2 / v) * exp(-0.5 * th2 / v);
    } }`;
// The surroundings the lacquer and chrome reflect: the lit paper below, darkness above, and the soft key light behind
// and above the camera (baked once, for the camera's average heading).
const ENV_FRAG = `
uniform vec3 uKey; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = d.y < 0.0 ? vec3(0.17, 0.175, 0.25) * (0.35 + 0.65 * smoothstep(-0.12, -0.9, d.y)) * smoothstep(0.0, -0.06, d.y) : vec3(0.004, 0.004, 0.006);
  float k = max(dot(d, uKey), 0.0);
  col += vec3(1.0) * (1.1 * pow(k, 60.0) + 0.2 * pow(k, 6.0));
  // a soft band of light along the horizon, strongest behind the camera, and two dim side lights: the streaks and
  // sparkle along the chrome walls and edges
  vec3 back = normalize(vec3(uKey.x, 0.0, uKey.z));
  float b = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), back), 0.0);
  col += vec3(0.6) * (0.25 + 0.75 * pow(b, 3.0)) * exp(-pow((d.y - 0.08) / 0.08, 2.0));
  col += vec3(0.5) * exp(-pow(length(d - normalize(vec3(-back.z, 0.5, back.x))) / 0.25, 2.0));
  col += vec3(0.5) * exp(-pow(length(d - normalize(vec3(back.z, 0.5, -back.x))) / 0.25, 2.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const ENVS = new WeakMap();
function paperEnv(renderer) {
  if (!renderer) return null;
  if (ENVS.has(renderer)) return ENVS.get(renderer);
  const az = (CAM.wide.yaw + LIGHT.off) * DEG, el = LIGHT.elev * DEG;
  const key = new THREE.Vector3(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  const scene = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 64, 32);
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uKey: { value: key } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: ENV_FRAG });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(scene, 0).texture;
  pm.dispose(); geo.dispose(); mat.dispose();
  ENVS.set(renderer, tex);
  return tex;
}

// The signed distance (ss, negative inside) from the outline of each notehead kind, side by side in one texture (one
// square cell per kind, GLOW.R ss either side of the head's centre). Worked out once per page: the outlines never change.
let SDF = null;
function headSdf(list) { // list = [[glyph name, half its width], ...]
  if (SDF) return SDF;
  const N = GLOW.texels, R = GLOW.R, W = N * list.length, data = new Uint16Array(W * N);
  list.forEach(([name, hw], cell) => {
    const seg = [];
    for (const s of musicShapes(name)) {
      const { shape, holes } = s.extractPoints(12);
      for (const p of [shape, ...holes]) for (let i = 0, j = p.length - 1; i < p.length; j = i++) seg.push(p[j].x - hw, p[j].y, p[i].x - hw, p[i].y);
    }
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const x = -R + ((ix + 0.5) * 2 * R) / N, y = -R + ((iy + 0.5) * 2 * R) / N;
      let m = Infinity, inside = false;
      for (let k = 0; k < seg.length; k += 4) {
        const ax = seg[k], ay = seg[k + 1], ex = seg[k + 2] - ax, ey = seg[k + 3] - ay;
        if ((ay > y) !== (ay + ey > y) && x < (ex * (y - ay)) / ey + ax) inside = !inside;
        const l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l)) : 0;
        const dx = x - ax - u * ex, dy = y - ay - u * ey, d2 = dx * dx + dy * dy;
        if (d2 < m) m = d2;
      }
      data[iy * W + cell * N + ix] = THREE.DataUtils.toHalfFloat(inside ? -Math.sqrt(m) : Math.sqrt(m));
    }
  });
  const tex = new THREE.DataTexture(data, W, N, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return (SDF = tex);
}

// A hand's colours (see HANDS), as linear colours ready for the shaders. A single CSS colour (css) may stand in for
// the description: its tint then makes the halo, a paler version the rim, and a near-white the cores.
function handLook(h, css) {
  const tint = (c) => { const v = new THREE.Color(c); const m = Math.max(v.r, v.g, v.b, 1e-6); return new THREE.Vector3(v.r / m, v.g / m, v.b / m); };
  if (css && typeof css === 'object') { h = css; css = null; } // a whole description, as in HANDS
  if (css) {
    const t = tint(css), sat = t.clone().set(t.x ** 2, t.y ** 2, t.z ** 2), w = new THREE.Vector3(1, 1, 1);
    sat.divideScalar(Math.max(sat.x, sat.y, sat.z));
    return { core: w.clone().lerp(t, 0.18).multiplyScalar(1.7).min(new THREE.Vector3(9, 9, 9)), rim: w.clone().lerp(t, 0.55), halo: sat,
      ball: w.clone().lerp(t, 0.2).multiplyScalar(2.6), ballRim: w.clone().lerp(t, 0.5).multiplyScalar(0.7), ballHalo: sat.clone(), refl: w.clone().lerp(t, 0.6) };
  }
  const lum = (v, L) => v.multiplyScalar(L / (0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z)); // the same brightness for both hands
  return { core: new THREE.Vector3(...h.core), rim: lum(tint(h.rim), GLOW.rimLum), halo: lum(tint(h.halo), GLOW.haloLum), ball: new THREE.Vector3(...h.ball),
    ballRim: tint(h.ballRim).multiplyScalar(0.55), ballHalo: lum(tint(h.ballHalo), 0.22), refl: tint(h.refl) };
}

// ---- small geometry helpers ----
const flat = (geo) => geo.rotateX(-Math.PI / 2); // a glyph's (x, y) onto the page: world (x, -y), its thickness up
function polyArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x - p[i].x) * (p[j].y + p[i].y); return Math.abs(a / 2); }
function inPoly(p, x, y) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }
function edgeDist(polys, x, y) {
  let m = Infinity;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j].x, ay = p[j].y, bx = p[i].x - ax, by = p[i].y - ay, l = bx * bx + by * by;
    const u = l ? Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / l)) : 0;
    m = Math.min(m, Math.hypot(x - ax - u * bx, y - ay - u * by));
  }
  return m;
}
// Where the standoff pins go under a raised glyph: well inside its outline, the first one as near the viewer (lowest
// page y) as possible so it shows, the others spread out; one pin per `per` square units of area, at most `max`.
function pinSpots(shapes, { step, margin, per, max }) {
  const out = [];
  for (const s of shapes) {
    const { shape: outer, holes } = s.extractPoints(6);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of outer) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const cands = [], polys = [outer, ...holes];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
      if (inPoly(outer, x, y) && !holes.some((h) => inPoly(h, x, y)) && edgeDist(polys, x, y) >= margin) cands.push([x, y]);
    }
    if (!cands.length) continue;
    const area = polyArea(outer) - holes.reduce((a, h) => a + polyArea(h), 0), n = Math.max(1, Math.min(max, Math.round(area / per)));
    const chosen = [cands.reduce((a, b) => (b[1] < a[1] - 1e-6 || (Math.abs(b[1] - a[1]) < 1e-6 && b[0] < a[0]) ? b : a))];
    while (chosen.length < n) {
      let best = null, bd = -1;
      for (const c of cands) { let d = Infinity; for (const q of chosen) d = Math.min(d, Math.hypot(q[0] - c[0], q[1] - c[1])); if (d > bd) { bd = d; best = c; } }
      if (bd < step * 2) break;
      chosen.push(best);
    }
    out.push(...chosen);
  }
  return out;
}

// Thin lines, merged: segs = [x0, y0, x1, y1, width] in page units. Each is cut into pieces at most 6 ss long so its
// on-screen width can be judged along its length.
function lineGeometry(segs) {
  let n = 0;
  for (const s of segs) n += Math.max(1, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / 6));
  const pos = new Float32Array(n * 12), off = new Float32Array(n * 12), dir = new Float32Array(n * 12), side = new Float32Array(n * 4), idx = new Uint32Array(n * 6);
  let k = 0;
  for (const [x0, y0, x1, y1, w] of segs) {
    const len = Math.hypot(x1 - x0, y1 - y0) || 1e-6, m = Math.max(1, Math.ceil(len / 6));
    const dx = (x1 - x0) / len, dy = (y1 - y0) / len; // page direction; world: (dx, 0, -dy); across it on the paper: (dy, 0, dx)
    for (let i = 0; i < m; i++) {
      const a = i / m, b = (i + 1) / m, ax = x0 + (x1 - x0) * a, ay = y0 + (y1 - y0) * a, bx = x0 + (x1 - x0) * b, by = y0 + (y1 - y0) * b;
      const v = k * 4;
      [[ax, ay, -1], [ax, ay, 1], [bx, by, -1], [bx, by, 1]].forEach(([px, py, s], j) => {
        pos.set([px, LINE.lift, -py], (v + j) * 3); off.set([dy * w / 2, 0, dx * w / 2], (v + j) * 3); dir.set([dx, 0, -dy], (v + j) * 3); side[v + j] = s;
      });
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
      k++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 1;
  return g;
}

const MUSIC_REST = { 4: 'restWhole', 2: 'restHalf', 1: 'restQuarter', 0.5: 'rest8th', 0.25: 'rest16th', 0.125: 'rest32nd' };
const ACC = { '♯': 'accidentalSharp', '♭': 'accidentalFlat', '♮': 'accidentalNatural', '𝄪': 'accidentalDoubleSharp', '𝄫': 'accidentalDoubleFlat' };
const FLAG = ['flag8th', 'flag16th', 'flag32nd'];
const ADV = { accidentalSharp: 0.996, accidentalFlat: 0.904, accidentalNatural: 0.672, accidentalDoubleSharp: 1, accidentalDoubleFlat: 1.652,
  restWhole: 1.132, restHalf: 1.132, restQuarter: 1.08, rest8th: 1, rest16th: 1.28, rest32nd: 1.452, noteheadWhole: 1.688 };

// buildPaper(T, tools, piece, opts) -> { scene, render(t, camera, opts), ... }
//   T      the colour theme (only its note colours are kept, for the hands)
//   tools  { renderer } (for the reflections the lacquer and chrome show; optional)
//   piece  the parsed piece, or null
//   opts   { title: text for the 3D title, glyphs: the object loadGlyphs() resolved to, or null while they load,
//            hands: the id of one of HAND_PAIRS, or two CSS colours (default: the measured rose and ice) }
// The hand colours can also be changed afterwards, without building again: result.setHands(same kind of value).
const pairLooks = (v) => {
  const pair = typeof v === 'string' ? HAND_PAIRS.find((p) => p.id === v) : null;
  return [0, 1].map((h) => handLook(HANDS[h], pair ? pair.hands[h] : Array.isArray(v) ? v[h] : null));
};
export function buildPaper(T, tools, piece, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const env = paperEnv(tools && tools.renderer);
  // the hands' colours: the measured pink and ice-cyan, unless opts.hands picks another pair
  const looks = pairLooks(opts.hands);
  const hands = looks.map((l) => new THREE.Color(l.halo.x, l.halo.y, l.halo.z));
  const glyphs = opts.glyphs || null;
  const startX = (sf) => 9.5 + Math.abs(sf) * 1.05; // after the clefs (0.9-3.7), the key signature and the time signature
  const S = piece && piece.notes.length ? engrave(piece, { linear: true, carry: true, rests: true, start: startX, ...LAYOUT }) : null;

  // ---- materials ----
  const ink = new THREE.MeshStandardMaterial({ color: PAL.ink, roughness: 0.3, metalness: 0, envMap: env, envMapIntensity: 1 });
  const face = new THREE.MeshStandardMaterial({ color: PAL.face, roughness: 0.1, metalness: 0, envMap: env, envMapIntensity: 1 });
  // Polished chrome: a sharp reflection of the surroundings (dark walls with bright streaks, a thin bright top rim);
  // the lamps' own glints on it are held to a fraction, so they never sparkle like stars.
  const softGlints = (m, k) => { m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n reflectedLight.directSpecular *= ${k.toFixed(3)};`); }; m.customProgramCacheKey = () => 'paper-chrome-' + k; return m; };
  const chrome = softGlints(new THREE.MeshStandardMaterial({ color: PAL.chrome, roughness: 0.16, metalness: 1, envMap: env, envMapIntensity: 1 }), 0.25);
  const fleck = softGlints(new THREE.MeshStandardMaterial({ color: PAL.fleck, roughness: 0.2, metalness: 1, envMap: env, envMapIntensity: 1 }), 0.25); // the small signs in the music: darker, only flecks of chrome
  // the balls' sharp mirror spots on the glossy ink and lacquer (positions in view space, set each frame)
  const spotU = { uSpot: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uSpotColor: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uSpotK: { value: new THREE.Vector2(REFL.inkK, REFL.inkGloss) } };
  // lit noteheads: the ink head, drawn in the hand's white-hot core colour from the moment it is played (aLitT = that
  // time, aHand = 0 right, 1 left; set per instance), so no work is needed per frame but setting the time
  const glowU = { uTime: { value: -1e9 }, uFade: { value: 1 }, uCore: { value: looks.map((l) => l.core) } };
  const withSpots = (m, key, lit = false) => {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, spotU);
      if (lit) {
        Object.assign(sh.uniforms, glowU);
        sh.vertexShader = 'attribute float aLitT; attribute float aHand; uniform float uTime; varying float vLit; varying float vHand;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLit = step(aLitT, uTime); vHand = aHand;');
      }
      sh.fragmentShader = SPOT_DECL + (lit ? 'uniform vec3 uCore[2]; uniform float uFade; varying float vLit; varying float vHand;\n' : '') +
        sh.fragmentShader.replace('#include <dithering_fragment>', SPOT_CODE + (lit ? '\n if (vLit > 0.5) gl_FragColor.rgb = (vHand < 0.5 ? uCore[0] : uCore[1]) * uFade;' : '') + '\n#include <dithering_fragment>');
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  const headMat = withSpots(ink.clone(), 'paper-head', true);
  withSpots(ink, 'paper-ink'); withSpots(face, 'paper-face');
  const raised = [face, chrome];
  const mirrorOf = (base) => { // drawn right after the paper (opaque pass, before everything else), adding light to it
    const m = base.clone();
    m.blending = THREE.AdditiveBlending; m.depthTest = false; m.depthWrite = false; m.roughness = Math.max(0.45, base.roughness);
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying float vMirY;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp = instanceMatrix * wp;\n#endif\n vMirY = (modelMatrix * wp).y; }');
      sh.fragmentShader = 'varying float vMirY;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.rgb = min(gl_FragColor.rgb * ${MIRROR.k.toFixed(3)} * exp(vMirY / ${MIRROR.fall.toFixed(3)}), vec3(${MIRROR.cap.toFixed(3)}));`);
    };
    m.customProgramCacheKey = () => 'paper-mirror';
    return m;
  };
  const mirrored = [mirrorOf(face), mirrorOf(chrome)];
  const paperU = { uCam: { value: new THREE.Vector3() }, uVn: { value: LIGHT.vNear }, uDn: { value: 40 }, uLam: { value: 38 }, uCap: { value: LIGHT.cap },
    uSatNear: { value: PAL.satNear }, uSatFar: { value: PAL.satFar }, uHueK: { value: PAL.hueK }, uFade: { value: 1 },
    uBall: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uBallColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uShadow: { value: [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0)] }, uRefl: { value: new THREE.Vector4(REFL.k, REFL.gloss, REFL.diffuse, REFL.narrow) } };
  const paperMat = new THREE.ShaderMaterial({ uniforms: paperU, vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const lineU = { uRes: { value: new THREE.Vector2(1280, 720) }, uMinPx: { value: 1.2 }, uColor: { value: new THREE.Color(PAL.ink) }, uCam: paperU.uCam,
    uFar0: { value: 70 }, uFar1: { value: 130 }, uFarFade: { value: 0.35 }, uOpacity: { value: 1 },
    uBall: paperU.uBall, uBallColor: paperU.uBallColor, uGlint: { value: new THREE.Vector2(REFL.lineK, REFL.lineGloss) } };
  const lineMat = new THREE.ShaderMaterial({ uniforms: lineU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });

  // ---- the paper: one large sheet that travels under the camera (its shading depends only on the camera) ----
  const paper = new THREE.Mesh(flat(new THREE.PlaneGeometry(1, 1)), paperMat);
  paper.scale.set(1600, 1, 1600); paper.frustumCulled = false; paper.renderOrder = -1;
  scene.add(paper);
  const key = new THREE.DirectionalLight('#ffffff', LIGHT.key);
  // The edge light: the view direction mirrored across the line of the staff, so the halfway vector always lies
  // across the staff and every near edge (of beams, heads, raised signs) catches one thin neutral highlight.
  const edge = new THREE.DirectionalLight('#ffffff', LIGHT.edge);
  scene.add(key, key.target, edge, edge.target);
  const ambient = new THREE.AmbientLight('#b8bcd8', 0.05);
  scene.add(ambient);

  // ---- the printed music ----
  const printed = new THREE.Group(); scene.add(printed);
  const heads = []; // one per notehead, for lighting them up: { kind, mesh, index, t, staff, x, y, chord }
  const geos = new Map(), kinds = new Map(), lines = [], slabs = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
  const cached = (k, make) => { if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
  // ink symbols: printed, nearly flush; raised symbols: on pins, black faces and chrome sides
  const inkGlyph = (name, dx = 0) => cached('i:' + name, () => flat(extrude(musicShapes(name), INK).translate(dx, 0, 0)));
  const raisedGlyph = (name, size = 1, sx = 1) => cached(`r:${name}:${size}:${sx}`, () => {
    const shapes = musicShapes(name, { size }), geo = flat(extrude(shapes, RAISED).scale(sx, 1, 1));
    geo.userData.pins = pinSpots(shapes, { step: 0.12 * size, margin: RAISED.pin + 0.05, per: 2.2 * size * size, max: 3 }).map(([x, y]) => [x * sx, y]);
    return geo;
  });
  const kind = (name, geo, mat, lift = 0, colors = false) => { if (!kinds.has(name)) kinds.set(name, { geo, mat, lift, colors, list: [] }); return kinds.get(name); };
  const put = (k, x, y, sx = 1, sy = 1, tag = null) => k.list.push([x, y, sx, sy, tag]);
  const line = (x0, y0, x1, y1, w) => lines.push([x0, y0, x1, y1, w]);
  const slab = (x0, y0, x1, y1, thick) => { // a beam or thick bar line: a parallelogram with vertical ends, raised like the ink
    const s = new THREE.Shape(), h = thick / 2 - INK.bevelSize;
    s.moveTo(x0, y0 - h); s.lineTo(x1, y1 - h); s.lineTo(x1, y1 + h); s.lineTo(x0, y0 + h); s.lineTo(x0, y0 - h);
    slabs.push([(x0 + x1) / 2, s]);
  };
  const raisedSmall = [face, fleck];
  const raisedPut = (name, x, y, size = 1, sx = 1, small = false) => {
    const geo = raisedGlyph(name, size, sx), k = kind(`r:${name}:${size}:${sx}:${small}`, geo, small ? raisedSmall : raised, RAISED.lift);
    put(k, x, y);
    const pk = kind('pin:small', null, chrome, 0);
    for (const [px, py] of geo.userData.pins) put(pk, x + px, y + py, RAISED.pin, RAISED.pin);
  };

  if (S && glyphs) {
    const { groups, level } = S;
    // the system: brace, system line, staff lines, clefs, key and time signature, tempo mark
    const left = 0, right = S.finalX;
    for (const b of [TB, 0]) for (let i = 0; i < 5; i++) line(left - LINE.system / 2, b + i, right, b + i, LINE.staff);
    line(left, -0.06, left, TOP[0] + 0.06, LINE.system);
    raisedPut('brace', -0.45 - 1.04 * 1.5, 0, 3.75, 1.5);
    raisedPut('gClef', 0.9, TB + 1); raisedPut('fClef', 0.9, 3);
    const sf = S.sf, ksX = 4.3;
    for (let i = 0; i < Math.abs(sf); i++) for (const staff of [0, 1]) {
      const step = SIG[sf < 0 ? 'flat' : 'sharp'][staff ? 'bass' : 'treble'][i], y = staff ? (step - 18) / 2 : TB + (step - 30) / 2;
      raisedPut(sf < 0 ? 'accidentalFlat' : 'accidentalSharp', ksX + i * 1.05, y);
    }
    const [num, den] = S.meter, tsX = ksX + Math.abs(sf) * 1.05 + 0.5;
    const digits = (n) => String(n).split('').map((d) => 'timeSig' + d), width = (ds) => ds.length * 1.75;
    const tsW = Math.max(width(digits(num)), width(digits(den)));
    for (const b of [TB, 0]) for (const [n, y] of [[num, b + 3], [den, b + 1]]) {
      const ds = digits(n);
      ds.forEach((g, i) => raisedPut(g, tsX + (tsW - width(ds)) / 2 + i * 1.75, y));
    }
    // the noteheads, stems, flags, dots, ledger lines and accidentals of each group of notes
    const stemX = (c, d) => c.x + d * STEM_DX;
    const dirOf = (cs) => {
      const v = cs[0].voice;
      if (v === 1) return 1;
      if (v === 2) return -1;
      const mid = MID[cs[0].staff], hi = Math.max(...cs.map((c) => c.heads[c.heads.length - 1].y)) - mid, lo = mid - Math.min(...cs.map((c) => c.heads[0].y));
      return hi > lo ? -1 : 1;
    };
    // the x of the moment before on the same staff, so an accidental can keep clear of that note
    const places = [0, 1].map((staff) => [...new Set(S.chords.filter((c) => c.staff === staff).map((c) => c.x))].sort((a, b) => a - b));
    const before = (c) => { const p = places[c.staff]; let lo = 0, hi = p.length; while (lo < hi) { const m = (lo + hi) >> 1; if (p[m] < c.x - 0.01) lo = m + 1; else hi = m; } return lo ? p[lo - 1] : null; };
    const drawHeads = (c, d) => {
      const order = d > 0 ? c.heads : [...c.heads].reverse();
      let prev = null;
      for (const h of order) { h.dx = prev && Math.abs(h.step - prev.step) === 1 && !prev.dx ? d * HEAD_W : 0; prev = h; } // a step apart: either side of the stem
      const name = c.v >= 4 ? 'whole' : c.v >= 2 ? 'half' : 'solid', dotted = [0.375, 0.75, 1.5, 3].includes(c.v);
      const glyph = name === 'whole' ? 'noteheadWhole' : name === 'half' ? 'noteheadHalf' : 'noteheadBlack', hw = (ADV[glyph] || HEAD_W) / 2;
      const k = kind('head:' + name, inkGlyph(glyph, -hw), headMat, 0, true);
      let accCol = 0, lastAccY = Infinity;
      const px = before(c);
      for (const h of [...c.heads].reverse()) {
        const hx = c.x + h.dx, tag = { kind: name, t: c.t, staff: c.staff, x: hx, y: h.y, chord: c, mesh: null, index: -1 };
        heads.push(tag); put(k, hx, h.y, 1, 1, tag);
        if (dotted) put(kind('dot', inkGlyph('augmentationDot', -0.2), ink), c.x + hw + 0.45 + Math.max(0, ...c.heads.map((q) => q.dx)), Number.isInteger(h.y) ? h.y + 0.5 : h.y);
        const ext = hw + 0.38;
        for (let ly = BOTTOM[c.staff] - 1; ly >= h.y - 0.01; ly--) line(hx - ext, ly, hx + ext, ly, LINE.ledger);
        for (let ly = TOP[c.staff] + 1; ly <= h.y + 0.01; ly++) line(hx - ext, ly, hx + ext, ly, LINE.ledger);
        if (h.acc && ACC[h.acc]) {
          accCol = lastAccY - h.y < 3 ? accCol + 1 : 0; lastAccY = h.y;
          const g = ACC[h.acc], w = ADV[g];
          let gap = 0.22, s = 1, ax = c.x + Math.min(0, h.dx) - hw - gap - w - accCol * 1.05;
          if (px != null && ax < px + HEAD_W / 2 + 0.12) { // too close to the note before: tuck it in, then make it a little smaller
            gap = 0.08; ax = c.x + Math.min(0, h.dx) - hw - gap - w - accCol * 1.05;
            if (ax < px + HEAD_W / 2 + 0.08) { s = 0.8; ax = c.x + Math.min(0, h.dx) - hw - gap - w * s - accCol * 0.9; }
          }
          raisedPut(g, ax, h.y, s, 1, true);
        }
      }
      return hw;
    };
    for (const g of groups) {
      const d = dirOf(g), lv = g.map((c) => level(c.v));
      g.forEach((c) => drawHeads(c, d));
      if (g[0].v >= 4) continue;
      const far = (c) => (d > 0 ? c.heads[0].y : c.heads[c.heads.length - 1].y), near = (c) => (d > 0 ? c.heads[c.heads.length - 1].y : c.heads[0].y);
      if (g.length === 1) {
        const c = g[0], extra = c.v < 1 ? (lv[0] - 1) * 0.5 : 0;
        let end = near(c) + d * (3.5 + extra);
        end = d > 0 ? Math.max(end, MID[c.staff]) : Math.min(end, MID[c.staff]);
        const sx = stemX(c, d);
        line(sx, far(c) + d * STEM_DY, sx, end, LINE.stem);
        if (c.v < 1) { const f = FLAG[Math.min(2, lv[0] - 1)] + (d > 0 ? 'Up' : 'Down'); put(kind('flag:' + f, inkGlyph(f), ink), sx - LINE.stem / 2, end); }
        continue;
      }
      const deep = Math.max(...lv), xs = g.map((c) => stemX(c, d)), f = g[0], l = g[g.length - 1];
      const y0 = near(f) + d * 3.5, y1 = near(l) + d * 3.5, slope = Math.max(-0.16, Math.min(0.16, ((y1 - y0) / (xs[xs.length - 1] - xs[0])) * 0.5));
      let base = y0;
      g.forEach((c, i) => { const need = near(c) + d * (3.0 + (deep - 1) * 0.75), at = base + slope * (xs[i] - xs[0]); if ((need - at) * d > 0) base += need - at; });
      const at = (x) => base + slope * (x - xs[0]);
      g.forEach((c, i) => line(xs[i], far(c) + d * STEM_DY, xs[i], at(xs[i]), LINE.stem));
      for (let L = 1; L <= deep; L++) {
        const off = -d * ((L - 1) * 0.75 + 0.25), seg = (xa, xb) => slab(xa, at(xa) + off, xb, at(xb) + off, 0.5);
        if (L === 1) { seg(xs[0] - LINE.stem / 2, xs[xs.length - 1] + LINE.stem / 2); continue; }
        for (let i = 0; i < g.length; i++) {
          if (lv[i] < L) continue;
          if (i + 1 < g.length && lv[i + 1] >= L) seg(xs[i], xs[i + 1]);
          else if (!(i > 0 && lv[i - 1] >= L)) seg(i + 1 < g.length ? xs[i] : xs[i] - 1.1, i + 1 < g.length ? xs[i] + 1.1 : xs[i]);
        }
      }
    }
    // rests: whole-bar rests hang from the fourth line, the others sit on the middle of the staff
    for (const r of S.rests) {
      const v = r.whole ? 4 : r.v, name = MUSIC_REST[v] || 'restQuarter', w = ADV[name] || 1;
      put(kind('rest:' + name, inkGlyph(name, -w / 2), ink), r.x, MID[r.staff] + (name === 'restWhole' ? 1 : 0));
    }
    // bar lines, through both staves; a thin and a thick line at the end
    for (const bx of S.barX) line(bx, -LINE.bar / 2, bx, TOP[0] + LINE.bar / 2, LINE.bar);
    line(S.finalX - 0.95, -0.07, S.finalX - 0.95, TOP[0] + 0.07, LINE.bar);
    { const s = new THREE.Shape(), x0 = S.finalX - 0.55 + INK.bevelSize, x1 = S.finalX - 0.05 - INK.bevelSize, y0 = INK.bevelSize - 0.07, y1 = TOP[0] + 0.07 - INK.bevelSize;
      s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0); slabs.push([S.finalX, s]); }
    // the tempo mark, printed flat above the first treble staff
    const bpm = piece.tempoMap && piece.tempoMap.length ? Math.round(piece.tempoMap[0].bpm) : 0;
    if (bpm) {
      const tm = textShapes(`♩ = ${bpm}`, { size: 2.5 });
      const m = new THREE.Mesh(flat(new THREE.ShapeGeometry(tm, 8)), ink);
      m.position.set(1.0, LINE.lift + 0.002, -(TOP[0] + 2.4)); printed.add(m);
    }
    // the title, raised on pins above the start of the music
    addTitle(String(opts.title || '').trim());
  }
  function addTitle(text) {
    if (!text) return;
    const em = TITLE.cap / (glyphs.text.capHeight || 0.77);
    let rows = [text], w = textShapes(text, { size: em }).width, scale = Math.min(1, TITLE.maxW / w);
    if (scale < TITLE.minScale && text.includes(' ')) { // too long for one line, even smaller: two lines, broken at the space nearest the middle
      let best = -1;
      for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2))) best = i;
      rows = [text.slice(0, best), text.slice(best + 1)];
      w = Math.max(...rows.map((r) => textShapes(r, { size: em }).width)); scale = Math.min(TITLE.rowScale, TITLE.maxW / w);
    }
    const size = em * Math.max(scale, 0.3), cap = TITLE.cap * Math.max(scale, 0.3);
    rows.forEach((row, i) => {
      const shapes = textShapes(row, { size, letterSpacing: 0.01 });
      const geo = flat(extrude(shapes, TITLE));
      const base = TOP[0] + TITLE.gap + (rows.length - 1 - i) * cap * 1.5, x = TITLE.x;
      const m = new THREE.Mesh(geo, raised); m.position.set(x, TITLE.lift, -base); printed.add(m);
      const r = new THREE.Mesh(geo, mirrored); r.position.set(x, -TITLE.lift, -base); r.scale.y = -1; r.renderOrder = -0.5; printed.add(r);
      const pk = kind('pin:title', null, chrome, 0);
      for (const [px, py] of pinSpots(shapes, { step: 0.35 * cap / TITLE.cap * 1.4, margin: TITLE.pin + 0.25, per: 14 * (cap / TITLE.cap) ** 2, max: 4 })) put(pk, x + px, base + py, TITLE.pin, TITLE.pin);
    });
  }

  // Everything collected above becomes instanced meshes, one per kind of symbol per piece of the music.
  const pinGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
  for (const [name, k] of kinds) {
    const byChunk = new Map();
    for (const it of k.list) { const c = Math.floor(it[0] / CHUNK); if (!byChunk.has(c)) byChunk.set(c, []); byChunk.get(c).push(it); }
    const isPin = name.startsWith('pin:'), lift = name === 'pin:title' ? TITLE.lift : RAISED.lift;
    for (const items of byChunk.values()) {
      let geo = isPin ? pinGeo : k.geo;
      if (k.colors) { // noteheads: the shape is shared, and each piece of the music adds when and in which hand each head lights
        const g = new THREE.BufferGeometry();
        g.setIndex(geo.index);
        for (const [n, a] of Object.entries(geo.attributes)) g.setAttribute(n, a);
        g.setAttribute('aLitT', new THREE.InstancedBufferAttribute(Float32Array.from(items, (it) => it[4].t), 1));
        g.setAttribute('aHand', new THREE.InstancedBufferAttribute(Float32Array.from(items, (it) => it[4].staff), 1));
        geo = g;
      }
      const m = new THREE.InstancedMesh(geo, k.mat, items.length);
      items.forEach(([x, y, sx, sy, tag], i) => {
        if (isPin) M.compose(V.set(x, 0, -y), Q.identity(), SC.set(sx, lift + 0.02, sy));
        else M.compose(V.set(x, k.lift, -y), Q.identity(), SC.set(sx, 1, sy));
        m.setMatrixAt(i, M);
        if (tag) { tag.mesh = m; tag.index = i; }
      });
      m.computeBoundingSphere();
      printed.add(m);
      if (name === 'pin:title') { // and their reflections
        const r = new THREE.InstancedMesh(pinGeo, mirrored[1], items.length);
        items.forEach(([x, y, sx, sy], i) => { M.compose(V.set(x, 0, -y), Q.identity(), SC.set(sx, -(lift + 0.02), sy)); r.setMatrixAt(i, M); });
        r.computeBoundingSphere(); r.renderOrder = -0.5; printed.add(r);
      }
    }
  }
  { // thin lines and beams, merged per piece of the music; long lines (the staff lines) are cut at the piece boundaries
    const pieces = [];
    for (const s of lines) {
      const [x0, y0, x1, y1, w] = s;
      if (x1 - x0 < CHUNK) { pieces.push(s); continue; }
      for (let a = x0; a < x1 - 1e-6;) {
        const b = Math.min(x1, (Math.floor(a / CHUNK) + 1) * CHUNK);
        pieces.push([a, y0 + ((y1 - y0) * (a - x0)) / (x1 - x0), b, y0 + ((y1 - y0) * (b - x0)) / (x1 - x0), w]);
        a = b;
      }
    }
    const byChunk = new Map();
    for (const s of pieces) { const c = Math.floor((s[0] + s[2]) / 2 / CHUNK); if (!byChunk.has(c)) byChunk.set(c, []); byChunk.get(c).push(s); }
    for (const segs of byChunk.values()) { const m = new THREE.Mesh(lineGeometry(segs), lineMat); m.renderOrder = 2; printed.add(m); }
    const slabChunks = new Map();
    for (const [x, s] of slabs) { const c = Math.floor(x / CHUNK); if (!slabChunks.has(c)) slabChunks.set(c, []); slabChunks.get(c).push(s); }
    for (const shapes of slabChunks.values()) { const g = flat(extrude(shapes, { ...INK, curveSegments: 1, smooth: 30 })); printed.add(new THREE.Mesh(g, ink)); }
  }

  // ---- the halos of the lit notes: one square per notehead, all in one draw; a note's square appears when it is played ----
  const KINDS = ['solid', 'half', 'whole'], HEAD_GLYPH = ['noteheadBlack', 'noteheadHalf', 'noteheadWhole'];
  const haloU = { uTime: glowU.uTime, uFade: glowU.uFade, uR: { value: GLOW.R }, uLift: { value: LINE.lift * 0.5 }, uGrow: { value: GLOW.grow }, uTintD: { value: GLOW.tint },
    uK: { value: new THREE.Vector3(...GLOW.k) }, uW: { value: new THREE.Vector3(...GLOW.w) }, uWin: { value: new THREE.Vector2(...GLOW.win) },
    uRim: { value: looks.map((l) => l.rim) }, uHalo: { value: looks.map((l) => l.halo) }, uSdf: { value: null } };
  const haloMat = new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const quad = new THREE.PlaneGeometry(2, 2);
  if (glyphs) haloU.uSdf.value = headSdf(HEAD_GLYPH.map((g) => [g, (ADV[g] || HEAD_W) / 2]));
  if (heads.length) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.index); g.setAttribute('position', quad.attributes.position);
    const a = new Float32Array(heads.length * 4);
    heads.forEach((h, i) => a.set([h.x, h.y, h.t, KINDS.indexOf(h.kind) + 3 * h.staff], i * 4));
    g.setAttribute('aHead', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = heads.length;
    const halos = new THREE.Mesh(g, haloMat);
    halos.frustumCulled = false; halos.renderOrder = 1; // over the paper, under the thin lines, so stems and ledger lines stay dark
    printed.add(halos);
  }

  // ---- live playing (no piece, or someone playing over a paused piece): endless systems, and the notes as played ----
  // Everything here is made once with room to spare; each frame only fills in the places and the counts.
  const liveGroup = new THREE.Group(); liveGroup.visible = false; scene.add(liveGroup);
  const SYS = LIVE.system * LAYOUT.minSpeed, sysEnd = SYS - LIVE.gap; // length of one system, and where its staff ends
  const sysLines = [];
  { const segs = [];
    for (const b of [TB, 0]) for (let i = 0; i < 5; i++) segs.push([-LINE.system / 2, b + i, sysEnd, b + i, LINE.staff]);
    segs.push([0, -0.06, 0, TOP[0] + 0.06, LINE.system], [sysEnd - LINE.bar / 2, -LINE.bar / 2, sysEnd - LINE.bar / 2, TOP[0] + LINE.bar / 2, LINE.bar]);
    const geo = lineGeometry(segs);
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(geo, lineMat); m.renderOrder = 2; m.frustumCulled = false; liveGroup.add(m); sysLines.push(m); }
  }
  // per system: the brace and the two clefs on their pins (as instances, one per system on view)
  const sysGlyphs = [], sysPins = [];
  let sysPinMesh = null, sysK = NaN;
  // the notes: lit heads, their halos, ledger lines, and raised sharps and flats on pins
  const LG = { heads: null, aHand: null, halos: null, aHead: null, ledgers: null, signs: new Map(), pins: null, spell: [] };
  if (glyphs) {
    for (const [name, dx, y, size, sx] of [['brace', -0.45 - 1.04 * 1.5, 0, 3.75, 1.5], ['gClef', 0.9, TB + 1, 1, 1], ['fClef', 0.9, 3, 1, 1]]) {
      const geo = raisedGlyph(name, size, sx), m = new THREE.InstancedMesh(geo, raised, 3);
      m.frustumCulled = false; liveGroup.add(m); sysGlyphs.push([m, dx, y]);
      for (const [px, py] of geo.userData.pins) sysPins.push([dx + px, y + py]);
    }
    sysPinMesh = new THREE.InstancedMesh(pinGeo, chrome, 3 * sysPins.length); sysPinMesh.frustumCulled = false; liveGroup.add(sysPinMesh);
    const N = LIVE.heads, hw = HEAD_W / 2, head = inkGlyph('noteheadBlack', -hw), g = new THREE.BufferGeometry();
    g.setIndex(head.index);
    for (const [n, a] of Object.entries(head.attributes)) g.setAttribute(n, a);
    g.setAttribute('aLitT', new THREE.InstancedBufferAttribute(new Float32Array(N).fill(-1e10), 1)); // lit from the start
    g.setAttribute('aHand', LG.aHand = new THREE.InstancedBufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    LG.heads = new THREE.InstancedMesh(g, headMat, N); LG.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const hg = new THREE.InstancedBufferGeometry();
    hg.setIndex(quad.index); hg.setAttribute('position', quad.attributes.position);
    hg.setAttribute('aHead', LG.aHead = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
    LG.halos = new THREE.Mesh(hg, haloMat); LG.halos.renderOrder = 1;
    LG.ledgers = lineGeometry(Array.from({ length: LIVE.ledgers }, () => [0, 0, 1, 0, LINE.ledger])); // (each one piece: shorter than 6 ss)
    for (const k of ['position', 'aOff', 'aDir']) LG.ledgers.attributes[k].setUsage(THREE.DynamicDrawUsage);
    const lm = new THREE.Mesh(LG.ledgers, lineMat); lm.renderOrder = 2;
    for (const sign of ['accidentalSharp', 'accidentalFlat']) {
      const m = new THREE.InstancedMesh(raisedGlyph(sign, 1, 1), raisedSmall, LIVE.signs); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      LG.signs.set(sign, m); liveGroup.add(m);
    }
    LG.pins = new THREE.InstancedMesh(pinGeo, chrome, LIVE.pins); LG.pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [LG.heads, LG.halos, lm, LG.pins]) { m.frustumCulled = false; liveGroup.add(m); }
    for (const m of LG.signs.values()) m.frustumCulled = false;
    const spell = speller(0); // how each key is written with no key signature: the place on the staff and the sign
    for (let p = 0; p < 128; p++) { const s = spell(p), staff = p < 60 ? 1 : 0; LG.spell.push({ staff, y: staff ? (s.step - 18) / 2 : TB + (s.step - 30) / 2, sign: ACC[s.acc] || null }); }
  }
  const setLedger = (i, x0, x1, y) => { // one ledger line from x0 to x1 at page height y
    const a = LG.ledgers.attributes, w = LINE.ledger / 2;
    for (let j = 0; j < 4; j++) {
      const v = (i * 4 + j) * 3;
      a.position.array[v] = j < 2 ? x0 : x1; a.position.array[v + 1] = LINE.lift; a.position.array[v + 2] = -y;
      a.aOff.array[v] = 0; a.aOff.array[v + 1] = 0; a.aOff.array[v + 2] = w;
      a.aDir.array[v] = 1; a.aDir.array[v + 1] = 0; a.aDir.array[v + 2] = 0;
    }
  };
  const ns = { accidentalSharp: 0, accidentalFlat: 0 }, chordT = [-1e9, -1e9], chordX = [0, 0], chordY = [new Float32Array(16), new Float32Array(16)], chordN = [0, 0];
  const accY = [new Float32Array(16), new Float32Array(16)], accN = [0, 0]; // the signs already placed in each staff's chord
  // Draws what has been played (trail: [{ pitch, vel, t0, t1 }], oldest first, times on the same clock as t) around
  // the camera's place cx (page x, after re-centring); a note played at t0 stands lag ss ahead of the camera's place then.
  function drawLive(trail, cx, lag) {
    const k = Math.floor(cx / SYS);
    if (k !== sysK) { // the systems on view: the one under the camera, the one before and the one after
      sysK = k;
      for (let i = 0; i < 3; i++) {
        const x0 = (k - 1 + i) * SYS;
        sysLines[i].position.x = x0;
        for (const [m, dx, y] of sysGlyphs) { M.compose(V.set(x0 + dx, RAISED.lift, -y), Q.identity(), SC.set(1, 1, 1)); m.setMatrixAt(i, M); m.instanceMatrix.needsUpdate = true; }
        sysPins.forEach(([px, py], j) => { M.compose(V.set(x0 + px, 0, -py), Q.identity(), SC.set(RAISED.pin, RAISED.lift + 0.02, RAISED.pin)); sysPinMesh.setMatrixAt(i * sysPins.length + j, M); });
      }
      if (sysPinMesh) sysPinMesh.instanceMatrix.needsUpdate = true;
    }
    if (!LG.heads) return;
    let i0 = trail.length;
    while (i0 > 0 && liveLayout.xOf(trail[i0 - 1].t0) + lag > cx - LIVE.behind) i0--;
    let nh = 0, nl = 0, np = 0;
    ns.accidentalSharp = ns.accidentalFlat = 0;
    chordT[0] = chordT[1] = -1e9;
    for (let i = i0; i < trail.length && nh < LIVE.heads; i++) {
      const n = trail[i], sp = LG.spell[n.pitch];
      if (!sp || n.pitch < 21 || n.pitch > 108) continue;
      const staff = sp.staff, y = sp.y;
      if (n.t0 - chordT[staff] > LIVE.chord) { chordT[staff] = n.t0; chordX[staff] = liveLayout.xOf(n.t0) + lag; chordN[staff] = accN[staff] = 0; }
      let dx = 0; // a step away from a note of the same chord: the other side of the (unseen) stem
      for (let j = 0; j < chordN[staff]; j++) if (Math.abs(chordY[staff][j] - y) === 0.5) dx = HEAD_W;
      if (chordN[staff] < 16 && !dx) chordY[staff][chordN[staff]++] = y;
      const x = chordX[staff] + dx;
      M.compose(V.set(x, 0, -y), Q.identity(), SC.set(1, 1, 1)); LG.heads.setMatrixAt(nh, M);
      LG.aHand.array[nh] = staff;
      const ah = LG.aHead.array, o4 = nh * 4; ah[o4] = x; ah[o4 + 1] = y; ah[o4 + 2] = -1e10; ah[o4 + 3] = 3 * staff; // (kind 0: a solid head)
      nh++;
      const ext = HEAD_W / 2 + 0.38; // ledger lines above and below the staff
      for (let ly = BOTTOM[staff] - 1; ly >= y - 0.01 && nl < LIVE.ledgers; ly--) setLedger(nl++, x - ext, x + ext, ly);
      for (let ly = TOP[staff] + 1; ly <= y + 0.01 && nl < LIVE.ledgers; ly++) setLedger(nl++, x - ext, x + ext, ly);
      const m = sp.sign && LG.signs.get(sp.sign);
      if (m && ns[sp.sign] < LIVE.signs) { // left of the whole chord; a sign that would touch another moves one column left
        let col = 0;
        for (let j = 0; j < accN[staff]; j++) if (Math.abs(accY[staff][j] - y) < 3) col++;
        if (accN[staff] < 16) accY[staff][accN[staff]++] = y;
        const ax = chordX[staff] - HEAD_W / 2 - 0.22 - ADV[sp.sign] - col * 1.05, geo = m.geometry;
        M.compose(V.set(ax, RAISED.lift, -y), Q.identity(), SC.set(1, 1, 1)); m.setMatrixAt(ns[sp.sign]++, M);
        for (const [px, py] of geo.userData.pins) if (np < LIVE.pins) { M.compose(V.set(ax + px, 0, -(y + py)), Q.identity(), SC.set(RAISED.pin, RAISED.lift + 0.02, RAISED.pin)); LG.pins.setMatrixAt(np++, M); }
      }
    }
    LG.heads.count = nh; LG.halos.geometry.instanceCount = nh; LG.pins.count = np;
    LG.heads.instanceMatrix.needsUpdate = LG.aHand.needsUpdate = LG.aHead.needsUpdate = LG.pins.instanceMatrix.needsUpdate = true;
    for (const [sign, m] of LG.signs) { m.count = ns[sign]; m.instanceMatrix.needsUpdate = true; }
    LG.ledgers.setDrawRange(0, nl * 6);
    for (const k2 of ['position', 'aOff', 'aDir']) LG.ledgers.attributes[k2].needsUpdate = true;
  }


  // ---- the camera ----
  const sstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  let layout = null;
  if (S) {
    const t1 = Math.min(...S.landings.filter((l) => l.length).map((l) => l[0].t)), tEnd = Math.max(...S.landings.map((l) => (l.length ? l[l.length - 1].t : 0)));
    // how far ahead the camera starts: enough that, OPENING.at seconds before the first note, it looks at the start of the system
    const ta = t1 - OPENING.at, want = Math.max(0, OPENING.margin - S.xOf(ta));
    // the end of the sound: the crane and fade are timed to finish as the final notes stop
    const tOff = piece.duration ?? Math.max(...piece.notes.map((n) => n.onset + n.dur));
    const tc = Math.min(tEnd + ENDING.wait[1], Math.max(tEnd + ENDING.wait[0], tOff - ENDING.out));
    layout = { xOf: S.xOf, speed: S.speed, t1, tEnd, tOff, tc, lead: want / (1 - sstep(t1 - OPENING.before, t1 + OPENING.after, ta)) };
  }
  // Live: the place moves on at the slowest layout speed, counted from liveBase (re-centred every LIVE.period s, a
  // whole number of systems, so nothing visibly moves when it changes). (Finite: the ramps below must not see infinities.)
  let liveBase = 0;
  const liveLayout = { xOf: (t) => (t - liveBase) * LAYOUT.minSpeed, speed: LAYOUT.minSpeed, t1: -1e9, tEnd: 1e9, tOff: 1e9, tc: 1e9, lead: 0 };
  const E = new THREE.Euler(0, 0, 0, 'YXZ'), D = new THREE.Vector3();
  const slowed = (u) => (u <= 0 ? 0 : u < 1 ? u * u * u - (u * u * u * u) / 2 : 0.5 + (u - 1)); // the integral of smoothstep
  // The x the camera follows: the music's own place, exactly, except at the two ends. At the start it runs a little
  // ahead (so the first picture shows the title, brace and clefs, as in the reference) and lets the music catch up
  // over about nine seconds, gliding about a sixth slower meanwhile; over the last bars it slows a little, and after
  // the final note its glide dies away (smoothly: the speed carries on and decays), so the last chord stays in view.
  const camX = (L, t) => {
    const u = Math.min(t, L.tEnd);
    const slow = Math.min(0.25 * L.speed, ENDING.lag / (0.5 * ENDING.over)); // ss/s less by the final note
    let x = L.xOf(u) + L.lead * (1 - sstep(L.t1 - OPENING.before, L.t1 + OPENING.after, t)) - slow * ENDING.over * slowed((u - (L.tEnd - ENDING.over)) / ENDING.over);
    if (t > L.tEnd) x += (L.speed - slow) * ENDING.settle * (1 - Math.exp(-(t - L.tEnd) / ENDING.settle));
    return x;
  };
  // the crane at the end: straight up (the lens keeps its tilt and heading), easing into 12 ss/s
  const crane = (L, t) => { const s = t - L.tc; return s > 0 ? ENDING.crane * (s - 0.25 * (1 - Math.exp(-s / 0.25))) : 0; };
  // Where the camera is at time t (a pure function): it looks along its heading, tilted down, with the current bass
  // place (camX, page y = c.y) at `at` in the picture, from height h; the crane then lifts it without turning it.
  function poseAt(L, t, c, aspect, pos, quat, ps) {
    const yaw = (c.yaw - c.yawAmp * Math.cos((2 * Math.PI * t) / c.yawPeriod)) * DEG;
    const h = c.h + c.hAmp * Math.cos((2 * Math.PI * t) / c.hPeriod) + c.rise * sstep(L.tEnd - ENDING.over, L.tEnd, t), up = crane(L, t);
    E.set(-c.tilt * DEG, yaw - Math.PI / 2, 0); quat.setFromEuler(E);
    const th = Math.tan((c.fov * DEG) / 2);
    D.set((2 * c.at[0] - 1) * th * aspect, (1 - 2 * c.at[1]) * th, -1).applyQuaternion(quat);
    const k = h / -D.y, x = camX(L, t), z = -c.y;
    pos.set(x - D.x * k, h + up, z - D.z * k);
    ps.x = x; ps.h = h + up; ps.yaw = yaw; ps.dNear = (h + up) / Math.sin((c.tilt + c.fov / 2) * DEG);
    return ps;
  }
  const pose = { x: 0, h: 0, yaw: 0, dNear: 40 };
  const CAMS = { wide: CAM.wide, tall: CAM.tall, wideStill: still(CAM.wide), tallStill: still(CAM.tall) };
  const camFor = (aspect, motion = true) => CAMS[(aspect < 1 ? 'tall' : 'wide') + (motion ? '' : 'Still')];
  const place = (camera, L, t, c) => poseAt(L, t, c, camera.aspect, camera.position, camera.quaternion, pose);

  // ---- the balls of light, one per hand ----
  // Each hops from note to note in a straight line (in plan) at constant speed, its height a parabola with the top in
  // the middle of the hop, rising BALL.k * T^BALL.p ss for a gap of T seconds (rests are flown over: the hop is just
  // longer and higher); it touches each note for an instant. A chord is landed on at its outer note (the top in the
  // right hand, the bottom in the left), on that note's own head.
  const headX = new Map(heads.map((h) => [`${h.staff}|${h.t}|${h.y}`, h.x]));
  const paths = [0, 1].map((hand) => (S ? S.landings[hand].map((l) => ({ t: l.t, x: headX.get(`${hand}|${l.t}|${l.y}`) ?? l.x, y: l.y })) : []));
  const ballGeo = new THREE.PlaneGeometry(2, 2), QSIZE = 2.3; // the square around a ball reaches 2.3 radii out
  const ballU = looks.map((l) => ({ uSize: { value: BALL.r * QSIZE }, uQ: { value: QSIZE }, uCore: { value: l.ball }, uRim: { value: l.ballRim }, uHalo: { value: l.ballHalo }, uAlpha: { value: 1 } }));
  const balls = ballU.map((u) => {
    const m = new THREE.Mesh(ballGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: BALL_VERT, fragmentShader: BALL_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 10; scene.add(m);
    return m;
  });
  const camTc = new THREE.Vector3(), qTc = new THREE.Quaternion(), poseTc = { x: 0, h: 0, yaw: 0, dNear: 0 }, away = new THREE.Vector3();
  // Where a ball's entry starts: the x at which the line it glides in along (inH high, over its first note's line)
  // crosses the left edge of the picture inT seconds before that note. Found once per picture shape (by halving).
  const entry = { aspect: 0, c: null, x: [0, 0], done: [false, false] }, ep = new THREE.Vector3();
  function entryX(hand, L, c, aspect) {
    if (entry.aspect !== aspect || entry.c !== c) { entry.aspect = aspect; entry.c = c; entry.done[0] = entry.done[1] = false; }
    if (entry.done[hand]) return entry.x[hand];
    const f = paths[hand][0], th = Math.tan((c.fov * DEG) / 2) * aspect;
    poseAt(L, f.t - BALL.inT, c, aspect, camTc, qTc, poseTc); qTc.invert();
    const ndcX = (x) => { ep.set(x, BALL.inH, -f.y).sub(camTc).applyQuaternion(qTc); return ep.z < -0.01 ? ep.x / -ep.z / th : -Infinity; };
    let lo = f.x - 400, hi = f.x;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (ndcX(m) < -1.05) lo = m; else hi = m; }
    entry.done[hand] = true;
    return (entry.x[hand] = Math.min(lo, f.x - 4));
  }
  // The centre of a hand's ball at time t, into p (world). False when that hand has no notes.
  function ballAt(hand, t, L, c, aspect, p) {
    const list = paths[hand];
    if (!list.length) return false;
    const first = list[0], last = list[list.length - 1];
    if (t < first.t) { // gliding in from the left, faster than the music, and settling onto the first note
      const u = (first.t - t) / BALL.inT, x0 = entryX(hand, L, c, aspect);
      p.set(first.x + (x0 - first.x) * u, BALL.z0 + (BALL.inH - BALL.z0) * ((1 - BALL.inA) * Math.pow(u, BALL.inP) + BALL.inA * u), -first.y);
    } else if (t < last.t) {
      let lo = 0, hi = list.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; }
      const a = list[lo], b = list[lo + 1], T = b.t - a.t, u = (t - a.t) / T;
      p.set(a.x + (b.x - a.x) * u, BALL.z0 + 4 * Math.min(BALL.hMax, BALL.k * Math.pow(T, BALL.p)) * u * (1 - u), -(a.y + (b.y - a.y) * u));
    } else { // its hand has finished: it lifts off and hovers, keeping its place in the picture
      p.set(last.x + camX(L, t) - camX(L, last.t), BALL.z0 + BALL.hover * (1 - Math.exp(-(t - last.t) / BALL.hoverT)), -last.y);
    }
    const s = t - L.tc;
    if (s > 0) { // the end: it rises with the crane and flies away from the camera, so it shrinks where it is in the picture
      poseAt(L, L.tc, c, aspect, camTc, qTc, poseTc);
      away.set(last.x + camX(L, L.tc) - camX(L, last.t), BALL.z0 + BALL.hover * (1 - Math.exp(-(L.tc - last.t) / BALL.hoverT)), -last.y).sub(camTc).normalize();
      p.addScaledVector(away, BALL.away * (s - BALL.awayT * (1 - Math.exp(-s / BALL.awayT))));
      p.y += crane(L, t) + BALL.rise * s;
    }
    return true;
  }

  const keyDir = new THREE.Vector3(), edgeDir = new THREE.Vector3(), point = new THREE.Vector3(), out = { focus: 50, range: 0, sky: false, point };
  const inkLinear = new THREE.Color(PAL.ink), bp = new THREE.Vector3();
  const faded = [ink, headMat, face, chrome, fleck, ...mirrored];
  // what the last frame drew, for checking it from outside: the balls' centres (world), whether each is shown, the fades
  const probe = { balls: [new THREE.Vector3(), new THREE.Vector3()], shown: [false, false], fade: 1, ballFade: 1, tc: layout ? layout.tc : null, tEnd: layout ? layout.tEnd : null, camera: null, t: 0 };
  function render(t, camera, o = {}) {
    const c = camFor(camera.aspect, o.motion !== false), live = !!o.live || !S, L = live ? liveLayout : layout;
    if (camera.fov !== c.fov || camera.near !== NEAR || camera.far !== FAR) { camera.fov = c.fov; camera.near = NEAR; camera.far = FAR; camera.updateProjectionMatrix(); }
    printed.visible = !live; liveGroup.visible = live;
    if (live) liveBase = Math.floor(t / LIVE.period) * LIVE.period;
    const p = place(camera, L, t, c);
    camera.updateMatrixWorld();
    if (live) drawLive(o.live || NONE, p.x, c.live || 0);
    // the end: the picture fades to black, the balls last (smoothly in what the eye sees, so as linear light ^2.2)
    const fS = 1 - sstep(L.tc + ENDING.fade[0], L.tc + ENDING.fade[1], t), fB = 1 - sstep(L.tc + ENDING.ballFade[0], L.tc + ENDING.ballFade[1], t);
    const linS = Math.pow(fS, 2.2), linB = Math.pow(fB, 2.2);
    // the light pool and the key light travel with the camera
    paperU.uCam.value.copy(camera.position);
    paperU.uDn.value = p.dNear; paperU.uLam.value = LIGHT.lam * p.h; paperU.uVn.value = LIGHT.vNear * Math.pow(LIGHT.h0 / Math.max(1, p.h), LIGHT.hExp);
    paperU.uFade.value = linS;
    paper.position.set(camera.position.x, 0, camera.position.z);
    const az = p.yaw + LIGHT.off * DEG, el = LIGHT.elev * DEG;
    keyDir.set(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    point.set(p.x, 0, -c.y);
    key.target.position.copy(point); key.position.copy(point).addScaledVector(keyDir, 60);
    edgeDir.subVectors(camera.position, point).normalize(); edgeDir.x = -edgeDir.x;
    edge.target.position.copy(point); edge.position.copy(point).addScaledVector(edgeDir, 60);
    key.intensity = LIGHT.key * linS; edge.intensity = LIGHT.edge * linS; ambient.intensity = 0.05 * linS;
    for (const m of faded) m.envMapIntensity = linS;
    if (o.res) lineU.uRes.value.copy(o.res);
    lineU.uMinPx.value = 1.15 * (o.pr || 1);
    lineU.uColor.value.copy(inkLinear).multiplyScalar(linS);
    // the lit notes: every head played by now (its time <= t) glows, for good
    glowU.uTime.value = live ? -1e9 : t; glowU.uFade.value = linS;
    out.focus = camera.position.distanceTo(point);
    // the balls, their reflections, their light on the paper and their shadows
    for (let hand = 0; hand < 2; hand++) {
      const m = balls[hand], shown = !live && o.paths !== false && linB > 0 && ballAt(hand, t, L, c, camera.aspect, bp);
      const pb = paperU.uBall.value[hand], sh = paperU.uShadow.value[hand], spot = spotU.uSpot.value[hand];
      m.visible = shown; probe.shown[hand] = shown;
      if (!shown) { pb.w = 0; sh.w = 0; spot.w = 0; continue; }
      probe.balls[hand].copy(bp);
      m.position.copy(bp); ballU[hand].uAlpha.value = linB;
      pb.set(bp.x, bp.y, bp.z, BALL.r);
      paperU.uBallColor.value[hand].copy(looks[hand].refl).multiplyScalar(linB);
      const lift = bp.y / keyDir.y; // the shadow: along the key light, down onto the paper
      sh.set(bp.x - keyDir.x * lift, bp.z - keyDir.z * lift, SHADOW.r0 + SHADOW.rk * bp.y, SHADOW.strength * sstep(SHADOW.from, SHADOW.to, bp.y) * fB);
      spot.set(bp.x, bp.y, bp.z, 1).applyMatrix4(camera.matrixWorldInverse); spot.w = BALL.r; // (in view space)
      spotU.uSpotColor.value[hand].copy(looks[hand].refl).multiplyScalar(linB);
    }
    probe.fade = fS; probe.ballFade = fB; probe.camera = camera; probe.t = t;
    return out;
  }

  // A different pair of hand colours (as opts.hands), straight into the colours the shaders already use.
  function setHands(v) {
    pairLooks(v).forEach((l, h) => { for (const k of Object.keys(l)) looks[h][k].copy(l[k]); hands[h].setRGB(l.halo.x, l.halo.y, l.halo.z); });
  }

  return { scene, render, setHands, bloom: { pass: GLOW.bloom, mips: GLOW.bloomMips }, layout: S, heads, hands, balls, paths, ballAt: (hand, t, aspect = 16 / 9, p = new THREE.Vector3(), motion = true) => (layout && ballAt(hand, t, layout, camFor(aspect, motion), aspect, p) ? p : null),
    pose, probe, uniforms: { paper: paperU, line: lineU, glow: glowU, halo: haloU, spot: spotU, balls: ballU }, lights: { key, edge, ambient },
    materials: { ink, head: headMat, face, chrome, fleck, paper: paperMat, line: lineMat }, printed, camX: (t) => camX(layout || liveLayout, t), timing: layout };
}
