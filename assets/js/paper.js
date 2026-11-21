// "Paper": the written music lies on a long sheet of real paper (ivory by default; a few other calm colours in PAPERS),
// printed in a matching near-black ink, and the camera glides along it like a dolly on rails, looking diagonally down
// the music. The title, clefs, brace and signs stand a little above the paper on short silver pins, black lacquer with
// a thin chrome rim. One soft light travels with the camera, so the paper is brightest just below the picture and dims
// gently toward the top. The paper has a fine grain, fibres and a faint cockle, lit by the key light (one seeded,
// tileable texture made once), and everything that stands up from it casts a soft shadow on it (shadowMask below).
// One small ball of light per hand (right pink, left ice-cyan) hops from note to note; each note lights up white-hot
// the instant its ball touches it and stays lit, in a tight ring of its hand's colour. The glows light the scene: the
// lit notes and the balls throw soft pools of their colour on the paper (a light map, drawn each frame), the balls
// show in the semi-gloss paper as soft streaks, and the balls and the newest lit notes are small lamps that every
// shiny surface mirrors (GLINT). The notation can be printed matte ink or made of polished metal, smoked glass or satin
// gold (FINISHES), each reflecting a dim studio with one soft window. Optionally each ball leaves a thin trail of light
// along its path (TRAIL), its touches light the open paper in its corner of the picture (CORNER: a glow, ripples or
// electric filaments) and set off small puffs of glowing powder (SPARK). At the end the camera cranes up, the balls
// fly away and the picture fades to black.
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
import { engrave } from './sheet.js?v=8';
import { SIG, speller } from './score.js?v=20';
import { musicShapes, textShapes, extrude } from './glyphs.js?v=1';

const TB = 11;                                   // page y of the treble staff's bottom line (the bass staff's is 0)
const MID = [TB + 2, 2], TOP = [TB + 4, 4], BOTTOM = [TB, 0];
const DEG = Math.PI / 180;
const NONE = [];
const CHUNK = 96;                                // the printed music is cut into pieces this long (ss), so the graphics card skips what is out of view
const NEAR = 2, FAR = 700;                       // camera clipping range (ss): the camera never comes nearer than ~20 ss to the paper

// ---- the look, as measured from the reference (sRGB unless marked) ----
const PAL = {
  face: '#07070a',          // the lacquered black faces of the raised pieces
  chrome: '#b4b4ba',        // their rims and the pins
  fleck: '#7a7a82',         // the rims of the small signs in the music (accidentals)
};                          // (the paper and its ink: PAPERS)
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
// The halo around a lit note. The notehead itself is drawn white-hot (its core colour, just above white, so it keeps
// its own shape); the halo is a tight ring of the hand's colour around it, laid over the paper: at distance d (ss)
// outside the head's outline it covers a = sum k * exp(-d / w) of the paper (half maximum ~0.2 ss out, ~10% by 0.55 ss
// out, about 1.1-1.25 ss from the centre, as measured in the first video), in a colour going from the pale rim to the
// saturated halo over `tint` ss (the rim is the pale tint taken rimSat of the way to the saturated one, so it reads
// as colour on light paper). The paper under it is dimmed by dim * a and the colour added, so a halo never turns
// the paper white and two halos that overlap in a close chord stay a coloured glow (each one's colour stays under
// rimLum / dim; see HALO_FRAG). R: half the size of the square each halo is drawn in; win: where it fades out.
// bloom: the stage's bloom pass for this look (strength, radius, threshold: only the white-hot cores and balls), using
// only its smallest blurs (bloomMips), a spread of a few pixels on screen.
const GLOW = { k: [0.55, 0.45], w: [0.08, 0.28], rimLum: 0.4, rimSat: 0.8, haloLum: 0.3, dim: 0.55, grow: 0.03, tint: 0.2, R: 2.4, win: [1.6, 2.35], texels: 128, bloom: [0.2, 0, 0.92], bloomMips: [1, 0.3, 0, 0, 0] };
// The light the glows throw on the paper: a soft pool of the hand's colour around every lit note and under each ball,
// as from a small lamp `h` ss above the paper (brightness k / (1 + (r / h)^2)^1.5 at r ss from it: half at 0.77 h,
// 10% at 1.9 h), added to the paper's own light and tinted by it. note: the lit notes' pools (k, h; R: half the size
// of the square each is drawn in); ball: the balls' (k, and h = its height + h0: small, so the pool gathers at the
// touch point as the ball comes down and fades fast as it rises; pale: its colour, and its reflection's, are taken this
// far toward white, as a white-hot ball gives a pale tint of its colour, never a blue-grey or lilac cast on warm paper);
// max: many pools together never give more than this (a soft limit). texels: the light map (in page coordinates, over
// the shadow mask's window).
const POOL = { note: { k: 0.3, h: 1.0, R: 5 }, ball: { k: 0.3, h0: 0.3, pale: 0.45 }, trail: { k: 0.05, w: 0.9 }, max: 0.5, texels: [512, 256] };
// The glows as lights on whatever shines: the two balls and, for each hand, the `notes` newest lit notes (the notes it
// last landed on; each fades out as the ball lands on later ones: weight 1 - smoothstep(fade[0], fade[1], k + u), k = how
// many landings ago, u = how far along its next hop the ball is), all small round lamps of radius r (ss), the notes'
// `lift` ss above the paper; the balls shine in their pale light (as their pools do: POOL.ball.pale), so the ink and
// lines near a ball catch a near-white glint, never a blue or violet one. Their light falls off as k / (d^2 + r^2) (ball, note: k); glossy and metal surfaces
// mirror them (a highlight widened by the lamp's size) and the thin lines catch them as short streaks (as polished
// wires do: `streak` = the sharpness of the streak, per finish in FINISH).
const GLINT = { notes: 3, fade: [0.5, 3], lift: 0.35, r: { ball: 0.25, note: 0.45 }, k: { ball: 3, note: 2.5 } };
const GLOWS = 2 + 2 * GLINT.notes;               // how many lights that makes
// The light trails (optional): behind each ball, a thin line of light along the exact path it flew (the same hops),
// fading out over T s. Rebuilt every frame from the path itself (so it is a pure function of the time): `n` samples
// spread over T, plus the landings in that time exactly; w: the line's width (ss) and minPx the least it may be on
// screen (drawing pixels; thinner, it fades instead); lum: its colour's brightness; dim: how much it dims what lies
// behind it (so it reads as coloured light on bright paper without ever turning white); fade: how its brightness
// falls with age (power of 1 - age / T).
const TRAIL = { T: 0.85, n: 72, max: 96, w: 0.1, minPx: 1.5, lum: 0.55, dim: 0.45, fade: 1.6 };
// Corner light (optional, off by default). The staves run diagonally, so the top left and bottom right of the picture
// are open paper. Each touch of the right hand's ball lights the top-left paper, each touch of the left hand's the
// bottom-right, in the hand's colour, as light on the paper itself (in the paper shader, so it has perspective),
// scaled by the square root of the paper's own light there (so it is as gentle on the dimmer far paper as on the
// near). Its colour (the light's) is the ball's taken toward white, at least `pale` of the way and as far as it takes
// for its colourfulness, in itself and against the paper (brightest channel - dimmest, of its colour and of its colour
// over the paper's), to be at most `sat` times its brightness (luminance), so any hand colour on any paper reads as a
// pale coloured light that brightens the paper, never as a tinted stain (ice-cyan is paler on golden parchment than
// on grey). On the paper it shows
// that colour itself on every paper colour (it is divided by the paper's colour, which the paper shader multiplies
// back, and kept as bright as on a neutral paper as light); the electric filaments are the hand's light seen
// directly (paled only as far as it needs in itself, as against a white paper). It
// adds light under its own soft limit (`max`) and, where it is strong, holds back a little of the lamp's light
// (`dim` of it at most), so it shows a hint of its colour on bright paper without ever darkening it. It is placed from points
// of the picture (`at`, -1..1 across and up) where their rays meet the paper, so it stays in its corner of the frame
// as the camera glides (in either picture shape), and sized by S = that point's distance x tan(fov / 2) (half the
// picture's height there). It fades to nothing toward the music: band = the page heights (ss) where it starts and
// where it is full, per hand (the treble staff's top line is at 15, the bass staff's bottom line at 0), so it never
// lies over the notes. Touches less than `gap` s after the last one that set it off are merged into it (so never more
// than 3 a second; played live: the first chord in each `slot` s, which also allows at most 3 in any second), and
// overlapping swells take the larger, so a fast passage gives a gentle pulse, never a flicker. k: per hand (the far
// top-left paper gets a little more).
//   glow: a soft pool centred `at`, stretched along the staves (`stretch`), radius R S, swelling in `up` s and fading
//     (time constant `down` s, about 0.8 s in all) as it widens a little (`grow`).
//   ripples: a ring of light from `at` (just inside the corner) at each touch: radius S (r0 + R (1 - e^(-age / T))),
//     width S (w0 + w1 (1 - e^(-age / T))), fading as it grows (time constant `decay`, gone by `life`), with a fainter
//     echo ring inside it (`echo`: its size and brightness), and a faint glow at the centre (`glow`).
//   electric: a thin filament reaching in from a point of the frame edge round the corner (`edge`: the picture points
//     of that edge, chosen by the note's seed) toward the note just touched; `n` steps and `branches` side branches of
//     `bn` steps, `len` of the picture's height long on screen (at most 3 S; S from the corner itself, CORNER.at) and
//     stopping `stop` ss short of the music; it grows from the edge in `grow` s, wanders (`wiggle`) and crawls a
//     little (`crawl`, smooth in time), and dies away (time constant `decay`, gone by `life`). Its core is w ss wide
//     (at least minPx drawing pixels), the hand's colour `white` of the way to white; its soft halo `halo` ss (at
//     least haloPx), both wider where the paper is further off than S = sRef ss (so they look about as wide in either
//     corner); lum, haloLum: their brightness, dim, haloDim: how much each dims the paper under it; k: its soft light
//     on the paper around it, which flickers softly (two smooth waves of flickHz per second, seeded: flick[0] of the
//     filament's brightness, flick[1] of its light on the paper; far too little to count as a flash).
// Strength (the "Corner light strength" slider, K from 0 to 1, 0.5 by default): every style's brightness is scaled by
// light[0] + (light[1] - light[0]) K and its size and reach by reach[0] + (reach[1] - reach[0]) K (both 1 at 0.5).
// Shade: with the corner light on, the lamp's light falls off into the two open corners, so the corner light stands
// out against them. It holds back part of the paper's own light (and of the light on anything raised there), never
// the glows, the balls or the corner light, which are lights of their own. depth: how much of the lamp's light it
// holds back at the corner itself (linear light), per corner (top left, bottom right), at K 0 and at K 1. It falls off
// as (1 - x)^p, x = the distance from the corner of the picture over R (in the picture's shorter side, R[0] along the
// staves as they run across the picture and R[1] across them; [top left], [bottom right]), so it ends with no edge;
// band: the page heights (ss) where it starts and where it may be full, per corner, so it never lies over the music;
// warm: what is left of the light keeps the paper's hue, a little deeper and warmer (blue held back a little more:
// power 1 - warm for red, 1 + 1.5 warm for blue); dither: a fixed noise of about this many levels (of 255) where it
// is, against banding in the gradient.
const CORNER = {
  ids: ['off', 'glow', 'ripples', 'electric'], pale: 0.08, sat: 1.3, max: 0.6, dim: 0.3, gap: 0.34, slot: 0.5, at: [[-1.1, 1.1], [1.1, -1.1]], band: [[18, 24], [-2.5, -8]], k: [1.4, 1],
  strength: { light: [0.4, 1.6], reach: [0.82, 1.18] },
  shade: { depth: [[0.62, 0.9], [0.55, 0.84]], R: [[1.9, 1.0], [1.7, 1.0]], p: 2.6, band: [[17.5, 30], [-3, -12]], warm: 0.08, dither: 1 },
  glow: { at: [[-0.72, 0.62], [0.72, -0.72]], k: 0.26, R: 0.7, stretch: 1.6, up: 0.18, down: 0.27, grow: 0.25, life: 1.0 },
  ripples: { at: [[-0.92, 0.88], [0.92, -0.92]], n: 4, k: 0.6, r0: 0.05, R: 1.6, T: 0.6, w0: 0.05, w1: 0.24, decay: 0.5, life: 1.4, echo: [0.62, 0.4], glow: 0.25 },
  electric: { n: 12, branches: 3, bn: 6, len: 0.33, stop: 5, grow: 0.08, decay: 0.12, life: 0.45, wiggle: 0.55, crawl: 0.12, w: 0.07, sRef: 10, minPx: 1.2, halo: 0.7, haloPx: 7,
    lum: 0.6, white: 0.15, dim: 0.45, haloDim: 0.28, haloLum: 0.27, k: 0.35, flick: [0.12, 0.3], flickHz: [7, 11], edge: [[[-1.04, 0.2], [-1.04, 1.04], [-0.75, 1.04]], [[1.04, -0.2], [1.04, -1.04], [0.3, -1.04]]] },
};
// The corner light's styles as the Look tab offers them (one line each, plain words).
export const CORNER_STYLES = [
  { id: 'off', name: 'Off', desc: 'No light in the corners: only the music, the balls and the lit notes.' },
  { id: 'glow', name: 'Glow', desc: 'A soft pool of each hand\'s colour swells in its open corner at every touch, then fades.' },
  { id: 'ripples', name: 'Ripples', desc: 'Soft rings of light spread over the paper from the corner at every touch, fading as they grow.' },
  { id: 'electric', name: 'Electric', desc: 'Thin, softly glowing sparks of electricity reach in from the edge at every touch and die away.' },
];
const ARCS = 2, ARC_PTS = (CORNER.electric.n + 1) + CORNER.electric.branches * (CORNER.electric.bn + 1); // filaments alive per hand, points in each
// Powder sparks (optional; the slider sets the share of `max` particles in each puff, 0 = none). At each touch a puff
// of fine glowing powder bursts up and out from the note, drifts with drag and a little gravity, settles on the paper
// and fades. Each particle's path is a closed formula of the time since its touch, seeded by the note: up speed vUp,
// outward speed vOut, drag (1/s), gravity g (ss/s^2), from a disc r0 ss wide at height y0; it lives `life` s, fading
// over the last `tail` of it, white-hot for its first `hot` s; size (ss), never under minPx drawing pixels (smaller,
// it fades instead, so it never twinkles by aliasing). The newest `slots` touches per hand are drawn, the oldest
// fading out smoothly (`fade`, in touches); a touch less than `fast` s after the one before gets a smaller puff (down
// to `least` of it). Each particle lights the paper under it a little (pool k, as a lamp h0 ss above its height).
const SPARK = { max: 56, slots: 12, fade: 3, life: [1, 1.6], tail: 0.45, hot: 0.18, vUp: [1.6, 4.2], vOut: [0.8, 3.2], drag: [2.4, 4], g: 3, r0: 0.35, y0: 0.3,
  size: [0.04, 0.085], minPx: 1.2, lum: 0.75, dim: 0.6, fast: 0.3, least: 0.35, pool: { k: 0.012, h0: 0.35 } };
// The balls: radius (with the bloom, the clipped core is 0.40 ss across, as measured), centre height at contact, hop
// rise k * T^p (capped at hMax). Entry: inT seconds before its first note it comes in at the left edge of the picture,
// inH ss high, and glides straight to the note at a constant speed, sinking fast at first and gently at the end
// (height ~ (1 - inA) u^inP + inA u, u = time left / inT: still sinking a little when it touches). After its hand's
// last note it rises to `hover` ss and keeps its place in the picture; when the camera cranes up it flies away from
// the camera (away ss/s, easing in over awayT s) and a little upward (rise ss/s).
const BALL = { r: 0.17, z0: 0.3, k: 1.25, p: 0.7, hMax: 4.5, inH: 6.5, inT: 1.6, inP: 1.7, inA: 0.2, hover: 1.3, hoverT: 0.45, away: 26, awayT: 0.35, rise: 1.0 };
// The semi-gloss paper mirrors the balls: gloss = the spread of the reflection (radians of the half
// vector; broad, so a ball 1 ss up leaves a soft streak ~2-3 ss long), k = how bright it is (the ball is a light: its
// reflection peaks ~+40% over the paper at 1 ss up), narrow = how much narrower it is sideways (a vertical streak);
// (the light a ball throws on the paper is POOL.ball; its glints on the ink and lines, GLINT).
const REFL = { gloss: 0.25, k: 3.6, narrow: 0.7 };
// The light pool travels with the camera: brightness falls off exponentially with slant distance D from the camera,
// V = vNear * exp(-(D - Dnear) / (LAM * h)), where Dnear is the distance to the bottom-centre of the picture and h the
// camera height. lam 2.6 keeps near:far at about 1.7x in luma (a gentle falloff: the far paper is dimmer, never dark),
// and the near paper dims a little as the camera rises (vNear ~ 1/h, then a soft cap at `cap`, sRGB, times the paper's
// own expo: ivory paper peaks near #c2bcae, lit but never glaring). The key light: `elev` deg up, `off` deg round from
// straight behind the camera toward its right (fixed for each camera, so the shadows never swim), so the shadows fall
// to the left and a little away, where they can be seen (straight away from the camera, the pieces hide them);
// envOff = where the lacquer's reflections see it (unchanged). key, edge: the 3D pieces' lights.
const LIGHT = { vNear: 1.15, h0: 22, hExp: 1.0, lam: 2.6, cap: 0.88, elev: 40, off: 80, envOff: 5, key: 2.2, edge: 1.4 };
// What the key light does to the paper: amb = the share of the paper's light that is not the key (the brightness in
// full shadow, linear); shadow = how much of the key a solid piece holds back; ball = the same for a ball of light (it
// glows, so its shadow is lighter; ballSize: its shadow is cast by a sphere this many times its radius, the glow
// around it, so it still shows when the ball flies high and the shadow is soft); contact = the extra darkening right where a piece meets the paper (ambient
// occlusion, from pieces less than `low` ss up); soft = the blur (ss, sigma) of the shadows of the highest pieces
// (those up to `high` ss above the paper go from the sharp shadow to that one); bump = how strongly the grain tilts the
// light; cockle = the faint waviness of the sheet (slope); inkLift: the printing ink casts its shadow as if it stood
// this many times higher than its 0.11 ss (a thin, readable crescent beside each notehead and beam).
const SHADE = { amb: 0.38, shadow: 0.9, ball: 0.55, ballSize: 1.8, contact: 0.3, low: 0.4, soft: 0.3, high: 0.9, bump: 0.55, cockle: 0.012, inkLift: 2.2 };
// The shadow mask: everything raised is drawn once per frame, seen straight from above and slid along the key light
// onto the paper (a planar shadow), into a texture of texels[0] x texels[1] covering a window of the page: from `back`
// ss behind the camera's place to W ss further on (along x), and world z from z0 over H ss (the whole system, the title
// and the shadows they cast). The window steps in whole texels, so the shadows never swim as the camera glides.
const MASK = { texels: [2048, 1024], z0: -52, H: 64, wide: { back: 36, W: 128 }, tall: { back: 42, W: 160 } };
// The paper itself: a seeded, tileable texture made once (size texels square), repeating every `tile` ss for the grain,
// fibres and formation (the cloudiness of paper), and every `toneTile` ss for its slow, faint changes of tone.
const GRAIN = { size: 1024, tile: 16, toneTile: 96, fibres: 2600, seed: 0x5eed1e };
// The paper colours offered under Look. near: the colour of the paper in full light, far: its colour where the light
// is dim (both sRGB, only their hue and saturation count); expo: brightness; ink: the printing ink; tone: how much
// the paper's tone varies [fine (fibres, formation), slow]; grain: the depth of its grain; swatch: its button.
export const PAPERS = [
  { id: 'ivory', name: 'Ivory', desc: 'Warm ivory, like a fine printed edition: bright, soft and easy on the eyes.', near: '#fbf1dc', far: '#f3dfbd', expo: 1, ink: '#16120e', tone: [0.05, 0.035], grain: 1, swatch: ['#f4ecdb', '#cfc1a5'] },
  { id: 'beige', name: 'Warm beige', desc: 'A deeper, calmer cream, like a well-loved music book under a reading lamp.', near: '#f4e5cb', far: '#eed9b8', expo: 0.95, ink: '#1a130d', tone: [0.055, 0.04], grain: 1.05, swatch: ['#ebdcc0', '#c4ac86'] },
  { id: 'parchment', name: 'Parchment', desc: 'Slightly aged paper, a little golden, with a soft mottled tone.', near: '#f2ddb4', far: '#e8cfa3', expo: 0.94, ink: '#24180e', tone: [0.08, 0.075], grain: 1.2, swatch: ['#e8d3aa', '#b89566'] },
  { id: 'grey', name: 'Soft grey', desc: 'Cool, quiet grey card with a neutral black ink.', near: '#ecebe8', far: '#dcdde2', expo: 0.92, ink: '#111215', tone: [0.045, 0.03], grain: 0.95, swatch: ['#dddcd9', '#a6a8ae'] },
  { id: 'lavender', name: 'Lavender', desc: 'Lavender-slate paper in blue-black ink, as in the first video, a little brighter.', near: '#ccd3ff', far: '#b5bfff', expo: 0.8, ink: '#090a13', tone: [0.045, 0.03], grain: 0.9, swatch: ['#a9acc4', '#6b6e86'] },
];
export const PAPER_DEFAULT = 'ivory';
// Layout speed (ss per second of music; see engrave()): at least the first video's 13.5, enough that the closest
// notes (10th percentile of the gaps, ornaments left out) stand 2.6 ss apart, and at most 24, so the camera never
// rushes. 24 is the lowest cap that still leaves room for a sign between the fastest sixteenths (0.094 s apart in the
// Revolutionary Etude and the C minor Prelude: 2.26 ss at 24, 2.07 at 22, where 15% of the Etude's signs would crowd).
const LAYOUT = { minSpeed: 13.5, maxSpeed: 24, minGap: 2.6 };
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
// ---- what the notation is made of (the app's "Notes made of" choice) ----
export const FINISHES = [
  { id: 'matte', name: 'Matte ink', desc: 'Printed ink with lacquered signs and chrome rims: quiet, with only a soft sheen where the lights pass. (Default.)', chip: 'radial-gradient(75% 75% at 32% 28%, #77716a, #2a2620 62%)' },
  { id: 'metal', name: 'Polished metal', desc: 'Polished steel: dark close by, with bright rounded edges, a slow gleam in the distance and the coloured lights caught in its shine.', chip: 'radial-gradient(80% 80% at 30% 25%, #f4f6fa, #9aa0aa 42%, #33373f 80%)' },
  { id: 'glass', name: 'Smoked glass', desc: 'Dark tinted glass: the staff shows faintly through, with crisp highlights on the rims.', chip: 'radial-gradient(70% 70% at 30% 25%, #aab3c8, #1d2030 38%, #07080d 75%)' },
  { id: 'gold', name: 'Satin gold', desc: 'Softly brushed gold with a warm sheen on its edges.', chip: 'radial-gradient(80% 80% at 30% 25%, #fff0c4, #d6ae68 45%, #6b4e1c 85%)' },
];  // (chip: how its button shows it)
export const FINISH_DEFAULT = 'matte';
// The finishes other than matte ink round every symbol off (a deeper bevel, cut into the outline so the symbol keeps
// its size), so each small notehead or beam catches a little of the room: a highlight on its near edge, the lit paper
// on its slopes. That is what makes metal read as metal and glass as glass at this size. 'rim' keeps a flat top inside
// a narrow rounded rim (polished metal: the top mirrors the dark room, so the notes stay dark and readable on the
// paper, and the rim catches the light); 'round' is a soft dome.
const DOME = {
  round: { ink: { depth: 0.02, bevelThickness: 0.09, bevelSize: 0.065, bevelOffset: -0.04, bevelSegments: 3, curveSegments: 8 },
    raised: { depth: 0.06, bevelThickness: 0.06, bevelSize: 0.05, bevelOffset: -0.028, bevelSegments: 3, curveSegments: 8 },
    title: { bevelThickness: 0.14, bevelSize: 0.13, bevelOffset: -0.07, bevelSegments: 4 } },
  rim: { ink: { depth: 0.04, bevelThickness: 0.055, bevelSize: 0.06, bevelOffset: -0.03, bevelSegments: 3, curveSegments: 8 },
    raised: { depth: 0.08, bevelThickness: 0.04, bevelSize: 0.04, bevelOffset: -0.02, bevelSegments: 3, curveSegments: 8 },
    title: { bevelThickness: 0.1, bevelSize: 0.1, bevelOffset: -0.05, bevelSegments: 4 } },
};
// The finishes, as materials. ink = the printed symbols (noteheads, beams, flags, rests, dots); face = the tops of the
// raised signs and the title; wall = their sides; fleck = the sides of the small signs; pin = the standoff pins
// (default: the chrome). Each is a MeshPhysicalMaterial setting (colour = the metal's own reflectance, or the glass's
// tint); T = how much light smoked glass lets through (it is drawn over the paper and the staff lines, which show
// through it, dimmed); cc = a clear coat (glass: a second, sharper reflection); env = the strength of the room's
// reflection; max = the brightest any part may be (linear, a soft limit under the bloom threshold, so only the lit
// notes ever bloom). glints = the share of the lamps' own highlights kept (soft, never sparkling); glow = how strongly
// the glows' light shows on it [diffuse, mirror]; haze = a broad sheen of the glows' colour (glowCode); line = the colour of the thin lines (staff, ledger and bar lines and
// stems share the finish), lineGlow = the glows' streaks along them [brightness, sharpness]; dome = the bevel (DOME);
// win = the strength of the soft window in the room it reflects and room = that of its dim walls (paperEnv). matte:
// the original materials.
const FINISH = {
  matte: { glow: [1, 0.35], lineGlow: [0.5, 24], max: 0.85 },
  metal: { ink: { color: '#979ca7', metalness: 1, roughness: 0.16, max: 0.58 }, face: { color: '#868b95', metalness: 1, roughness: 0.1, env: 0.85, max: 0.6 },
    wall: { color: '#d2d5dc', metalness: 1, roughness: 0.12, max: 0.64 }, fleck: { color: '#a3a7b1', metalness: 1, roughness: 0.15, max: 0.6 },
    glints: 0.3, glow: [1, 2.2], haze: 0.4, line: '#1d2029', lineGlow: [2.4, 60], dome: 'rim', win: 0.7, room: 0.35 },
  glass: { ink: { color: '#0b0d16', roughness: 0.05, T: 0.16, cc: 1, max: 0.6 }, face: { color: '#080a12', roughness: 0.04, T: 0.12, cc: 1, max: 0.6 },
    wall: { color: '#121522', roughness: 0.04, T: 0.16, cc: 1, max: 0.6 }, fleck: { color: '#121522', roughness: 0.05, T: 0.18, cc: 1, max: 0.6 }, pin: 'chrome',
    glints: 0.5, glow: [1, 1.6], line: '#10121b', lineGlow: [1.8, 80], dome: 'rim', win: 0.35, room: 0.03 },
  gold: { ink: { color: '#d6ae68', metalness: 1, roughness: 0.32, max: 0.56 }, face: { color: '#d4aa62', metalness: 1, roughness: 0.26, env: 0.8, max: 0.58 },
    wall: { color: '#efcd8e', metalness: 1, roughness: 0.18, max: 0.62 }, fleck: { color: '#c8a15c', metalness: 1, roughness: 0.22, max: 0.58 },
    pin: { color: '#e8c88e', metalness: 1, roughness: 0.18, max: 0.62 }, glints: 0.3, glow: [1, 1.6], haze: 0.3, line: '#2a1f0d', lineGlow: [1.6, 30], dome: 'round', win: 0.7, room: 0.15 },
};
const LINE ={ staff: 0.1, stem: 0.11, ledger: 0.13, bar: 0.14, system: 0.16, lift: 0.004 };
const HEAD_W = 1.18, STEM_DX = 0.53, STEM_DY = 0.168; // Bravura notehead width; stem centre and start relative to the head centre

// ---- shaders ----
// The corner shade (CORNER.shade), shared by the paper and the 3D pieces: how much of the lamp's light is held back at
// a point of the picture (uv: 0..1 from the bottom left) whose place on the page is py (ss up the page). uCS = (on,
// depth at the top-left corner, depth at the bottom-right corner, dither); uCSA = (the picture's width and height in
// its shorter side, the direction the staves run in the picture, in the same units).
const CS = CORNER.shade, glf = (v) => v.toFixed(4);
const srgbLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // one sRGB channel as linear light
const SHADE_GLSL = `
#ifdef CORNER_SHADE
uniform vec4 uCS, uCSA;
float cornerShade(vec2 uv, float py) {
  vec2 q = (uv - 0.5) * uCSA.xy, hc = 0.5 * uCSA.xy, a = uCSA.zw, n = vec2(-a.y, a.x);
  vec2 d0 = q - vec2(-hc.x, hc.y), d1 = q - vec2(hc.x, -hc.y);
  float x0 = min(length(vec2(dot(d0, a) / ${glf(CS.R[0][0])}, dot(d0, n) / ${glf(CS.R[0][1])})), 1.0);
  float x1 = min(length(vec2(dot(d1, a) / ${glf(CS.R[1][0])}, dot(d1, n) / ${glf(CS.R[1][1])})), 1.0);
  float m0 = clamp((py - ${glf(CS.band[0][0])}) / ${glf(CS.band[0][1] - CS.band[0][0])}, 0.0, 1.0), m1 = clamp((py - ${glf(CS.band[1][0])}) / ${glf(CS.band[1][1] - CS.band[1][0])}, 0.0, 1.0);
  m0 *= m0 * (3.0 - 2.0 * m0); m1 *= m1 * (3.0 - 2.0 * m1);
  return uCS.y * pow(1.0 - x0, ${glf(CS.p)}) * m0 + uCS.z * pow(1.0 - x1, ${glf(CS.p)}) * m1;
}
vec3 shadeLeft(float s) { return pow(vec3(max(1.0 - s, 1e-4)), vec3(${glf(1 - CS.warm)}, 1.0, ${glf(1 + 1.5 * CS.warm)})); }
#endif
`;
const PAPER_VERT = `
uniform vec2 uOrigin;
varying vec3 vW; varying vec4 vClip; varying vec2 vP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vP = w.xz - uOrigin; vClip = projectionMatrix * viewMatrix * w; gl_Position = vClip; }`;
// The paper. uTintNear / uTintFar: its colour in full and in dim light (sRGB, brightest channel 1); uTex: its texture
// (r: fine tone, g b: the slope of its grain, a: slow tone), sampled every uTile.x ss and every uTile.y ss (vP: the
// place on the page, from a whole number of tiles away); uLook = (fine tone, slow tone, grain, cockle); uKey: toward
// the key light; uShade = (ambient share, contact darkening, height below which it darkens, height of the softest
// shadow); uMask, uMaskSoft: the shadow mask, sharp and blurred (r: how much of the key is held back, g: the height of
// what holds it back / 4), over the window uMaskBox = (x0, z0, 1 / W, 1 / H). uLight: the light the lit notes and the
// light trails throw on the paper (the light map, over the same window); uPool = (the balls' pool brightness, the
// height added to a ball's own for its pool, the soft limit of all the pools together).
const PAPER_FRAG = `
uniform vec3 uCam, uTintNear, uTintFar, uKey; uniform float uVn, uDn, uLam, uCap, uFade;
uniform sampler2D uTex, uMask, uMaskSoft, uLight; uniform vec2 uTile; uniform vec4 uLook, uShade, uMaskBox; uniform vec3 uPool;
// The balls: uBall = (x, height, z, radius; 0 = none), uBallColor = the colour their reflection takes, uPoolColor =
// the colour of the light they throw; uRefl = (brightness, gloss in radians, -, sideways narrowing).
uniform vec4 uBall[2], uRefl; uniform vec3 uBallColor[2], uPoolColor[2];
uniform float uAccOn; uniform vec2 uAccK; uniform vec4 uAccA[2], uAccP[4], uRing[16]; uniform vec2 uBand[2]; uniform vec3 uAccC[2];
varying vec3 vW; varying vec4 vClip; varying vec2 vP;${SHADE_GLSL}
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); } // fixed dither against banding
void main() {
  float D = distance(vW, uCam);
  float v = uVn * exp(-(D - uDn) / uLam);
  vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;                     // place in the picture, 0..1 from the bottom left
  float cx = mix(0.38, 0.5, uv.y), dx = uv.x - cx;
  v *= 1.0 - mix(dx < 0.0 ? 0.1 : 0.34, 0.45, uv.y) * dx * dx;    // slight vignette, as measured
  v = v / pow(1.0 + pow(v / uCap, 4.0), 0.25);                  // a soft cap: lit paper, never glaring
  vec3 c = v * mix(uTintFar, uTintNear, smoothstep(0.2, 0.7, v / uCap));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  vec3 col = toLinear(max(c, 0.0));
  // The sheet: its fibres and formation (fine tone), slow changes of tone, and the grain and faint cockle lit by the key.
  vec4 g = texture2D(uTex, vP * uTile.x);
  float slow = texture2D(uTex, vP * uTile.y + vec2(0.37, 0.61)).a;
  vec2 sl = (g.gb - 0.5) * 2.0 * uLook.z
          + uLook.w * vec2(cos(vW.x * 0.071 + 1.3 * sin(vW.z * 0.043)), cos(vW.z * 0.083 + 1.1 * sin(vW.x * 0.037)));
  vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
  float dif = max(dot(N, uKey), 0.0) / uKey.y;
  // The key light's shadows: sharp where what casts them is low, soft where it is high, a touch darker where it meets
  // the paper; faded out near the ends of the window.
  vec2 mu = (vW.xz - uMaskBox.xy) * uMaskBox.zw;
  float occ = 0.0, ao = 0.0;
  vec3 pool = vec3(0.0);
  if (mu.x > 0.0 && mu.x < 1.0 && mu.y > 0.0 && mu.y < 1.0) {
    vec4 m0 = texture2D(uMask, mu), m1 = texture2D(uMaskSoft, mu);
    float hb = 4.0 * m1.g / max(m1.r, 0.03), edge = smoothstep(0.0, 0.03, mu.x) * (1.0 - smoothstep(0.88, 1.0, mu.x));
    occ = mix(m0.r, m1.r, smoothstep(0.05, uShade.w, hb)) * edge;
    ao = uShade.y * m1.r * (1.0 - smoothstep(0.0, uShade.z, hb)) * edge;
    pool = texture2D(uLight, mu).rgb * smoothstep(0.0, 0.03, mu.x) * (1.0 - smoothstep(0.97, 1.0, mu.x));
  }
  float E = (uShade.x + (1.0 - uShade.x) * (1.0 - occ) * dif) * (1.0 - ao);
  float tone = (1.0 + uLook.x * (g.r - 0.5) * 2.0) * (1.0 + uLook.y * (slow - 0.5) * 2.0);
  col *= E * tone;
  // The corner shade (with the corner light on): the lamp's light falling off into the open corners (CORNER.shade).
#ifdef CORNER_SHADE
  float csh = cornerShade(uv, -vW.z);
  col *= shadeLeft(csh);
#endif
  // The glows' light: the pools of the lit notes and light trails (above), and of each ball, as from a small lamp at
  // its height (plus uPool.y); all of them together held under uPool.z (softly), tinted by the paper, which takes it in.
  for (int i = 0; i < 2; i++) {
    vec4 b = uBall[i];
    if (b.w <= 0.0) continue;
    vec2 q = b.xz - vW.xz; float hb = b.y + uPool.y;
    pool += uPoolColor[i] * uPool.x * hb / pow(dot(q, q) + hb * hb, 1.5);
  }
  // Corner light (CORNER): for each hand, soft pools (uAccP: x, z, radius, brightness; two per hand) and rings (uRing:
  // radius, width, brightness; eight per hand, centred on the corner's place uAccA: x, z, stretch along the staves),
  // fading out toward the music (uBand: per hand, the page height where it starts and where it is full).
  vec3 acc = vec3(0.0);
  if (uAccOn > 0.5) {
    float py = -vW.z;
    for (int h = 0; h < 2; h++) {
      float m = clamp((py - uBand[h].x) / (uBand[h].y - uBand[h].x), 0.0, 1.0);
      if (m <= 0.0) continue;
      m *= m * (3.0 - 2.0 * m);
      vec2 d = vW.xz - uAccA[h].xy; d.x /= uAccA[h].z;
      float r = length(d), e = 0.0;
      for (int i = 0; i < 8; i++) { vec4 g = uRing[h * 8 + i]; if (g.z > 0.0) { float q = (r - g.x) / g.y; e += g.z * exp(-q * q); } }
      for (int i = 0; i < 2; i++) { vec4 p = uAccP[h * 2 + i]; if (p.w > 0.0) { vec2 q = vW.xz - p.xy; q.x /= uAccA[h].z; e += p.w / pow(1.0 + dot(q, q) / (p.z * p.z), 1.5); } }
      acc += uAccC[h] * e * m * sqrt(clamp(v / uCap, 0.25, 1.0)); // (as gentle on the dimmer far paper as on the near)
    }
  }
  float pm = max(max(pool.r, pool.g), pool.b);
  if (pm > 1e-5) col += toLinear(uTintNear) * tone * pool * (uPool.z * (1.0 - exp(-pm / uPool.z)) / pm);
  // the corner light: added under its own soft limit (uAccK.x), holding back a little of the lamp's light where it is
  // strong (uAccK.y), so it shows a hint of its colour on bright paper (its colour is divided by the paper's: see CORNER)
  float am = max(max(acc.r, acc.g), acc.b);
  if (am > 1e-5) { float ka = 1.0 - exp(-am / uAccK.x); col = col * (1.0 - uAccK.y * ka) + toLinear(uTintNear) * tone * acc * (uAccK.x * ka / am); }
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
    col += uBallColor[i] * uRefl.x * refl;
  }
#ifdef CORNER_SHADE
  if (csh > 0.0) { // a fixed noise of about uCS.w levels (triangular, as the picture is stored), so the shade never bands
    float tp = ign(gl_FragCoord.xy) + ign(gl_FragCoord.yx + vec2(5.37, 17.71)) - 1.0, l = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    col *= 1.0 + tp * uCS.w * 2.2 / (255.0 * pow(l, 0.4545)) * smoothstep(0.0, 0.05, csh);
  }
#endif
  gl_FragColor = vec4(col * uFade, 1.0);
}`;
// The shadow mask: each raised piece (and each ball) drawn from straight above after sliding every point of it along
// the key light down onto the paper (uKey: toward the light; uBox as uMaskBox), so what is drawn is its shadow. r: how
// much of the light it holds back (uK; the largest wins), g: the height it is cast from / 4 (the highest wins).
// uLift: the printing ink is drawn as if it stood that many times higher than it is, so a notehead's shadow shows.
const MASK_VERT = `
uniform vec3 uKey; uniform vec4 uBox; uniform float uLift; varying float vH;
void main() {
  vec4 w = vec4(position, 1.0);
#ifdef USE_INSTANCING
  w = instanceMatrix * w;
#endif
  w = modelMatrix * w;
  w.y *= uLift;
  vH = max(w.y, 0.0);
  vec2 p = w.xz - uKey.xz * (w.y / uKey.y);
  gl_Position = vec4((p - uBox.xy) * uBox.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const MASK_FRAG = 'uniform float uK; varying float vH; void main() { gl_FragColor = vec4(uK, min(vH * 0.25, 1.0), 0.0, 1.0); }';
// A Gaussian blur of the mask along one direction (uStep: one texel of the picture drawn; uSig: sigma in those texels).
const BLUR_FRAG = `
uniform sampler2D uTex; uniform vec2 uStep; uniform float uSig; varying vec2 vUv;
void main() {
  vec4 s = vec4(0.0); float wt = 0.0;
  for (int i = -6; i <= 6; i++) { float f = float(i), k = exp(-0.5 * f * f / (uSig * uSig)); s += k * texture2D(uTex, vUv + uStep * f); wt += k; }
  gl_FragColor = s / wt;
}`;
// Thin lines: each is a flat ribbon on the paper. On screen it is widened to at least uMinPx (drawing pixels) across,
// and made fainter by the same factor, so its coverage stays right while it can never break up into dashes. The ribbon
// is drawn one pixel wider on each side and its edges are shaded by how much of each pixel the line covers (vAcross =
// pixels from its middle, vHalf = its half width), which keeps a thin line at a shallow angle smooth instead of
// beaded, even when the picture is drawn at one pixel per screen pixel.
const LINE_VERT = `
attribute vec3 aOff; attribute vec3 aDir; attribute float aSide;
uniform vec2 uRes; uniform float uMinPx;
varying float vAlpha, vAcross, vHalf; varying vec3 vW, vT;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vT = aDir;
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
// A line is a thin, glossy wire lying on the paper: each glow near it (uGW: its place, world, and radius, 0 = none; uGC:
// its colour and strength) shows on it as a short streak of its colour, where the wire's slope mirrors it toward the
// camera (a wire's highlight, after Kajiya and Kay: brightest where the light and the eye make mirrored angles with
// the wire; uGlint = brightness, sharpness, the lamp's size softening it close by).
const LINE_FRAG = `
uniform vec3 uColor, uCam; uniform float uFar0, uFar1, uFarFade, uOpacity, uMax; uniform vec4 uGW[${GLOWS}]; uniform vec3 uGC[${GLOWS}]; uniform vec2 uGlint;
varying float vAlpha, vAcross, vHalf; varying vec3 vW, vT;
void main() {
  float a = vAlpha * clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * uOpacity * (1.0 - uFarFade * smoothstep(uFar0, uFar1, distance(vW, uCam)));
  vec3 col = uColor, Vv = normalize(uCam - vW), T = normalize(vT);
  float b = dot(T, Vv), sb = sqrt(max(1.0 - b * b, 0.0));
  for (int i = 0; i < ${GLOWS}; i++) {
    vec4 s = uGW[i];
    if (s.w <= 0.0) continue;
    vec3 d = s.xyz - vW; float d2 = dot(d, d);
    if (d2 > 625.0) continue;
    vec3 Ln = d * inversesqrt(d2);
    float c = dot(T, Ln), k = max(sqrt(max(1.0 - c * c, 0.0)) * sb - c * b, 0.0), p = uGlint.y / (1.0 + 0.5 * uGlint.y * s.w * s.w / d2);
    col += uGC[i] * uGlint.x * pow(k, p) * clamp(Ln.y + 0.2, 0.0, 1.0) / (d2 + s.w * s.w);
  }
  float m = max(max(col.r, col.g), col.b);
  col *= 1.0 / pow(1.0 + pow(m / uMax, 6.0), 1.0 / 6.0);         // a soft limit, under the bloom threshold
  gl_FragColor = vec4(col, a);
}`;
// The glow around a lit note: a square lying on the paper around each notehead, drawn (adding light) only once the
// note has been played. aHead = (x, page y, time it lights, kind + 3 * hand); kind 0 solid, 1 half, 2 whole picks a
// cell of uSdf, the signed distance (ss) from the notehead's outline (negative inside). The lit notehead itself is
// the ink head drawn white (see headMaterial); this adds the halo around it, and the light in a hollow head's slot.
// On light paper a halo of added light alone washes out to white, so it also dims the paper where it is strong (uDim):
// its colour is what you see there, as when a coloured lamp outshines the room light. Laid over the paper this way
// (colour * a added, the paper below dimmed by uDim * a), halos that overlap never add up past their colour / uDim.
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
uniform sampler2D uSdf; uniform float uR, uGrow, uTintD, uFade, uDim; uniform vec2 uK, uW; uniform vec3 uRim[2], uHalo[2]; uniform vec2 uWin;
varying vec2 vLocal; varying float vCell, vHand;
void main() {
  vec2 uv = vec2((vLocal.x / (2.0 * uR) + 0.5 + vCell) / 3.0, vLocal.y / (2.0 * uR) + 0.5);
  float d = max(texture2D(uSdf, uv).r - uGrow, 0.0);
  float a = min(dot(uK, exp(-d / uW)), 1.0) * (1.0 - smoothstep(uWin.x, uWin.y, length(vLocal))) * uFade;
  vec3 tint = vHand < 0.5 ? mix(uRim[0], uHalo[0], smoothstep(0.0, uTintD, d)) : mix(uRim[1], uHalo[1], smoothstep(0.0, uTintD, d));
  gl_FragColor = vec4(tint * a, uDim * a); // (alpha: how much it dims the paper under it)
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
// The glows as lights on the 3D pieces (added to three.js's own shading, after its lights): uGL = each glow's place in
// view space and its radius (0 = none), uGLC its colour and strength. Each is shaded as three.js shades its own lamps
// (so metal mirrors it, gold tints it, glass and the lacquer show it in their clear shine), with the highlight widened
// by the lamp's size close by (its radius / 2 per unit of distance, added to the roughness squared, as for a round
// lamp); kd and ks weigh its light and its highlight, and kh adds a broad sheen of its colour (the faint haze around
// a polished metal's highlight), so the walls and rims that face a lit note or a ball take on its colour.
const GL_DECL = `uniform vec4 uGL[${GLOWS}]; uniform vec3 uGLC[${GLOWS}];\n`;
// The corner shade on the 3D pieces: the share of the lamp's light (direct and from the room) that reaches them where
// they are in the picture (gl_FragCoord x uCSR, its size's inverse) and on the page (their place in view space through
// uCSV, the camera's world matrix), right after three.js's own lights.
const SHADE_DECL = '#ifdef CORNER_SHADE\nuniform vec2 uCSR; uniform mat4 uCSV;\n#endif' + SHADE_GLSL;
const SHADE_HOOK = `
#ifdef CORNER_SHADE
 {
   vec3 ks = shadeLeft(cornerShade(gl_FragCoord.xy * uCSR, -(uCSV * vec4(-vViewPosition, 1.0)).z));
   reflectedLight.directDiffuse *= ks; reflectedLight.directSpecular *= ks; reflectedLight.indirectDiffuse *= ks; reflectedLight.indirectSpecular *= ks;
#ifdef USE_CLEARCOAT
   clearcoatSpecularDirect *= ks; clearcoatSpecularIndirect *= ks;
#endif
 }
#endif`;
const glowCode = (kd, ks, kh = 0) => `
 { // the glows: their light on it and their highlights in its shine
#ifdef USE_CLEARCOAT
  vec3 ccKeep = clearcoatSpecularDirect;
#endif
  for (int i = 0; i < ${GLOWS}; i++) {
    vec4 s = uGL[i];
    if (s.w <= 0.0) continue;
    vec3 L = s.xyz - geometryPosition; float d2 = dot(L, L);
    if (d2 > 625.0) continue;                                     // (more than 25 ss away: too faint to show)
    float d = sqrt(d2), widen = 0.5 * s.w / d;
    IncidentLight il; il.direction = L / d; il.color = uGLC[i] / (d2 + s.w * s.w); il.visible = true;
    PhysicalMaterial gm = material;
    gm.roughness = sqrt(min(1.0, pow2(material.roughness) + widen));
#ifdef USE_CLEARCOAT
    gm.clearcoatRoughness = sqrt(min(1.0, pow2(material.clearcoatRoughness) + widen));
#endif
    ReflectedLight one = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
    RE_Direct(il, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, gm, one);
    reflectedLight.directDiffuse += ${kd.toFixed(3)} * one.directDiffuse;
    reflectedLight.directSpecular += ${ks.toFixed(3)} * one.directSpecular;${kh > 0 ? `
    reflectedLight.directSpecular += ${kh.toFixed(3)} * material.specularColorBlended * il.color * max(dot(geometryNormal, il.direction), 0.0)
      * (0.5 + 0.5 * max(dot(geometryNormal, normalize(il.direction + geometryViewDir)), 0.0));` : ''}
  }
#ifdef USE_CLEARCOAT
  clearcoatSpecularDirect = ccKeep + ${ks.toFixed(3)} * (clearcoatSpecularDirect - ccKeep);
#endif
 }`;
// The light map: the light the lit notes throw on the paper, drawn from straight above into a texture over the shadow
// mask's window (uBox, as there), adding up. One square per notehead (the halos' own squares and their aHead), drawn
// once the note has been played: k / (1 + (r / h)^2)^1.5 at r ss from the note (uPool = k, h, R).
const POOL_VERT = `
attribute vec4 aHead; uniform float uTime; uniform vec4 uBox; uniform vec3 uPool;
varying vec2 vLocal; varying float vHand;
void main() {
  if (aHead.z > uTime) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); vHand = 0.0; return; } // not played yet
  vHand = floor(aHead.w / 3.0 + 0.01);
  vLocal = position.xy * uPool.z;
  vec2 p = vec2(aHead.x + vLocal.x, -(aHead.y + vLocal.y));
  gl_Position = vec4((p - uBox.xy) * uBox.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const POOL_FRAG = `
uniform vec3 uPool, uColor[2]; varying vec2 vLocal; varying float vHand;
void main() {
  float r = length(vLocal), e = uPool.x / pow(1.0 + r * r / (uPool.y * uPool.y), 1.5) * (1.0 - smoothstep(0.7 * uPool.z, uPool.z, r));
  gl_FragColor = vec4((vHand < 0.5 ? uColor[0] : uColor[1]) * e, 1.0);
}`;
// A light trail: a ribbon along the points of a ball's path (position, world; aTan: the direction of travel there;
// aAge: how long ago the ball was there, as a share of TRAIL.T; aSide: which edge), turned to face the camera and
// uW ss wide, but never under uMinPx drawing pixels (thinner, it fades instead, so it never breaks up). Its colour
// (uColor) is laid over what lies behind it as the halos are (the colour added, what is behind dimmed by uDim), fading
// with age as (1 - age)^uPow, and coming in softly just behind the ball.
const TRAIL_VERT = `
attribute vec3 aTan; attribute float aSide, aAge; uniform vec2 uRes; uniform float uW, uMinPx;
varying float vAcross, vAge, vK;
void main() {
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 w = vec4(position, 1.0), c0 = pv * w, c1 = pv * (w + vec4(aTan * 0.05, 0.0));
  vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5, along = normalize(s1 - s0 + vec2(1e-6, 0.0));
  float px = uW * 0.5 * uRes.y * projectionMatrix[1][1] / max(c0.w, 1e-3), core = max(px, uMinPx) * 0.5, hw = 2.5 * core + 1.0;
  vK = px / max(px, uMinPx); vAge = aAge; vAcross = aSide * hw / core;
  c0.xy += vec2(-along.y, along.x) * aSide * hw / (uRes * 0.5) * c0.w;
  gl_Position = c0;
}`;
const TRAIL_FRAG = `
uniform vec3 uColor; uniform float uFade, uDim, uPow; varying float vAcross, vAge, vK;
void main() {
  float a = exp(-1.6 * vAcross * vAcross) * pow(max(1.0 - vAge, 0.0), uPow) * smoothstep(0.0, 0.05, vAge) * vK * uFade;
  gl_FragColor = vec4(uColor * a, uDim * a);
}`;
// The light a trail throws on the paper (into the light map): the same ribbon seen from straight above, lying on the
// paper under the path, wider and fainter where the path is high (uK = brightness, uW = half its width at the paper).
const TRAIL_POOL_VERT = `
attribute vec3 aTan; attribute float aSide, aAge; uniform vec4 uBox; uniform float uW;
varying float vAcross, vAge, vH;
void main() {
  vec2 t = aTan.xz; float l = length(t); t = l > 1e-4 ? t / l : vec2(1.0, 0.0);
  vH = max(position.y, 0.0); vAcross = aSide; vAge = aAge;
  vec2 p = position.xz + vec2(-t.y, t.x) * aSide * uW * (1.0 + 0.6 * vH);
  gl_Position = vec4((p - uBox.xy) * uBox.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const TRAIL_POOL_FRAG = `
uniform vec3 uColor; uniform float uK, uPow; varying float vAcross, vAge, vH;
void main() { gl_FragColor = vec4(uColor * uK * pow(max(1.0 - vAge, 0.0), uPow) * exp(-3.0 * vAcross * vAcross) / (1.0 + 0.4 * vH * vH), 1.0); }`;
// An electric filament of the corner light (CORNER.electric), drawn segment by segment: each segment (aA to aB, on the
// paper; position is aA) a quad round it in the picture, which lights the pixels nearer to it than to the segments before and after
// it on its piece (aP to aA, aB to aN; none at the piece's ends, where aP = aA or aN = aB), by their distance from it.
// So the filament's light is a true function of the distance from the whole line: round joins and ends, nothing
// folds or creases at a sharp bend, and nothing is counted twice. aAl: its brightness at aA and aB; aWd: its width
// there (a share of uW ss), never under uMinPx drawing pixels (thinner, it fades instead); aE: 1 on the first segment
// of each piece, where (uEnd 1: the halo) it fades in from aA, so a branch's halo starts softly inside the
// filament's own; aCorner: which corner of the quad. Laid over the paper as the trails are (its colour added, what is
// behind dimmed by uDim); drawn twice: the thin core and a soft halo. Its places are worked out in drawing pixels from
// the middle of the picture, and passed as such (w = 1), so they are interpolated straight across the picture; each
// corner takes the depth of the paper under it (a little above it: uInvPV undoes the camera), so the paper never cuts
// into the halo, while anything raised (the 3D title) still hides it.
const ARC_VERT = `
attribute vec2 aCorner, aAl, aWd; attribute vec3 aP, aB, aN; attribute float aE; uniform vec2 uRes; uniform float uW, uMinPx, uEnd; uniform mat4 uInvPV;
flat varying vec4 vAB, vPN, vK; flat varying vec2 vHas; varying vec2 vS;
vec2 onScreen(vec4 c) { return c.xy / c.w * uRes * 0.5; }
float paperDepth(vec2 s, mat4 pv) {
  vec2 q = s / (uRes * 0.5); vec4 a = uInvPV * vec4(q, -1.0, 1.0), b = uInvPV * vec4(q, 1.0, 1.0); a /= a.w; b /= b.w;
  vec4 c = pv * vec4(mix(a.xyz, b.xyz, clamp((a.y - 0.05) / max(a.y - b.y, 1e-6), 0.0, 1.0)), 1.0);
  return clamp(c.z / c.w, -1.0, 1.0);
}
void main() {
  mat4 pv = projectionMatrix * viewMatrix;
  vec4 ca = pv * vec4(position, 1.0), cb = pv * vec4(aB, 1.0);
  vec2 sa = onScreen(ca), sb = onScreen(cb), sp = onScreen(pv * vec4(aP, 1.0)), sn = onScreen(pv * vec4(aN, 1.0));
  float k = 0.5 * uW * uRes.y * projectionMatrix[1][1], pa = k * aWd.x / max(ca.w, 1e-3), pb = k * aWd.y / max(cb.w, 1e-3);
  float ra = max(pa, uMinPx) * 0.5, rb = max(pb, uMinPx) * 0.5, hw = 2.5 * max(ra, rb) + 1.0;
  vec2 d = sb - sa; float l = length(d); vec2 t = l > 1e-3 ? d / l : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  vS = (aCorner.x < 0.5 ? sa - t * hw : sb + t * hw) + n * aCorner.y * hw;
  vAB = vec4(sa, sb); vPN = vec4(sp, sn); vHas = vec2(step(1e-3, distance(sp, sa)), step(1e-3, distance(sn, sb)));
  vK = vec4(ra, rb, aAl.x * pa / max(pa, uMinPx) * (1.0 - uEnd * aE), aAl.y * pb / max(pb, uMinPx));
  gl_Position = vec4(vS / (uRes * 0.5), paperDepth(vS, pv), 1.0);
}`;
const ARC_FRAG = `
uniform vec3 uColor; uniform float uFade, uDim;
flat varying vec4 vAB, vPN, vK; flat varying vec2 vHas; varying vec2 vS;
float segD(vec2 p, vec2 a, vec2 b, out float u) { vec2 ab = b - a; u = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * u); }
void main() {
  float u, v, d = segD(vS, vAB.xy, vAB.zw, u);
  if (vHas.x > 0.5 && segD(vS, vPN.xy, vAB.xy, v) < d) discard;   // (nearer the segment before: it lights this pixel)
  if (vHas.y > 0.5 && segD(vS, vAB.zw, vPN.zw, v) <= d) discard;  // (or the one after)
  float q = d / mix(vK.x, vK.y, u), a = exp(-1.6 * q * q) * mix(vK.z, vK.w, u) * uFade;
  gl_FragColor = vec4(uColor * a, uDim * a);
}`;
// Powder sparks (SPARK): one instance per particle, aI = (puff slot, particle number). Puff slot s: uPuff[s] = (x, z of
// the touch, time since it, seed), uPuffK[s] = (brightness, how many particles it has, hand). A particle's path is a
// closed formula of that time (see SPARK), from numbers drawn from the seed and its own number by an integer hash.
const SPARK_PATH = `
attribute vec2 aI; uniform vec4 uPuff[${2 * SPARK.slots}], uPuffK[${2 * SPARK.slots}]; uniform vec2 uLife, uUp, uOut, uDrag, uSize; uniform vec4 uMot; // uMot = (g, r0, y0, hot)
float hsh(uint a, uint b) { uint h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u; h ^= h >> 15; h *= 0x2C1B3C6Du; h ^= h >> 12; h *= 0x297A2D39u; h ^= h >> 15; return float(h >> 8) / 16777216.0; }
// into xyz (world), b (brightness), hot (white-hot share), size (ss), hand; false when the particle is not shown
bool particle(out vec3 xyz, out float b, out float hot, out float size, out float hand) {
  int s = int(aI.x + 0.5); vec4 P = uPuff[s], K = uPuffK[s];
  uint sd = uint(P.w), pi = uint(aI.y) * 8u;
  float tau = P.z, L = mix(uLife.x, uLife.y, hsh(sd, pi));
  xyz = vec3(0.0); b = 0.0; hot = 0.0; size = 0.0; hand = K.z;
  if (K.x <= 0.0 || tau < 0.0 || tau > L || aI.y >= K.y) return false;
  float az = 6.2831853 * hsh(sd, pi + 1u), rr = uMot.y * sqrt(hsh(sd, pi + 2u));
  float vo = mix(uOut.x, uOut.y, hsh(sd, pi + 3u)), vu = mix(uUp.x, uUp.y, hsh(sd, pi + 4u)), k = mix(uDrag.x, uDrag.y, hsh(sd, pi + 5u));
  float e = (1.0 - exp(-k * tau)) / k;
  vec2 xz = P.xy + vec2(cos(az), sin(az)) * (rr + vo * e);
  float y = max(uMot.z + (vu + uMot.x / k) * e - uMot.x / k * tau, 0.03);
  xyz = vec3(xz.x, y, xz.y);
  hot = exp(-tau / uMot.w);
  b = K.x * (1.0 - smoothstep(L * ${(1 - SPARK.tail).toFixed(3)}, L, tau)) * (0.65 + 0.35 * hot) * mix(0.7, 1.0, smoothstep(0.03, 0.3, y));
  size = mix(uSize.x, uSize.y, hsh(sd, pi + 6u));
  return true;
}`;
const SPARK_VERT = `${SPARK_PATH}
uniform vec2 uRes; uniform float uMinPx; uniform vec3 uCol[2];
varying vec2 vQ; varying vec3 vC; varying float vB;
void main() {
  vec3 p; float b, hot, size, hand;
  if (!particle(p, b, hot, size, hand)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vQ = vec2(0.0); vC = vec3(0.0); vB = 0.0; return; }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float px = size * uRes.y * 0.5 * projectionMatrix[1][1] / max(-mv.z, 1e-3), grow = max(1.0, uMinPx / max(px, 1e-4));
  vB = b / (grow * grow); // drawn no smaller than uMinPx, its light spread over the larger dot
  vC = mix(hand < 0.5 ? uCol[0] : uCol[1], vec3(1.0), 0.35 * hot);
  vQ = position.xy; mv.xy += position.xy * 2.0 * size * grow; // the square reaches two radii
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = `
uniform float uLum, uDim, uFade; varying vec2 vQ; varying vec3 vC; varying float vB;
void main() { float a = exp(-5.6 * dot(vQ, vQ)) * vB * uFade; gl_FragColor = vec4(vC * uLum * a, uDim * a); }`;
// The light the sparks throw on the paper (into the light map): each particle a tiny lamp at its height (+ uH0 ss),
// a pool as POOL's, as bright as uK at the paper when the particle lies on it and weaker when it is higher.
const SPARK_POOL_VERT = `${SPARK_PATH}
uniform vec4 uBox; uniform float uH0;
varying vec2 vLocal; varying float vH, vB, vHand;
void main() {
  vec3 p; float b, hot, size, hand;
  if (!particle(p, b, hot, size, hand)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); vH = 1.0; vB = 0.0; vHand = 0.0; return; }
  vH = p.y + uH0; vB = b * (0.75 + 0.25 * hot); vHand = hand;
  vLocal = position.xy * 3.0 * vH;
  gl_Position = vec4((p.xz + vLocal - uBox.xy) * uBox.zw * 2.0 - 1.0, 0.0, 1.0);
}`;
const SPARK_POOL_FRAG = `
uniform float uK, uH0; uniform vec3 uCol[2]; varying vec2 vLocal; varying float vH, vB, vHand;
void main() {
  float q = dot(vLocal, vLocal) / (vH * vH), e = uK * vB * (uH0 * uH0) / (vH * vH) / pow(1.0 + q, 1.5) * (1.0 - smoothstep(4.0, 9.0, q));
  gl_FragColor = vec4((vHand < 0.5 ? uCol[0] : uCol[1]) * e, 1.0);
}`;
// The surroundings the lacquer, chrome and the finishes reflect, a dim studio: the lit paper below (uFloor, linear),
// darkness above, and the soft key light behind and above the camera. For the polished finishes (uWin > 0) the room
// also has one large soft window ahead of the camera, a little to its right and low (about 3 to 22 deg up, 50 deg
// wide, its edges soft), in a daylight tinted by the paper (uWinC): the flat tops of the far notes mirror it and
// gleam softly as they glide through it, while the near tops mirror the dark room above and stay dark. Under it a
// faint warm glow of the room's walls, and (uRoom) the dim walls and ceiling, brighter toward the horizon, so the near
// flat tops of polished metal read as dark steel rather than black. Baked once per paper colour and finish, for the
// camera's average heading (uHead).
const ENV_FRAG = `
uniform vec3 uKey, uFloor, uHead, uWinC; uniform float uWin, uRoom; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = d.y < 0.0 ? uFloor * (0.35 + 0.65 * smoothstep(-0.12, -0.9, d.y)) * smoothstep(0.0, -0.06, d.y) : vec3(0.004, 0.004, 0.006);
  if (uWin > 0.0) {
    vec3 fw = normalize(vec3(uHead.x, 0.0, uHead.z)), sd = vec3(-fw.z, 0.0, fw.x);
    vec2 h = vec2(dot(d, fw), dot(d, sd));
    float az = atan(h.y, h.x) - 0.12, el = asin(clamp(d.y, -1.0, 1.0));
    float win = smoothstep(0.46, 0.3, abs(az)) * smoothstep(0.03, 0.1, el) * smoothstep(0.42, 0.3, el);
    float wall = exp(-pow(az / 0.9, 2.0)) * smoothstep(-0.02, 0.05, el) * smoothstep(0.7, 0.1, el);
    col += uWin * uWinC * (win + 0.04 * wall);
    if (d.y > 0.0) col += uRoom * uWinC * (0.6 + 0.4 * exp(-el / 0.35)); // the room's dim walls and ceiling
  }
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
// win: the strength of the window (0: none, as the matte ink and its lacquer have always seen the room). Each map is
// made once per renderer and kept (one per paper colour and window strength in use).
function paperEnv(renderer, paper, win = 0, room = 0) {
  if (!renderer) return null;
  if (!ENVS.has(renderer)) ENVS.set(renderer, new Map());
  const made = ENVS.get(renderer), id = paper.id + ':' + win + ':' + room;
  if (made.has(id)) return made.get(id);
  const az = (CAM.wide.yaw + LIGHT.envOff) * DEG, el = 51 * DEG, yaw = CAM.wide.yaw * DEG;
  const key = new THREE.Vector3(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
  const t = tintOf(paper.near), wc = new THREE.Color().setRGB(0.55 + 0.45 * t.x, 0.55 + 0.45 * t.y, 0.55 + 0.45 * t.z, THREE.SRGBColorSpace);
  const scene = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 64, 32);
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uKey: { value: key }, uFloor: { value: paperFloor(paper) },
    uHead: { value: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) }, uWinC: { value: new THREE.Vector3(wc.r, wc.g, wc.b).multiplyScalar(ENV_WIN * paper.expo) }, uWin: { value: win }, uRoom: { value: room } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: ENV_FRAG });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer), tex = pm.fromScene(scene, 0).texture;
  pm.dispose(); geo.dispose(); mat.dispose();
  made.set(id, tex);
  return tex;
}
const ENV_WIN = 0.55; // the window's brightness (linear, before the finish's own strength)
// A paper colour's tints (brightest channel 1), and the colour the lacquer sees of it below (linear: the lavender
// paper gives what it always reflected, the brighter papers a little more).
const tintOf = (css) => { const n = parseInt(css.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255], m = Math.max(...c); return new THREE.Vector3(c[0] / m, c[1] / m, c[2] / m); };
const paperOf = (id) => PAPERS.find((p) => p.id === id) || PAPERS.find((p) => p.id === PAPER_DEFAULT);
function paperFloor(p) {
  const t = tintOf(p.near), c = new THREE.Color().setRGB(t.x, t.y, t.z, THREE.SRGBColorSpace); // (linear)
  const k = 0.26 * (p.expo * LIGHT.cap) / 0.66;
  return new THREE.Vector3(c.r * k, c.g * k, c.b * k);
}

// The paper's texture, made once: r = its fine tone (fibres a little lighter or darker, and the formation: the
// cloudiness of paper held to the light), g b = the slope of its surface along x and z (grain, fibres, formation;
// 0.5 = flat), a = slow, faint changes of tone (used at the larger tile). Seeded and tileable; mipmapped and filtered
// anisotropically, so it never crawls or shimmers at a grazing angle.
let GRAIN_TEX = null;
function paperTexture(renderer) {
  if (!GRAIN_TEX) {
    const N = GRAIN.size, M = N - 1, NN = N * N;
    let seed = GRAIN.seed >>> 0;
    const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const h = new Float32Array(NN), tone = new Float32Array(NN), slow = new Float32Array(NN), tmp = new Float32Array(NN);
    const ease = (u) => u * u * u * (u * (u * 6 - 15) + 10);
    const noise = (dst, cells, amp) => { // periodic value noise, `cells` lattice cells across the tile
      const v = new Float32Array(cells * cells);
      for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
      const k = cells / N, tx = new Float32Array(N), x0 = new Int32Array(N), x1 = new Int32Array(N);
      for (let x = 0; x < N; x++) { const f = x * k, i = Math.floor(f); tx[x] = ease(f - i); x0[x] = i % cells; x1[x] = (i + 1) % cells; }
      for (let y = 0; y < N; y++) {
        const ty = tx[y], r0 = x0[y] * cells, r1 = x1[y] * cells;
        for (let x = 0; x < N; x++) {
          const a = v[r0 + x0[x]] + (v[r0 + x1[x]] - v[r0 + x0[x]]) * tx[x], b = v[r1 + x0[x]] + (v[r1 + x1[x]] - v[r1 + x0[x]]) * tx[x];
          dst[y * N + x] += amp * (a + (b - a) * ty);
        }
      }
    };
    // formation: soft clouds about 0.25 to 1 ss across, in the tone and, a little, in the surface
    noise(tone, 16, 0.55); noise(tone, 32, 0.3); noise(tone, 64, 0.2);
    noise(h, 32, 0.35); noise(h, 64, 0.3); noise(h, 128, 0.32);
    // grain: the tooth of the paper, a texel or two across
    for (let i = 0; i < NN; i++) tmp[i] = rnd() * 2 - 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (y - 1) & M, d = (y + 1) & M, l = (x - 1) & M, r = (x + 1) & M;
      h[y * N + x] += 0.3 * (4 * tmp[y * N + x] + 2 * (tmp[u * N + x] + tmp[d * N + x] + tmp[y * N + l] + tmp[y * N + r]) + tmp[u * N + l] + tmp[u * N + r] + tmp[d * N + l] + tmp[d * N + r]) / 16;
    }
    noise(h, 256, 0.3);
    // fibres: short, gently curved threads, most of them lying roughly along the sheet (x), a few across it
    for (let f = 0; f < GRAIN.fibres; f++) {
      let x = rnd() * N, y = rnd() * N, ang = rnd() < 0.65 ? (rnd() + rnd() + rnd() - 1.5) * 0.7 : rnd() * Math.PI;
      const len = 24 + 64 * rnd() * rnd(), bend = (rnd() - 0.5) * 0.006, w = 0.55 + 0.6 * rnd(), lift = (rnd() < 0.85 ? 1 : -0.6) * (0.08 + 0.16 * rnd());
      const shade = (rnd() - 0.35) * 0.6;
      for (let s = 0; s < len; s += 0.5) {
        const fade = Math.sin((Math.PI * s) / len), ix = Math.floor(x), iy = Math.floor(y);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const dx = ix + i + 0.5 - x, dy = iy + j + 0.5 - y, g = Math.exp(-(dx * dx + dy * dy) / (w * w)) * fade * 0.5;
          if (g < 0.01) continue;
          const k = ((iy + j) & M) * N + ((ix + i) & M);
          h[k] += lift * g; tone[k] += shade * g;
        }
        x += Math.cos(ang) * 0.5; y += Math.sin(ang) * 0.5; ang += bend;
      }
    }
    noise(slow, 4, 0.55); noise(slow, 8, 0.3); noise(slow, 16, 0.18);
    const sd = (a) => { let s = 0, q = 0; for (let i = 0; i < a.length; i++) { s += a[i]; q += a[i] * a[i]; } const m = s / a.length; return [m, Math.sqrt(Math.max(q / a.length - m * m, 1e-12))]; };
    const [tm, ts] = sd(tone), [sm, ssd] = sd(slow);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { // slopes, by central differences (wrapping round)
      const i = y * N + x;
      tmp[i] = (h[y * N + ((x + 1) & M)] - h[y * N + ((x - 1) & M)]) * 0.5;
    }
    const sx = sd(tmp)[1], gz = new Float32Array(NN);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) gz[y * N + x] = (h[((y + 1) & M) * N + x] - h[((y - 1) & M) * N + x]) * 0.5;
    const sz = sd(gz)[1], S = Math.max(sx, sz);
    const data = new Uint8Array(NN * 4), b = (v) => Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * v)));
    for (let i = 0; i < NN; i++) { // r, g, b, a: +-1 = three standard deviations (the slopes: the larger of the two)
      data[i * 4] = b((tone[i] - tm) / (3 * ts)); data[i * 4 + 1] = b(tmp[i] / (3 * S)); data[i * 4 + 2] = b(gz[i] / (3 * S)); data[i * 4 + 3] = b((slow[i] - sm) / (3 * ssd));
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.needsUpdate = true;
    GRAIN_TEX = tex;
  }
  if (renderer) GRAIN_TEX.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return GRAIN_TEX;
}

// What the shadow mask needs, made once per renderer and shared by every paper scene built on it (a scene is built
// again whenever the piece, title or picture size changes, and these would otherwise pile up): the mask (full) and two
// half-size targets for its blur (a, then b), the material that draws the shadows, a camera that picks what to draw,
// the two balls' shadow casters, and the blur passes. Layers: SHADOW_LAYER = the raised pieces, INK_LAYER = the ink.
const SHADOW_LAYER = 1, INK_LAYER = 2, KITS = new WeakMap();
function shadowKit(renderer) {
  if (!renderer) return null;
  if (KITS.has(renderer)) return KITS.get(renderer);
  const [MW, MH] = MASK.texels, opts = { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  const k = { full: new THREE.WebGLRenderTarget(MW, MH, opts), a: new THREE.WebGLRenderTarget(MW / 2, MH / 2, opts), b: new THREE.WebGLRenderTarget(MW / 2, MH / 2, opts) };
  k.maskU = { uKey: { value: new THREE.Vector3(0, 1, 0) }, uBox: { value: new THREE.Vector4() }, uK: { value: 1 }, uLift: { value: 1 } };
  k.maskMat = new THREE.ShaderMaterial({ uniforms: k.maskU, vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
  k.maskCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50); // (only for choosing what to draw: the shader places it)
  k.maskCam.rotation.x = -Math.PI / 2; k.maskCam.layers.set(SHADOW_LAYER);
  k.ballCasters = new THREE.Scene();
  k.ballCast = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(BALL.r * SHADE.ballSize, 16, 10), k.maskMat); m.frustumCulled = false; m.visible = false; m.layers.set(SHADOW_LAYER); k.ballCasters.add(m); return m; });
  k.blurU = [{ uTex: { value: k.full.texture }, uStep: { value: new THREE.Vector2(1 / (MW / 2), 0) }, uSig: { value: 2 } },
    { uTex: { value: k.a.texture }, uStep: { value: new THREE.Vector2(0, 1 / (MH / 2)) }, uSig: { value: 2 } }];
  k.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // the light map (the glows' light on the paper, over the same window), and a camera that draws everything in a
  // scene (the light-map shaders place what they draw themselves)
  k.light = new THREE.WebGLRenderTarget(POOL.texels[0], POOL.texels[1], { ...opts, type: THREE.HalfFloatType });
  k.lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const quad = new THREE.PlaneGeometry(2, 2);
  k.blurScenes = k.blurU.map((u) => {
    const sc = new THREE.Scene(), m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ uniforms: u, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: BLUR_FRAG }));
    m.frustumCulled = false; sc.add(m); return sc;
  });
  KITS.set(renderer, k);
  return k;
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
  return { core: new THREE.Vector3(...h.core), rim: lum(tint(h.rim).lerp(tint(h.halo), GLOW.rimSat), GLOW.rimLum), halo: lum(tint(h.halo), GLOW.haloLum), ball: new THREE.Vector3(...h.ball),
    ballRim: tint(h.ballRim).multiplyScalar(0.55), ballHalo: lum(tint(h.ballHalo), 0.22), refl: tint(h.refl) };
}

// ---- small geometry helpers ----
const flat = (geo) => geo.rotateX(-Math.PI / 2); // a glyph's (x, y) onto the page: world (x, -y), its thickness up
// A seeded integer hash (two unsigned 32-bit integers in, one out), and the same as a number in [0, 1).
function hashU(a, b) { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35); h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16; return h >>> 0; }
const hash01 = (a, b) => hashU(a, b) / 4294967296;
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
//            hands: the id of one of HAND_PAIRS, or two CSS colours (default: the measured rose and ice),
//            paper: the id of one of PAPERS (default PAPER_DEFAULT) }
// The hand and paper colours can also be changed afterwards, without building again: result.setHands(same kind of
// value), result.setPaper(id).
const pairLooks = (v) => {
  const pair = typeof v === 'string' ? HAND_PAIRS.find((p) => p.id === v) : null;
  return [0, 1].map((h) => handLook(HANDS[h], pair ? pair.hands[h] : Array.isArray(v) ? v[h] : null));
};
export function buildPaper(T, tools, piece, opts = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  const renderer = (tools && tools.renderer) || null;
  let paperTone = paperOf(opts.paper);
  const env = paperEnv(renderer, paperTone);
  // the hands' colours: the measured pink and ice-cyan, unless opts.hands picks another pair
  const looks = pairLooks(opts.hands);
  const hands = looks.map((l) => new THREE.Color(l.halo.x, l.halo.y, l.halo.z));
  const glyphs = opts.glyphs || null;
  const startX = (sf) => 9.5 + Math.abs(sf) * 1.05; // after the clefs (0.9-3.7), the key signature and the time signature
  const S = piece && piece.notes.length ? engrave(piece, { linear: true, carry: true, rests: true, doubles: true, detached: true, start: startX, ...LAYOUT }) : null;

  // ---- materials ----
  // What the notation is made of (opts.finish, one of FINISHES): matte ink keeps the original materials; the others
  // are physically based (FINISH), with their own rounded bevels (DOME) and a room with a window to reflect.
  const fid = FINISH[opts.finish] ? opts.finish : FINISH_DEFAULT, FX = FINISH[fid], F = fid === 'matte' ? null : FX;
  const DM = F && DOME[F.dome], IP = F ? DM.ink : INK, RP = F ? { ...RAISED, ...DM.raised } : RAISED, TP = F ? { ...TITLE, ...DM.title } : TITLE;
  const grow = IP.bevelSize + (IP.bevelOffset || 0); // how far the symbols' sides stand out from their outlines
  const fenv = F ? paperEnv(renderer, paperTone, F.win, F.room) : env;
  // A finish's material (see FINISH): physically based, reflecting the room; smoked glass is drawn over what lies below
  // it (custom blending: its own reflection plus what it lets through, T x (1 - Fresnel)).
  const physical = (p) => {
    const m = new THREE.MeshPhysicalMaterial({ color: p.color, metalness: p.metalness ?? 0, roughness: p.roughness, ior: 1.5, clearcoat: p.cc || 0, clearcoatRoughness: 0.03, envMap: fenv, envMapIntensity: p.env || 1 });
    if (p.T != null) Object.assign(m, { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, depthWrite: true });
    Object.assign(m.userData, { env: p.env || 1, max: p.max, win: F.win });
    if (p.T != null) m.userData.T = p.T;
    return m;
  };
  const ink = F ? physical(F.ink) : new THREE.MeshStandardMaterial({ color: paperTone.ink, roughness: 0.3, metalness: 0, envMap: env, envMapIntensity: 1 });
  const face = F ? physical(F.face) : new THREE.MeshStandardMaterial({ color: PAL.face, roughness: 0.1, metalness: 0, envMap: env, envMapIntensity: 1 });
  // The glows as lights (see GL_DECL; places in view space, set each frame) and the lit noteheads: the ink head, drawn in
  // the hand's white-hot core colour from the moment it is played (aLitT = that time, aHand = 0 right, 1 left; set per
  // instance), so no work is needed per frame but setting the time.
  // The corner shade's uniforms (see SHADE_GLSL), shared by the paper and the 3D pieces.
  const csU = { uCS: { value: new THREE.Vector4() }, uCSA: { value: new THREE.Vector4(16 / 9, 1, 1, 0) }, uCSR: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uCSV: { value: new THREE.Matrix4() } };
  const glU = { uGL: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4()) }, uGLC: { value: Array.from({ length: GLOWS }, () => new THREE.Vector3()) } };
  const glowU = { uTime: { value: -1e9 }, uFade: { value: 1 }, uCore: { value: looks.map((l) => l.core) } };
  // What each material adds to three.js's own shading: glints = the lamps' own highlights held to a fraction (so they
  // never sparkle like stars); the glows' light and highlights (glowCode, weighed by the finish's `glow`); lit = the
  // white-hot lit notehead; glass = the share of light smoked glass lets through (its alpha: 1 - T (1 - Fresnel)); and a
  // soft limit to the finish's brightest (userData.max, or the finish's own), under the bloom threshold. On glass the
  // Fresnel term (the paler, more mirror-like look at grazing angles) is kept to the sloping faces, x (1 - n.up): flat
  // tops and beams stay dark smoked glass however low the camera looks along them; only the rims and walls catch light.
  const FRES = `vec3 nn = normalize(normal); float nv = clamp(dot(nn, normalize(vViewPosition)), 0.0, 1.0), f5 = pow(1.0 - nv, 5.0);
          float up = dot(nn, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), fm = 0.04 + 0.96 * f5 * clamp(1.0 - up, 0.0, 1.0);`;
  const shadeMats = []; // (all that the corner shade compiles into: see shadeOn)
  const hook = (m, key, { glints = null, lit = false } = {}) => {
    shadeMats.push(m);
    const T = m.userData.T, max = m.userData.max ?? FX.max ?? FINISH.matte.max;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, glU, csU);
      let end = '#include <lights_fragment_end>';
      if (glints != null) end += `\n reflectedLight.directSpecular *= ${glints.toFixed(3)};\n#ifdef USE_CLEARCOAT\n clearcoatSpecularDirect *= ${glints.toFixed(3)};\n#endif`;
      if (T != null) end += `\n { ${FRES}\n   float k = fm / (0.04 + 0.96 * f5); reflectedLight.indirectSpecular *= k;\n#ifdef USE_CLEARCOAT\n   clearcoatSpecularIndirect *= k;\n#endif\n }`;
      end += SHADE_HOOK; // (the corner shade dims the lamp's light on it, not the glows' light added next)
      end += glowCode(FX.glow[0], FX.glow[1], FX.haze || 0);
      if (lit) {
        Object.assign(sh.uniforms, glowU);
        sh.vertexShader = 'attribute float aLitT; attribute float aHand; uniform float uTime; varying float vLit; varying float vHand;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLit = step(aLitT, uTime); vHand = aHand;');
      }
      const glass = T == null ? '' : `\n { ${FRES}
          float Tk = mix(${Math.min(0.5, 2.2 * T).toFixed(3)}, ${T.toFixed(3)}, smoothstep(0.8, 0.99, up));
          gl_FragColor.a = 1.0 - Tk * (1.0 - fm); }`;
      const cap = `\n { float mx = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b); gl_FragColor.rgb *= 1.0 / pow(1.0 + pow(mx / ${max.toFixed(3)}, 6.0), 1.0 / 6.0); }`;
      sh.fragmentShader = GL_DECL + SHADE_DECL + (lit ? 'uniform vec3 uCore[2]; uniform float uFade; varying float vLit; varying float vHand;\n' : '') +
        sh.fragmentShader.replace('#include <lights_fragment_end>', end).replace('#include <dithering_fragment>', glass + cap +
          (lit ? '\n if (vLit > 0.5) gl_FragColor.rgb = (vHand < 0.5 ? uCore[0] : uCore[1]) * uFade;' + (T != null ? '\n if (vLit > 0.5) gl_FragColor.a = 1.0;' : '') : '') + '\n#include <dithering_fragment>');
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  // Polished chrome (the matte ink's rims and pins): a sharp reflection of the room (dark walls with bright streaks, a
  // thin bright top rim); the lamps' own glints on it are held to a quarter, so they never sparkle like stars.
  const chromeMat = (k) => hook(new THREE.MeshStandardMaterial({ color: PAL.chrome, roughness: 0.16, metalness: 1, envMap: env, envMapIntensity: 1 }), k, { glints: 0.25 });
  const chrome = F ? hook(physical(F.wall), `paper-wall-${fid}`, { glints: F.glints }) : chromeMat('paper-chrome');
  const fleck = F ? hook(physical(F.fleck), `paper-fleck-${fid}`, { glints: F.glints }) // the small signs in the music: darker, only flecks of chrome
    : hook(new THREE.MeshStandardMaterial({ color: PAL.fleck, roughness: 0.2, metalness: 1, envMap: env, envMapIntensity: 1 }), 'paper-fleck', { glints: 0.25 });
  const pinMat = !F ? chrome : F.pin === 'chrome' ? chromeMat('paper-chrome-' + fid) : F.pin ? hook(physical(F.pin), `paper-pin-${fid}`, { glints: F.glints }) : chrome;
  const headMat = hook(ink.clone(), 'paper-head-' + fid, { lit: true, glints: F ? F.glints : null });
  hook(ink, 'paper-ink-' + fid, { glints: F ? F.glints : null }); hook(face, 'paper-face-' + fid, { glints: F ? F.glints : null });
  const raised = [face, chrome];
  const mirrorOf = (base) => { // drawn right after the paper (opaque pass, before everything else), adding light to it
    const m = base.clone();
    m.blending = THREE.AdditiveBlending; m.transparent = false; m.depthTest = false; m.depthWrite = false; m.roughness = Math.max(0.45, base.roughness);
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying float vMirY;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 wp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n wp = instanceMatrix * wp;\n#endif\n vMirY = (modelMatrix * wp).y; }');
      sh.fragmentShader = 'varying float vMirY;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.rgb = min(gl_FragColor.rgb * ${MIRROR.k.toFixed(3)} * exp(vMirY / ${MIRROR.fall.toFixed(3)}), vec3(${MIRROR.cap.toFixed(3)}));`);
    };
    m.customProgramCacheKey = () => 'paper-mirror' + (base.isMeshPhysicalMaterial ? '-phys' : '');
    return m;
  };
  const mirrored = [mirrorOf(face), mirrorOf(chrome)];
  const paperU = { uCam: { value: new THREE.Vector3() }, uVn: { value: LIGHT.vNear }, uDn: { value: 40 }, uLam: { value: 38 }, uCap: { value: LIGHT.cap }, uFade: { value: 1 },
    uTintNear: { value: new THREE.Vector3() }, uTintFar: { value: new THREE.Vector3() }, uKey: { value: new THREE.Vector3(0, 1, 0) }, uOrigin: { value: new THREE.Vector2() },
    uTex: { value: paperTexture(renderer) }, uTile: { value: new THREE.Vector2(1 / GRAIN.tile, 1 / GRAIN.toneTile) }, uLook: { value: new THREE.Vector4() },
    uShade: { value: new THREE.Vector4(SHADE.amb, SHADE.contact, SHADE.low, SHADE.high) }, uMask: { value: null }, uMaskSoft: { value: null }, uMaskBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBall: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uBallColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uRefl: { value: new THREE.Vector4(REFL.k, REFL.gloss, 0, REFL.narrow) },
    uLight: { value: null }, uPool: { value: new THREE.Vector3(POOL.ball.k, POOL.ball.h0, POOL.max) }, uPoolColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uAccOn: { value: 0 }, uAccA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uAccP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uRing: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uBand: { value: CORNER.band.map(([a, b]) => new THREE.Vector2(a, b)) }, uAccC: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uAccK: { value: new THREE.Vector2(CORNER.max, CORNER.dim) }, ...csU };
  const paperMat = new THREE.ShaderMaterial({ uniforms: paperU, vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  shadeMats.push(paperMat);
  // The corner shade is compiled in only while the corner light is on (CORNER_SHADE), so with it off every shader is
  // exactly as it was. Switching it on or off recompiles these few programs once (no rebuild).
  let shadeIn = false;
  const shadeOn = (v) => { if (v === shadeIn) return; shadeIn = v; for (const m of shadeMats) { if (v) m.defines.CORNER_SHADE = ''; else delete m.defines.CORNER_SHADE; m.needsUpdate = true; } };
  // the thin lines: printed ink, or the finish's own colour; the glows' streaks along them (places in world space)
  const lineU = { uRes: { value: new THREE.Vector2(1280, 720) }, uMinPx: { value: 1.2 }, uColor: { value: new THREE.Color(paperTone.ink) }, uCam: paperU.uCam,
    uFar0: { value: 70 }, uFar1: { value: 130 }, uFarFade: { value: 0.35 }, uOpacity: { value: 1 }, uMax: { value: F ? F.wall.max : FX.max },
    uGW: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4()) }, uGC: glU.uGLC, uGlint: { value: new THREE.Vector2(...FX.lineGlow) } };
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

  // ---- the shadows: every raised piece drawn into the shadow mask each frame (see shadowKit), then blurred ----
  const cast = (o) => { o.layers.enable(o.material === ink || o.material === headMat ? INK_LAYER : SHADOW_LAYER); return o; };
  const sh = shadowKit(renderer), [MW, MH] = MASK.texels;
  if (sh) { paperU.uMask.value = sh.full.texture; paperU.uMaskSoft.value = sh.b.texture; }
  const clearKeep = new THREE.Color();
  // Draws the shadow mask for a window starting at page x x0 (W ss long), with the key light toward paperU.uKey and
  // the balls (`at`: their centres, `shown`) holding back ballK of it.
  function drawShadows(x0, W, ballK, at, shown) {
    if (!sh) return;
    const H = MASK.H, z0 = MASK.z0, { maskU, maskCam, blurU } = sh, box = maskU.uBox.value;
    box.set(x0, z0, 1 / W, 1 / H); paperU.uMaskBox.value.copy(box); maskU.uKey.value.copy(paperU.uKey.value);
    maskCam.left = -W / 2 - 3; maskCam.right = W / 2 + 3; maskCam.top = H / 2 + 3; maskCam.bottom = -H / 2 - 3; maskCam.updateProjectionMatrix();
    maskCam.position.set(x0 + W / 2, 20, z0 + H / 2); maskCam.updateMatrixWorld();
    for (let i = 0; i < 2; i++) { sh.ballCast[i].visible = shown[i]; sh.ballCast[i].position.copy(at[i]); }
    const r = renderer, target = r.getRenderTarget(), autoClear = r.autoClear, alpha = r.getClearAlpha();
    r.getClearColor(clearKeep);
    r.setClearColor(0x000000, 0); r.autoClear = false;
    r.setRenderTarget(sh.full); r.clear(true, false, false);
    const bg = scene.background; scene.background = null; scene.overrideMaterial = sh.maskMat;
    maskU.uK.value = SHADE.shadow; maskCam.layers.set(SHADOW_LAYER); r.render(scene, maskCam); // the raised pieces
    maskU.uLift.value = SHADE.inkLift; maskCam.layers.set(INK_LAYER); r.render(scene, maskCam); // the printing ink
    scene.overrideMaterial = null; scene.background = bg; maskU.uLift.value = 1; maskCam.layers.set(SHADOW_LAYER);
    maskU.uK.value = ballK; r.render(sh.ballCasters, maskCam);
    blurU[0].uSig.value = SHADE.soft / (2 * W / MW); blurU[1].uSig.value = SHADE.soft / (2 * H / MH);
    r.setRenderTarget(sh.a); r.render(sh.blurScenes[0], sh.quadCam);
    r.setRenderTarget(sh.b); r.render(sh.blurScenes[1], sh.quadCam);
    r.setRenderTarget(target); r.autoClear = autoClear; r.setClearColor(clearKeep, alpha);
  }

  // ---- the printed music ----
  const printed = new THREE.Group(); scene.add(printed);
  const titleBox = new THREE.Box3(); // the 3D title's extent in the world (empty without a title), for the opening shot
  const heads = []; // one per notehead, for lighting them up: { kind, mesh, index, t, staff, x, y, chord }
  const geos = new Map(), kinds = new Map(), lines = [], slabs = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
  const cached = (k, make) => { if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
  // ink symbols: printed, nearly flush; raised symbols: on pins, black faces and chrome sides
  const inkGlyph = (name, dx = 0) => cached('i:' + name, () => flat(extrude(musicShapes(name), IP).translate(dx, 0, 0)));
  const raisedGlyph = (name, size = 1, sx = 1) => cached(`r:${name}:${size}:${sx}`, () => {
    const shapes = musicShapes(name, { size }), geo = flat(extrude(shapes, RP).scale(sx, 1, 1));
    geo.userData.pins = pinSpots(shapes, { step: 0.12 * size, margin: RAISED.pin + 0.05, per: 2.2 * size * size, max: 3 }).map(([x, y]) => [x * sx, y]);
    return geo;
  });
  const kind = (name, geo, mat, lift = 0, colors = false) => { if (!kinds.has(name)) kinds.set(name, { geo, mat, lift, colors, list: [] }); return kinds.get(name); };
  const put = (k, x, y, sx = 1, sy = 1, tag = null) => k.list.push([x, y, sx, sy, tag]);
  const line = (x0, y0, x1, y1, w) => lines.push([x0, y0, x1, y1, w]);
  const slab = (x0, y0, x1, y1, thick) => { // a beam or thick bar line: a parallelogram with vertical ends, raised like the ink
    const s = new THREE.Shape(), h = thick / 2 - grow;
    s.moveTo(x0, y0 - h); s.lineTo(x1, y1 - h); s.lineTo(x1, y1 + h); s.lineTo(x0, y0 + h); s.lineTo(x0, y0 - h);
    slabs.push([(x0 + x1) / 2, s]);
  };
  const raisedSmall = [face, fleck];
  const raisedPut = (name, x, y, size = 1, sx = 1, small = false) => {
    const geo = raisedGlyph(name, size, sx), k = kind(`r:${name}:${size}:${sx}:${small}`, geo, small ? raisedSmall : raised, RAISED.lift);
    put(k, x, y);
    const pk = kind('pin:small', null, pinMat, 0);
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
    { const s = new THREE.Shape(), x0 = S.finalX - 0.55 + grow, x1 = S.finalX - 0.05 - grow, y0 = grow - 0.07, y1 = TOP[0] + 0.07 - grow;
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
      const geo = flat(extrude(shapes, TP));
      const base = TOP[0] + TITLE.gap + (rows.length - 1 - i) * cap * 1.5, x = TITLE.x;
      geo.computeBoundingBox(); titleBox.union(geo.boundingBox.clone().translate(new THREE.Vector3(x, TITLE.lift, -base)));
      const m = cast(new THREE.Mesh(geo, raised)); m.position.set(x, TITLE.lift, -base); printed.add(m);
      const r = new THREE.Mesh(geo, mirrored); r.position.set(x, -TITLE.lift, -base); r.scale.y = -1; r.renderOrder = -0.5; printed.add(r);
      const pk = kind('pin:title', null, pinMat, 0);
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
      printed.add(cast(m));
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
    for (const shapes of slabChunks.values()) { const g = flat(extrude(shapes, { ...IP, curveSegments: 1, smooth: 30 })); printed.add(cast(new THREE.Mesh(g, ink))); }
  }

  // ---- the halos of the lit notes: one square per notehead, all in one draw; a note's square appears when it is played ----
  const KINDS = ['solid', 'half', 'whole'], HEAD_GLYPH = ['noteheadBlack', 'noteheadHalf', 'noteheadWhole'];
  const haloU = { uTime: glowU.uTime, uFade: glowU.uFade, uDim: { value: GLOW.dim }, uR: { value: GLOW.R }, uLift: { value: LINE.lift * 0.5 }, uGrow: { value: GLOW.grow }, uTintD: { value: GLOW.tint },
    uK: { value: new THREE.Vector2(...GLOW.k) }, uW: { value: new THREE.Vector2(...GLOW.w) }, uWin: { value: new THREE.Vector2(...GLOW.win) },
    uRim: { value: looks.map((l) => l.rim) }, uHalo: { value: looks.map((l) => l.halo) }, uSdf: { value: null } };
  const haloMat = new THREE.ShaderMaterial({ uniforms: haloU, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
  const quad = new THREE.PlaneGeometry(2, 2);
  if (glyphs) haloU.uSdf.value = headSdf(HEAD_GLYPH.map((g) => [g, (ADV[g] || HEAD_W) / 2]));
  let haloGeo = null;
  if (heads.length) {
    const g = (haloGeo = new THREE.InstancedBufferGeometry());
    g.setIndex(quad.index); g.setAttribute('position', quad.attributes.position);
    const a = new Float32Array(heads.length * 4);
    heads.forEach((h, i) => a.set([h.x, h.y, h.t, KINDS.indexOf(h.kind) + 3 * h.staff], i * 4));
    g.setAttribute('aHead', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = heads.length;
    const halos = new THREE.Mesh(g, haloMat);
    halos.frustumCulled = false; halos.renderOrder = 1; // over the paper, under the thin lines, so stems and ledger lines stay dark
    printed.add(halos);
  }
  // The light map's own scene (drawn each frame into the shadow kit's light target, see drawLight): the pools of the
  // lit notes (the halos' squares again, printed or live) and of the light trails.
  const poolScene = new THREE.Scene();
  const poolU = { uTime: glowU.uTime, uBox: paperU.uMaskBox, uPool: { value: new THREE.Vector3(POOL.note.k, POOL.note.h, POOL.note.R) }, uColor: { value: [new THREE.Vector3(), new THREE.Vector3()] } };
  const poolMat = new THREE.ShaderMaterial({ uniforms: poolU, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const poolOf = (geo) => { const m = new THREE.Mesh(geo, poolMat); m.frustumCulled = false; poolScene.add(m); return m; };
  const printedPools = haloGeo ? poolOf(haloGeo) : null;

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
      m.frustumCulled = false; liveGroup.add(cast(m)); sysGlyphs.push([m, dx, y]);
      for (const [px, py] of geo.userData.pins) sysPins.push([dx + px, y + py]);
    }
    sysPinMesh = new THREE.InstancedMesh(pinGeo, pinMat, 3 * sysPins.length); sysPinMesh.frustumCulled = false; liveGroup.add(cast(sysPinMesh));
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
    LG.pools = poolOf(hg); LG.pools.visible = false;
    LG.ledgers = lineGeometry(Array.from({ length: LIVE.ledgers }, () => [0, 0, 1, 0, LINE.ledger])); // (each one piece: shorter than 6 ss)
    for (const k of ['position', 'aOff', 'aDir']) LG.ledgers.attributes[k].setUsage(THREE.DynamicDrawUsage);
    const lm = new THREE.Mesh(LG.ledgers, lineMat); lm.renderOrder = 2;
    for (const sign of ['accidentalSharp', 'accidentalFlat']) {
      const m = new THREE.InstancedMesh(raisedGlyph(sign, 1, 1), raisedSmall, LIVE.signs); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      LG.signs.set(sign, m); liveGroup.add(cast(m));
    }
    LG.pins = new THREE.InstancedMesh(pinGeo, pinMat, LIVE.pins); LG.pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (const m of [LG.heads, LG.halos, lm, LG.pins]) { m.frustumCulled = false; liveGroup.add(m); }
    cast(LG.heads); cast(LG.pins);
    for (const m of LG.signs.values()) m.frustumCulled = false;
    const spell = speller(0); // how each key is written with no key signature: the place on the staff and the sign
    for (let p = 0; p < 128; p++) { const s = spell(p), staff = p < 60 ? 1 : 0; LG.spell.push({ staff, y: staff ? (s.step - 18) / 2 : TB + (s.step - 30) / 2, sign: ACC[s.acc] || null }); }
  }
  // Smoked glass is drawn after the halos and the thin lines (renderOrder 3), so the staff and the light show through it.
  const isGlass = (m) => !!m && m.transparent && m.userData.T != null;
  scene.traverse((o) => { if (o.isMesh && (Array.isArray(o.material) ? o.material.some(isGlass) : isGlass(o.material))) o.renderOrder = 3; });
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
  // The chords as played (for the corner light and the sparks): per staff, the newest LIVE_CH, in a ring (n counts them
  // this frame), each at its outer note (the top one in the treble, the bottom one in the bass), as the balls land.
  const LIVE_CH = 32, liveCh = [0, 1].map(() => ({ t: new Float64Array(LIVE_CH), x: new Float32Array(LIVE_CH), y: new Float32Array(LIVE_CH), seed: new Uint32Array(LIVE_CH), kept: new Uint8Array(LIVE_CH), n: 0 }));
  function drawLive(trail, cx, lag) {
    liveCh[0].n = liveCh[1].n = 0;
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
      const lc = liveCh[staff];
      if (n.t0 - chordT[staff] > LIVE.chord) {
        // a new chord: set off the corner light if it is the first in its CORNER.slot (so never more than 3 a second)
        const prev = lc.n ? lc.t[(lc.n - 1) % LIVE_CH] : -1e9, j = lc.n++ % LIVE_CH;
        lc.t[j] = n.t0; lc.x[j] = liveLayout.xOf(n.t0) + lag; lc.y[j] = y; lc.seed[j] = hashU(Math.round(n.t0 * 1000), staff) & 0xffffff;
        lc.kept[j] = Math.floor(n.t0 / CORNER.slot) !== Math.floor(prev / CORNER.slot) ? 1 : 0;
        chordT[staff] = n.t0; chordX[staff] = liveLayout.xOf(n.t0) + lag; chordN[staff] = accN[staff] = 0;
      } else { const j = (lc.n - 1) % LIVE_CH; if (staff === 0 ? y > lc.y[j] : y < lc.y[j]) lc.y[j] = y; }
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
  // The opening shot: so that the whole 3D title can be read from the first picture until the first note, the camera
  // starts a little higher (dh ss), looking further up the page (dy) and back along it (dx), and eases into its usual
  // place over the OPENING.after s after the first note (weight 1 until the first note, then 0 from t1 + after on).
  const openW = (L, t) => (L !== layout ? 0 : 1 - sstep(L.t1, L.t1 + OPENING.after, t));
  const NO_OFF = { dh: 0, dy: 0, dx: 0 };
  // Where the camera is at time t (a pure function): it looks along its heading, tilted down, with the current bass
  // place (camX, page y = c.y) at `at` in the picture, from height h; the crane then lifts it without turning it.
  function poseAt(L, t, c, aspect, pos, quat, ps, off = openFit(L, c, aspect)) {
    const yaw = (c.yaw - c.yawAmp * Math.cos((2 * Math.PI * t) / c.yawPeriod)) * DEG, w = off === NO_OFF ? 0 : openW(L, t), fh = frameAt(L, t, c, aspect, 1);
    const h = c.h + c.hAmp * Math.cos((2 * Math.PI * t) / c.hPeriod) + c.rise * sstep(L.tEnd - ENDING.over, L.tEnd, t) + off.dh * w + fh, up = crane(L, t);
    E.set(-c.tilt * DEG, yaw - Math.PI / 2, 0); quat.setFromEuler(E);
    const th = Math.tan((c.fov * DEG) / 2);
    D.set((2 * c.at[0] - 1) * th * aspect, (1 - 2 * c.at[1]) * th, -1).applyQuaternion(quat);
    const k = h / -D.y, x = camX(L, t) + off.dx * w, z = -(c.y + off.dy * w + frameAt(L, t, c, aspect, 0));
    pos.set(x - D.x * k, h + up, z - D.z * k);
    ps.x = x; ps.h = h + up; ps.hl = h - off.dh * w - fh + up; ps.yaw = yaw; ps.dNear = (h + up) / Math.sin((c.tilt + c.fov / 2) * DEG); // hl: the height the light follows (the opening shot's and the framing's extra height do not dim the paper)
    return ps;
  }
  // Framing: the notes each hand has just played or is about to play stay in the picture (inside FRAME.m of its half
  // width and height), which matters in the narrow tall picture when the right hand climbs high or the left hand goes
  // low. When they would not fit, the camera looks a little further up or down the page (dy ss), as little as needed:
  // and when they span more than the picture, it also rises a little (at most FRAME.maxH ss) to take them all in:
  // the change needed every FRAME.dt s, held for FRAME.reach s on either side (so the camera is there in time), then
  // smoothed (a Gaussian of FRAME.sigma s), so it drifts gently ([shift, height]: the height changes more slowly). Worked out once per camera and picture shape, from the
  // camera's mean pose; a pure function of t. The notes that count: each hand's latest note for FRAME.hold s after it
  // is struck, and its next note from FRAME.ahead s before.
  const FRAME = { m: 0.85, ahead: 0.35, hold: 0.6, reach: [2, 4], sigma: [1.5, 2.5], dt: 0.1, max: 14, maxH: 12 };
  const frm = { aspect: 0, c: null, d: null, h: null, t0: 0 }, frP = new THREE.Vector3(), frQ = new THREE.Quaternion(), frV = new THREE.Vector3(), frD = new THREE.Vector3();
  function frameAt(L, t, c, aspect, d) { // d: 0 = the shift up the page, 1 = the extra height
    if (L !== layout || !layout) return 0;
    if (frm.aspect !== aspect || frm.c !== c) buildFrame(c, aspect);
    const a = d ? frm.h : frm.d, u = (t - frm.t0) / FRAME.dt, i = Math.floor(u);
    return i < 0 ? a[0] : i >= a.length - 1 ? a[a.length - 1] : a[i] + (a[i + 1] - a[i]) * (u - i);
  }
  function buildFrame(c, aspect) {
    frm.aspect = aspect; frm.c = c;
    const E2 = new THREE.Euler(-c.tilt * DEG, c.yaw * DEG - Math.PI / 2, 0, 'YXZ'), th = Math.tan((c.fov * DEG) / 2);
    frQ.setFromEuler(E2);
    frD.set((2 * c.at[0] - 1) * th * aspect, (1 - 2 * c.at[1]) * th, -1).applyQuaternion(frQ);
    const k = c.h / -frD.y; frP.set(-frD.x * k, c.h, -c.y - frD.z * k); frQ.invert();
    const ndc = (dx, y) => { frV.set(dx, 0, -y).sub(frP).applyQuaternion(frQ); const z = Math.max(0.1, -frV.z); return [frV.x / z / (th * aspect), frV.y / z / th]; };
    const solve = (dx, ax, goal) => { // the page y at which the note's picture x (ax 0) or y (ax 1) reaches goal (x falls and y rises with page y)
      let lo = -150, hi = 150;
      for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2, v = ndc(dx, m)[ax]; if (ax === 0 ? v > goal : v < goal) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const DX = 40, hiY = new Float64Array(2 * DX + 1), loY = new Float64Array(2 * DX + 1); // the page y range in the picture, by x from the place
    for (let j = 0; j <= 2 * DX; j++) { const dx = j - DX; hiY[j] = Math.min(solve(dx, 0, -FRAME.m), solve(dx, 1, FRAME.m)); loY[j] = Math.max(solve(dx, 0, FRAME.m), solve(dx, 1, -FRAME.m)); }
    const range = (dx) => { const u = Math.min(2 * DX, Math.max(0, dx + DX)), j = Math.min(2 * DX - 1, Math.floor(u)), f = u - j; return [loY[j] + (loY[j + 1] - loY[j]) * f, hiY[j] + (hiY[j + 1] - hiY[j]) * f]; };
    // Every FRAME.dt s, for a few heights (the picture's page range scaled by sc about c.y, sc = 1 ... sMax): the
    // shifts dy that keep each hand's current notes inside, lo <= dy <= hi. Held for `reach` s on either side (the
    // intersection over that window), the least height that leaves a shift, and the shift nearest 0; then smoothed.
    const L = layout, t0 = L.t1 - 3, n = Math.max(2, Math.ceil((L.tEnd + 4 - t0) / FRAME.dt)), K = 13, sMax = 1 + FRAME.maxH / c.h;
    const scK = Float64Array.from({ length: K }, (_, k) => 1 + ((sMax - 1) * k) / (K - 1));
    const LO = new Float64Array(n * K).fill(-Infinity), HI = new Float64Array(n * K).fill(Infinity), lists = S.landings, at = [0, 0];
    for (let i = 0; i < n; i++) {
      const t = t0 + i * FRAME.dt, x0 = L.xOf(t);
      for (const h of [0, 1]) {
        const list = lists[h];
        while (at[h] + 1 < list.length && list[at[h] + 1].t <= t) at[h]++; // this hand's latest note (if it has started)
        for (let q = at[h]; q <= at[h] + 1 && q < list.length; q++) { // it, while it is fresh, and the next one, once it is near
          const l = list[q];
          if (l.t <= t ? t - l.t > FRAME.hold : l.t - t > FRAME.ahead) continue;
          const [a, b] = range(l.x - x0);
          for (let k = 0; k < K; k++) { LO[i * K + k] = Math.max(LO[i * K + k], l.y - c.y - (b - c.y) * scK[k]); HI[i * K + k] = Math.min(HI[i * K + k], l.y - c.y - (a - c.y) * scK[k]); }
        }
      }
    }
    const wantY = new Float64Array(n), wantH = new Float64Array(n);
    const span = (i, k, r) => { let lo = -Infinity, hi = Infinity; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { lo = Math.max(lo, LO[j * K + k]); hi = Math.min(hi, HI[j * K + k]); } return [lo, hi]; };
    const rH = Math.round(FRAME.reach[1] / FRAME.dt), rY = Math.round(FRAME.reach[0] / FRAME.dt);
    for (let i = 0; i < n; i++) {
      let k = 0;
      while (k < K - 1) { const [lo, hi] = span(i, k, rH); if (lo <= hi) break; k++; } // the height: held longer, so it changes rarely
      const [lo, hi] = span(i, k, rY);
      const y = lo === -Infinity && hi === Infinity ? 0 : lo <= hi ? Math.min(hi, Math.max(lo, 0)) : (lo + hi) / 2;
      wantY[i] = Math.max(-FRAME.max, Math.min(FRAME.max, y)); wantH[i] = (scK[k] - 1) * c.h;
    }
    const smooth = (src, sigma) => {
      const g = Math.round((3 * sigma) / FRAME.dt), wts = [];
      for (let j = -g; j <= g; j++) wts.push(Math.exp(-0.5 * ((j * FRAME.dt) / sigma) ** 2));
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) { let a = 0, wsum = 0; for (let j = -g; j <= g; j++) { const q = Math.min(n - 1, Math.max(0, i + j)); a += src[q] * wts[j + g]; wsum += wts[j + g]; } d[i] = a / wsum; }
      return d;
    };
    frm.d = smooth(wantY, FRAME.sigma[0]); frm.h = smooth(wantH, FRAME.sigma[1]); frm.t0 = t0;
  }
  // The opening offsets for one camera and picture shape, found once (a small search): the least change that keeps
  // the title's corners inside the picture (with a small margin) both when playback starts and at the first note.
  // Without a title, or when it already fits, nothing changes.
  const fit = { aspect: 0, c: null, off: NO_OFF }, fitPos = new THREE.Vector3(), fitQ = new THREE.Quaternion(), fitPose = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 0 }, fitV = new THREE.Vector3();
  function openFit(L, c, aspect) {
    if (L !== layout || !layout || titleBox.isEmpty()) return NO_OFF;
    if (fit.aspect === aspect && fit.c === c) return fit.off;
    fit.aspect = aspect; fit.c = c;
    const b = titleBox, pts = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push([x, y, z]);
    const th = Math.tan((c.fov * DEG) / 2), times = [L.t1 - OPENING.at, L.t1];
    const over = (off) => { // how far the points stick out of the picture (0 = all inside the margin)
      let worst = 0;
      for (const t of times) {
        poseAt(L, t, c, aspect, fitPos, fitQ, fitPose, off); fitQ.invert();
        for (const [x, y, z] of pts) {
          fitV.set(x, y, z).sub(fitPos).applyQuaternion(fitQ);
          if (fitV.z > -0.1) return 99;
          const nx = fitV.x / -fitV.z / (th * aspect), ny = fitV.y / -fitV.z / th;
          worst = Math.max(worst, Math.abs(nx) - 0.95, ny - 0.9, -ny - 0.95);
        }
      }
      return Math.max(0, worst);
    };
    let best = NO_OFF, bestCost = Infinity, bestOver = over(NO_OFF);
    if (bestOver > 0) {
      for (let dh = 0; dh <= 1.2 * c.h; dh += 1.5) for (let dy = 0; dy <= 24; dy += 2) for (let dx = -30; dx <= 10; dx += 2.5) {
        const off = { dh, dy, dx }, o = over(off), cost = dh + 0.5 * dy + 0.3 * Math.abs(dx);
        if (o < bestOver - 1e-9 || (o <= bestOver + 1e-9 && cost < bestCost)) { best = off; bestOver = o; bestCost = cost; }
      }
    }
    return (fit.off = best);
  }
  const pose = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 40 };
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
  // the light trails (optional), one ribbon per ball, and the light each throws on the paper (in the light map's scene);
  // the points are filled in each frame (fillTrail)
  const trailIdx = new Uint16Array((TRAIL.max - 1) * 6);
  for (let i = 0; i < TRAIL.max - 1; i++) trailIdx.set([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2], i * 6);
  const trails = looks.map((l, hand) => {
    const g = new THREE.BufferGeometry(), dyn = (n) => new THREE.BufferAttribute(new Float32Array(TRAIL.max * 2 * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(3)); g.setAttribute('aTan', dyn(3)); g.setAttribute('aAge', dyn(1));
    g.setAttribute('aSide', new THREE.BufferAttribute(Float32Array.from({ length: TRAIL.max * 2 }, (_, i) => (i & 1 ? 1 : -1)), 1));
    g.setIndex(new THREE.BufferAttribute(trailIdx, 1)); g.setDrawRange(0, 0);
    const u = { uRes: lineU.uRes, uW: { value: TRAIL.w }, uMinPx: { value: TRAIL.minPx }, uColor: { value: new THREE.Vector3() }, uFade: { value: 1 }, uDim: { value: TRAIL.dim }, uPow: { value: TRAIL.fade } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    m.frustumCulled = false; m.visible = false; m.renderOrder = 9; scene.add(m);
    const pu = { uBox: paperU.uMaskBox, uW: { value: POOL.trail.w }, uK: { value: POOL.trail.k }, uColor: { value: new THREE.Vector3() }, uPow: { value: TRAIL.fade } };
    const pm = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: pu, vertexShader: TRAIL_POOL_VERT, fragmentShader: TRAIL_POOL_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    pm.frustumCulled = false; pm.visible = false; poolScene.add(pm);
    return { mesh: m, pool: pm, u, pu, hand };
  });
  const camTc = new THREE.Vector3(), qTc = new THREE.Quaternion(), poseTc = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 0 }, away = new THREE.Vector3();
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

  // A light trail: the points of a hand's path over the last TRAIL.T s, into its ribbon (newest first): TRAIL.n times
  // spread evenly over that span, and each landing in it exactly, twice (the path turns sharply there: one point carries
  // the direction it came in, the other the direction it leaves in). Every point is where ballAt puts the ball at
  // that time, so the trail is the ball's own path; nothing is carried over from one frame to the next.
  const TT = new Float64Array(TRAIL.max), TK = new Uint8Array(TRAIL.max), tp = new THREE.Vector3();
  function fillTrail(hand, t, L, c, aspect) {
    const list = paths[hand], g = trails[hand].mesh.geometry, P = g.attributes.position.array, D = g.attributes.aTan.array, A = g.attributes.aAge.array;
    let j = -1;
    if (list.length && list[0].t <= t) { let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; } j = lo; }
    const N = TRAIL.n, room = TRAIL.max - N;
    let n = 0, k = 0, land = 0;
    for (;;) {
      const tg = k < N ? t - (TRAIL.T * k) / (N - 1) : -Infinity;
      const tl = j >= 0 && list[j].t > t - TRAIL.T && land + 2 <= room ? list[j].t : -Infinity;
      if (tg === -Infinity && tl === -Infinity) break;
      if (tl >= tg) { if (tl === tg) k++; TT[n] = tl; TK[n++] = 1; TT[n] = tl; TK[n++] = 2; j--; land += 2; } // a landing (newer side first)
      else { TT[n] = tg; TK[n++] = 0; k++; }
    }
    for (let i = 0; i < n; i++) {
      ballAt(hand, TT[i], L, c, aspect, tp);
      P[6 * i] = P[6 * i + 3] = tp.x; P[6 * i + 1] = P[6 * i + 4] = tp.y; P[6 * i + 2] = P[6 * i + 5] = tp.z;
      A[2 * i] = A[2 * i + 1] = (t - TT[i]) / TRAIL.T;
    }
    for (let i = 0; i < n; i++) { // the direction of travel: from the older neighbour to the newer one (one-sided at a landing)
      const a = TK[i] === 2 || i === 0 ? i : i - 1, b = TK[i] === 1 || i === n - 1 ? i : i + 1;
      let dx = P[6 * a] - P[6 * b], dy = P[6 * a + 1] - P[6 * b + 1], dz = P[6 * a + 2] - P[6 * b + 2];
      const l = Math.hypot(dx, dy, dz);
      if (l < 1e-6) { dx = 1; dy = 0; dz = 0; } else { dx /= l; dy /= l; dz /= l; }
      D[6 * i] = D[6 * i + 3] = dx; D[6 * i + 1] = D[6 * i + 4] = dy; D[6 * i + 2] = D[6 * i + 5] = dz;
    }
    g.setDrawRange(0, Math.max(0, n - 1) * 6);
    g.attributes.position.needsUpdate = g.attributes.aTan.needsUpdate = g.attributes.aAge.needsUpdate = true;
  }
  // ---- the corner light and the powder sparks (both optional), set off by the touches of the balls ----
  // The touches, each frame: per hand the newest SPARK.slots (for the sparks) and the newest corner triggers. For a
  // piece they are the balls' landings (the corner triggers chosen once: each landing at least CORNER.gap s after the
  // last one kept); played live, the chords as played (see drawLive). Seeds: the landing's number, or its time.
  const trig = paths.map((list) => { const keep = []; let last = -1e9; list.forEach((l, i) => { if (l.t - last >= CORNER.gap) { keep.push(i); last = l.t; } }); return Int32Array.from(keep); });
  const lastAt = (list, t) => { let lo = 0, hi = list.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; } return lo; };
  const NT = 4, TR = [0, 1].map(() => ({ n: 0, x: new Float32Array(NT), y: new Float32Array(NT), tau: new Float32Array(NT), seed: new Uint32Array(NT) }));
  const sparkU = { uPuff: { value: Array.from({ length: 2 * SPARK.slots }, () => new THREE.Vector4()) }, uPuffK: { value: Array.from({ length: 2 * SPARK.slots }, () => new THREE.Vector4()) },
    uLife: { value: new THREE.Vector2(...SPARK.life) }, uUp: { value: new THREE.Vector2(...SPARK.vUp) }, uOut: { value: new THREE.Vector2(...SPARK.vOut) }, uDrag: { value: new THREE.Vector2(...SPARK.drag) },
    uSize: { value: new THREE.Vector2(...SPARK.size) }, uMot: { value: new THREE.Vector4(SPARK.g, SPARK.r0, SPARK.y0, SPARK.hot) }, uCol: { value: [new THREE.Vector3(), new THREE.Vector3()] } };
  // the touches at time t into TR (corner triggers, newest first) and the sparks' puff slots; n = particles per puff
  function touches(t, live, n, fadeB) {
    const P = sparkU.uPuff.value, K = sparkU.uPuffK.value, life = SPARK.life[1], lifeC = Math.max(CORNER.glow.life, CORNER.ripples.life, CORNER.electric.life);
    for (let h = 0; h < 2; h++) {
      const tr = TR[h], o = h * SPARK.slots;
      let np = 0;
      tr.n = 0;
      if (!live) {
        const list = paths[h];
        if (list.length && t >= list[0].t) {
          const lo = lastAt(list, t), u = lo + 1 < list.length ? (t - list[lo].t) / (list[lo + 1].t - list[lo].t) : 0;
          if (n) for (let k = 0; k < SPARK.slots && lo - k >= 0; k++) {
            const i = lo - k, l = list[i], tau = t - l.t;
            if (tau > life) break;
            const gap = i > 0 ? l.t - list[i - 1].t : 1, share = SPARK.least + (1 - SPARK.least) * sstep(0, SPARK.fast, gap);
            P[o + np].set(l.x, -l.y, tau, (i * 2 + h) & 0xffffff); K[o + np++].set((1 - sstep(SPARK.slots - SPARK.fade, SPARK.slots, k + u)) * fadeB, n * share, h, 0);
          }
          const tg = trig[h];
          let j = -1;
          if (tg.length && list[tg[0]].t <= t) { let a = 0, b = tg.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (list[tg[m]].t <= t) a = m; else b = m - 1; } j = a; }
          for (; j >= 0 && tr.n < NT; j--) {
            const l = list[tg[j]], tau = t - l.t;
            if (tau > lifeC) break;
            tr.x[tr.n] = l.x; tr.y[tr.n] = l.y; tr.tau[tr.n] = tau; tr.seed[tr.n++] = (tg[j] * 2 + h) & 0xffffff;
          }
        }
      } else {
        const lc = liveCh[h], m = Math.min(lc.n, LIVE_CH), u = lc.n ? Math.min(1, (t - lc.t[(lc.n - 1) % LIVE_CH]) / 0.15) : 0;
        for (let k = 0; k < m; k++) {
          const j = (lc.n - 1 - k) % LIVE_CH, tau = t - lc.t[j];
          if (tau < 0) continue;
          if (tau > Math.max(life, lifeC)) break;
          if (n && np < SPARK.slots && tau <= life) {
            const gap = k + 1 < m ? lc.t[j] - lc.t[(lc.n - 2 - k) % LIVE_CH] : 1, share = SPARK.least + (1 - SPARK.least) * sstep(0, SPARK.fast, gap);
            P[o + np].set(lc.x[j], -lc.y[j], tau, lc.seed[j]); K[o + np++].set((1 - sstep(SPARK.slots - SPARK.fade, SPARK.slots, k + u)) * fadeB, n * share, h, 0);
          }
          if (lc.kept[j] && tr.n < NT && tau <= lifeC) { tr.x[tr.n] = lc.x[j]; tr.y[tr.n] = lc.y[j]; tr.tau[tr.n] = tau; tr.seed[tr.n++] = lc.seed[j]; }
        }
      }
      for (let k = np; k < SPARK.slots; k++) K[o + k].x = 0;
    }
  }
  // The powder sparks: every particle of every puff slot is an instance, ordered particle by particle, so drawing the
  // first n * (puff slots) instances draws n particles a puff. Drawn over the paper as the trails are, and again into
  // the light map as tiny lamps.
  const sparkGeo = new THREE.InstancedBufferGeometry();
  { const q = new THREE.PlaneGeometry(2, 2), N = SPARK.max * 2 * SPARK.slots, a = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { a[2 * i] = i % (2 * SPARK.slots); a[2 * i + 1] = Math.floor(i / (2 * SPARK.slots)); }
    sparkGeo.setIndex(q.index); sparkGeo.setAttribute('position', q.attributes.position); sparkGeo.setAttribute('aI', new THREE.InstancedBufferAttribute(a, 2)); sparkGeo.instanceCount = 0; }
  const sparkMU = { ...sparkU, uRes: lineU.uRes, uMinPx: { value: SPARK.minPx }, uLum: { value: SPARK.lum }, uDim: { value: SPARK.dim }, uFade: { value: 1 } };
  const sparkMesh = new THREE.Mesh(sparkGeo, new THREE.ShaderMaterial({ uniforms: sparkMU, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
  sparkMesh.frustumCulled = false; sparkMesh.visible = false; sparkMesh.renderOrder = 9; scene.add(sparkMesh);
  const sparkPU = { ...sparkU, uBox: paperU.uMaskBox, uK: { value: SPARK.pool.k }, uH0: { value: SPARK.pool.h0 } };
  const sparkPool = new THREE.Mesh(sparkGeo, new THREE.ShaderMaterial({ uniforms: sparkPU, vertexShader: SPARK_POOL_VERT, fragmentShader: SPARK_POOL_FRAG, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  sparkPool.frustumCulled = false; sparkPool.visible = false; poolScene.add(sparkPool);

  // The corner light's electric filaments: per hand one geometry holding ARCS filaments of ARC_PTS points each (the main
  // one, then its branches), as the ARC_SEGS segments between them (four corners each), drawn twice (core and halo).
  const EL = CORNER.electric, ARC_DYN = ['position', 'aP', 'aB', 'aN', 'aAl', 'aWd'];
  // whether point i of a filament (0 .. ARC_PTS - 1) is the first or the last of its piece; the point each segment starts at
  const arcFirst = (i) => i === 0 || (i > EL.n && (i - EL.n - 1) % (EL.bn + 1) === 0), arcLast = (i) => i === EL.n || (i > EL.n && (i - EL.n) % (EL.bn + 1) === 0);
  const segAt = Int32Array.from({ length: ARC_PTS }, (_, i) => i).filter((i) => !arcLast(i)), ARC_SEGS = segAt.length;
  const arcIdx = [], arcInvPV = { value: new THREE.Matrix4() }; // (the camera undone: world from the picture, for the filaments' depth)
  for (let q = 0; q < ARCS * ARC_SEGS; q++) arcIdx.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 1, 4 * q + 3, 4 * q + 2);
  const arcs = looks.map(() => {
    const g = new THREE.BufferGeometry(), N = ARCS * ARC_SEGS * 4, dyn = (k) => new THREE.BufferAttribute(new Float32Array(N * k), k).setUsage(THREE.DynamicDrawUsage);
    for (const [k, n] of [['position', 3], ['aP', 3], ['aB', 3], ['aN', 3], ['aAl', 2], ['aWd', 2]]) g.setAttribute(k, dyn(n));
    g.setAttribute('aCorner', new THREE.BufferAttribute(Float32Array.from({ length: N * 2 }, (_, i) => (i & 1 ? ((i >> 1) & 1 ? 1 : -1) : (i >> 2) & 1)), 2));
    g.setAttribute('aE', new THREE.BufferAttribute(Float32Array.from({ length: N }, (_, i) => (arcFirst(segAt[(i >> 2) % ARC_SEGS]) ? 1 : 0)), 1));
    g.setIndex(arcIdx);
    const mk = (w, minPx, dim, order, end) => {
      const u = { uRes: lineU.uRes, uW: { value: w }, uMinPx: { value: minPx }, uColor: { value: new THREE.Vector3() }, uFade: { value: 1 }, uDim: { value: dim }, uEnd: { value: end }, uInvPV: arcInvPV };
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
      m.frustumCulled = false; m.visible = false; m.renderOrder = order; scene.add(m);
      return m;
    };
    return { geo: g, halo: mk(EL.halo, EL.haloPx, EL.haloDim, 8, 1), core: mk(EL.w, EL.minPx, EL.dim, 8.5, 0) };
  });
  // Where the ray through a point of the picture (nx, ny: -1..1) meets the paper: into cp (world x, z); returns its
  // distance from the camera.
  const rayV = new THREE.Vector3(), cp = { x: 0, z: 0 }, AX = new Float32Array(ARC_PTS), AZ = new Float32Array(ARC_PTS), AG = new Float32Array(EL.n + 1);
  const QX = new Float32Array(ARC_PTS), QZ = new Float32Array(ARC_PTS), QA = new Float32Array(ARC_PTS), QW = new Float32Array(ARC_PTS); // (one filament's points)
  function onPaper(camera, nx, ny) {
    rayV.set(nx, ny, 0.5).unproject(camera).sub(camera.position);
    const s = camera.position.y / Math.max(-rayV.y, 1e-4);
    cp.x = camera.position.x + rayV.x * s; cp.z = camera.position.z + rayV.z * s;
    return s * rayV.length();
  }
  const bandOf = (h, py) => { const [a, b] = CORNER.band[h]; return sstep(0, 1, (py - a) / (b - a)); };
  // One filament (slot a of hand h) for a trigger: from a point on the frame edge near the corner (chosen by the seed)
  // toward the note it was set off by, stopping short of the music (EL.stop); a jagged walk whose heading wanders (and
  // crawls a little with time), with a few branches; it grows from the edge, thins and dims toward its tip. Returns
  // its brightness (0: nothing drawn) and leaves its middle in cp, for its glow on the paper.
  function fillArc(h, a, tau, seed, nx, ny, S, camera, kr) {
    const g = arcs[h].geo.attributes;
    const env0 = tau < 0 || tau > EL.life ? 0 : sstep(0, 0.03, tau) * Math.exp(-tau / EL.decay) * (1 - sstep(EL.life - 0.1, EL.life, tau));
    // a soft flicker, smooth in time (two slow waves, seeded): a little in the filament, more in its light on the paper
    const fl = 0.6 * Math.sin(6.283 * (EL.flickHz[0] * tau + hash01(seed, 5))) + 0.4 * Math.sin(6.283 * (EL.flickHz[1] * tau + hash01(seed, 6)));
    const env = env0 * (1 + EL.flick[0] * fl);
    // the start: along the frame edge (two straight pieces round the corner), a little outside the picture
    const ed = EL.edge[h], l1 = Math.hypot(ed[1][0] - ed[0][0], ed[1][1] - ed[0][1]), l2 = Math.hypot(ed[2][0] - ed[1][0], ed[2][1] - ed[1][1]);
    let v = hash01(seed, 1) * (l1 + l2), ex, ey;
    if (v < l1) { v /= l1; ex = ed[0][0] + (ed[1][0] - ed[0][0]) * v; ey = ed[0][1] + (ed[1][1] - ed[0][1]) * v; } else { v = (v - l1) / l2; ex = ed[1][0] + (ed[2][0] - ed[1][0]) * v; ey = ed[1][1] + (ed[2][1] - ed[1][1]) * v; }
    const ws = Math.max(1, (onPaper(camera, ex, ey) * Math.tan((camera.fov * DEG) / 2)) / EL.sRef); // (further off, wider: about as wide on screen)
    const x0 = cp.x, z0 = cp.z, py0 = -z0;
    let dx = nx - x0, dz = ny - z0; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // as long as `len` of the picture's height on screen (whichever way it points), but stopping short of the music
    rayV.set(x0, 0, z0).project(camera); const sx = rayV.x, sy = rayV.y;
    rayV.set(x0 + dx * S, 0, z0 + dz * S).project(camera);
    // (in the tall picture a little shorter: its height is so much larger than its width)
    let L = Math.min(3 * S * kr, (EL.len * kr * Math.sqrt(Math.min(1, camera.aspect)) * S) / Math.max(0.5 * Math.hypot((rayV.x - sx) * camera.aspect, rayV.y - sy), 0.05));
    const stop = h === 0 ? TOP[0] + EL.stop : BOTTOM[1] - EL.stop, dpy = -dz;
    if (h === 0 && dpy < 0) L = Math.min(L, (py0 - stop) / -dpy); else if (h === 1 && dpy > 0) L = Math.min(L, (stop - py0) / dpy);
    const on = env > 0.002 && L > 1;
    const grow = sstep(0, EL.grow, tau) * 1.1, step = L / EL.n, ang = Math.atan2(dz, dx);
    let k = 0, cx = 0, cz = 0;
    // the main filament, then the branches
    for (let b = 0; b <= EL.branches; b++) {
      const len = b ? EL.bn : EL.n, root = b ? 2 + Math.floor(hash01(seed, 70 + b) * (EL.n - 5)) : 0;
      let x = b ? AX[root] : x0, z = b ? AZ[root] : z0, hd = b ? AG[root] + (hash01(seed, 80 + b) < 0.5 ? -1 : 1) * (0.45 + 0.5 * hash01(seed, 90 + b)) : ang, dev = 0;
      const st = b ? step * 0.55 : step, f0 = b ? root / EL.n : 0, df = b ? 0.55 / EL.n : 1 / EL.n, kb = b ? 0.6 : 1;
      for (let i = 0; i <= len; i++, k++) {
        if (i > 0) {
          const s0 = 100 * b + 10 + i;
          dev = 0.55 * dev + EL.wiggle * (2 * hash01(seed, s0) - 1) + EL.crawl * Math.sin(tau * 21 + 6.283 * hash01(seed, s0 + 50));
          const hh = hd + dev, s = st * (0.75 + 0.5 * hash01(seed, s0 + 25));
          x += Math.cos(hh) * s; z += Math.sin(hh) * s;
          if (!b) AG[i] = hh;
        } else if (!b) AG[0] = ang;
        if (!b) { AX[i] = x; AZ[i] = z; }
        const f = f0 + i * df;
        const al = on ? env * kb * (1 - 0.45 * Math.pow(Math.min(f, 1), 1.5)) * (i === len ? 0.25 : 1) * (1 - sstep(grow - 0.12, grow, f)) * bandOf(h, -z) : 0;
        QX[k] = x; QZ[k] = z; QA[k] = al; QW[k] = (1 - 0.55 * Math.min(f, 1)) * (b ? 0.7 : 1) * ws;
        if (!b && i === EL.n >> 1) { cx = x; cz = z; }
      }
    }
    // its segments, each with the points before and after it on its piece (itself at the piece's ends), at all four corners
    const PA = g.position.array, PP = g.aP.array, PB = g.aB.array, PN = g.aN.array, AL = g.aAl.array, WD = g.aWd.array;
    for (let s = 0; s < ARC_SEGS; s++) {
      const i = segAt[s], p = arcFirst(i) ? i : i - 1, q = arcLast(i + 1) ? i + 1 : i + 2;
      for (let c = 0, v = 4 * (a * ARC_SEGS + s); c < 4; c++, v++) {
        PA[3 * v] = QX[i]; PA[3 * v + 1] = 0.02; PA[3 * v + 2] = QZ[i]; PB[3 * v] = QX[i + 1]; PB[3 * v + 1] = 0.02; PB[3 * v + 2] = QZ[i + 1];
        PP[3 * v] = QX[p]; PP[3 * v + 1] = 0.02; PP[3 * v + 2] = QZ[p]; PN[3 * v] = QX[q]; PN[3 * v + 1] = 0.02; PN[3 * v + 2] = QZ[q];
        AL[2 * v] = QA[i]; AL[2 * v + 1] = QA[i + 1]; WD[2 * v] = QW[i]; WD[2 * v + 1] = QW[i + 1];
      }
    }
    cp.x = cx; cp.z = cz;
    return on ? env0 * (1 + EL.flick[1] * fl) : 0;
  }
  // The corner light at time t (style: an index into CORNER.ids, 0 = off): its uniforms and filaments.
  // K: its strength, 0..1 (CORNER.strength: kb scales the brightness of each style, kr its size and reach).
  const cornerOff = () => { paperU.uAccOn.value = 0; shadeOn(false); for (const a of arcs) a.halo.visible = a.core.visible = false; };
  const sdA = new THREE.Vector3(), sdB = new THREE.Vector3(), accCol = [new THREE.Vector3(), new THREE.Vector3()], arcCol = [new THREE.Vector3(), new THREE.Vector3()];
  function corner(style, camera, pr, fade, K) {
    const id = CORNER.ids[style], th = Math.tan((camera.fov * DEG) / 2), AP = paperU.uAccP.value, RG = paperU.uRing.value;
    const ST = CORNER.strength, kb = ST.light[0] + (ST.light[1] - ST.light[0]) * K, kr = ST.reach[0] + (ST.reach[1] - ST.reach[0]) * K;
    paperU.uAccOn.value = 1; shadeOn(true);
    // the shade in the two corners: its depth for this strength, the picture in its shorter side and the direction the
    // staves run across it (from the page under the middle of the picture, one staff space along x)
    const D = CORNER.shade.depth, saX = Math.max(camera.aspect, 1), saY = Math.max(1 / camera.aspect, 1);
    onPaper(camera, 0, 0);
    sdA.set(cp.x, 0, cp.z).project(camera); sdB.set(cp.x + 1, 0, cp.z).project(camera);
    let sx = (sdB.x - sdA.x) * saX, sy = (sdB.y - sdA.y) * saY; const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
    csU.uCS.value.set(1, D[0][0] + (D[0][1] - D[0][0]) * K, D[1][0] + (D[1][1] - D[1][0]) * K, CORNER.shade.dither);
    csU.uCSA.value.set(saX, saY, sx, sy); csU.uCSV.value.copy(camera.matrixWorld);
    csU.uCSR.value.set(1 / lineU.uRes.value.x, 1 / lineU.uRes.value.y);
    arcInvPV.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    for (let h = 0; h < 2; h++) {
      const tr = TR[h], d = onPaper(camera, CORNER.at[h][0], CORNER.at[h][1]), S = d * th, ax = cp.x, az = cp.z, kh = CORNER.k[h];
      paperU.uAccA.value[h].set(ax, az, id === 'glow' ? CORNER.glow.stretch : 1, S);
      { // the hand's light (see lightOf), and that light as it falls on the paper: divided by the paper's colour
        // (which the paper shader multiplies back, so the light's own colour is what is seen), as bright as it would be
        // on a neutral paper of the same lightness
        const al = paperU.uTintNear.value, r = srgbLin(al.x), g = srgbLin(al.y), b = srgbLin(al.z), y = 0.2126 * r + 0.7152 * g + 0.0722 * b, c = lightOf(accCol[h], looks[h].ballHalo, r, g, b);
        paperU.uAccC.value[h].set((c.x * y) / r, (c.y * y) / g, (c.z * y) / b);
      }
      AP[2 * h].w = AP[2 * h + 1].w = 0;
      for (let i = 0; i < 8; i++) RG[8 * h + i].z = 0;
      const ar = arcs[h];
      ar.halo.visible = ar.core.visible = id === 'electric';
      if (id === 'glow') {
        const G = CORNER.glow, dg = onPaper(camera, G.at[h][0], G.at[h][1]), Sg = dg * th;
        let E = 0;
        for (let i = 0; i < tr.n; i++) { const s = tr.tau[i]; E = Math.max(E, sstep(0, G.up, s) * Math.exp(-Math.max(0, s - G.up) / G.down) * (1 - sstep(G.life - 0.25, G.life, s))); }
        if (E > 0) AP[2 * h].set(cp.x, cp.z, Sg * G.R * kr * (1 - G.grow * 0.5 + G.grow * E), G.k * kh * kb * E);
      } else if (id === 'ripples') {
        const R = CORNER.ripples, dr = onPaper(camera, R.at[h][0], R.at[h][1]), Sr = dr * th, rx = cp.x, rz = cp.z;
        paperU.uAccA.value[h].set(rx, rz, 1, Sr);
        let E = 0;
        for (let i = 0; i < tr.n; i++) {
          const s = tr.tau[i], g = 1 - Math.exp(-s / R.T), a = R.k * kh * kb * sstep(0, 0.1, s) * Math.exp(-s / R.decay) * (1 - sstep(R.life - 0.35, R.life, s));
          if (a <= 0) continue;
          const rho = Sr * kr * (R.r0 + R.R * g), w = Sr * kr * (R.w0 + R.w1 * g);
          RG[8 * h + i].set(rho, w, a, 0); RG[8 * h + 4 + i].set(rho * R.echo[0], w * 0.8, a * R.echo[1], 0);
          E = Math.max(E, sstep(0, 0.1, s) * Math.exp(-s / (2 * R.decay)));
        }
        if (E > 0) AP[2 * h].set(rx, rz, Sr * 0.6 * kr, R.k * kh * kb * R.glow * E);
      } else if (id === 'electric') {
        let a = 0;
        for (let i = 0; i < tr.n && a < ARCS; i++) {
          if (tr.tau[i] > EL.life) continue;
          const e = fillArc(h, a, tr.tau[i], tr.seed[i], tr.x[i], -tr.y[i], S, camera, kr);
          if (e > 0) AP[2 * h + a].set(cp.x, cp.z, (2 + 0.25 * EL.len * S) * kr, EL.k * kh * kb * e);
          a++;
        }
        for (; a < ARCS; a++) fillArc(h, a, -1, 0, 0, 0, S, camera, kr); // (nothing: all its points dark)
        // (the filament is the hand's light seen directly, not on the paper: its colour paled only as far as it needs in
        // itself, against white, and not corrected for the paper)
        const v = lightOf(arcCol[h], looks[h].ballHalo, 1, 1, 1), cc = ar.core.material.uniforms.uColor.value, hc = ar.halo.material.uniforms.uColor.value;
        cc.copy(v).lerp(WHITE, EL.white); hc.copy(v);
        cc.multiplyScalar(EL.lum * kb / (0.2126 * cc.x + 0.7152 * cc.y + 0.0722 * cc.z)); hc.multiplyScalar(EL.haloLum * kb / (0.2126 * hc.x + 0.7152 * hc.y + 0.0722 * hc.z)); ar.halo.material.uniforms.uW.value = EL.halo * kr;
        ar.core.material.uniforms.uMinPx.value = EL.minPx * pr; ar.halo.material.uniforms.uMinPx.value = EL.haloPx * pr;
        ar.core.material.uniforms.uFade.value = ar.halo.material.uniforms.uFade.value = fade;
        for (const k of ARC_DYN) ar.geo.attributes[k].needsUpdate = true;
      }
    }
  }
  // The glows as lights (GLINT): the next free one at world (x, y, z), radius r, colour col x k; into the 3D pieces'
  // uniforms (view space) and the lines' (world space).
  let glowN = 0, glowCam = null;
  function setGlow(x, y, z, r, col, k) {
    if (glowN >= GLOWS) return;
    const v = glU.uGL.value[glowN];
    v.set(x, y, z, 1).applyMatrix4(glowCam.matrixWorldInverse); v.w = r;
    lineU.uGW.value[glowN].set(x, y, z, r); glU.uGLC.value[glowN].copy(col).multiplyScalar(k);
    glowN++;
  }
  // Each hand's light, as its lit notes throw it (their halo colour) and as its ball does (the ball's halo colour): at
  // full strength (brightest channel 1), a little paler.
  const tint = [new THREE.Vector3(), new THREE.Vector3()], ballTint = [new THREE.Vector3(), new THREE.Vector3()], WHITE = new THREE.Vector3(1, 1, 1);
  const full = (out, v) => { const m = Math.max(v.x, v.y, v.z, 1e-6); return out.set(v.x / m, v.y / m, v.z / m).lerp(WHITE, 0.2); };
  const tintOfHand = (h) => { full(ballTint[h], looks[h].ballHalo); return full(tint[h], looks[h].halo); };
  // A hand's light for the corner light (see CORNER): its colour v (linear) at full strength, taken toward white at
  // least CORNER.pale and as far as needed for it to be no more colourful than CORNER.sat, both in itself and against
  // the paper it falls on (r, g, b: the paper's colour, linear): (brightest - dimmest channel of the light, and of the
  // light over the paper) <= sat x its luminance (found by halving the interval: the excess falls as the light
  // pales); into out.
  const satOver = (p, x, y, z, r, g, b) => {
    const X = (x + (1 - x) * p) / r, Y = (y + (1 - y) * p) / g, Z = (z + (1 - z) * p) / b;
    return Math.max(X, Y, Z) - Math.min(X, Y, Z) - CORNER.sat * (0.2126 * X + 0.7152 * Y + 0.0722 * Z);
  };
  const lightOf = (out, v, r, g, b) => {
    const m = Math.max(v.x, v.y, v.z, 1e-6), x = v.x / m, y = v.y / m, z = v.z / m;
    let lo = CORNER.pale, hi = 1;
    if (Math.max(satOver(lo, x, y, z, 1, 1, 1), satOver(lo, x, y, z, r, g, b)) > 0) {
      for (let i = 0; i < 16; i++) { const mid = 0.5 * (lo + hi); if (Math.max(satOver(mid, x, y, z, 1, 1, 1), satOver(mid, x, y, z, r, g, b)) > 0) lo = mid; else hi = mid; }
      lo = hi;
    }
    return out.set(x, y, z).lerp(WHITE, lo);
  };
  // Draws the light map: the pools of the lit notes and of the light trails, over the shadow mask's window.
  function drawLight() {
    if (!sh) return;
    const r = renderer, target = r.getRenderTarget(), autoClear = r.autoClear, alpha = r.getClearAlpha();
    r.getClearColor(clearKeep);
    r.setClearColor(0x000000, 0); r.autoClear = false;
    r.setRenderTarget(sh.light); r.clear(true, false, false);
    r.render(poolScene, sh.lightCam);
    r.setRenderTarget(target); r.autoClear = autoClear; r.setClearColor(clearKeep, alpha);
  }

  const keyDir = new THREE.Vector3(), edgeDir = new THREE.Vector3(), point = new THREE.Vector3(), out = { focus: 50, range: 0, sky: false, point };
  const inkLinear = new THREE.Color(F ? F.line : paperTone.ink), bp = new THREE.Vector3();
  const faded = [...new Set([ink, headMat, face, chrome, fleck, pinMat, ...mirrored])];
  if (sh) paperU.uLight.value = sh.light.texture;
  // A paper colour (see PAPERS), straight into the uniforms and materials (no rebuild): its tints, texture, ink, and
  // the room the lacquer, chrome and finishes reflect.
  function applyPaper(pt) {
    paperTone = pt;
    paperU.uTintNear.value.copy(tintOf(pt.near)); paperU.uTintFar.value.copy(tintOf(pt.far)); paperU.uCap.value = LIGHT.cap * pt.expo;
    paperU.uLook.value.set(pt.tone[0], pt.tone[1], SHADE.bump * pt.grain, SHADE.cockle);
    if (!F) { ink.color.set(pt.ink); headMat.color.set(pt.ink); inkLinear.set(pt.ink); }
    const e0 = paperEnv(renderer, pt), e1 = F ? paperEnv(renderer, pt, F.win, F.room) : e0;
    if (e0) for (const m of faded) { const e = m.userData.win ? e1 : e0; if (m.envMap !== e) { m.envMap = e; m.needsUpdate = true; } }
  }
  applyPaper(paperTone);
  // what the last frame drew, for checking it from outside: the balls' centres (world), whether each is shown, the fades
  const probe = { balls: [new THREE.Vector3(), new THREE.Vector3()], shown: [false, false], corner: 'off', sparks: 0, fade: 1, ballFade: 1, tc: layout ? layout.tc : null, tEnd: layout ? layout.tEnd : null, camera: null, t: 0, glows: 0 };
  function render(t, camera, o = {}) {
    const c = camFor(camera.aspect, o.motion !== false), live = !!o.live || !S, L = live ? liveLayout : layout;
    if (camera.fov !== c.fov || camera.near !== NEAR || camera.far !== FAR) { camera.fov = c.fov; camera.near = NEAR; camera.far = FAR; camera.updateProjectionMatrix(); }
    printed.visible = !live; liveGroup.visible = live;
    if (printedPools) printedPools.visible = !live;
    if (LG.pools) LG.pools.visible = live;
    if (live) liveBase = Math.floor(t / LIVE.period) * LIVE.period;
    const p = place(camera, L, t, c);
    camera.updateMatrixWorld();
    if (live) drawLive(o.live || NONE, p.x, c.live || 0);
    // the end: the picture fades to black, the balls last (smoothly in what the eye sees, so as linear light ^2.2)
    const fS = 1 - sstep(L.tc + ENDING.fade[0], L.tc + ENDING.fade[1], t), fB = 1 - sstep(L.tc + ENDING.ballFade[0], L.tc + ENDING.ballFade[1], t);
    const linS = Math.pow(fS, 2.2), linB = Math.pow(fB, 2.2);
    // the light pool and the key light travel with the camera
    paperU.uCam.value.copy(camera.position);
    paperU.uDn.value = p.dNear; paperU.uLam.value = LIGHT.lam * p.h; paperU.uVn.value = LIGHT.vNear * paperTone.expo * Math.pow(LIGHT.h0 / Math.max(1, p.hl), LIGHT.hExp);
    paperU.uFade.value = linS;
    paper.position.set(camera.position.x, 0, camera.position.z);
    // (the texture's place counted from a whole number of its larger tiles, so its numbers stay small)
    paperU.uOrigin.value.set(Math.floor(camera.position.x / GRAIN.toneTile) * GRAIN.toneTile, Math.floor(camera.position.z / GRAIN.toneTile) * GRAIN.toneTile);
    const az = (c.yaw + LIGHT.off) * DEG, el = LIGHT.elev * DEG; // fixed for each camera: the shadows never swim
    keyDir.set(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    paperU.uKey.value.copy(keyDir);
    point.set(p.x, 0, -c.y);
    key.target.position.copy(point); key.position.copy(point).addScaledVector(keyDir, 60);
    edgeDir.subVectors(camera.position, point).normalize(); edgeDir.x = -edgeDir.x;
    edge.target.position.copy(point); edge.position.copy(point).addScaledVector(edgeDir, 60);
    key.intensity = LIGHT.key * linS; edge.intensity = LIGHT.edge * linS; ambient.intensity = 0.05 * linS;
    for (const m of faded) m.envMapIntensity = (m.userData.env ?? 1) * linS;
    if (o.res) lineU.uRes.value.copy(o.res);
    lineU.uMinPx.value = 1.15 * (o.pr || 1);
    lineU.uColor.value.copy(inkLinear).multiplyScalar(linS);
    // the lit notes: every head played by now (its time <= t) glows, for good, and lights the paper around it
    glowU.uTime.value = live ? -1e9 : t; glowU.uFade.value = linS;
    for (let h = 0; h < 2; h++) poolU.uColor.value[h].copy(tintOfHand(h));
    out.focus = camera.position.distanceTo(point);
    glowN = 0; glowCam = camera;
    // the balls, their reflections, their light on the paper and on everything that shines, their shadows and trails
    for (let hand = 0; hand < 2; hand++) {
      const m = balls[hand], shown = !live && o.paths !== false && linB > 0 && ballAt(hand, t, L, c, camera.aspect, bp);
      const pb = paperU.uBall.value[hand], tr = trails[hand], trailOn = shown && !!o.trails;
      m.visible = shown; probe.shown[hand] = shown; tr.mesh.visible = tr.pool.visible = trailOn;
      if (!shown) { pb.w = 0; continue; }
      probe.balls[hand].copy(bp); // (also where its shadow is cast from)
      m.position.copy(bp); ballU[hand].uAlpha.value = linB;
      pb.set(bp.x, bp.y, bp.z, BALL.r);
      paperU.uBallColor.value[hand].copy(looks[hand].refl).lerp(WHITE, POOL.ball.pale).multiplyScalar(linB);
      paperU.uPoolColor.value[hand].copy(ballTint[hand]).lerp(WHITE, POOL.ball.pale).multiplyScalar(linB);
      setGlow(bp.x, bp.y, bp.z, GLINT.r.ball, paperU.uPoolColor.value[hand], GLINT.k.ball); // (its pale light, as above: already faded)
      if (trailOn) {
        fillTrail(hand, t, L, c, camera.aspect);
        const v = ballTint[hand], lum = 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
        tr.u.uColor.value.copy(v).multiplyScalar(TRAIL.lum / lum); tr.u.uFade.value = linB; tr.u.uMinPx.value = TRAIL.minPx * (o.pr || 1); tr.pu.uColor.value.copy(v).multiplyScalar(linB);
      }
    }
    // and each hand's newest lit notes, fading out as its ball lands on later ones (see GLINT)
    if (!live) for (let hand = 0; hand < 2; hand++) {
      const list = paths[hand];
      if (!list.length || t < list[0].t) continue;
      let lo = 0, hi = list.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].t <= t) lo = m; else hi = m - 1; }
      const u = lo + 1 < list.length ? (t - list[lo].t) / (list[lo + 1].t - list[lo].t) : Math.min(1, t - list[lo].t);
      for (let k = 0; k < GLINT.notes && lo - k >= 0; k++) {
        const w = 1 - sstep(GLINT.fade[0], GLINT.fade[1], k + u), n = list[lo - k];
        if (w > 0) setGlow(n.x, GLINT.lift, -n.y, GLINT.r.note, tint[hand], GLINT.k.note * w * linS);
      }
    }
    probe.glows = glowN;
    for (let i = glowN; i < GLOWS; i++) { glU.uGL.value[i].w = 0; lineU.uGW.value[i].w = 0; }
    // the corner light and the powder sparks (both optional), set off by the touches
    const cs = Math.max(0, CORNER.ids.indexOf(o.corner)), np = Math.round(Math.min(1, Math.max(0, Number(o.sparks) || 0)) * SPARK.max);
    if (cs || np) touches(t, live, np, linB);
    if (cs) corner(cs, camera, o.pr || 1, linS, Math.min(1, Math.max(0, o.cornerK ?? 0.5))); else cornerOff();
    sparkMesh.visible = sparkPool.visible = np > 0;
    if (np) {
      sparkGeo.instanceCount = np * 2 * SPARK.slots; sparkMU.uMinPx.value = SPARK.minPx * (o.pr || 1); sparkMU.uFade.value = linB;
      for (let h = 0; h < 2; h++) sparkU.uCol.value[h].copy(ballTint[h]);
    }
    probe.corner = CORNER.ids[cs]; probe.sparks = np;
    // the shadows of everything raised, in a window of the page that steps along in whole texels, and the glows' light
    // on the paper over the same window
    const mk = camera.aspect < 1 ? MASK.tall : MASK.wide, texel = mk.W / MASK.texels[0];
    drawShadows(Math.floor((p.x - mk.back) / texel) * texel, mk.W, SHADE.ball * linB, probe.balls, probe.shown);
    drawLight();
    probe.fade = fS; probe.ballFade = fB; probe.camera = camera; probe.t = t;
    return out;
  }

  // A different pair of hand colours (as opts.hands), straight into the colours the shaders already use.
  function setHands(v) {
    pairLooks(v).forEach((l, h) => { for (const k of Object.keys(l)) looks[h][k].copy(l[k]); hands[h].setRGB(l.halo.x, l.halo.y, l.halo.z); });
  }
  // A different paper colour: the id of one of PAPERS.
  const setPaper = (id) => applyPaper(paperOf(id));

  return { scene, render, setHands, setPaper, paperId: () => paperTone.id, finish: fid, bloom: { pass: GLOW.bloom, mips: GLOW.bloomMips }, layout: S, heads, hands, balls, paths, ballAt: (hand, t, aspect = 16 / 9, p = new THREE.Vector3(), motion = true) => (layout && ballAt(hand, t, layout, camFor(aspect, motion), aspect, p) ? p : null),
    pose, probe, framing: frm, uniforms: { paper: paperU, line: lineU, glow: glowU, halo: haloU, glows: glU, pool: poolU, balls: ballU }, lights: { key, edge, ambient }, trails,
    materials: { ink, head: headMat, face, chrome, fleck, pin: pinMat, paper: paperMat, line: lineMat }, printed, camX: (t) => camX(layout || liveLayout, t), timing: layout };
}
