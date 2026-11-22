// "Paper": the written music lies on a long sheet of real paper (ivory by default; a few other calm colours in PAPERS),
// printed in a matching near-black ink, and the camera glides along it like a dolly on rails, looking diagonally down
// the music. The title, clefs, brace and signs stand solid on the paper (raised from it, no pins: round 5), black
// lacquer with a thin chrome rim. One soft light travels with the camera, so the paper is brightest just below the picture and dims
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
// The notes' shine (the app's "Shine of the notes", s = 0..1, `def` unless chosen; 0 = the quiet sheen of before): the
// notation catches the glows as polished metal does, in a second, tighter highlight added to its own (glowCode). It
// sees the top of every symbol as gently domed (aDome, see domeOf: tilted up to atan(dome) at the outline, not at all
// in the middle), so a ball close beside a notehead, a beam or a sign shows on it as a crisp highlight that slides
// over it and grows as the ball comes near (a flat top mirrors only lights at the camera's own mirrored angle).
// k: its strength at s = 1 (times s^p); rough: its sharpness (Beckmann alpha, from s = 0 to 1: tighter as it grows),
// widened by how fast the surface turns within a pixel (`aa`, so thin rims and far notes never sparkle) and by the
// lamp's size close by (alpha + lamp x its radius / distance, as for a round lamp, with its white-hot core as the
// size); haze: a broad sheen of the light's colour around the highlight (GGX alpha, and its share at s = 1, times
// s^2), as polished metal shows; sat: how much of the light's colour it keeps (near white with a hint of the hand's
// colour, never steel-blue); note: the share for the lit notes' glows (softer than the balls'; easing in over noteIn
// seconds from the moment each is struck, so nothing near it lights up all at once); cap: the brightest it may make
// any part (linear, under the bloom threshold, so it never blooms or glares: it eases into the room left below it,
// so a strong highlight keeps a bright centre and a soft edge instead of a flat blown patch); the thin lines' streaks
// grow by line[0] x s in brightness and line[1] x s in sharpness, up to lineCap; tint: how much of the finish's own
// colour the highlight takes.
const SHINE = { def: 0.5, k: 2, p: 1.3, rough: [0.2, 0.09], lamp: 0.2, aa: 0.12, dome: 1.8, haze: [0.45, 0.1], sat: 0.6, note: 0.35, noteIn: 0.15, cap: 0.9, line: [1.6, 0.5], lineCap: 0.88,
  tint: { matte: 0, metal: 0.25, glass: 0.1, gold: 0.6 } };
// The balls' brightness (the app's "Brightness of the balls", b = 0..1, 0.5 = as designed): the light they throw (its
// pool on the paper, its reflection, its glints and shine on the notation) is scaled by `light` (exponentially from
// light[0] at 0 to 1 at 0.5 to light[1] at 1); the ball itself by the same factor below 0.5, and above it its core by
// only `core` of the gain (the clipped white centre and its bloom grow little), its tinted halo by `halo` of it and
// its light on the paper right under it (its pool and its mirror image) by `refl` of it (so a bright ball never
// leaves a second bright spot below it); its glints and shine on the notation take the whole gain.
const BALLK = { def: 0.5, light: [0.4, 1.7], core: 0.4, halo: 1, refl: 0.5 };
export const SHINE_DEFAULT = SHINE.def;
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
//   electric (round 5: a Tesla-coil discharge, sharp, no longer a soft wisp): a jagged bolt of current reaching in
//     from a point of the frame edge round the corner (`edge`: the picture points of that edge, chosen by the note's
//     seed: the arc's terminal) toward the note just touched, `len` of the picture's height long on screen (at most
//     3 S; S from the corner itself, CORNER.at) and stopping `stop` ss short of the music. Its shape is fractal: the
//     straight line split `n` = 2^k times, each midpoint pushed sideways by `rough` x the piece's length (random), so
//     it kinks sharply at every scale, with `branches` forks of `bn` steps (`fork` [shortest, longest] of its length,
//     leaving at [least, most] radians). It re-strikes `hz` times a second, each strike a new shape from the same
//     terminal (seeded, so every frame is a pure function of the time), flashing `flash` brighter as it strikes and
//     settling; a pulse of current runs along it from the terminal to the tip `pulseHz` times a second (`pulse`: how
//     much brighter, `pulseW` its length, a share of the bolt). The leader grows from the edge in `grow` s and the
//     whole discharge dies away (time constant `decay`, gone by `life`). Its core is hard-edged and white-hot (the
//     hand's colour `white` of the way to white), w ss wide (at least minPx drawing pixels); its halo is the hand's
//     colour, `halo` ss (at least haloPx), both wider where the paper is further off than S = sRef ss (so they look
//     about as wide in either corner); lum, haloLum: their brightness (the core blooms); dim, haloDim: how much each
//     dims the paper under it (so the bolt reads on white paper too); k: its light on the paper around it, which
//     flickers with the strikes (flick: [the bolt's, its light's] share of the flicker).
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
  ripples: { at: [[-0.92, 0.88], [0.92, -0.92]], n: 4, k: 1.0, r0: 0.05, R: 1.6, T: 0.6, w0: 0.018, w1: 0.075, decay: 0.5, life: 1.4, echo: [0.72, 0.55], glow: 0.14 }, // (round 5: crisp, thin rings; 0.05 / 0.24 wide and k 0.6 before)
  electric: { n: 16, branches: 4, bn: 8, len: 0.52, stop: 2.5, rough: 0.32, fork: [0.22, 0.48], forkAng: [0.35, 0.95], hz: 14, flash: 0.55, pulseHz: 5, pulse: 1.3, pulseW: 0.09,
    grow: 0.05, decay: 0.17, life: 0.62, w: 0.05, sRef: 10, minPx: 1.6, halo: 0.95, haloPx: 9,
    lum: 1.9, white: 0.82, dim: 0.5, haloDim: 0.36, haloLum: 0.6, k: 0.6, flick: [0.35, 0.3], edge: [[[-1.04, 0.2], [-1.04, 1.04], [-0.75, 1.04]], [[1.04, -0.2], [1.04, -1.04], [0.3, -1.04]]] },
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
// Electric notes (round 5; the "Electric notes" slider, K from 0 to 1, 0 = none): as a ball lands on a note, the note
// crackles with short, sharp bolts of current (white-hot cores in the hand's colour, as the Electric corner light),
// and a bolt jumps to it from the hand's note before, when that is within `reach` ss (and not touching it). For each
// of the hand's newest `notes` landings within `life` s: the jump (bolt 0) and 1 + (bolts - 2) K crackles, leaving
// the head `r0` ss from its middle in seeded directions, len [shortest, longest] ss long (times 0.7 + 0.6 K). Each is a
// fractal bolt (n steps and one fork of bn steps, rough as CORNER.electric's), re-struck hz times a second, flashing
// `flash` brighter as it strikes; it flares up in 15 ms and dies away (time constant decay). Its core is w ss wide (at
// least minPx), its halo `halo` ss (at least haloPx); lum, haloLum: their brightness at K 1 (0.6 + 0.8 K of it);
// dim, haloDim: how much they dim what is behind (so they read on white paper); white: the core's share of white.
// Current with the balls (round 6; the "Current with the balls" slider, K from 0 to 1, 0 = none): each ball carries
// electricity. Its tail: the path it flew over the last tail x (0.6 + 0.4 K) s, drawn as a jagged channel of current
// through the air (n = 2^k steps; jag: how far it strays from the path, [at the ball, at the end of the tail] ss, x (0.6 +
// 0.6 K)), with `strands` (branches) thinner strands twisting round it, re-struck hz times a second, brightest at the
// ball and fading to nothing at the end ((1 - f)^fall, f = 0 at the ball). A small crackle leaps off the ball
// (`spark`: [shortest, longest] ss). Where a ball lands, the note sparks (`sparks` crackles, `sparkLen` ss long, gone by
// `sparkLife` s) and a bolt leaps ahead to the note it will land on next, when that is within leadMax ss (lit at once,
// dying away with time constant leadDecay, gone by `lead` s), so the current runs ahead of the ball. Core and halo as
// the electric notes' (ZAP).
const CURRENT = { n: 32, branches: 2, bn: 16, tail: 0.55, jag: [0.04, 0.38], fall: 1.3, hz: 16, spark: [0.45, 1.0], sparks: 2, sparkLen: [0.9, 2.0], sparkLife: 0.32, lead: 0.28, leadDecay: 0.1, leadMax: 16,
  w: 0.045, minPx: 1.4, halo: 0.6, haloPx: 7, dim: 0.5, haloDim: 0.42, lum: 2.2, haloLum: 0.75, white: 0.8 };
// Cracks of light in the notes (round 6; the "Cracks of light" slider, K from 0 to 1, 0 = none): as the music reaches
// a note, the whole of it (head, stem, flag, beam, dots) breaks into glowing cracks lit from inside, keeping its shape:
// two scales of cells over the piece (`cells` per ss, the finer `fine` times as many, only some of their edges), the
// light bleeding a little into each shard (`bleed` ss), each shard's cracks flickering on their own `hz` times a
// second; a flash as the note is played (`flash` more, time constant `flashT` s) settling to a steady inner glow, and
// the shell round them darkening (to `dark` of itself at K 1) so the light shows. The heads keep their play time; the
// rest of the note is lit as the music reaches its place on the page (the layout is proportional to time). Only what
// stands up from the page cracks (the printed text, flat on it, does not) and rests do not. In the hand's colour (its
// halo's, `gain` times as bright, the cracks' middles toward white).
const CRACK = { cells: 2.3, fine: 2.4, bleed: 0.09, hz: 12, flash: 1.5, flashT: 0.22, dark: 0.38, gain: 1.6 };
const ZAP = { notes: 3, bolts: 4, life: 0.42, reach: 9, r0: 0.72, len: [1.1, 2.6], n: 8, branches: 1, bn: 4, rough: 0.34, hz: 18, flash: 0.6, decay: 0.12,
  w: 0.042, minPx: 1.4, halo: 0.62, haloPx: 7, dim: 0.55, haloDim: 0.45, lum: 2.2, haloLum: 0.75, white: 0.8 };
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
const SHADE = { amb: 0.38, shadow: 0.9, ball: 0.55, ballSize: 1.8, contact: 0.3, low: 0.4, soft: 0.3, high: 0.9, bump: 0.55, cockle: 0.012, inkLift: 1.4 }; // (inkLift 2.2 for the 0.11 ss ink before round 5)
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
  { id: 'charcoal', name: 'Charcoal', desc: 'Warm near-black paper in pearl ink under a soft lamp; the lit notes glow and shine in its satin sheen.', near: '#3f3329', far: '#382d25', expo: 0.32, ink: '#e0d8c9', tone: [0.055, 0.045], grain: 0.95, swatch: ['#3b322b', '#0f0c0a'], dark: 'charcoal' },
  { id: 'graphite', name: 'Graphite', desc: 'Deep neutral grey paper in pearl ink under a soft lamp; the hand colours look their truest.', near: '#3a3a3b', far: '#333437', expo: 0.32, ink: '#dddad3', tone: [0.05, 0.04], grain: 0.9, swatch: ['#3b3a38', '#131315'], dark: 'graphite' },
  // Marble (round 5): polished stone instead of paper. marble: the veins (see MARBLE in PAPER_FRAG): size = the
  // pattern's size (ss), warp, w = [main, fine] vein widths, k = [main veins, fine veins, cloudiness, halo], vein = the
  // veins' colour at full light; polish (light marble; a dark one takes DARK.marble) = [reflection strength over
  // REFL.k, gloss (radians), mirror of the lit notes, sheen of the room]; css: its button.
  // (round 6: the dark marble's veins dimmer and greyer, and faint under the music (`under`: their share there), as
  // the pale notes got lost among the bright veins)
  { id: 'marble-dark', name: 'Dark marble', desc: 'Polished black marble with soft grey veins that fade away under the music, in pearl ink; the balls and the lit notes mirror in its polish.', near: '#2d2a28', far: '#282624', expo: 0.32, ink: '#e6e0d4', tone: [0.015, 0.03], grain: 0.18, swatch: ['#2e2b29', '#0d0c0c'], dark: 'marble',
    marble: { size: 34, warp: 2.6, w: [0.018, 0.003], k: [0.75, 0.32, 0.18, 0.08], vein: '#7d7a75', under: 0.22 },
    css: 'linear-gradient(118deg, transparent 37%, rgba(190,186,178,.55) 39.5%, transparent 42%), linear-gradient(32deg, transparent 61%, rgba(190,186,178,.3) 62.5%, transparent 64%), radial-gradient(120% 95% at 45% 100%, #2e2b29 35%, #0d0c0c)' },
  { id: 'marble-gold', name: 'Black and gold', desc: 'Polished black marble with thin golden veins (as Portoro stone), faint under the music, in pearl ink: warm, rich and calm.', near: '#262321', far: '#211f1d', expo: 0.32, ink: '#e8e1d3', tone: [0.015, 0.03], grain: 0.18, swatch: ['#2a2622', '#0b0a09'], dark: 'marble',
    marble: { size: 30, warp: 2.8, w: [0.014, 0.0028], k: [0.9, 0.38, 0.14, 0.1], vein: '#a17c3c', under: 0.25 },
    css: 'linear-gradient(118deg, transparent 37%, rgba(214,170,92,.85) 39.5%, transparent 42%), linear-gradient(32deg, transparent 61%, rgba(214,170,92,.5) 62.5%, transparent 64%), radial-gradient(120% 95% at 45% 100%, #2a2622 35%, #0b0a09)' },
  { id: 'marble-white', name: 'White marble', desc: 'Polished white marble with soft grey veins, in black ink: cool, bright and calm, with the lights mirrored in it.', near: '#f4f2ee', far: '#e7e4df', expo: 0.95, ink: '#141313', tone: [0.012, 0.025], grain: 0.18, swatch: ['#f4f2ee', '#c9c6c0'],
    marble: { size: 40, warp: 2.2, w: [0.03, 0.005], k: [0.75, 0.3, 0.08, 0.32], vein: '#969390', under: 0.5 }, polish: [1.15, 0.13, 0.45, 0.08],
    css: 'linear-gradient(118deg, transparent 35%, rgba(128,124,118,.55) 39%, transparent 43%), linear-gradient(30deg, transparent 59%, rgba(128,124,118,.35) 61.5%, transparent 64%), radial-gradient(120% 95% at 45% 100%, #f4f2ee 35%, #c9c6c0)' },
];
// Dark papers (a paper with `dark`: the id of one of these). The ink turns light by itself (the paper's own `ink`, and
// for each finish its `dark` version in FINISH), and the light behaves as on a real dark sheet under one lamp:
// lamp: the key light's pool, narrower than on light paper so it reads on the dark sheet: lam replaces LIGHT.lam (the
//   fall-off with distance from the camera), and a soft round pool around the place where the music is played, at
//   page x + fwd (ss) from it: brightness floor + (1 - floor) / (1 + (r / R)^2)^1.5 at r ss (R across the music,
//   R * along along it), on the paper and on everything raised (so the far ink dims with the far paper);
// amb: the share of the light in full shadow (SHADE.amb on light paper; lower, so the shadows still read); ball: how
//   much of it a ball holds back and ballSize the size of what casts it (SHADE.ball, SHADE.ballSize on light paper: more
//   and larger, as a soft shadow is faint on a dark sheet);
// pool, corner: the glows' and the corner light's light on the paper, as a share of what they give on light paper
//   (the same light makes a far stronger mark on a dark sheet, so it is turned down to stay soft); cornerSat: the
//   corner light's colourfulness (CORNER.sat on light paper: a dark sheet can take a deeper colour, never a stain);
// refl: the balls' reflections (REFL.k times this); sheen: the lit notes' reflections in the satin paper (soft
//   streaks of their colour toward the camera, as the balls'; per unit of their light); gloss: the spread of both;
// room: the satin's faint sheen of the dim room, strongest at grazing angles (Fresnel), so on the far paper;
// arcRise: the time (s) over which the Electric corner light's light on the sheet swells in (a soft rise, not a pop);
// haloDim: how much a lit note's halo dims the paper under it (GLOW.dim on light paper; a dark sheet needs little);
// line: the colour of the thin lines (staff, ledger and bar lines, stems; a little dimmer than the heads, as thin
//   printed lines are); face, faceRough: the matte finish's raised signs and title, pearl lacquer instead of black;
// env: the brightness of the room the finishes reflect (paper.expo on light paper: here the room stays lit, not the
//   paper);
// bloom: the stage's bloom (as GLOW.bloom), a little weaker, as a glow spreads further to the eye on a dark ground.
const DARK = {
  charcoal: { lamp: { lam: 1.9, R: 26, along: 1.5, fwd: 4, floor: 0.45 }, amb: 0.16, ball: 1.3, ballSize: 2.6, pool: 0.32, corner: 0.36, cornerSat: 2.4, refl: 0.42, sheen: 0.35, gloss: 0.21, room: 0.3, arcRise: 0.15, haloDim: 0.25,
    line: '#9d9587', face: '#d9d1c2', faceRough: 0.22, env: 0.85, bloom: [0.15, 0, 0.92] },
};
DARK.graphite = { ...DARK.charcoal, line: '#9a9893', face: '#d8d5ce' }; // the same sheet and lamp in a neutral grey
// polished black marble: the same lamp, a sharper and stronger mirror of the balls and the lit notes, more sheen
DARK.marble = { ...DARK.charcoal, refl: 0.85, gloss: 0.1, sheen: 0.8, room: 0.5, line: '#a49e94', face: '#e2ddd3', faceRough: 0.16 };
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
// The cinematic camera, "Crane and overhead" (camMove 'cinematic'; the Steady camera above stays the default). Planned
// once per piece and picture shape from the score: the piece is cut into phrases at bar lines (scored by a breath in
// the notes, a held note into the bar line, a change of texture, loudness or register, and the usual 4- and 8-bar
// grouping), and each phrase is given a pose: HIGH (craned up, nearly overhead, the whole grand staff in view like a
// printed page), LOW (down close to the paper at a grazing angle, around the hands) or MID2 (a three-quarter view from
// the other side). A new section or a busy, loud phrase cranes up; the next phrase comes down; louder phrases go a
// little higher, quieter ones a little lower and closer. Each move starts `lead` s before its bar line and turns the
// view at `rate` deg/s at most (a move that would not fit its phrase with a `hold` after it is made smaller); a held
// pose orbits slowly (`orbit` deg/s, alternating sides; a low view also closes in a little, a high one opens out).
// The key poses form a piecewise-linear plan, smoothed by a Gaussian of `sigma` s in closed form, so every pose is a
// pure function of t with continuous acceleration and no overshoot. The camera keeps the Steady camera's lens and
// its light (the shadows never swim); it starts as the Steady camera (the 3D title), blends in `inW` s after the first
// note and back out before the last (the ending crane is the Steady one). Framing: the notes each hand has just played
// or is about to play, and both balls, stay inside `frame.m` of the picture (the camera backs off as little as needed,
// worked out on a `frame.dt` grid, held `frame.reach` s, smoothed), and the planned distance keeps a notehead at least
// `minPx` px tall at 1080p (the distance with both limits is smoothed again by `distSigma` s). Live playing has no future to plan from: the Steady camera is used there.
// Calm: two HIGH poses stand at least `highGap` s apart (otherwise that phrase gets MID2); the paper under the place
// being played never sweeps across the picture faster than `sweep` times it does with the Steady camera at the same
// moment (1.35 there keeps the whole picture's sweep, nearer paper included, within about 1.5 times the Steady one) (the camera keeps back as far as that needs, planned with the other limits); and the lamp, the key light and
// the shadows stay where the Steady camera has them (the picture's brightness does not swing as the camera moves; the
// shadow window is `shadowPad` times wider, for the high views). In the low views, which look further along the paper,
// the lamp's fall-off reaches up to 1 + lowLam[0] times as far (all of it below a tilt of lowLam[1] deg, none above lowLam[2]),
// so the far paper does not sink into black.
// Poses: [tilt, heading, distance to the place (ss), at x, at y (fractions of the picture), wh, wp] where the place's
// page y is the Steady one moved wh of the way to the two hands' mean and wp of the way to the middle of the system.
// Round 5: bolder than the calmed round-4 version (rate 6 -> 8.5 deg/s, blending in from 0.8 s instead of 1.5 s after
// the first note, the first phrase cut from 6 s), so the moves are seen; it stays smooth (the same Gaussian plan).
const CINE = {
  sigma: 1.5, rate: 8.5, tMin: 4, tMax: 12, hold: 3, lead: 0.6, inW: [0.8, 4.5], outW: [3, 0.5], highGap: 24, sweep: 1.35, shadowPad: 1.35, lowLam: [0.7, 14, 44],
  orbit: 0.6, orbitMax: 6, push: { LOW: 0.85, HIGH: 1.06, MID2: 0.95 }, tip: { HIGH: -3 },
  seg: { min: 9, max: 24, pref: 13, first: 6 },
  frame: { m: 0.9, mBall: 0.84, hold: 0.3, ahead: 0.2, reach: 2.6, dt: 0.1, knot: 0.25, sigma: 1, hands: 2 },
  minPx: 16, distSigma: 0.8, lam: 1.3, dof: { range: 0.85, wide: [18, 26], tall: [29, 37] }, sysMid: (TB + 4) / 2, // dof: the lens blur, only in the low views (full below the first tilt, none above the second)
  wide: { HIGH: (e) => [71 + 6 * e, 88, 90 + 14 * e, 0.42, 0.5, 0, 1], LOW: (e, side) => [14 + 3 * e, side ? 62 : 74, 24 + 5 * e, 0.55, 0.5, 1, 0], MID2: (e, side) => [36, side ? 66 : 42, 50, 0.52, 0.53, 0.5, 0] },
  tall: { HIGH: (e) => [62 + 6 * e, 44, 70 + 10 * e, 0.5, 0.6, 0, 1], LOW: (e, side) => [27 + 3 * e, side ? 14 : 30, 32 + 5 * e, 0.6, 0.62, 1, 0], MID2: (e, side) => [40, side ? 40 : 22, 55, 0.6, 0.52, 0.5, 0] },
};
// The close-up camera ("Close-ups", camMove 'closeup'): the same planned machinery as CINE (phrases, a Gaussian-smoothed
// plan, framing, the Steady camera's light), with two poses that take turns phrase by phrase: CLOSE (down low behind
// one hand's ball of light, looking along the music as it comes, so the notes stream toward the lens; it follows that
// ball's own height on the page, smoothed by `follow` s, and pushes in a little more while it holds) and WIDE (pulled
// far back and up, the whole grand staff in view; it opens out a little while it holds). Each close-up follows the
// hand with more to play in that phrase (the right hand counts `rh` times, as it usually carries the tune; after
// `same` close-ups on one hand the other gets a turn if it has at least half as much). Its first move starts `first` s
// after the first note (it dives in as the music begins). In a close-up only the followed ball and the notes it lands
// on within `frame` s must stay in the picture (the other hand may leave it), and the paper may stream past up to
// `sweep` times as fast as with the Steady camera (it moves mostly toward the lens). Poses as CINE's, plus hb: which
// ball the place follows (1 = the right hand's, -1 = the left hand's, 0 = between them).
const CLOSE = {
  first: 0.6, rh: 1.6, same: 2, sweep: 2.6, follow: 0.7, frame: { hold: 0.15, ahead: 0.15 }, push: { CLOSE: 0.8, WIDE: 1.07 },
  wide: { CLOSE: (e, side) => [17 + 4 * e, side ? 22 : 36, 13 + 3 * e, 0.5, 0.58, 1, 0], WIDE: (e, side) => [56 + 8 * e, side ? 74 : 86, 86 + 12 * e, 0.45, 0.5, 0.3, 0.7] },
  tall: { CLOSE: (e, side) => [22 + 4 * e, side ? 12 : 24, 16 + 3 * e, 0.55, 0.62, 1, 0], WIDE: (e, side) => [54 + 6 * e, side ? 40 : 48, 72 + 10 * e, 0.5, 0.58, 0.3, 0.7] },
};
export const CAM_MOVES = [
  { id: 'steady', name: 'Steady', desc: 'A slow, steady glide along the music from the side.' },
  { id: 'cinematic', name: 'Cinematic', desc: 'Moves with the music: rises high over the page at new sections and loud passages, comes down low and close in quiet ones, and turns to new angles. Live playing uses Steady.' },
  { id: 'closeup', name: 'Close-ups', desc: 'Swoops down low behind a ball of light and rides along the music with it for a phrase, then pulls far back to show the whole page, and in again. Live playing uses Steady.' },
];
// Live playing (no piece, or someone playing over a paused piece): the camera glides at the slowest layout speed
// along endless systems of a grand staff, each `system` seconds long with a brace and clefs at its start and `gap` ss
// of blank paper after its closing bar line; notes appear where they are played (the place the bass ball usually
// is), lit at once, and stay lit. Notes struck within `chord` s on one staff stand together as a chord; notes more
// than `behind` ss behind the camera's place are out of the picture and not drawn. `period`: the page is re-centred
// every so many seconds (a whole number of systems), so its numbers stay small however long the studio is open.
const LIVE = { system: 30, gap: 6, chord: 0.06, behind: 90, period: 300, heads: 256, ledgers: 512, signs: 96, pins: 288 };
// The ending. Over the last `over` s the camera slows a little and rises, falling `lag` ss behind the music by the
// final note (so the last chord sits a little right of the usual place, whatever the speed); after the final note its
// glide dies away (time constant `settle` s). It cranes straight up (12 ss/s, easing in) at tc: `lead` s before the
// final notes stop sounding (tOff), but at least `land` s after the final note lands and at most `late` s after tOff, so
// the rise is seen before the picture goes. The picture then fades smoothly over `fade` s, starting `fadeAt` s after
// tOff and at least `rise` s into the crane; the balls go with it, a little behind (`ballLag`). It is all over within
// `by` s after tOff, just inside the 2.5 s the app plays after the end of the piece, so the closing card follows after
// only a breath of black.
const ENDING = { lag: 7, over: 10, crane: 12, settle: 1, lead: 0.8, land: 0.4, late: 0.1, fadeAt: 0.2, rise: 0.4, fade: 1.85, ballLag: 0.15, by: 2.35 };
// Opening: `at` seconds before the first note (when playback starts) the camera looks at the start of the system, the
// bass end of the brace near the bass anchor, `margin` ss before it; the lead fades from `before` s before the first
// note to `after` s after it. The picture fades in from black over `fadeIn` s from the start of the video (`start`: the
// app's runway, 1.5 s before music time 0).
const OPENING = { at: 1.5, margin: 1, before: 4, after: 5, start: -1.5, fadeIn: 0.7 };

// ---- sizes of the printing (ss) ----
// Round 5: the printed symbols (noteheads, beams, flags, rests, dots) stand 0.2 ss high (0.11 before) with softer,
// rounder edges (more bevel steps; the bevel cut a little into the outline so a symbol keeps its size); the raised
// signs (clefs, brace, key and time signatures, accidentals) stand solid on the paper, `height` ss from the paper to
// their face (no lift, no pins: on pins they looked as if they stood on sticks). Their bottom bevel lies just under
// the paper, so they meet it cleanly.
const INK = { depth: 0.08, bevelThickness: 0.06, bevelSize: 0.045, bevelOffset: -0.015, bevelSegments: 4, curveSegments: 6 }; // 0.2 high
const RAISED = { depth: 0.3, bevelThickness: 0.035, bevelSize: 0.026, bevelSegments: 3, curveSegments: 8, lift: 0, pin: 0.055, height: 0.37 };
const COMPOSER = { size: 3.1, above: 3.4 }; // the composer's name: printed in ink, its baseline `above` ss over the top staff line, under the title's right end
const TITLE = { cap: 12, maxW: 110, minScale: 0.45, rowScale: 0.7, depth: 0.95, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, curveSegments: 10, gap: 8.5, x: 6 }; // solid letters standing on the paper, depth high
// The channel's name, raised like the title but smaller (cap high), above the top staff every `every` s of music from
// the first `every` s on (none in the last `ending` s): its baseline `gap` ss over the top staff line, or `clear` ss
// over any higher notes there. Part of the page, so every stretch of a video carries it and it cannot be cropped away.
const MARK = { cap: 4, gap: 4.5, clear: 1.5, depth: 0.4, bevel: 0.6, spacing: 0.05, every: 30, ending: 8 };
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
  round: { ink: { depth: 0.06, bevelThickness: 0.1, bevelSize: 0.07, bevelOffset: -0.045, bevelSegments: 4, curveSegments: 8 },
    raised: { depth: 0.06, bevelThickness: 0.06, bevelSize: 0.05, bevelOffset: -0.028, bevelSegments: 3, curveSegments: 8 },
    title: { bevelThickness: 0.14, bevelSize: 0.13, bevelOffset: -0.07, bevelSegments: 4 } },
  rim: { ink: { depth: 0.09, bevelThickness: 0.06, bevelSize: 0.06, bevelOffset: -0.03, bevelSegments: 4, curveSegments: 8 },
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
// Each finish on a dark paper (DARK): only what changes (colour, roughness, metalness of each part; line; the room it
// reflects: win, room). Polished metal turns to bright silver (a softer polish, so the tops show the lit room, not the
// dark sheet below), smoked glass to pale opal glass, satin gold stays gold in a brighter room; matte ink takes the
// paper's own ink and DARK's face.
FINISH.metal.dark = { ink: { color: '#dde1e8', roughness: 0.27 }, face: { color: '#d0d4dc', roughness: 0.2 }, wall: { color: '#eef0f4', roughness: 0.12 }, fleck: { color: '#c8ccd4', roughness: 0.2 },
  line: '#8f949d', win: 0.9, room: 0.9 };
FINISH.glass.dark = { ink: { color: '#8fa2b8', roughness: 0.04 }, face: { color: '#8899af', roughness: 0.03 }, wall: { color: '#c5d0de', roughness: 0.03 }, fleck: { color: '#a9b6c6', roughness: 0.04 },
  line: '#8e98a6', win: 1.1, room: 0.55 };
FINISH.gold.dark = { ink: { roughness: 0.3 }, face: { roughness: 0.24 }, line: '#a5844a', win: 0.8, room: 0.6 };
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
// The lamp's pool on a dark paper (DARK.lamp), shared by the paper, the lines and the 3D pieces: the share of the
// key light at world point w, D from the camera. uLampA = (near brightness, distance it is measured from, fall-off
// length, cap), as the paper's own; uSpot = (centre x, z, 1 / R^2, floor), uSpotB = (1 / along^2).
const LAMP_GLSL = `
#ifdef DARK_PAPER
uniform vec4 uLampA, uSpot; uniform float uSpotB;
float lampSpot(vec3 w) { vec2 q = w.xz - uSpot.xy; return uSpot.w + (1.0 - uSpot.w) * pow(1.0 + (q.x * q.x * uSpotB + q.y * q.y) * uSpot.z, -1.5); }
float lampAt(vec3 w, float D) {
  float v = uLampA.x * exp(-(D - uLampA.y) / uLampA.z);
  v = v / pow(1.0 + pow(v / uLampA.w, 4.0), 0.25);
  return v / uLampA.w * lampSpot(w);
}
#endif
`;
const PAPER_VERT = `
uniform vec2 uOrigin;
varying vec3 vW; varying vec4 vClip; varying vec2 vP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vP = w.xz - uOrigin; vClip = projectionMatrix * viewMatrix * w; gl_Position = vClip; }`;
// The cracks of light (CRACK) for the ink and the lit heads: uCrK = (strength, cells per ss, flickers a second, the
// picture's fade), uCrT = the music time, uCrC = each hand's crack colour (linear), uCrL = (the layout's t0, its start x,
// its speed in ss/s, the page height between the staves).
const CRACK_GLSL = `
#ifdef CRACKS
uniform vec4 uCrK, uCrL; uniform float uCrT; uniform vec3 uCrC[2]; varying vec3 vCrW;
vec2 crH(vec2 p) { vec3 a = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); a += dot(a, a.yzx + 33.33); return fract((a.xx + a.yz) * a.zy); }
vec2 crCells(vec2 p) { // (the distance to the nearest edge of a cell, the nearest cell's id 0..1)
  vec2 n = floor(p), f = fract(p), mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), r = g + crH(n + g) - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)), r = g + crH(n + g) - f; vec2 e = r - mr; if (dot(e, e) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(e))); }
  return vec2(md, crH(n + mg).x);
}
// the cracked piece: base = its own shading, w = the place (world), age = s since it was played, hand: 0 right, 1 left
vec3 crackShade(vec3 base, vec3 w, float age, float hand) {
  vec2 p = w.xz * uCrK.y + vec2(0.0, 1.7 * w.y);   // (a little of the height, so the sides crack too)
  vec2 c1 = crCells(p), c2 = crCells(p * ${CRACK.fine.toFixed(2)} + vec2(7.1, 3.3));
  float l1 = 1.0 - smoothstep(0.035, 0.055 + fwidth(c1.x), c1.x);
  float l2 = (1.0 - smoothstep(0.02, 0.035 + fwidth(c2.x), c2.x)) * 0.6 * step(0.4, fract(c2.y * 7.31));
  float g = exp(-c1.x / ${(CRACK.bleed * CRACK.cells).toFixed(3)});
  float fl = 0.6 + 0.4 * fract(sin(dot(vec2(c1.y * 91.7, floor(uCrT * uCrK.z)), vec2(12.9898, 78.233))) * 43758.5453);
  float on = smoothstep(0.0, 0.03, age), e = (1.0 + ${CRACK.flash.toFixed(2)} * exp(-age / ${CRACK.flashT.toFixed(3)})) * on, line = max(l1, l2);
  vec3 col = mix(uCrC[0], uCrC[1], hand), light = mix(col, vec3(1.0), 0.65 * line) * (line + 0.3 * g) * fl * e * uCrK.x;
  return base * mix(1.0, ${CRACK.dark.toFixed(2)}, uCrK.x * on) + light * uCrK.w;
}
#endif
`;
// The paper. uTintNear / uTintFar: its colour in full and in dim light (sRGB, brightest channel 1); uTex: its texture
// (r: fine tone, g b: the slope of its grain, a: slow tone), sampled every uTile.x ss and every uTile.y ss (vP: the
// place on the page, from a whole number of tiles away); uLook = (fine tone, slow tone, grain, cockle); uKey: toward
// the key light; uShade = (ambient share, contact darkening, height below which it darkens, height of the softest
// shadow); uMask, uMaskSoft: the shadow mask, sharp and blurred (r: how much of the key is held back, g: the height of
// what holds it back / 4), over the window uMaskBox = (x0, z0, 1 / W, 1 / H). uLight: the light the lit notes and the
// light trails throw on the paper (the light map, over the same window); uPool = (the balls' pool brightness, the
// height added to a ball's own for its pool, the soft limit of all the pools together).
const PAPER_FRAG = `
uniform vec3 uCam, uLamp, uTintNear, uTintFar, uKey; uniform float uVn, uDn, uLam, uCap, uFade;
uniform sampler2D uTex, uMask, uMaskSoft, uLight; uniform vec2 uTile; uniform vec4 uLook, uShade, uMaskBox; uniform vec3 uPool;
// The balls: uBall = (x, height, z, radius; 0 = none), uBallColor = the colour their reflection takes, uPoolColor =
// the colour of the light they throw; uRefl = (brightness, gloss in radians, -, sideways narrowing).
uniform vec4 uBall[2], uRefl; uniform vec3 uBallColor[2], uPoolColor[2];
uniform float uAccOn; uniform vec2 uAccK; uniform vec4 uAccA[2], uAccP[4], uRing[16]; uniform vec2 uBand[2]; uniform vec3 uAccC[2];
varying vec3 vW; varying vec4 vClip; varying vec2 vP;${SHADE_GLSL}${LAMP_GLSL}
#if defined(DARK_PAPER) || defined(MARBLE)
uniform vec4 uDark, uGW[${GLOWS}]; uniform vec3 uGC[${GLOWS}], uSheenC; // uDark = (pool share, corner light share, sheen, room sheen); uSheenC = the room sheen's colour (the paper's own peak light); the glows as lamps (world; see LINE_FRAG)
#endif
#ifdef MARBLE
// Marble (a paper with \`marble\`, round 5): its veins and clouds are worked out at each point of the slab (world x, z),
// so they are crisp at any distance and never repeat. uMarble = (1 / the pattern's size in ss, warp, main vein width,
// fine vein width, both in the field's units); uMarbleK = (main veins, fine veins, cloudiness, the soft halo round the
// main veins); uVein = a vein's colour over the stone's (linear, per channel: what the lit stone is multiplied by where
// a vein is, so the veins take the same light, shadow and lamp fall-off as the stone).
uniform vec4 uMarble, uMarbleK, uMarbleU; uniform vec3 uVein; // uMarbleU = (the veins' share under the music, its page heights from, to, the soft edge)
vec2 mh(vec2 p) { vec3 a = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); a += dot(a, a.yzx + 33.33); return fract((a.xx + a.yz) * a.zy) * 2.0 - 1.0; }
float gn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(mh(i), f), dot(mh(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x), mix(dot(mh(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(mh(i + vec2(1.0)), f - vec2(1.0)), u.x), u.y); }
float fbm(vec2 p, int n) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { if (i >= n) break; s += a * gn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.1, 1.7); a *= 0.5; } return s; }
// a vein: a thin line where the field f (a distance, >= 0) is under w; far off, where it would be thinner than a pixel,
// it fades instead of shimmering
float vein(float f, float w) { float aa = fwidth(f) + 1e-5; return smoothstep(w + aa, 0.0, f) * min(1.0, w / aa); }
// the distance to the nearest edge of a cell pattern (the cracks of the stone: its fine veins), as the exact distance
// to the bisector of the two nearest cell points
float cracks(vec2 p) {
  vec2 n = floor(p), f = fract(p), mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), r = g + 0.5 + 0.45 * mh(n + g) - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)), r = g + 0.5 + 0.45 * mh(n + g) - f; vec2 e = r - mr; if (dot(e, e) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(e))); }
  return md;
}
vec4 marble(vec2 w) { // (main veins, fine veins, cloud tone about -1..1, the main veins' soft halo)
  vec2 p = w * uMarble.x;
  vec2 q = vec2(fbm(p * 0.8, 4), fbm(p * 0.8 + vec2(5.2, 1.3), 4));
  // the main veins: long, turbulent lines running mostly one way across the slab (a warped stripe pattern), each
  // swelling, thinning and fading out along its course; a second, rarer set crosses them at an angle
  float s1 = dot(p, vec2(0.86, 0.5)) * 0.9 + uMarble.y * fbm(p * 0.55 + 1.8 * q, 5);
  float s2 = dot(p, vec2(-0.35, 0.94)) * 0.55 + 0.8 * uMarble.y * fbm(p * 0.7 - 1.4 * q + vec2(3.0, 8.0), 5);
  float d1 = abs(fract(s1) - 0.5) * 2.0, d2 = abs(fract(s2) - 0.5) * 2.0; // (0 on a vein's line)
  d1 = 1.0 - d1; d2 = 1.0 - d2;
  float wv = uMarble.z * (0.35 + 1.3 * smoothstep(-0.35, 0.45, gn(p * 0.9 + 11.0)));
  float on1 = smoothstep(-0.3, 0.1, gn(p * 0.35 + vec2(7.0, 3.0))), on2 = smoothstep(0.05, 0.35, gn(p * 0.3 + vec2(2.0, 9.0)));
  float m = max(vein(d1, wv) * on1, vein(d2, 0.7 * wv) * on2);
  float h = max(exp(-d1 / (wv * 6.0)) * on1, 0.6 * exp(-d2 / (wv * 5.0)) * on2);
  // the fine veins: a web of thin cracks (warped cells), in patches, and gathered near the main veins
  float c = cracks(p * 3.2 + 2.2 * q + 1.1 * vec2(fbm(p * 2.0, 3), fbm(p * 2.0 + 4.0, 3)));
  float spread = max(0.8 * h, smoothstep(0.0, 0.35, gn(p * 0.8 + vec2(5.0, 2.0))));
  float fi = vein(c, uMarble.w * 12.0) * spread;
  return vec4(m, fi, 2.0 * fbm(p * 0.45 + 3.3, 4) + 0.5 * h, h);
}
#endif
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); } // fixed dither against banding
void main() {
  float D = distance(vW, uLamp); // (the lamp: the Steady camera's place, also when the cinematic camera looks)
  float v = uVn * exp(-(D - uDn) / uLam);
  vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;                     // place in the picture, 0..1 from the bottom left
  float cx = mix(0.38, 0.5, uv.y), dx = uv.x - cx;
  v *= 1.0 - mix(dx < 0.0 ? 0.1 : 0.34, 0.45, uv.y) * dx * dx;    // slight vignette, as measured
  v = v / pow(1.0 + pow(v / uCap, 4.0), 0.25);                  // a soft cap: lit paper, never glaring
#ifdef DARK_PAPER
  v *= lampSpot(vW);                                            // dark paper: the lamp's round pool (DARK.lamp)
#endif
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
#ifdef MARBLE
  { // the stone's clouds and veins (see marble()), lit as the stone is
    vec4 mb = marble(vW.xz);
    float vv = clamp(uMarbleK.x * mb.x + uMarbleK.y * mb.y + uMarbleK.w * mb.w, 0.0, 1.0), py = -vW.z;
    vv *= mix(uMarbleU.x, 1.0, 1.0 - smoothstep(uMarbleU.y - uMarbleU.w, uMarbleU.y, py) * (1.0 - smoothstep(uMarbleU.z, uMarbleU.z + uMarbleU.w, py))); // (faint under the music)
    tone *= max(0.2, 1.0 + uMarbleK.z * mb.z);
    col *= mix(vec3(1.0), uVein, vv);
  }
#endif
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
#ifdef DARK_PAPER
  pool *= uDark.x; acc *= uDark.y;                              // (on a dark sheet the same light makes a stronger mark)
#endif
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
#if defined(DARK_PAPER) || defined(MARBLE)
  // dark paper (and polished marble): its sheen also mirrors the lit notes (the glows of radius > 0.3: not the balls, done above), as
  // soft streaks of their colour toward the camera
  for (int i = 0; i < ${GLOWS}; i++) {
    vec4 s = uGW[i];
    if (s.w < 0.3) continue;
    vec3 d = s.xyz - vW; float L2 = dot(d, d);
    if (L2 > 400.0) continue;
    float L = sqrt(L2), a2 = 0.25 * s.w * s.w / L2;
    vec3 dd = d / L - R;
    float de = dot(dd, up), ds = dot(dd, side), ve = se * se + a2, vs = ss * ss + a2;
    col += uGC[i] * uDark.z * a2 / sqrt(ve * vs) * exp(-0.5 * (de * de / ve + ds * ds / vs));
  }
  { // and the satin's own faint sheen of the dim room: strongest at grazing angles (Fresnel), so on the far paper,
    // brighter toward the horizon and broken by the grain
    float fr = pow(1.0 - max(dot(N, -V), 0.0), 5.0), room = 0.35 + 0.65 * exp(-max(reflect(V, N).y, 0.0) / 0.4);
    col += uSheenC * tone * (uDark.w * fr * room * (1.0 - ao));
  }
#endif
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
uniform vec3 uColor, uCam, uLamp; uniform float uFar0, uFar1, uFarFade, uOpacity, uMax; uniform vec4 uGW[${GLOWS}]; uniform vec3 uGC[${GLOWS}]; uniform vec2 uGlint;
varying float vAlpha, vAcross, vHalf; varying vec3 vW, vT;${LAMP_GLSL}
void main() {
  float a = vAlpha * clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * uOpacity * (1.0 - uFarFade * smoothstep(uFar0, uFar1, distance(vW, uCam)));
  vec3 col = uColor, Vv = normalize(uCam - vW), T = normalize(vT);
#ifdef DARK_PAPER
  col *= lampAt(vW, distance(vW, uLamp));                        // light ink on dark paper: lit by the lamp's pool
#endif
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
uniform vec3 uCore, uRim, uHalo; uniform float uQ, uAlpha; uniform vec2 uGain; varying vec2 vQ;
void main() {
  float q = length(vQ) * uQ, aa = max(fwidth(q), 1e-4);
  float core = 1.0 - smoothstep(0.8 - aa, 1.0 + aa, q);
  float rim = exp(-pow((q - 1.0) / 0.2, 2.0));
  float halo = exp(-max(q - 1.0, 0.0) / 0.3) * (1.0 - smoothstep(1.4, 2.2, q));
  vec3 col = uCore * core * uGain.x + (1.0 - core) * (uRim * rim + uHalo * halo) * uGain.y; // (uGain: the balls' brightness, BALLK)
  gl_FragColor = vec4(col * uAlpha, 1.0);
}`;
// The glows as lights on the 3D pieces (added to three.js's own shading, after its lights): uGL = each glow's place in
// view space and its radius (0 = none), uGLC its colour and strength. Each is shaded as three.js shades its own lamps
// (so metal mirrors it, gold tints it, glass and the lacquer show it in their clear shine), with the highlight widened
// by the lamp's size close by (its radius / 2 per unit of distance, added to the roughness squared, as for a round
// lamp); kd and ks weigh its light and its highlight, and kh adds a broad sheen of its colour (the faint haze around
// a polished metal's highlight), so the walls and rims that face a lit note or a ball take on its colour.
// uShine = the notes' shine (SHINE): (strength, 0 = none; its sharpness, alpha; the dome's tilt; its haze), uGLS =
// each glow's share of it (1 for a ball, SHINE.note for a lit note); vDome = the dome's tilt here (aDome, view space).
const GL_DECL = `uniform vec4 uGL[${GLOWS}]; uniform vec3 uGLC[${GLOWS}]; uniform vec4 uShine; uniform float uGLS[${GLOWS}]; varying vec3 vDome;\n`;
// The corner shade on the 3D pieces: the share of the lamp's light (direct and from the room) that reaches them where
// they are in the picture (gl_FragCoord x uCSR, its size's inverse) and on the page (their place in view space through
// uCSV, the camera's world matrix), right after three.js's own lights.
const SHADE_DECL = '#ifdef CORNER_SHADE\nuniform vec2 uCSR;\n#endif\n#if defined(CORNER_SHADE) || defined(DARK_PAPER)\nuniform mat4 uCSV;\n#endif\n#ifdef DARK_PAPER\nuniform vec3 uLamp;\n#endif' + SHADE_GLSL + LAMP_GLSL;
const SHADE_HOOK = `
#ifdef CORNER_SHADE
 {
   vec3 ks = shadeLeft(cornerShade(gl_FragCoord.xy * uCSR, -(uCSV * vec4(-vViewPosition, 1.0)).z));
   reflectedLight.directDiffuse *= ks; reflectedLight.directSpecular *= ks; reflectedLight.indirectDiffuse *= ks; reflectedLight.indirectSpecular *= ks;
#ifdef USE_CLEARCOAT
   clearcoatSpecularDirect *= ks; clearcoatSpecularIndirect *= ks;
#endif
 }
#endif
#ifdef DARK_PAPER
 { // on dark paper the lamp's pool (DARK.lamp) lights the pieces as it lights the paper (the room's reflection a little less)
   vec3 lw = (uCSV * vec4(-vViewPosition, 1.0)).xyz; float lk = lampAt(lw, distance(lw, uLamp)), li = mix(1.0, lk, 0.6);
   reflectedLight.directDiffuse *= lk; reflectedLight.directSpecular *= lk; reflectedLight.indirectDiffuse *= li; reflectedLight.indirectSpecular *= li;
#ifdef USE_CLEARCOAT
   clearcoatSpecularDirect *= lk; clearcoatSpecularIndirect *= li;
#endif
 }
#endif`;
// The notes' shine (SHINE) is added up in shineAcc and laid over the finished colour at the end (see hook), with its
// own soft limit: tint = how much of the finish's colour its highlight takes.
const glowCode = (kd, ks, kh = 0, tint = 0) => `
 vec3 shineAcc = vec3(0.0);
 { // the glows: their light on it and their highlights in its shine
#ifdef USE_CLEARCOAT
  vec3 ccKeep = clearcoatSpecularDirect;
#endif
  vec3 sN = normalize(geometryNormal + uShine.z * vDome), sDn = fwidth(sN);   // the shine's (domed) normal, and how fast it turns
  float sNV = max(dot(sN, geometryViewDir), 1e-3), sA = sqrt(pow2(uShine.y) + min(${SHINE.aa.toFixed(3)} * dot(sDn, sDn), 0.25));
  vec3 sF0 = mix(vec3(0.9), material.specularColorBlended / max(max(material.specularColorBlended.r, material.specularColorBlended.g), max(material.specularColorBlended.b, 1e-3)) * 0.9, ${tint.toFixed(3)});
  for (int i = 0; i < ${GLOWS}; i++) {
    vec4 s = uGL[i];
    if (s.w <= 0.0) continue;
    vec3 L = s.xyz - geometryPosition; float d2 = dot(L, L);
    if (d2 > 625.0) continue;                                     // (more than 25 ss away: too faint to show)
    float d = sqrt(d2), widen = 0.5 * s.w / d;
    IncidentLight il; il.direction = L / d; il.color = uGLC[i] / (d2 + s.w * s.w); il.visible = true;
    if (uShine.x > 0.0 && uGLS[i] > 0.0) {                         // the shine: a tight highlight on the domed top, as from polished metal
      vec3 sH = normalize(il.direction + geometryViewDir);
      float sNL = max(dot(sN, il.direction), 0.0), sa = min(1.0, sA + ${SHINE.lamp.toFixed(3)} * s.w / d), sNLs = sNL * smoothstep(0.0, 0.35, sNL); // (sNLs: fading softly to the dome's far side, with no crease)
      float nh2 = max(pow2(max(dot(sN, sH), 0.0)), 1e-4), a2 = sa * sa;  // (a Beckmann highlight: a crisp core with short tails, unlike GGX's long glow)
      shineAcc += uGLS[i] * il.color * sNLs * F_Schlick(sF0, 1.0, max(dot(geometryViewDir, sH), 0.0)) * V_GGX_SmithCorrelated(sa, sNL, sNV)
        * (exp((nh2 - 1.0) / (nh2 * a2)) / (PI * a2 * nh2 * nh2) + uShine.w * D_GGX(${SHINE.haze[0].toFixed(3)}, sqrt(nh2))); // (+ a broad haze of the light's colour around it, as on polished metal)
    }
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
attribute vec2 aCorner, aAl, aWd; attribute vec3 aP, aB, aN; attribute float aE; uniform vec2 uRes; uniform float uW, uMinPx, uEnd, uAir; uniform mat4 uInvPV;
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
  // (a bolt in the air, uAir 1: the depth of its own segment, a little toward the camera, so it passes in front of what
  // is behind it and behind what is in front; one on the paper takes the paper's depth under it)
  // (never deeper than the paper under it, so the paper never cuts a halo off)
  float pd = paperDepth(vS, pv), dz = uAir > 0.5 ? min(clamp((aCorner.x < 0.5 ? ca.z / ca.w : cb.z / cb.w) - 0.0004, -1.0, 1.0), pd) : pd;
  gl_Position = vec4(vS / (uRes * 0.5), dz, 1.0);
}`;
const ARC_FRAG = `
uniform vec3 uColor; uniform float uFade, uDim, uHard;
flat varying vec4 vAB, vPN, vK; flat varying vec2 vHas; varying vec2 vS;
float segD(vec2 p, vec2 a, vec2 b, out float u) { vec2 ab = b - a; u = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0); return length(p - a - ab * u); }
void main() {
  float u, v, d = segD(vS, vAB.xy, vAB.zw, u);
  if (vHas.x > 0.5 && segD(vS, vPN.xy, vAB.xy, v) < d) discard;   // (nearer the segment before: it lights this pixel)
  if (vHas.y > 0.5 && segD(vS, vAB.zw, vPN.zw, v) <= d) discard;  // (or the one after)
  float q = d / mix(vK.x, vK.y, u);
  // the halo: a soft Gaussian; the core (uHard 1): a hard, white-hot line with a narrow shoulder, as an arc of current is
  float a = mix(exp(-1.6 * q * q), (1.0 - smoothstep(0.42, 0.95, q)) + 0.35 * exp(-1.1 * q * q), uHard) * mix(vK.z, vK.w, u) * uFade;
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
    uHead: { value: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) }, uWinC: { value: new THREE.Vector3(wc.r, wc.g, wc.b).multiplyScalar(ENV_WIN * (paper.dark ? DARK[paper.dark].env : paper.expo)) }, uWin: { value: win }, uRoom: { value: room } },
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
// The dome of a symbol's top, for the notes' shine (SHINE): a tilt for each corner of the flat top, as aDome, blended
// across the top into a gentle dome (none in the middle, the most at the edge). 'bowl' (noteheads, dots): the
// corner's place across the symbol's box, (x, z) / half its size, so the blend is an even round dome (a tilt that
// grows evenly from the middle, with no creases); 'ridge' (beams): the outward direction of the long sides only (not
// the square ends), so a beam is a rounded bar, the same all along it; otherwise the outward direction of the outline
// there (from the walls that meet it), a rounded ridge along every stroke and letter. The walls and the bottom keep 0
// (their own shape is round enough). For a geometry laid on the page (flat, up = +y), with extrude's two groups
// (faces first).
function domeOf(geo, mode = 'outline') {
  const faces = geo.groups.length ? geo.groups[0].count : 0, p = geo.attributes.position.array, n = geo.attributes.normal.array, N = p.length / 3;
  const out = new Float32Array(N * 3), at = new Map(), key = (v) => `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
  if (mode === 'bowl') {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < faces; v++) if (n[v * 3 + 1] > 0.5) { x0 = Math.min(x0, p[v * 3]); x1 = Math.max(x1, p[v * 3]); z0 = Math.min(z0, p[v * 3 + 2]); z1 = Math.max(z1, p[v * 3 + 2]); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ax = Math.max((x1 - x0) / 2, 1e-3), az = Math.max((z1 - z0) / 2, 1e-3);
    for (let v = 0; v < faces; v++) if (n[v * 3 + 1] > 0.5) { out[v * 3] = (p[v * 3] - cx) / ax; out[v * 3 + 2] = (p[v * 3 + 2] - cz) / az; }
    geo.setAttribute('aDome', new THREE.BufferAttribute(out, 3));
    return geo;
  }
  for (let v = faces; v < N; v++) {
    const nx = n[v * 3], nz = n[v * 3 + 2];
    if (mode === 'ridge' && Math.abs(nx) > 0.97 * Math.hypot(nx, nz)) continue; // (a beam's square end)
    const k = key(v), a = at.get(k);
    if (a) { a[0] += nx; a[1] += nz; } else at.set(k, [nx, nz]);
  }
  for (let v = 0; v < faces; v++) {
    if (n[v * 3 + 1] < 0.5) continue;
    const a = at.get(key(v)), l = a ? Math.hypot(a[0], a[1]) : 0;
    if (l > 1e-6) { out[v * 3] = a[0] / l; out[v * 3 + 2] = a[1] / l; }
  }
  geo.setAttribute('aDome', new THREE.BufferAttribute(out, 3));
  return geo;
}
const noDome = (geo) => geo.setAttribute('aDome', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3)); // (no dome: the pins, the flat text)
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
  const DM = F && DOME[F.dome], IP = F ? DM.ink : INK, RP = { ...RAISED, ...(F ? DM.raised : {}) }, TP = F ? { ...TITLE, ...DM.title } : TITLE;
  RP.depth = Math.max(0.05, RAISED.height - 2 * RP.bevelThickness); // (the raised signs: solid, the same height in every finish)
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
  // dark paper (DARK): the lamp's pool (see LAMP_GLSL), shared by the paper, the lines and the 3D pieces
  const lampU = { uLamp: { value: new THREE.Vector3() }, uLampA: { value: new THREE.Vector4(1, 40, 38, 1) }, uSpot: { value: new THREE.Vector4(0, 0, 0, 1) }, uSpotB: { value: 1 } };
  const glU = { uGL: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4()) }, uGLC: { value: Array.from({ length: GLOWS }, () => new THREE.Vector3()) } };
  const shineU = { uShine: { value: new THREE.Vector4(0, SHINE.rough[0], SHINE.dome, 0) }, uGLS: { value: new Float32Array(GLOWS) } }; // (the notes' shine: set each frame)
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
  const crackU = { uCrK: { value: new THREE.Vector4(0, CRACK.cells, CRACK.hz, 1) }, uCrT: { value: 0 }, uCrC: { value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1)] }, uCrL: { value: new THREE.Vector4(0, 0, 1, (TOP[1] + BOTTOM[0]) / 2) } };
  const crackMats = []; // (the materials the cracks compile into: see crackOn)
  const hook = (m, key, { glints = null, lit = false, crack = false } = {}) => {
    if (crack) crackMats.push(m);
    shadeMats.push(m);
    const T = m.userData.T, max = m.userData.max ?? FX.max ?? FINISH.matte.max;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, glU, csU, lampU, shineU);
      if (crack) { // (CRACKS: the world place, for the cracks)
        Object.assign(sh.uniforms, crackU);
        sh.vertexShader = '#ifdef CRACKS\nvarying vec3 vCrW;\n#endif\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef CRACKS\n { vec4 cw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n cw = instanceMatrix * cw;\n#endif\n vCrW = (modelMatrix * cw).xyz; }\n#endif');
      }
      sh.vertexShader = 'attribute vec3 aDome; varying vec3 vDome;\n' + sh.vertexShader.replace('#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\n { vec3 dn = aDome;\n#ifdef USE_INSTANCING\n dn = mat3(instanceMatrix) * dn;\n#endif\n vDome = normalMatrix * dn; }'); // (the dome's tilt, for the shine: see domeOf)
      let end = '#include <lights_fragment_end>';
      if (glints != null) end += `\n reflectedLight.directSpecular *= ${glints.toFixed(3)};\n#ifdef USE_CLEARCOAT\n clearcoatSpecularDirect *= ${glints.toFixed(3)};\n#endif`;
      if (T != null) end += `\n { ${FRES}\n   float k = fm / (0.04 + 0.96 * f5); reflectedLight.indirectSpecular *= k;\n#ifdef USE_CLEARCOAT\n   clearcoatSpecularIndirect *= k;\n#endif\n }`;
      end += SHADE_HOOK; // (the corner shade dims the lamp's light on it, not the glows' light added next)
      end += glowCode(FX.glow[0], FX.glow[1], FX.haze || 0, SHINE.tint[fid] ?? 0);
      if (lit) {
        Object.assign(sh.uniforms, glowU);
        sh.vertexShader = 'attribute float aLitT; attribute float aHand; uniform float uTime; varying float vLit; varying float vHand; varying float vLitT;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLit = step(aLitT, uTime); vHand = aHand; vLitT = aLitT;');
      }
      const glass = T == null ? '' : `\n { ${FRES}
          float Tk = mix(${Math.min(0.5, 2.2 * T).toFixed(3)}, ${T.toFixed(3)}, smoothstep(0.8, 0.99, up));
          gl_FragColor.a = 1.0 - Tk * (1.0 - fm); }`;
      const cap = `\n { float mx = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b); gl_FragColor.rgb *= 1.0 / pow(1.0 + pow(mx / ${max.toFixed(3)}, 6.0), 1.0 / 6.0); }` +
        `\n if (uShine.x > 0.0) { vec3 sc = uShine.x * shineAcc; sc = max(mix(vec3(dot(sc, vec3(0.2126, 0.7152, 0.0722))), sc, ${SHINE.sat.toFixed(3)}), 0.0); float sm = max(max(sc.r, sc.g), max(sc.b, 1e-5)), hr = max(${SHINE.cap.toFixed(3)} - max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b), 0.02);
   gl_FragColor.rgb += sc * (hr * (1.0 - exp(-sm / hr)) / sm); }`; // (the shine, over it, easing into the room left below its own limit: never dimming what is there, never a flat blown patch)
      // (the cracks: a lit head cracks from its own play time instead of turning white-hot; the rest of a note, from the
      // time the music reaches its place on the page, and only where it stands up from the page)
      const cracked = !crack ? '' : lit ? '\n#ifdef CRACKS\n if (vLit > 0.5) gl_FragColor.rgb = crackShade(gl_FragColor.rgb, vCrW, uCrT - vLitT, vHand);\n#endif'
        : '\n#ifdef CRACKS\n if (vCrW.y > 0.015 && vCrW.x > uCrL.y - 1.0) { float crAge = uCrT - (uCrL.x + (vCrW.x - uCrL.y) / uCrL.z); if (crAge >= 0.0) gl_FragColor.rgb = crackShade(gl_FragColor.rgb, vCrW, crAge, step(-vCrW.z, uCrL.w)); }\n#endif';
      const white = lit ? '\n if (vLit > 0.5) gl_FragColor.rgb = (vHand < 0.5 ? uCore[0] : uCore[1]) * uFade;' + (T != null ? '\n if (vLit > 0.5) gl_FragColor.a = 1.0;' : '') : '';
      sh.fragmentShader = GL_DECL + SHADE_DECL + (crack ? CRACK_GLSL : '') + (lit ? 'uniform vec3 uCore[2]; uniform float uFade; varying float vLit; varying float vHand; varying float vLitT;\n' : '') +
        sh.fragmentShader.replace('#include <lights_fragment_end>', end).replace('#include <dithering_fragment>', glass + cap +
          (crack && lit ? '\n#ifndef CRACKS' + white + '\n#endif' : white) + (lit && T != null ? '\n#ifdef CRACKS\n if (vLit > 0.5) gl_FragColor.a = 1.0;\n#endif' : '') + cracked + '\n#include <dithering_fragment>');
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
  const headMat = hook(ink.clone(), 'paper-head-' + fid, { lit: true, crack: true, glints: F ? F.glints : null });
  const restMat = hook(ink.clone(), 'paper-rest-' + fid, { glints: F ? F.glints : null }); // (the rests: as the ink, but they never crack)
  hook(ink, 'paper-ink-' + fid, { crack: true, glints: F ? F.glints : null });
  // The cracks (CRACK) compile into the ink and the heads (CRACKS) only while they are on, as the dark paper does.
  let crackIn = false;
  const crackOn = (v) => { if (v === crackIn) return; crackIn = v; for (const m of crackMats) { if (v) m.defines.CRACKS = ''; else delete m.defines.CRACKS; m.needsUpdate = true; } }; hook(face, 'paper-face-' + fid, { glints: F ? F.glints : null });
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
  const paperU = { uCam: { value: new THREE.Vector3() }, uLamp: lampU.uLamp, uVn: { value: LIGHT.vNear }, uDn: { value: 40 }, uLam: { value: 38 }, uCap: { value: LIGHT.cap }, uFade: { value: 1 },
    uTintNear: { value: new THREE.Vector3() }, uTintFar: { value: new THREE.Vector3() }, uKey: { value: new THREE.Vector3(0, 1, 0) }, uOrigin: { value: new THREE.Vector2() },
    uTex: { value: paperTexture(renderer) }, uTile: { value: new THREE.Vector2(1 / GRAIN.tile, 1 / GRAIN.toneTile) }, uLook: { value: new THREE.Vector4() },
    uShade: { value: new THREE.Vector4(SHADE.amb, SHADE.contact, SHADE.low, SHADE.high) }, uMask: { value: null }, uMaskSoft: { value: null }, uMaskBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBall: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uBallColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uRefl: { value: new THREE.Vector4(REFL.k, REFL.gloss, 0, REFL.narrow) },
    uLight: { value: null }, uPool: { value: new THREE.Vector3(POOL.ball.k, POOL.ball.h0, POOL.max) }, uPoolColor: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uAccOn: { value: 0 }, uAccA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uAccP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uRing: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, uBand: { value: CORNER.band.map(([a, b]) => new THREE.Vector2(a, b)) }, uAccC: { value: [new THREE.Vector3(), new THREE.Vector3()] }, uAccK: { value: new THREE.Vector2(CORNER.max, CORNER.dim) }, ...csU, ...lampU, uDark: { value: new THREE.Vector4(1, 1, 0, 0) }, uSheenC: { value: new THREE.Vector3() },
    uMarble: { value: new THREE.Vector4() }, uMarbleK: { value: new THREE.Vector4() }, uMarbleU: { value: new THREE.Vector4(1, BOTTOM[1] - 2.5, TOP[0] + 2.5, 2.5) }, uVein: { value: new THREE.Vector3(1, 1, 1) } };
  const paperMat = new THREE.ShaderMaterial({ uniforms: paperU, vertexShader: PAPER_VERT, fragmentShader: PAPER_FRAG, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  shadeMats.push(paperMat);
  // The corner shade is compiled in only while the corner light is on (CORNER_SHADE), so with it off every shader is
  // exactly as it was. Switching it on or off recompiles these few programs once (no rebuild).
  let shadeIn = false;
  const shadeOn = (v) => { if (v === shadeIn) return; shadeIn = v; for (const m of shadeMats) { if (v) m.defines.CORNER_SHADE = ''; else delete m.defines.CORNER_SHADE; m.needsUpdate = true; } };
  // the thin lines: printed ink, or the finish's own colour; the glows' streaks along them (places in world space)
  const lineU = { uRes: { value: new THREE.Vector2(1280, 720) }, uMinPx: { value: 1.2 }, uColor: { value: new THREE.Color(paperTone.ink) }, uCam: paperU.uCam,
    uFar0: { value: 70 }, uFar1: { value: 130 }, uFarFade: { value: 0.35 }, uOpacity: { value: 1 }, uMax: { value: F ? F.wall.max : FX.max },
    uGW: { value: Array.from({ length: GLOWS }, () => new THREE.Vector4()) }, uGC: glU.uGLC, uGlint: { value: new THREE.Vector2(...FX.lineGlow) }, ...lampU };
  Object.assign(paperU, { uGW: lineU.uGW, uGC: glU.uGLC }); // (the paper's satin sheen mirrors the glows on dark paper)
  const lineMax = lineU.uMax.value; // (the lines' own soft limit; the notes' shine may raise it toward SHINE.lineCap)
  const lineMat = new THREE.ShaderMaterial({ uniforms: lineU, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  // A dark paper compiles its few extra lines into these programs (DARK_PAPER), once, when it is chosen: with a light
  // paper every shader is exactly as it was.
  let darkIn = false;
  const darkOn = (v) => { if (v === darkIn) return; darkIn = v; for (const m of [...shadeMats, lineMat]) { if (v) m.defines.DARK_PAPER = ''; else delete m.defines.DARK_PAPER; m.needsUpdate = true; } };
  // Marble (a paper with `marble`) compiles its veins into the paper's program (MARBLE), likewise only when chosen.
  let marbleIn = false;
  const marbleOn = (v) => { if (v === marbleIn) return; marbleIn = v; if (v) paperMat.defines.MARBLE = ''; else delete paperMat.defines.MARBLE; paperMat.needsUpdate = true; };

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
  const cast = (o) => { o.layers.enable(o.material === ink || o.material === headMat || o.material === restMat ? INK_LAYER : SHADOW_LAYER); return o; }; // (the rests, in restMat, are ink too)
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
    const bs = paperTone.dark ? DARK[paperTone.dark].ballSize / SHADE.ballSize : 1;
    for (let i = 0; i < 2; i++) { sh.ballCast[i].visible = shown[i]; sh.ballCast[i].position.copy(at[i]); sh.ballCast[i].scale.setScalar(bs); }
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
  const geos = new Map(), kinds = new Map(), lines = [], slabs = [], stems = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();
  const cached = (k, make) => { if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
  // ink symbols: printed, nearly flush; raised symbols: on pins, black faces and chrome sides
  const inkGlyph = (name, dx = 0) => cached('i:' + name, () => domeOf(flat(extrude(musicShapes(name), IP).translate(dx, 0, 0)), /^notehead|Dot$/.test(name) ? 'bowl' : 'outline'));
  const raisedGlyph = (name, size = 1, sx = 1) => cached(`r:${name}:${size}:${sx}`, () => {
    const shapes = musicShapes(name, { size }), geo = domeOf(flat(extrude(shapes, RP).scale(sx, 1, 1)));
    geo.userData.pins = RAISED.lift > 0 ? pinSpots(shapes, { step: 0.12 * size, margin: RAISED.pin + 0.05, per: 2.2 * size * size, max: 3 }).map(([x, y]) => [x * sx, y]) : []; // (standing solid: no pins)
    return geo;
  });
  const kind = (name, geo, mat, lift = 0, colors = false) => { if (!kinds.has(name)) kinds.set(name, { geo, mat, lift, colors, list: [] }); return kinds.get(name); };
  const put = (k, x, y, sx = 1, sy = 1, tag = null) => k.list.push([x, y, sx, sy, tag]);
  const line = (x0, y0, x1, y1, w) => lines.push([x0, y0, x1, y1, w]);
  // a stem: raised like the ink (round 5; a printed line before, which looked flat beside the raised heads and beams),
  // w ss wide over all, its outline inset by the bevel's growth
  const stem = (x, y0, y1, w) => {
    const s = new THREE.Shape(), h = Math.max(0.012, w / 2 - grow), a = Math.min(y0, y1), b = Math.max(y0, y1);
    s.moveTo(x - h, a); s.lineTo(x + h, a); s.lineTo(x + h, b); s.lineTo(x - h, b); s.lineTo(x - h, a);
    stems.push([x, s]);
  };
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
        stem(sx, far(c) + d * STEM_DY, end, LINE.stem);
        if (c.v < 1) { const f = FLAG[Math.min(2, lv[0] - 1)] + (d > 0 ? 'Up' : 'Down'); put(kind('flag:' + f, inkGlyph(f), ink), sx - LINE.stem / 2, end); }
        continue;
      }
      const deep = Math.max(...lv), xs = g.map((c) => stemX(c, d)), f = g[0], l = g[g.length - 1];
      const y0 = near(f) + d * 3.5, y1 = near(l) + d * 3.5, slope = Math.max(-0.16, Math.min(0.16, ((y1 - y0) / (xs[xs.length - 1] - xs[0])) * 0.5));
      let base = y0;
      g.forEach((c, i) => { const need = near(c) + d * (3.0 + (deep - 1) * 0.75), at = base + slope * (xs[i] - xs[0]); if ((need - at) * d > 0) base += need - at; });
      const at = (x) => base + slope * (x - xs[0]);
      g.forEach((c, i) => stem(xs[i], far(c) + d * STEM_DY, at(xs[i]), LINE.stem));
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
      put(kind('rest:' + name, inkGlyph(name, -w / 2), restMat), r.x, MID[r.staff] + (name === 'restWhole' ? 1 : 0));
    }
    // bar lines, through both staves; a thin and a thick line at the end
    for (const bx of S.barX) line(bx, -LINE.bar / 2, bx, TOP[0] + LINE.bar / 2, LINE.bar);
    line(S.finalX - 0.95, -0.07, S.finalX - 0.95, TOP[0] + 0.07, LINE.bar);
    { const s = new THREE.Shape(), x0 = S.finalX - 0.55 + grow, x1 = S.finalX - 0.05 - grow, y0 = grow - 0.07, y1 = TOP[0] + 0.07 - grow;
      s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
      printed.add(cast(new THREE.Mesh(domeOf(flat(extrude([s], { ...IP, curveSegments: 1, smooth: 30 })), 'ridge'), restMat))); } // (the final bar: ink that never cracks)
    // the tempo mark, printed flat above the first treble staff
    const bpm = piece.tempoMap && piece.tempoMap.length ? Math.round(piece.tempoMap[0].bpm) : 0;
    if (bpm) {
      const tm = textShapes(`♩ = ${bpm}`, { size: 2.5 });
      const m = new THREE.Mesh(noDome(flat(new THREE.ShapeGeometry(tm, 8))), ink);
      m.position.set(1.0, LINE.lift + 0.002, -(TOP[0] + 2.4)); printed.add(m);
    }
    // the title, standing on the paper above the start of the music, and the composer printed under its right end, as
    // in a score; then the channel's name along the page
    addTitle(String(opts.title || '').trim());
    addComposer(String(opts.composer || '').trim());
    addMarks(String(opts.mark || '').trim());
  }
  function addComposer(text) {
    if (!text || titleBox.isEmpty()) return;
    const shapes = textShapes(text, { size: COMPOSER.size, letterSpacing: 0.02 }), right = titleBox.max.x;
    const m = new THREE.Mesh(noDome(flat(new THREE.ShapeGeometry(shapes, 8))), ink);
    m.position.set(Math.max(TITLE.x, right - shapes.width), LINE.lift + 0.002, -(TOP[0] + COMPOSER.above)); printed.add(m);
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
      const geo = domeOf(flat(extrude(textShapes(row, { size, letterSpacing: 0.01 }), TP)));
      titleBox.union(standing(geo, TITLE.x, TOP[0] + TITLE.gap + (rows.length - 1 - i) * cap * 1.5, TP.bevelThickness));
    });
  }
  function addMarks(text) { // the channel's name (MARK)
    if (!text || !S) return;
    const shapes = textShapes(text, { size: MARK.cap / (glyphs.text.capHeight || 0.77), letterSpacing: MARK.spacing }), w = shapes.width;
    const P = { ...TP, depth: MARK.depth, bevelThickness: TP.bevelThickness * MARK.bevel, bevelSize: TP.bevelSize * MARK.bevel, bevelOffset: (TP.bevelOffset || 0) * MARK.bevel };
    const geo = domeOf(flat(extrude(shapes, P)));
    for (let t = MARK.every; t < piece.duration - MARK.ending; t += MARK.every) {
      const x = S.xOf(t);
      if (x + w > S.finalX - 2) break;
      let top = TOP[0];
      for (const k of kinds.values()) for (const it of k.list) if (it[0] > x - 1.5 && it[0] < x + w + 1.5) top = Math.max(top, it[1] + 1);
      for (const [a, ya, b, yb] of lines) if (Math.max(a, b) > x - 1 && Math.min(a, b) < x + w + 1) top = Math.max(top, ya, yb);
      standing(geo, x, Math.max(TOP[0] + MARK.gap, top + MARK.clear), P.bevelThickness);
    }
  }
  // Raised lettering (the title, the channel's name) stands on the paper: solid from the paper up, its bottom bevel
  // (sink) just under the surface so the letters meet the paper cleanly, with their reflection in its sheen. Returns
  // their extent in the world.
  function standing(geo, x, base, sink = 0) {
    const m = cast(new THREE.Mesh(geo, raised)); m.position.set(x, -sink, -base); printed.add(m);
    const r = new THREE.Mesh(geo, mirrored); r.position.set(x, sink, -base); r.scale.y = -1; r.renderOrder = -0.5; printed.add(r);
    if (!geo.boundingBox) geo.computeBoundingBox();
    return geo.boundingBox.clone().translate(new THREE.Vector3(x, -sink, -base));
  }

  // Everything collected above becomes instanced meshes, one per kind of symbol per piece of the music.
  const pinGeo = noDome(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0));
  for (const [name, k] of kinds) {
    const byChunk = new Map();
    for (const it of k.list) { const c = Math.floor(it[0] / CHUNK); if (!byChunk.has(c)) byChunk.set(c, []); byChunk.get(c).push(it); }
    const isPin = name.startsWith('pin:'), lift = RAISED.lift;
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
    for (const shapes of slabChunks.values()) { const g = domeOf(flat(extrude(shapes, { ...IP, curveSegments: 1, smooth: 30 })), 'ridge'); printed.add(cast(new THREE.Mesh(g, ink))); }
    const stemChunks = new Map();
    for (const [x, s] of stems) { const c = Math.floor(x / CHUNK); if (!stemChunks.has(c)) stemChunks.set(c, []); stemChunks.get(c).push(s); }
    for (const shapes of stemChunks.values()) { const g = domeOf(flat(extrude(shapes, { ...IP, curveSegments: 1, smooth: 30 }))); printed.add(cast(new THREE.Mesh(g, ink))); }
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
    if (sysPins.length) { sysPinMesh = new THREE.InstancedMesh(pinGeo, pinMat, 3 * sysPins.length); sysPinMesh.frustumCulled = false; liveGroup.add(cast(sysPinMesh)); } // (none while the signs stand solid)
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
    const tc = Math.min(tOff + ENDING.late, Math.max(tEnd + ENDING.land, tOff - ENDING.lead));
    const f0 = Math.min(tOff + ENDING.by - ENDING.fade, Math.max(tOff + ENDING.fadeAt, tc + ENDING.rise)), f1 = f0 + ENDING.fade;
    layout = { xOf: S.xOf, speed: S.speed, t1, tEnd, tOff, tc, f0, f1, lead: want / (1 - sstep(t1 - OPENING.before, t1 + OPENING.after, ta)) };
  }
  // Live: the place moves on at the slowest layout speed, counted from liveBase (re-centred every LIVE.period s, a
  // whole number of systems, so nothing visibly moves when it changes). (Finite: the ramps below must not see infinities.)
  let liveBase = 0;
  const liveLayout = { xOf: (t) => (t - liveBase) * LAYOUT.minSpeed, speed: LAYOUT.minSpeed, t1: -1e9, tEnd: 1e9, tOff: 1e9, tc: 1e9, f0: 1e9, f1: 1e9 + 1, lead: 0 };
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
  // The cinematic camera's share of the pose (see CINE): none until inW[0] s after the first note, all of it from
  // inW[1] s, and none again by outW[1] s before the last note (the plan is back at the Steady pose by then).
  let cineOn = false;
  const s5 = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * u * (u * (6 * u - 15) + 10); }; // (continuous acceleration)
  const cineW = (L, t) => s5(L.t1 + CINE.inW[0], L.t1 + CINE.inW[1], t) * (1 - s5(L.tEnd - CINE.outW[0], L.tEnd - CINE.outW[1], t));
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
    ps.lam = LIGHT.lam * ps.h; ps.dof = 0; ps.focus = 0; ps.dist = 0; ps.cine = 0; ps.tilt = c.tilt;
    const W = cineOn && layout && L === layout && c.yawAmp ? cineW(L, t) : 0; // (only with the gentle movement on)
    if (W > 0) cineBlend(L, t, c, aspect, pos, quat, ps, W, yaw, h, x, -z, up, k * D.length());
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
  const fit = { aspect: 0, c: null, off: NO_OFF }, fitPos = new THREE.Vector3(), fitQ = new THREE.Quaternion(), fitPose = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 0, lam: 0, dof: 0, focus: 0, dist: 0, cine: 0 }, fitV = new THREE.Vector3();
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
  const pose = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 40, lam: 62, dof: 0, focus: 0, dist: 0, cine: 0, tilt: 0 };
  const CAMS = { wide: CAM.wide, tall: CAM.tall, wideStill: still(CAM.wide), tallStill: still(CAM.tall) };
  const camFor = (aspect, motion = true) => CAMS[(aspect < 1 ? 'tall' : 'wide') + (motion ? '' : 'Still')];
  const place = (camera, L, t, c) => poseAt(L, t, c, camera.aspect, camera.position, camera.quaternion, pose);

  // ---- the cinematic camera (see CINE) ----
  // A piecewise-linear curve (knots ascending; values n x dim) smoothed by a Gaussian of width sigma, evaluated in
  // closed form: the curve itself plus, near each knot, the change of slope there times what the smoothing does to a
  // corner (an even bump that vanishes a few sigma away). C-infinity, and it never leaves the range of the knots.
  const RT2PI = Math.sqrt(2 * Math.PI);
  const erfc = (x) => { const k = 1 / (1 + 0.3275911 * x); return k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) * Math.exp(-x * x); }; // x >= 0 (A&S 7.1.26)
  const bend = (x, s) => { const a = Math.abs(x) / s; return (s * Math.exp(-0.5 * a * a)) / RT2PI - Math.abs(x) * 0.5 * erfc(a / Math.SQRT2); };
  function curve(times, values, dim, sigma) {
    const n = times.length, slope = new Float64Array((n + 1) * dim), ds = new Float64Array(n * dim);
    for (let i = 0; i + 1 < n; i++) for (let d = 0; d < dim; d++) slope[(i + 1) * dim + d] = (values[(i + 1) * dim + d] - values[i * dim + d]) / (times[i + 1] - times[i]);
    for (let i = 0; i < n; i++) for (let d = 0; d < dim; d++) ds[i * dim + d] = slope[(i + 1) * dim + d] - slope[i * dim + d];
    return { t: Float64Array.from(times), v: Float64Array.from(values), slope, ds, dim, sigma, n };
  }
  function evalCurve(C, t, out) {
    const { t: T, v, slope, ds, dim, sigma, n } = C;
    if (t <= T[0]) for (let d = 0; d < dim; d++) out[d] = v[d];
    else if (t >= T[n - 1]) for (let d = 0; d < dim; d++) out[d] = v[(n - 1) * dim + d];
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
      for (let d = 0; d < dim; d++) out[d] = v[lo * dim + d] + slope[(lo + 1) * dim + d] * (t - T[lo]);
    }
    const r = 6 * sigma;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t - r) lo = m + 1; else hi = m; }
    for (let k = lo; k < n && T[k] <= t + r; k++) { const b = bend(t - T[k], sigma); for (let d = 0; d < dim; d++) out[d] += ds[k * dim + d] * b; }
    return out;
  }
  // One plan per moving camera (CINE's 'cinematic', CLOSE's 'closeup'), each made once per picture shape; `cine` is
  // the one in use (pickCam).
  const newPlan = (style) => ({ style, aspect: 0, c: null, pose: null, hands: null, need: null, dist: null, cuts: [], base: null, moves: [] });
  const plans = { cinematic: newPlan('cinematic'), closeup: newPlan('closeup') };
  let cine = plans.cinematic;
  const pickCam = (m) => { cineOn = Object.hasOwn(plans, m); if (cineOn) cine = plans[m]; };
  const cv = new Float64Array(8), c1 = new Float64Array(1), c2 = new Float64Array(2), cQ = new THREE.Quaternion(), cE = new THREE.Euler(0, 0, 0, 'YXZ'), cP = new THREE.Vector3(), cB = new THREE.Vector3();
  const cR = new THREE.Vector3(), cU = new THREE.Vector3(), cF = new THREE.Vector3();
  const mix = (a, b, w) => a + (b - a) * w;
  // The planned pose at t, into cv, and the place's page y (returned): the plan, then the hands for the place (their
  // mean, or one hand's ball as hb says: cine.hands holds the right hand's and the left hand's, smoothed).
  function cinePlace(t, c) {
    evalCurve(cine.pose, t, cv);
    evalCurve(cine.hands, t, c2);
    const hy = (c2[0] + c2[1]) / 2 + (cv[7] * (c2[0] - c2[1])) / 2;
    return c.y + cv[5] * (hy - c.y) + cv[6] * (CINE.sysMid - c.y);
  }
  // the camera's right, up and forward for a tilt and heading (degrees), into cR, cU, cF; returns the quaternion cQ
  function cineAxes(tilt, yaw) {
    cE.set(-tilt * DEG, yaw * DEG - Math.PI / 2, 0); cQ.setFromEuler(cE);
    cR.set(1, 0, 0).applyQuaternion(cQ); cU.set(0, 1, 0).applyQuaternion(cQ); cF.set(0, 0, -1).applyQuaternion(cQ);
    return cQ;
  }
  // The Steady pose at t (already in pos, quat, ps; its heading yawS in radians, height hS, place xS / page y yS and
  // distance distS along its ray) moved W of the way to the planned one.
  function cineBlend(L, t, c, aspect, pos, quat, ps, W, yawS, hS, xS, yS, up, distS) {
    if (cine.aspect !== aspect || cine.c !== c || !cine.pose) buildCine(c, aspect);
    const th = Math.tan((c.fov * DEG) / 2), tyP = cinePlace(t, c);
    const tilt = mix(c.tilt, cv[0], W), yaw = mix(yawS / DEG, cv[1], W), a0 = mix(c.at[0], cv[3], W), a1 = mix(c.at[1], cv[4], W);
    E.set(-tilt * DEG, yaw * DEG - Math.PI / 2, 0); quat.setFromEuler(E);
    D.set((2 * a0 - 1) * th * aspect, (1 - 2 * a1) * th, -1).applyQuaternion(quat);
    // the distance: planned with the poses (see buildCine: the plan's, within the notehead size and the framing)
    const len = D.length(), distP = evalCurve(cine.dist, t, c1)[0], dist = mix(distS, distP, W), k = dist / len;
    const x = mix(xS, camX(L, t), W), y = mix(yS, tyP, W);
    pos.set(x - D.x * k, -D.y * k + up, -y - D.z * k);
    ps.x = x; ps.h = pos.y; ps.hl = mix(ps.hl, c.h + up, W); ps.yaw = yaw * DEG;
    ps.dNear = ps.h / Math.sin(Math.min(89.5, tilt + c.fov / 2) * DEG);
    const dt = CINE.dof[aspect < 1 ? 'tall' : 'wide'];
    ps.lam = mix(LIGHT.lam * (hS + up), CINE.lam * dist, W); ps.dof = W * (1 - s5(dt[0], dt[1], tilt)); ps.focus = k; ps.dist = dist; ps.cine = W; ps.tilt = tilt;
  }
  // The phrases: the bar lines the plan cuts the piece at ({ t, sec: a new section }), and each phrase's energy (0..1:
  // how busy and how loud it is, ranked within the piece).
  function phrases(L) {
    const ch = [...S.chords].sort((a, b) => a.t - b.t), t1 = L.t1, tEnd = L.tEnd, G = CINE.seg;
    const on = [...new Set(ch.map((q) => Math.round(q.t * 1000) / 1000))].sort((a, b) => a - b);
    const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const feat = (a, b) => {
      const pc = new Float64Array(12); let vel = 0, hi = 0, lo = 0, nh = 0, nl = 0, n = 0;
      for (const q of ch) {
        if (q.t < a) continue; if (q.t >= b) break;
        n++; vel += q.vel;
        for (const hd of q.heads) pc[hd.pitch % 12]++;
        const ps = q.heads.map((hd) => hd.pitch);
        if (q.staff) { hi += Math.max(...ps); nh++; } else { lo += Math.min(...ps); nl++; }
      }
      const s = pc.reduce((x, y) => x + y, 0) || 1;
      return { dens: n / (b - a), vel: n ? vel / n : 0, hi: nh ? hi / nh : 72, lo: nl ? lo / nl : 48, pc: pc.map((x) => x / s) };
    };
    const cands = [];
    S.barT.forEach((b, j) => {
      if (!(b >= t1 + G.first && b < tEnd - G.min)) return;
      const beat = S.beatAt(b), bl = (S.barT[j + 1] ?? b + (b - (S.barT[j - 1] ?? b - 2))) - b, Wn = 4 * bl;
      const near = on.filter((x) => x >= b - Wn && x <= b + Wn), iois = near.slice(1).map((x, i) => x - near[i]);
      let g = 0; for (let i = 1; i < on.length; i++) if (on[i] >= b - 0.6 * beat && on[i] <= b + 0.3 * beat) g = Math.max(g, on[i] - on[i - 1]);
      const gs = Math.min(1, Math.max(0, (g / Math.max(0.05, median(iois)) - 1) / 3)); // a breath before the bar line
      let l = 0; for (const q of ch) if (q.t >= b - bl && q.t < b - 0.01 && q.end >= b - 0.25 * beat) l = Math.max(l, (q.end - q.t) / beat);
      const ls = Math.min(1, Math.max(0, (l - 1) / 2)); // a note held into it
      const A = feat(b - Wn, b), B = feat(b, b + Wn);
      let pcd = 0; for (let k = 0; k < 12; k++) pcd += Math.abs(A.pc[k] - B.pc[k]);
      const nov = Math.abs(Math.log((B.dens + 0.3) / (A.dens + 0.3))) / 0.8 + Math.abs(B.vel - A.vel) / 25 + (Math.abs(B.hi - A.hi) + Math.abs(B.lo - A.lo)) / 14 + pcd / 1.2; // a change of texture
      cands.push({ t: b, j, gs, ls, nov, reg: j % 8 === 0 ? 0.35 : j % 4 === 0 ? 0.2 : j % 2 === 0 ? 0.05 : 0 });
    });
    const novs = cands.map((q) => q.nov).sort((a, b) => a - b), q80 = novs.length ? novs[Math.floor(0.8 * (novs.length - 1))] || 1 : 1, q67 = novs.length ? novs[Math.floor(0.67 * (novs.length - 1))] : Infinity;
    for (const q of cands) q.score = 0.35 * q.gs + 0.25 * q.ls + 0.45 * Math.min(1, q.nov / q80) + q.reg;
    // the cuts: phrases of G.min .. G.max s near G.pref, through the best bar lines (dynamic programming)
    const P = [{ t: t1, score: 0 }, ...cands, { t: tEnd, score: 0 }], best = new Float64Array(P.length).fill(-Infinity), from = new Int32Array(P.length).fill(-1);
    best[0] = 0;
    for (let i = 1; i < P.length; i++) for (let k = i - 1; k >= 0; k--) {
      const len = P[i].t - P[k].t;
      if (len > (k === 0 ? G.max + 6 : G.max)) break;
      if (len < (k === 0 ? G.first : G.min) || best[k] === -Infinity) continue;
      const v = best[k] + P[i].score - 0.6 * ((len - G.pref) / G.pref) ** 2;
      if (v > best[i]) { best[i] = v; from[i] = k; }
    }
    const cuts = [];
    if (best[P.length - 1] > -Infinity) for (let i = from[P.length - 1]; i > 0; i = from[i]) cuts.unshift({ t: P[i].t, sec: P[i].nov >= q67, j: P[i].j });
    // each phrase's energy
    const bounds = [t1, ...cuts.map((q) => q.t), tEnd], segs = [];
    for (let i = 0; i + 1 < bounds.length; i++) { const f = feat(bounds[i], Math.max(bounds[i] + 0.5, bounds[i + 1])); segs.push(f); }
    const rank = (key) => { const s = segs.map((f) => f[key]).sort((a, b) => a - b); return segs.map((f) => (segs.length > 1 ? s.indexOf(f[key]) / (segs.length - 1) : 0.5)); };
    const rd = rank('dens'), rv = rank('vel');
    return { cuts, energy: segs.map((_, i) => 0.5 * rd[i] + 0.5 * rv[i]) };
  }
  // The whole plan for one camera and picture shape (once): the poses, the hands' places, the framing. Two styles:
  // 'cinematic' (CINE: HIGH, LOW and MID2 poses by the music's energy and sections) and 'closeup' (CLOSE: CLOSE and
  // WIDE taking turns, each close-up following one hand's ball).
  function buildCine(c, aspect) {
    cine.aspect = aspect; cine.c = c;
    const close = cine.style === 'closeup', shape = aspect < 1 ? 'tall' : 'wide';
    const L = layout, Fm = close ? CLOSE[shape] : CINE[shape], fams = close ? ['CLOSE', 'WIDE'] : ['HIGH', 'LOW', 'MID2'], push = close ? CLOSE.push : CINE.push, th = Math.tan((c.fov * DEG) / 2), tx = th * aspect;
    cineAxes(c.tilt, c.yaw);
    cP.set((2 * c.at[0] - 1) * tx, (1 - 2 * c.at[1]) * th, -1).applyQuaternion(cQ);
    const base = [c.tilt, c.yaw, (c.h * cP.length()) / -cP.y, c.at[0], c.at[1], 0, 0, 0];
    const { cuts, energy } = phrases(L);
    const ang = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]); // how far the view turns between two poses (deg)
    const tBack = L.tEnd - CINE.outW[0] - 2 * CINE.sigma, T = [], V = [], moves = []; // (back at the Steady pose, smoothing and all, before the blend out begins)
    const put = (t, p) => { if (T.length && t < T[T.length - 1] + 0.05) t = T[T.length - 1] + 0.05; T.push(t); V.push(...p); };
    put(L.t1 - 30, base);
    let cur = base.slice(), fam = 'MID', lowSide = true, orbit = 1, lastHigh = -Infinity, lastHand = 0, sameN = 0;
    // the return to the Steady pose before the end can need up to backMax s: no move starts so late that it could not
    // be held for a while and then make that return in time
    let angMax = 0;
    for (const f of fams) for (const e of [0, 1]) for (const sd of [false, true]) angMax = Math.max(angMax, ang(Fm[f](e, sd), base));
    const slack = CINE.orbitMax + Math.abs(CINE.tip.HIGH), backMax = Math.max(CINE.tMin, (angMax + slack) / CINE.rate);
    // the close-ups dive in as the music begins: a first cut CLOSE.first s after the first note (when the first real
    // cut is not close by), with the first phrase's energy
    const all = close && (!cuts.length || cuts[0].t - L.t1 > CLOSE.first + CINE.lead + CINE.tMin + CINE.hold + 2) ? [{ t: L.t1 + CLOSE.first + CINE.lead, sec: false, first: true }, ...cuts] : cuts;
    const eOf = (q) => (q.first ? energy[0] : energy[cuts.indexOf(q) + 1]);
    const use = all.filter((q) => q.t - CINE.lead <= tBack - backMax - CINE.tMin - CINE.hold), starts = use.map((q) => q.t - CINE.lead);
    // how much each hand plays between two times (its landings), for choosing which ball a close-up follows
    const count = (h, a, b) => { let k = 0; for (const l of paths[h]) { if (l.t >= b) break; if (l.t >= a) k++; } return k; };
    for (let i = 0; i < use.length; i++) {
      const s = starts[i], q = use[i], e = eOf(q);
      let next, hb = 0;
      if (close) {
        next = fam === 'CLOSE' ? 'WIDE' : 'CLOSE';
        if (next === 'CLOSE') { // which ball: the hand with more to play here (the right hand counted CLOSE.rh times), with turns for variety
          const b = i + 1 < use.length ? use[i + 1].t : L.tEnd, nR = count(0, q.t, b), nL = count(1, q.t, b);
          let hand = nR * CLOSE.rh >= nL ? 0 : 1;
          if (!nR && nL) hand = 1; else if (!nL && nR) hand = 0;
          if (hand === lastHand && sameN >= CLOSE.same && (hand ? nR >= 0.5 * nL : nL >= 0.5 * nR)) hand = 1 - hand;
          sameN = hand === lastHand ? sameN + 1 : 1; lastHand = hand; hb = hand ? -1 : 1;
        }
      } else {
        next = fam === 'HIGH' ? 'LOW' : fam === 'LOW' ? (e >= 0.35 || q.sec ? 'HIGH' : 'MID2') : e >= 0.55 ? 'HIGH' : 'LOW';
        if (q.sec && fam !== 'HIGH') next = 'HIGH';
        if (next === 'HIGH' && s - lastHigh < CINE.highGap) next = 'MID2'; // (no two cranes close together)
      }
      const side = next === 'LOW' || next === 'CLOSE' ? (lowSide = !lowSide) : !lowSide;
      const ideal = [...Fm[next](e, side), hb];
      // the last move's hold ends when the return must start (time for the furthest it can then be from the Steady pose)
      const end = i + 1 < use.length ? starts[i + 1] : tBack - Math.max(CINE.tMin, (Math.max(ang(cur, base), ang(ideal, base)) + slack) / CINE.rate);
      if (end - s < CINE.tMin + CINE.hold) continue; // no room for a move here: the pose before is held on
      if (s > T[T.length - 1] + 1e-6) put(s, cur);
      const A = ang(cur, ideal), Tav = Math.min(CINE.tMax, end - s - CINE.hold);
      let P = ideal, Tm = Math.min(Tav, Math.max(CINE.tMin, A / CINE.rate));
      if (A / CINE.rate > Tav) { const f = (Tav * CINE.rate) / A; P = cur.map((v, d) => v + (ideal[d] - v) * f); Tm = Tav; }
      put(s + Tm, P);
      // the hold: a slow orbit (alternating sides), a low view closing in, a high one opening out and tipping a little
      const hd = end - s - Tm, Pe = P.slice();
      Pe[1] += orbit * Math.min(CINE.orbitMax, CINE.orbit * hd); orbit = -orbit;
      Pe[2] *= push[next] ?? 1; Pe[0] += (CINE.tip[next] ?? 0) * Math.min(1, hd / 10);
      put(end, Pe);
      moves.push({ t: +s.toFixed(2), T: +Tm.toFixed(2), fam: next, e: +e.toFixed(2), sec: q.sec, A: +A.toFixed(1), shrunk: P !== ideal, hb });
      cur = Pe; fam = next; if (next === 'HIGH') lastHigh = s;
    }
    put(tBack, base); put(tBack + 30, base);
    cine.pose = curve(T, V, 8, CINE.sigma); cine.cuts = cuts; cine.moves = moves; cine.base = base;
    // each hand's page y (where its ball is; a hand with no ball here takes the other's, or the middle), smoothed (a
    // close-up follows its ball more tightly)
    const Fr = CINE.frame, t0 = L.t1 - 3, t9 = L.tEnd + 3, HT = [], HV = [], tb = (t) => Math.min(t, L.tEnd); // (the balls' flight away at the very end does not count)
    for (let t = t0; t <= t9; t += Fr.knot) {
      const y = [null, null];
      for (let h = 0; h < 2; h++) if (paths[h].length && ballAt(h, tb(t), L, c, aspect, cB)) y[h] = -cB.z;
      const m = y[0] != null && y[1] != null ? (y[0] + y[1]) / 2 : y[0] ?? y[1] ?? c.y;
      HT.push(t); HV.push(y[0] ?? m, y[1] ?? m);
    }
    cine.hands = curve(HT, HV, 2, close ? CLOSE.follow : Fr.hands);
    // the framing: the least distance that keeps the notes each hand has just played or is about to play, and both
    // balls, inside the picture, every Fr.dt s (for the planned turn, place and framing point), held Fr.reach s
    const ch = [...S.chords].sort((a, b) => a.t - b.t), n = Math.ceil((t9 - t0) / Fr.dt) + 1, need = new Float64Array(n), why = (cine.why = new Int8Array(n)); // (why: which edge of the picture held it back, +4 for a ball; for tuning)
    let lo = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * Fr.dt, y = cinePlace(t, c);
      cineAxes(cv[0], cv[1]);
      const ax = 2 * cv[3] - 1, ay = 1 - 2 * cv[4], x0 = camX(L, t);
      cP.copy(cF).addScaledVector(cR, ax * tx).addScaledVector(cU, ay * th); const len = cP.length();
      // (a close-up keeps only the ball it follows, and the notes that ball lands on now, in the picture)
      const only = close && Math.abs(cv[7]) > 0.5 ? (cv[7] > 0 ? 0 : 1) : -1, hold = only < 0 ? Fr.hold : CLOSE.frame.hold, ahead = only < 0 ? Fr.ahead : CLOSE.frame.ahead;
      let k = 0;
      const fit = (px, py, pz, m) => {
        const dx = px - x0, dy = py, dz = pz + y, X = dx * cR.x + dy * cR.y + dz * cR.z, Y = dx * cU.x + dy * cU.y + dz * cU.z, Z = dx * cF.x + dy * cF.y + dz * cF.z;
        const k0 = Math.max((X - m * tx * Z) / (tx * (m - ax)), (-X - m * tx * Z) / (tx * (m + ax)), (Y - m * th * Z) / (th * (m - ay)), (-Y - m * th * Z) / (th * (m + ay)));
        if (k0 > k) { k = k0; why[i] = (m === Fr.mBall ? 4 : 0) + (k0 === (X - m * tx * Z) / (tx * (m - ax)) ? 0 : k0 === (-X - m * tx * Z) / (tx * (m + ax)) ? 1 : k0 === (Y - m * th * Z) / (th * (m - ay)) ? 2 : 3); }
      };
      for (let h = 0; h < 2; h++) if ((only < 0 || h === only) && t <= L.tEnd && paths[h].length && t >= paths[h][0].t - 0.2 && ballAt(h, t, L, c, aspect, cB)) { fit(cB.x, cB.y, cB.z, Fr.mBall); fit(cB.x, cB.y + 0.8, cB.z, Fr.mBall); }
      while (lo < ch.length && ch[lo].t < t - Fr.hold) lo++;
      for (let j = lo; j < ch.length && ch[j].t <= t + Fr.ahead; j++) {
        if (ch[j].t < t - hold || ch[j].t > t + ahead || (only >= 0 && ch[j].staff !== only)) continue;
        const q = ch[j], y0 = q.heads[0].y, y1 = q.heads[q.heads.length - 1].y;
        for (const yy of [Math.min(y0, y1) - 0.7, Math.max(y0, y1) + 0.7]) { fit(q.x - 0.8, 0.1, -yy, Fr.m); fit(q.x + 0.8, 0.1, -yy, Fr.m); }
      }
      need[i] = k * len;
    }
    const r = Math.round(Fr.reach / Fr.dt), NT = [], NV = [];
    for (let t = t0; t <= t9; t += Fr.knot) {
      const i = Math.round((t - t0) / Fr.dt); let m = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) m = Math.max(m, need[j]);
      NT.push(t); NV.push(m);
    }
    cine.need = curve(NT, NV, 1, Fr.sigma);
    // the distance on the same grid: the plan's, no further than keeps a notehead minPx tall at 1080p, no nearer than
    // the framing needs; then smoothed again (a limit taken frame by frame made the dolly bounce where the plan met it)
    const hpx = aspect < 1 ? 1080 / aspect : 1080, DV = [];
    const planned = (t) => { // the plan's distance at t: no further than keeps a notehead minPx tall, no nearer than the framing needs
      cinePlace(t, c); cineAxes(cv[0], cv[1]);
      cP.copy(cF).addScaledVector(cR, (2 * cv[3] - 1) * tx).addScaledVector(cU, (1 - 2 * cv[4]) * th);
      const far = (hpx * -cP.y) / cP.length() / (2 * th * CINE.minPx);
      return [Math.min(cv[2], far), evalCurve(cine.need, t, c1)[0]];
    };
    // The sideways sweep (CINE.sweep), on the framing's grid: the point of the paper under the place being played (the
    // two balls' mean) is seen from the planned camera at t and t + dt, and from the Steady camera at the same times;
    // where it crosses the picture (in picture heights per second) faster than `sweep` times the Steady speed, the
    // camera keeps further back (the speed falls about as the distance grows: solved twice, as the bound moves the pose).
    const sPos = new THREE.Vector3(), sQ = new THREE.Quaternion(), sPs = { ...pose }, sW = new THREE.Vector3(), spot = new THREE.Vector3();
    const dBase = new Float64Array(n), low = new Float64Array(n);
    for (let i = 0; i < n; i++) { const [d0, d1] = planned(t0 + i * Fr.dt); dBase[i] = Math.max(d0, d1); low[i] = d1; }
    const planSeen = (t, d) => { // where the spot is in the planned camera's picture at t from distance d ([x, y] in picture heights)
      const y = cinePlace(t, c); cineAxes(cv[0], cv[1]);
      cP.copy(cF).addScaledVector(cR, (2 * cv[3] - 1) * tx).addScaledVector(cU, (1 - 2 * cv[4]) * th);
      const k = d / cP.length();
      sW.set(spot.x - (camX(L, t) - cP.x * k), spot.y - (-cP.y * k + crane(L, t)), spot.z - (-y - cP.z * k));
      const Z = Math.max(0.1, sW.dot(cF)); return [sW.dot(cR) / (Z * 2 * th), sW.dot(cU) / (Z * 2 * th)];
    };
    const steadySeen = (t) => { // the same in the Steady camera's picture
      poseAt(L, t, c, aspect, sPos, sQ, sPs); sQ.invert();
      sW.copy(spot).sub(sPos).applyQuaternion(sQ);
      const Z = Math.max(0.1, -sW.z); return [sW.x / (Z * 2 * th), sW.y / (Z * 2 * th)];
    };
    const keepOn = cineOn; cineOn = false; // (the Steady camera's own pose)
    for (let i = 0; i + 1 < n; i++) {
      const t = t0 + i * Fr.dt, t2 = t + Fr.dt;
      if (t < L.t1 || t > L.tEnd) continue;
      let m = 0; spot.set(0, 0, 0);
      cinePlace(t, c); const only = close && Math.abs(cv[7]) > 0.5 ? (cv[7] > 0 ? 0 : 1) : -1; // (a close-up: the ball it follows)
      for (let h = 0; h < 2; h++) if ((only < 0 || h === only) && paths[h].length && ballAt(h, tb(t), L, c, aspect, cB)) { spot.x += cB.x; spot.z += cB.z; m++; }
      if (!m) continue;
      spot.multiplyScalar(1 / m); spot.y = 0;
      const a = steadySeen(t), b = steadySeen(t2), vS = Math.max(0.15, Math.hypot(b[0] - a[0], b[1] - a[1]) / Fr.dt);
      let f = 1;
      for (let it = 0; it < 2; it++) {
        const p0 = planSeen(t, dBase[i] * f), p1 = planSeen(t2, dBase[i + 1] * f), v = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / Fr.dt;
        f = Math.min(2.5, Math.max(f, (f * v) / ((close ? CLOSE.sweep : CINE.sweep) * vS)));
      }
      if (f > 1) low[i] = Math.max(low[i], dBase[i] * f);
    }
    cineOn = keepOn;
    // the lower bounds (framing and sweep) spread by a running maximum over 3 distSigma on either side, so that the
    // smoothed distance never dips below them (as cam-breathe's safety pass), then joined with the plan
    const r3 = Math.round((3 * CINE.distSigma) / Fr.dt), lowS = new Float64Array(n);
    for (let i = 0; i < n; i++) { let v = 0; for (let j = Math.max(0, i - r3); j <= Math.min(n - 1, i + r3); j++) v = Math.max(v, low[j]); lowS[i] = v; }
    for (let i = 0; i < NT.length; i++) {
      const [d0] = planned(NT[i]), u = (NT[i] - t0) / Fr.dt, j = Math.min(n - 1, Math.max(0, Math.floor(u)));
      DV.push(Math.max(d0, lowS[j], lowS[Math.min(n - 1, j + 1)]));
    }
    cine.dist = curve(NT, DV, 1, CINE.distSigma);
  }

  // ---- the balls of light, one per hand ----
  // Each hops from note to note in a straight line (in plan) at constant speed, its height a parabola with the top in
  // the middle of the hop, rising BALL.k * T^BALL.p ss for a gap of T seconds (rests are flown over: the hop is just
  // longer and higher); it touches each note for an instant. A chord is landed on at its outer note (the top in the
  // right hand, the bottom in the left), on that note's own head.
  const headX = new Map(heads.map((h) => [`${h.staff}|${h.t}|${h.y}`, h.x]));
  const paths = [0, 1].map((hand) => (S ? S.landings[hand].map((l) => ({ t: l.t, x: headX.get(`${hand}|${l.t}|${l.y}`) ?? l.x, y: l.y })) : []));
  const ballGeo = new THREE.PlaneGeometry(2, 2), QSIZE = 2.3; // the square around a ball reaches 2.3 radii out
  const ballU = looks.map((l) => ({ uSize: { value: BALL.r * QSIZE }, uQ: { value: QSIZE }, uCore: { value: l.ball }, uRim: { value: l.ballRim }, uHalo: { value: l.ballHalo }, uAlpha: { value: 1 }, uGain: { value: new THREE.Vector2(1, 1) } }));
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
  const poseV = new THREE.Vector3(), poseR = new THREE.Quaternion(), poseQ = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 0, lam: 0, dof: 0, focus: 0, dist: 0, cine: 0 };
  const camTc = new THREE.Vector3(), qTc = new THREE.Quaternion(), poseTc = { x: 0, h: 0, hl: 0, yaw: 0, dNear: 0, lam: 0, dof: 0, focus: 0, dist: 0, cine: 0 }, away = new THREE.Vector3();
  // Where a ball's entry starts: the x at which the line it glides in along (inH high, over its first note's line)
  // crosses the left edge of the picture inT seconds before that note. Found once per picture shape (by halving).
  const entry = { aspect: 0, c: null, x: [0, 0], done: [false, false] }, ep = new THREE.Vector3();
  function entryX(hand, L, c, aspect) {
    if (entry.aspect !== aspect || entry.c !== c) { entry.aspect = aspect; entry.c = c; entry.done[0] = entry.done[1] = false; }
    if (entry.done[hand]) return entry.x[hand];
    const f = paths[hand][0], th = Math.tan((c.fov * DEG) / 2) * aspect;
    const keep = cineOn; cineOn = false; // (from the Steady camera's picture: the same start for either camera)
    poseAt(L, f.t - BALL.inT, c, aspect, camTc, qTc, poseTc); qTc.invert(); cineOn = keep;
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

  // Bolts of current (the corner light's electric bolts, and the electric notes, ZAP): a kit holds, per hand, one
  // geometry of `count` bolts of PTS points each (the main channel of n steps, then `branches` forks of bn steps), as
  // the SEGS segments between them (four corners each), drawn twice (the hard core and the soft halo: [w, minPx, dim]
  // and [halo, haloPx, haloDim] of the style's settings, at drawing order `order`). Each frame the bolts' points go into
  // the kit's QX, QZ, QA (brightness), QW (width) one bolt at a time, and writeArc lays them into its geometry.
  const ARC_DYN = ['position', 'aP', 'aB', 'aN', 'aAl', 'aWd'], arcInvPV = { value: new THREE.Matrix4() }; // (the camera undone: world from the picture, for the bolts' depth)
  function arcKit(st, count, order, air = false) {
    const { n, branches, bn } = st, PTS = n + 1 + branches * (bn + 1);
    // whether point i of a bolt (0 .. PTS - 1) is the first or the last of its piece; the point each segment starts at
    const first = (i) => i === 0 || (i > n && (i - n - 1) % (bn + 1) === 0), last = (i) => i === n || (i > n && (i - n) % (bn + 1) === 0);
    const segAt = Int32Array.from({ length: PTS }, (_, i) => i).filter((i) => !last(i)), SEGS = segAt.length, idx = [];
    for (let q = 0; q < count * SEGS; q++) idx.push(4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 1, 4 * q + 3, 4 * q + 2);
    const hands = looks.map(() => {
      const g = new THREE.BufferGeometry(), N = count * SEGS * 4, dyn = (k) => new THREE.BufferAttribute(new Float32Array(N * k), k).setUsage(THREE.DynamicDrawUsage);
      for (const [k, d] of [['position', 3], ['aP', 3], ['aB', 3], ['aN', 3], ['aAl', 2], ['aWd', 2]]) g.setAttribute(k, dyn(d));
      g.setAttribute('aCorner', new THREE.BufferAttribute(Float32Array.from({ length: N * 2 }, (_, i) => (i & 1 ? ((i >> 1) & 1 ? 1 : -1) : (i >> 2) & 1)), 2));
      g.setAttribute('aE', new THREE.BufferAttribute(Float32Array.from({ length: N }, (_, i) => (first(segAt[(i >> 2) % SEGS]) ? 1 : 0)), 1));
      g.setIndex(idx);
      const mk = (w, minPx, dim, ord, end) => {
        const u = { uRes: lineU.uRes, uW: { value: w }, uMinPx: { value: minPx }, uColor: { value: new THREE.Vector3() }, uFade: { value: 1 }, uDim: { value: dim }, uEnd: { value: end }, uHard: { value: 1 - end }, uAir: { value: air ? 1 : 0 }, uInvPV: arcInvPV };
        const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
        m.frustumCulled = false; m.visible = false; m.renderOrder = ord; scene.add(m);
        return m;
      };
      return { geo: g, halo: mk(st.halo, st.haloPx, st.haloDim, order, 1), core: mk(st.w, st.minPx, st.dim, order + 0.5, 0) };
    });
    return { st, n, branches, bn, count, PTS, SEGS, segAt, first, last, hands, QX: new Float32Array(PTS), QY: new Float32Array(PTS).fill(0.02), QZ: new Float32Array(PTS), QA: new Float32Array(PTS), QW: new Float32Array(PTS) };
  }
  // bolt a of hand h: its segments from the kit's points, each with the points before and after it on its piece (itself
  // at the piece's ends), at all four corners
  function writeArc(K, h, a) {
    const g = K.hands[h].geo.attributes, { QX, QY, QZ, QA, QW, segAt, first, last, SEGS } = K;
    const PA = g.position.array, PP = g.aP.array, PB = g.aB.array, PN = g.aN.array, AL = g.aAl.array, WD = g.aWd.array;
    for (let s = 0; s < SEGS; s++) {
      const i = segAt[s], p = first(i) ? i : i - 1, q = last(i + 1) ? i + 1 : i + 2;
      for (let c = 0, v = 4 * (a * SEGS + s); c < 4; c++, v++) {
        PA[3 * v] = QX[i]; PA[3 * v + 1] = QY[i]; PA[3 * v + 2] = QZ[i]; PB[3 * v] = QX[i + 1]; PB[3 * v + 1] = QY[i + 1]; PB[3 * v + 2] = QZ[i + 1];
        PP[3 * v] = QX[p]; PP[3 * v + 1] = QY[p]; PP[3 * v + 2] = QZ[p]; PN[3 * v] = QX[q]; PN[3 * v + 1] = QY[q]; PN[3 * v + 2] = QZ[q];
        AL[2 * v] = QA[i]; AL[2 * v + 1] = QA[i + 1]; WD[2 * v] = QW[i]; WD[2 * v + 1] = QW[i + 1];
      }
    }
  }
  const EL = CORNER.electric, kitE = arcKit(EL, ARCS, 8), arcs = kitE.hands, kitZ = arcKit(ZAP, ZAP.notes * ZAP.bolts, 8.6), zaps = kitZ.hands;
  const kitC = arcKit(CURRENT, 3 + CURRENT.sparks, 8.8, true), currents = kitC.hands; // (per hand: the tail, the leap ahead, the ball's crackle, the note's sparks)
  // Where the ray through a point of the picture (nx, ny: -1..1) meets the paper: into cp (world x, z); returns its
  // distance from the camera.
  const rayV = new THREE.Vector3(), cp = { x: 0, z: 0 }, AX = new Float32Array(ARC_PTS), AZ = new Float32Array(ARC_PTS);
  const { QX, QZ, QA, QW } = kitE; // (one corner bolt's points)
  function onPaper(camera, nx, ny) {
    rayV.set(nx, ny, 0.5).unproject(camera).sub(camera.position);
    const s = camera.position.y / Math.max(-rayV.y, 1e-4);
    cp.x = camera.position.x + rayV.x * s; cp.z = camera.position.z + rayV.z * s;
    return s * rayV.length();
  }
  const bandOf = (h, py) => { const [a, b] = CORNER.band[h]; return sstep(0, 1, (py - a) / (b - a)); };
  // One bolt (slot a of hand h) for a trigger (see CORNER.electric): from its terminal on the frame edge near the corner
  // (chosen by the seed) toward the note it was set off by, stopping short of the music; a fractal, jagged channel of
  // current with forks, re-struck EL.hz times a second (a new shape each time), a pulse running along it, the leader
  // growing from the edge, thinning and dimming toward its tip. Returns its brightness (0: nothing drawn) and leaves
  // its middle in cp, for its light on the paper.
  const MD = new Float32Array(2 * (64 + 1)); // (one piece's points while it is split: up to 64 steps)
  function bolt(x0, z0, x1, z1, n, sd, salt, rough) { // midpoint displacement from (x0, z0) to (x1, z1) in n (2^k) steps, into MD
    MD[0] = x0; MD[1] = z0; MD[2 * n] = x1; MD[2 * n + 1] = z1;
    for (let step = n; step > 1; step >>= 1) for (let i = 0; i < n; i += step) {
      const j = i + step, m = i + (step >> 1), ax = MD[2 * i], az = MD[2 * i + 1], bx = MD[2 * j], bz = MD[2 * j + 1];
      const dx = bx - ax, dz = bz - az, off = rough * (2 * hash01(sd, salt + m * 31 + step) - 1); // (sideways, a share of the piece's length)
      MD[2 * m] = (ax + bx) / 2 - dz * off; MD[2 * m + 1] = (az + bz) / 2 + dx * off;
    }
  }
  function fillArc(h, a, tau, seed, nx, ny, S, camera, kr) {
    const env0 = tau < 0 || tau > EL.life ? 0 : sstep(0, 0.02, tau) * Math.exp(-tau / EL.decay) * (1 - sstep(EL.life - 0.12, EL.life, tau));
    // the strikes: a new shape EL.hz times a second, each flashing brighter as it strikes and settling
    const sk = Math.floor(tau * EL.hz), ph = tau * EL.hz - sk, sd = (seed + Math.imul(sk + 1, 0x9e3779b1)) >>> 0;
    const flash = Math.exp(-ph * 3.2), env = env0 * (1 - EL.flick[0] + EL.flick[0] * (0.35 + 0.65 * flash)) * (1 + EL.flash * flash);
    // the terminal: along the frame edge (two straight pieces round the corner), a little outside the picture
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
    const stop = h === 0 ? TOP[0] + EL.stop : BOTTOM[1] - EL.stop;
    // each strike leans a little to one side or the other of the straight way (seeded), so the strikes fan out
    const lean = 0.35 * (2 * hash01(sd, 3) - 1), cl = Math.cos(lean), sl = Math.sin(lean), ddx = dx * cl - dz * sl, ddz = dx * sl + dz * cl, dpy = -ddz;
    if (h === 0 && dpy < 0) L = Math.min(L, (py0 - stop) / -dpy); else if (h === 1 && dpy > 0) L = Math.min(L, (stop - py0) / dpy);
    const on = env > 0.002 && L > 1;
    const grow = sstep(0, EL.grow, tau) * 1.1, u = (tau * EL.pulseHz) % 1; // (the leader's reach; where the pulse of current is, 0..1 along the bolt)
    const lit = (f) => 1 + EL.pulse * Math.exp(-(((f - u) / EL.pulseW) ** 2)); // (the pulse brightens where it passes)
    let k = 0, cx = 0, cz = 0;
    // the main channel
    bolt(x0, z0, x0 + ddx * L, z0 + ddz * L, EL.n, sd, 100, EL.rough);
    for (let i = 0; i <= EL.n; i++, k++) {
      const x = MD[2 * i], z = MD[2 * i + 1], f = i / EL.n;
      AX[i] = x; AZ[i] = z;
      QX[k] = x; QZ[k] = z; QW[k] = (1 - 0.5 * f) * ws;
      QA[k] = on ? env * (1 - 0.4 * Math.pow(f, 1.5)) * (i === EL.n ? 0.3 : 1) * (1 - sstep(grow - 0.1, grow, f)) * lit(f) * bandOf(h, -z) : 0;
      if (i === EL.n >> 1) { cx = x; cz = z; }
    }
    // the forks: from a point of the main channel, off to one side, each its own small fractal bolt
    for (let b = 1; b <= EL.branches; b++) {
      const root = 2 + Math.floor(hash01(sd, 70 + b) * (EL.n - 6)), rx = AX[root], rz = AZ[root];
      const hx = AX[root + 1] - AX[root - 1], hz = AZ[root + 1] - AZ[root - 1], hl = Math.hypot(hx, hz) || 1;
      const turn = (hash01(sd, 80 + b) < 0.5 ? -1 : 1) * (EL.forkAng[0] + (EL.forkAng[1] - EL.forkAng[0]) * hash01(sd, 90 + b)), c = Math.cos(turn), sn = Math.sin(turn);
      const fx = (hx / hl) * c - (hz / hl) * sn, fz = (hx / hl) * sn + (hz / hl) * c, len = L * (EL.fork[0] + (EL.fork[1] - EL.fork[0]) * hash01(sd, 60 + b)), f0 = root / EL.n;
      bolt(rx, rz, rx + fx * len, rz + fz * len, EL.bn, sd, 1000 * b, EL.rough * 1.1);
      for (let i = 0; i <= EL.bn; i++, k++) {
        const x = MD[2 * i], z = MD[2 * i + 1], fb = i / EL.bn, f = f0 + fb * (len / L);
        QX[k] = x; QZ[k] = z; QW[k] = (1 - 0.5 * Math.min(f, 1)) * (1 - 0.5 * fb) * 0.7 * ws;
        QA[k] = on ? env * 0.7 * (1 - 0.6 * fb) * (i === EL.bn ? 0.2 : 1) * (1 - sstep(grow - 0.1, grow, f)) * lit(f) * bandOf(h, -z) : 0;
      }
    }
    writeArc(kitE, h, a);
    cp.x = cx; cp.z = cz;
    return on ? env0 * (1 - EL.flick[1] + EL.flick[1] * (0.4 + 0.6 * flash)) : 0;
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
          if (e > 0) AP[2 * h + a].set(cp.x, cp.z, (2 + 0.25 * EL.len * S) * kr, EL.k * kh * kb * e * (paperTone.dark ? sstep(0, DARK[paperTone.dark].arcRise, tr.tau[i]) : 1)); // (dark paper: its light on the sheet swells in gently)
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
  // The electric notes (ZAP) at time t, K their strength (0..1, more than 0), fade: the balls' fade.
  const zapOff = () => { for (const z of zaps) z.halo.visible = z.core.visible = false; };
  const zapCol = [new THREE.Vector3(), new THREE.Vector3()], lumOf = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
  function zap(t, live, camera, pr, fade, K) {
    const Z = ZAP, kz = kitZ, nCr = Math.round(1 + (Z.bolts - 2) * K), kl = 0.7 + 0.6 * K, kb = 0.6 + 0.8 * K;
    arcInvPV.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    for (let h = 0; h < 2; h++) {
      const zh = zaps[h];
      zh.halo.visible = zh.core.visible = true;
      let a = 0;
      // one landing at page (x, y), the note before at (px, py) (NaN: none), tau s ago
      const one = (x, y, px, py, tau, seed) => {
        const env0 = tau < 0 || tau > Z.life ? 0 : sstep(0, 0.015, tau) * Math.exp(-tau / Z.decay) * (1 - sstep(Z.life - 0.1, Z.life, tau));
        const sk = Math.floor(tau * Z.hz), ph = tau * Z.hz - sk, sd = (seed + Math.imul(sk + 1, 0x9e3779b1)) >>> 0, env = env0 * (1 + Z.flash * Math.exp(-ph * 3.2));
        for (let b = 0; b < Z.bolts && a < kz.count; b++) {
          let x0, z0, x1, z1, ok = env > 0.002;
          if (b === 0) { // the jump from the note before
            const d = Math.hypot(x - px, y - py), ux = (x - px) / (d || 1), uy = (y - py) / (d || 1);
            if (!(d <= Z.reach) || d < 2 * Z.r0 + 0.3) ok = false; // (NaN: no note before)
            x0 = px + ux * Z.r0; z0 = -(py + uy * Z.r0); x1 = x - ux * Z.r0; z1 = -(y - uy * Z.r0);
            if (!ok) { x0 = x1 = x; z0 = z1 = -y; }
          } else { // a crackle off the head
            if (b > nCr) ok = false;
            const ang = 6.2832 * hash01(seed, 40 + b) + 0.6 * (2 * hash01(sd, 50 + b) - 1), len = kl * (Z.len[0] + (Z.len[1] - Z.len[0]) * hash01(sd, 60 + b)), ca = Math.cos(ang), sa = Math.sin(ang);
            x0 = x + ca * Z.r0; z0 = -(y + sa * Z.r0 * 0.85); x1 = x + ca * (Z.r0 + len); z1 = -(y + sa * (Z.r0 * 0.85 + len));
          }
          bolt(x0, z0, x1, z1, Z.n, sd, 200 + 97 * b, EL.rough);
          let k = 0;
          for (let i = 0; i <= Z.n; i++, k++) {
            const f = i / Z.n;
            kz.QX[k] = MD[2 * i]; kz.QZ[k] = MD[2 * i + 1]; kz.QW[k] = b ? 1 - 0.6 * f : 1;
            kz.QA[k] = ok ? env * kb * (b ? (1 - 0.7 * f) * (i === Z.n ? 0.15 : 1) : 1 - 0.5 * Math.abs(2 * f - 1) ** 3) : 0;
          }
          // its fork, from a point along it, off to one side
          const root = 2 + Math.floor(hash01(sd, 300 + b) * (Z.n - 4)), rx = kz.QX[root], rz = kz.QZ[root];
          const hx = kz.QX[root + 1] - kz.QX[root - 1], hz = kz.QZ[root + 1] - kz.QZ[root - 1], hl = Math.hypot(hx, hz) || 1, turn = (hash01(sd, 310 + b) < 0.5 ? -1 : 1) * (0.4 + 0.5 * hash01(sd, 320 + b)), c = Math.cos(turn), sn = Math.sin(turn);
          const fl = 0.45 * Math.hypot(x1 - x0, z1 - z0) * (0.5 + 0.5 * hash01(sd, 330 + b)), fx = ((hx * c - hz * sn) / hl) * fl, fz = ((hx * sn + hz * c) / hl) * fl;
          bolt(rx, rz, rx + fx, rz + fz, Z.bn, sd, 400 + 97 * b, EL.rough);
          for (let i = 0; i <= Z.bn; i++, k++) {
            const f = i / Z.bn;
            kz.QX[k] = MD[2 * i]; kz.QZ[k] = MD[2 * i + 1]; kz.QW[k] = 0.7 * (1 - 0.6 * f);
            kz.QA[k] = ok ? env * kb * 0.6 * (1 - 0.7 * f) * (i === Z.bn ? 0.1 : 1) : 0;
          }
          writeArc(kz, h, a++);
        }
      };
      if (!live) {
        const list = paths[h];
        if (list.length && t >= list[0].t) {
          const lo = lastAt(list, t);
          for (let k = 0; k < Z.notes && lo - k >= 0; k++) {
            const i = lo - k, l = list[i], tau = t - l.t;
            if (tau > Z.life) break;
            const p = i > 0 ? list[i - 1] : null;
            one(l.x, l.y, p ? p.x : NaN, p ? p.y : NaN, tau, (i * 2 + h + 0x5a17) & 0xffffff);
          }
        }
      } else {
        const lc = liveCh[h], m = Math.min(lc.n, LIVE_CH);
        for (let k = 0; k < m && k < Z.notes; k++) {
          const j = (lc.n - 1 - k) % LIVE_CH, tau = t - lc.t[j];
          if (tau < 0) continue;
          if (tau > Z.life) break;
          const jp = k + 1 < m ? (lc.n - 2 - k) % LIVE_CH : -1;
          one(lc.x[j], lc.y[j], jp >= 0 ? lc.x[jp] : NaN, jp >= 0 ? lc.y[jp] : NaN, tau, lc.seed[j]);
        }
      }
      kz.QA.fill(0);
      for (; a < kz.count; a++) writeArc(kz, h, a); // (the rest: dark)
      const v = lightOf(zapCol[h], looks[h].ballHalo, 1, 1, 1), cc = zh.core.material.uniforms.uColor.value, hc = zh.halo.material.uniforms.uColor.value;
      cc.copy(v).lerp(WHITE, Z.white); hc.copy(v);
      cc.multiplyScalar(Z.lum / lumOf(cc)); hc.multiplyScalar(Z.haloLum / lumOf(hc));
      zh.core.material.uniforms.uMinPx.value = Z.minPx * pr; zh.halo.material.uniforms.uMinPx.value = Z.haloPx * pr;
      zh.core.material.uniforms.uFade.value = zh.halo.material.uniforms.uFade.value = fade;
      for (const k of ARC_DYN) zh.geo.attributes[k].needsUpdate = true;
    }
  }
  // Current with the balls (CURRENT) at time t, K its strength (0..1, more than 0), fade: the balls' fade.
  const currentOff = () => { for (const z of currents) z.halo.visible = z.core.visible = false; };
  const JU = new Float32Array(65), JV = new Float32Array(65), PX = new Float32Array(65), PY = new Float32Array(65), PZ = new Float32Array(65), PO = new Uint8Array(65);
  const cT = new THREE.Vector3(), cS = new THREE.Vector3(), cV = new THREE.Vector3(), cA = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), curCol = [new THREE.Vector3(), new THREE.Vector3()];
  // 1D midpoint displacement: n (2^k) offsets into out, 0 at the start, 0 at the end too unless `open` (a free end)
  function jag1(n, sd, salt, rough, out, open) {
    out[0] = 0; out[n] = open ? rough * (2 * hash01(sd, salt) - 1) : 0;
    for (let step = n; step > 1; step >>= 1) for (let i = 0; i < n; i += step) { const j = i + step, m = i + (step >> 1); out[m] = (out[i] + out[j]) / 2 + rough * (step / n) * (2 * hash01(sd, salt + m * 31 + step) - 1); }
  }
  // points k0 .. k0 + n of the kit: the base path PX/PY/PZ at stride `every`, pushed off it by the two offset sequences
  // (JU sideways, JV up across it) times amp(f), with brightness al(f) and width wd(f), f = 0 .. 1 along it
  function strand(K, k0, n, every, amp, al, wd) {
    const N = n * every;
    for (let i = 0; i <= n; i++) {
      const b = i * every, f = i / n, b0 = Math.max(0, b - every), b1 = Math.min(N, b + every);
      cT.set(PX[b1] - PX[b0], PY[b1] - PY[b0], PZ[b1] - PZ[b0]); if (cT.lengthSq() < 1e-8) cT.set(1, 0, 0); cT.normalize();
      cS.crossVectors(cT, UPV); if (cS.lengthSq() < 1e-6) cS.set(0, 0, 1); cS.normalize(); cV.crossVectors(cS, cT).normalize();
      const A = amp(f), k = k0 + i;
      K.QX[k] = PX[b] + (cS.x * JU[i] + cV.x * JV[i]) * A; K.QY[k] = Math.max(0.03, PY[b] + (cS.y * JU[i] + cV.y * JV[i]) * A); K.QZ[k] = PZ[b] + (cS.z * JU[i] + cV.z * JV[i]) * A;
      K.QA[k] = PO[b] ? al(f) : 0; K.QW[k] = wd(f);
    }
  }
  function current(t, L, c, camera, pr, fade, Kk) {
    const C = CURRENT, kc = kitC, n = C.n, sk = Math.floor(t * C.hz), ph = t * C.hz - sk, flash = Math.exp(-ph * 3.2), kb = 0.6 + 0.8 * Kk, ka = 0.6 + 0.6 * Kk;
    arcInvPV.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    for (let h = 0; h < 2; h++) {
      const zh = currents[h], list = paths[h], sd = (h * 7919 + Math.imul(sk + 1, 0x9e3779b1)) >>> 0;
      zh.halo.visible = zh.core.visible = true;
      // 0: the tail, through the air along the ball's path (f = 0 at the ball)
      kc.QA.fill(0); kc.QY.fill(0.02);
      const span = C.tail * (0.6 + 0.4 * Kk);
      for (let i = 0; i <= n; i++) { const ok = ballAt(h, t - span * (i / n), L, c, camera.aspect, cA); PO[i] = ok ? 1 : 0; if (ok) { PX[i] = cA.x; PY[i] = cA.y; PZ[i] = cA.z; } else if (i) { PX[i] = PX[i - 1]; PY[i] = PY[i - 1]; PZ[i] = PZ[i - 1]; } else { PX[i] = PY[i] = PZ[i] = 0; } }
      const live0 = PO[0] === 1, amp = (f) => (C.jag[0] + (C.jag[1] - C.jag[0]) * f) * ka, env = fade * kb * (0.72 + 0.28 * flash);
      if (live0) {
        jag1(n, sd, 11, 1.2, JU, true); jag1(n, sd, 12, 1.2, JV, true);
        strand(kc, 0, n, 1, amp, (f) => env * Math.pow(1 - f, C.fall), (f) => 1 - 0.6 * f);
        for (let b = 1; b <= C.branches; b++) { // the strands, twisting round it, over the tail at half the steps
          jag1(C.bn, sd, 20 + 7 * b, 1.6, JU, true); jag1(C.bn, sd, 21 + 7 * b, 1.6, JV, true);
          strand(kc, n + 1 + (b - 1) * (C.bn + 1), C.bn, n / C.bn, (f) => amp(f) * 0.8, (f) => env * 0.5 * Math.pow(1 - f, C.fall + 0.4), (f) => 0.6 * (1 - 0.5 * f));
        }
      }
      writeArc(kc, h, 0);
      // 1: the leap ahead, from the note just landed on to the next one (on the paper); 3..: the note's sparks
      kc.QA.fill(0); kc.QY.fill(0.02);
      const lo = list.length && t >= list[0].t ? lastAt(list, t) : -1, l = lo >= 0 ? list[lo] : null, tau = l ? t - l.t : 1e9, nx = lo >= 0 && lo + 1 < list.length ? list[lo + 1] : null;
      const sdL = l ? ((lo * 2 + h + 0x2b1) + Math.imul(sk + 1, 0x9e3779b1)) >>> 0 : 0;
      if (l && nx && tau <= C.lead) {
        const d = Math.hypot(nx.x - l.x, nx.y - l.y);
        if (d <= C.leadMax && d > 2 * ZAP.r0 + 0.3) {
          const ux = (nx.x - l.x) / d, uy = (nx.y - l.y) / d, e = fade * kb * sstep(0, 0.012, tau) * Math.exp(-tau / C.leadDecay) * (1 - sstep(C.lead - 0.06, C.lead, tau)) * (1 + 0.5 * flash);
          bolt(l.x + ux * ZAP.r0, -(l.y + uy * ZAP.r0), nx.x - ux * ZAP.r0, -(nx.y - uy * ZAP.r0), n, sdL, 500, EL.rough);
          for (let i = 0; i <= n; i++) { const f = i / n; kc.QX[i] = MD[2 * i]; kc.QZ[i] = MD[2 * i + 1]; kc.QW[i] = 1 - 0.3 * f; kc.QA[i] = e * (1 - 0.5 * Math.abs(2 * f - 1) ** 3); }
        }
      }
      writeArc(kc, h, 1);
      // 2: a crackle leaping off the ball, in the air
      kc.QA.fill(0); kc.QY.fill(0.02);
      if (live0) {
        const az = 6.2832 * hash01(sd, 31), el = 0.9 * (hash01(sd, 32) - 0.35), len = (C.spark[0] + (C.spark[1] - C.spark[0]) * hash01(sd, 33)) * ka;
        const dx = Math.cos(az) * Math.cos(el), dy = Math.sin(el), dz = Math.sin(az) * Math.cos(el), r = BALL.r;
        const bx = PX[0], by = PY[0], bz = PZ[0]; // (the ball)
        for (let i = 0; i <= n; i++) { const f = i / n; PX[i] = bx + dx * (r + len * f); PY[i] = by + dy * (r + len * f); PZ[i] = bz + dz * (r + len * f); PO[i] = 1; }
        jag1(n, sd, 41, 1.0, JU, true); jag1(n, sd, 42, 1.0, JV, true);
        strand(kc, 0, n, 1, () => 0.22 * len, (f) => env * 0.9 * (1 - 0.8 * f) * (0.5 + 0.5 * flash), (f) => 0.8 - 0.5 * f);
      }
      writeArc(kc, h, 2);
      // 3..: where the ball lands, the note sparks
      for (let b = 0; b < C.sparks; b++) {
        kc.QA.fill(0); kc.QY.fill(0.02);
        if (l && tau <= C.sparkLife) {
          const e = fade * kb * sstep(0, 0.015, tau) * Math.exp(-tau / 0.1) * (1 - sstep(C.sparkLife - 0.08, C.sparkLife, tau)) * (1 + 0.6 * flash);
          const ang = 6.2832 * hash01(lo * 2 + h, 90 + b) + 0.6 * (2 * hash01(sdL, 95 + b) - 1), len = ka * (C.sparkLen[0] + (C.sparkLen[1] - C.sparkLen[0]) * hash01(sdL, 97 + b)), ca = Math.cos(ang), sa = Math.sin(ang);
          bolt(l.x + ca * ZAP.r0, -(l.y + sa * ZAP.r0 * 0.85), l.x + ca * (ZAP.r0 + len), -(l.y + sa * (ZAP.r0 * 0.85 + len)), n, sdL, 600 + 97 * b, EL.rough);
          for (let i = 0; i <= n; i++) { const f = i / n; kc.QX[i] = MD[2 * i]; kc.QZ[i] = MD[2 * i + 1]; kc.QW[i] = 1 - 0.6 * f; kc.QA[i] = e * (1 - 0.75 * f) * (i === n ? 0.15 : 1); }
        }
        writeArc(kc, h, 3 + b);
      }
      const v = lightOf(curCol[h], looks[h].ballHalo, 1, 1, 1), cc = zh.core.material.uniforms.uColor.value, hc = zh.halo.material.uniforms.uColor.value;
      cc.copy(v).lerp(WHITE, C.white); hc.copy(v);
      cc.multiplyScalar(C.lum / lumOf(cc)); hc.multiplyScalar(C.haloLum / lumOf(hc));
      zh.core.material.uniforms.uMinPx.value = C.minPx * pr; zh.halo.material.uniforms.uMinPx.value = C.haloPx * pr;
      zh.core.material.uniforms.uFade.value = zh.halo.material.uniforms.uFade.value = 1;
      for (const k of ARC_DYN) zh.geo.attributes[k].needsUpdate = true;
    }
  }
  // The glows as lights (GLINT): the next free one at world (x, y, z), radius r, colour col x k; into the 3D pieces'
  // uniforms (view space) and the lines' (world space).
  let glowN = 0, glowCam = null;
  const clamp01 = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; };
  // The balls' brightness b (BALLK) as gains: light = the light they throw, core and halo = the ball's own (all 1 at 0.5).
  const bkOut = { light: 1, core: 1, halo: 1, refl: 1 };
  function ballGain(b) {
    const lo = b < 0.5, g = Math.pow(lo ? BALLK.light[0] : BALLK.light[1], lo ? 1 - 2 * b : 2 * b - 1);
    bkOut.light = g; bkOut.core = lo ? g : 1 + BALLK.core * (g - 1); bkOut.halo = lo ? g : 1 + BALLK.halo * (g - 1); bkOut.refl = lo ? g : 1 + BALLK.refl * (g - 1);
    return bkOut;
  }
  function setGlow(x, y, z, r, col, k, shine = 1) {
    if (glowN >= GLOWS) return;
    const v = glU.uGL.value[glowN];
    v.set(x, y, z, 1).applyMatrix4(glowCam.matrixWorldInverse); v.w = r;
    lineU.uGW.value[glowN].set(x, y, z, r); glU.uGLC.value[glowN].copy(col).multiplyScalar(k); shineU.uGLS.value[glowN] = shine; // (shine: its share of the notes' shine, SHINE)
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
    return Math.max(X, Y, Z) - Math.min(X, Y, Z) - (paperTone.dark ? DARK[paperTone.dark].cornerSat : CORNER.sat) * (0.2126 * X + 0.7152 * Y + 0.0722 * Z);
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

  const lampPos = new THREE.Vector3(), lampQ = new THREE.Quaternion(), lampPose = { ...pose }, focusAt = new THREE.Vector3(); // (the Steady pose for the lamp)
  const keyDir = new THREE.Vector3(), edgeDir = new THREE.Vector3(), point = new THREE.Vector3(), out = { focus: 50, range: 0, sky: false, point, dof: 0, focusZ: 0 };
  const inkLinear = new THREE.Color(F ? F.line : paperTone.ink), bp = new THREE.Vector3();
  const faded = [...new Set([ink, headMat, restMat, face, chrome, fleck, pinMat, ...mirrored])];
  if (sh) paperU.uLight.value = sh.light.texture;
  // A paper colour (see PAPERS), straight into the uniforms and materials (no rebuild): its tints, texture, ink, and
  // the room the lacquer, chrome and finishes reflect.
  // (the finish's own settings for each of its parts, kept so that a light paper brings them back after a dark one)
  const parts = F ? [[ink, 'ink'], [headMat, 'ink'], [restMat, 'ink'], [face, 'face'], [chrome, 'wall'], [fleck, 'fleck']] : [];
  if (F && pinMat !== chrome && !parts.some(([m]) => m === pinMat) && F.pin !== 'chrome') parts.push([pinMat, 'pin']);
  const own = parts.map(([m]) => ({ color: m.color.clone(), roughness: m.roughness, metalness: m.metalness }));
  function applyPaper(pt) {
    paperTone = pt;
    const dk = pt.dark ? DARK[pt.dark] : null, FD = F && dk ? F.dark || {} : null;
    paperU.uTintNear.value.copy(tintOf(pt.near)); paperU.uTintFar.value.copy(tintOf(pt.far)); paperU.uCap.value = LIGHT.cap * pt.expo;
    paperU.uLook.value.set(pt.tone[0], pt.tone[1], SHADE.bump * pt.grain, pt.marble ? 0 : SHADE.cockle); // (polished stone lies flat)
    // a dark paper (DARK): light ink, its lamp, softer marks of the glows, the satin sheen
    darkOn(!!dk);
    paperU.uShade.value.x = dk ? dk.amb : SHADE.amb;
    const pol = !dk && pt.polish; // (light marble's polish: its mirror of the lit notes and its sheen, as a dark paper's)
    paperU.uDark.value.set(dk ? dk.pool : 1, dk ? dk.corner : 1, dk ? dk.sheen : pol ? pol[2] : 0, dk ? dk.room : pol ? pol[3] : 0);
    // marble: its veins (MARBLE), their colour over the stone's
    marbleOn(!!pt.marble);
    if (pt.marble) {
      // the veins' colour (linear; THREE.Color reads the hex as sRGB) over the stone's own in full light (its tint at the
      // paper's peak, cap x expo, as the shader lights it), channel by channel
      const mb = pt.marble, tn = tintOf(pt.near), vc = new THREE.Color(mb.vein), sl = (c, t) => c / Math.max(1e-4, srgbLin(Math.min(1, LIGHT.cap * pt.expo * t)));
      paperU.uVein.value.set(sl(vc.r, tn.x), sl(vc.g, tn.y), sl(vc.b, tn.z));
      paperU.uMarble.value.set(1 / mb.size, mb.warp, mb.w[0], mb.w[1]); paperU.uMarbleK.value.set(...mb.k); paperU.uMarbleU.value.x = mb.under ?? 1;
    }
    if (dk || pol) { const pk = LIGHT.cap * pt.expo, tn = tintOf(pt.near), tf = tintOf(pt.far); paperU.uSheenC.value.set(srgbLin(pk * (tn.x + tf.x) / 2), srgbLin(pk * (tn.y + tf.y) / 2), srgbLin(pk * (tn.z + tf.z) / 2)); }
    paperU.uRefl.value.set(REFL.k * (dk ? dk.refl : pol ? pol[0] : 1), dk ? dk.gloss : pol ? pol[1] : REFL.gloss, 0, REFL.narrow);
    haloU.uDim.value = dk ? dk.haloDim : GLOW.dim;
    if (!F) {
      ink.color.set(pt.ink); headMat.color.set(pt.ink); restMat.color.set(pt.ink); inkLinear.set(dk ? dk.line : pt.ink);
      face.color.set(dk ? dk.face : PAL.face); face.roughness = dk ? dk.faceRough : 0.1;
    } else {
      parts.forEach(([m, k], i) => { const o = own[i], d = (FD && FD[k]) || {}; if (d.color) m.color.set(d.color); else m.color.copy(o.color); m.roughness = d.roughness ?? o.roughness; m.metalness = d.metalness ?? o.metalness; });
      inkLinear.set((FD && FD.line) || F.line);
    }
    mirrored[0].color.copy(face.color); mirrored[0].roughness = Math.max(0.45, face.roughness);
    const win = FD && FD.win != null ? FD.win : F && F.win, room = FD && FD.room != null ? FD.room : F && F.room;
    const e0 = paperEnv(renderer, pt), e1 = F ? paperEnv(renderer, pt, win, room) : e0;
    if (e0) for (const m of faded) { const e = m.userData.win ? e1 : e0; if (m.envMap !== e) { m.envMap = e; m.needsUpdate = true; } }
  }
  applyPaper(paperTone);
  // what the last frame drew, for checking it from outside: the balls' centres (world), whether each is shown, the fades
  const probe = { balls: [new THREE.Vector3(), new THREE.Vector3()], shown: [false, false], corner: 'off', sparks: 0, fade: 1, ballFade: 1, tc: layout ? layout.tc : null, tEnd: layout ? layout.tEnd : null, camera: null, t: 0, glows: 0 };
  function render(t, camera, o = {}) {
    pickCam(o.camMove); // (a moving camera chosen on purpose moves even with the gentle movement off: that only calms Steady)
    const c = camFor(camera.aspect, o.motion !== false || cineOn), live = !!o.live || !S, L = live ? liveLayout : layout;
    if (camera.fov !== c.fov || camera.near !== NEAR || camera.far !== FAR) { camera.fov = c.fov; camera.near = NEAR; camera.far = FAR; camera.updateProjectionMatrix(); }
    printed.visible = !live; liveGroup.visible = live;
    if (printedPools) printedPools.visible = !live;
    if (LG.pools) LG.pools.visible = live;
    if (live) liveBase = Math.floor(t / LIVE.period) * LIVE.period;
    const p = place(camera, L, t, c);
    camera.updateMatrixWorld();
    if (live) drawLive(o.live || NONE, p.x, c.live || 0);
    // the end: the picture fades to black, the balls last (smoothly in what the eye sees, so as linear light ^2.2)
    // (and at the start it fades in from black, smoothly too; not in live playing)
    const fIn = L === layout ? sstep(OPENING.start, OPENING.start + OPENING.fadeIn, t) : 1;
    const fS = fIn * (1 - sstep(L.f0, L.f1, t)), fB = fIn * (1 - sstep(L.f0 + ENDING.ballLag, L.f1, t));
    const linS = Math.pow(fS, 2.2), linB = Math.pow(fB, 2.2) * (paperTone.dark ? linS : 1); // (on dark paper the balls and their light go with the rest: no points of light left in the dark)
    // the light pool and the key light travel with the camera: with the Steady camera (the cinematic camera keeps
    // them where the Steady camera has them, so the picture's brightness and the shadows do not swing as it moves;
    // reflections, glints and sheen still follow the real camera, uCam)
    let sp = p, lamp = camera.position, reach = 1;
    if (p.cine > 0) { cineOn = false; poseAt(L, t, c, camera.aspect, lampPos, lampQ, lampPose); cineOn = true; sp = lampPose; lamp = lampPos; reach = 1 + CINE.lowLam[0] * p.cine * (1 - s5(CINE.lowLam[1], CINE.lowLam[2], p.tilt)); }
    paperU.uCam.value.copy(camera.position); paperU.uLamp.value.copy(lamp);
    paperU.uDn.value = sp.dNear; paperU.uLam.value = sp.lam * reach; paperU.uVn.value = LIGHT.vNear * paperTone.expo * Math.pow(LIGHT.h0 / Math.max(1, sp.hl), LIGHT.hExp);
    paperU.uFade.value = linS;
    if (paperTone.dark) { // a dark paper's lamp (DARK.lamp): a narrower fall-off and its round pool round the place where the music is played
      const lp = DARK[paperTone.dark].lamp;
      paperU.uLam.value = lp.lam * sp.h * reach;
      lampU.uLampA.value.set(paperU.uVn.value, sp.dNear, paperU.uLam.value, paperU.uCap.value);
      lampU.uSpot.value.set(sp.x + lp.fwd, -c.y, 1 / (lp.R * lp.R), lp.floor); lampU.uSpotB.value = 1 / (lp.along * lp.along);
      csU.uCSV.value.copy(camera.matrixWorld);
    }
    paper.position.set(camera.position.x, 0, camera.position.z);
    // (the texture's place counted from a whole number of its larger tiles, so its numbers stay small)
    paperU.uOrigin.value.set(Math.floor(camera.position.x / GRAIN.toneTile) * GRAIN.toneTile, Math.floor(camera.position.z / GRAIN.toneTile) * GRAIN.toneTile);
    const az = (c.yaw + LIGHT.off) * DEG, el = LIGHT.elev * DEG; // fixed for each camera: the shadows never swim
    keyDir.set(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    paperU.uKey.value.copy(keyDir);
    point.set(sp.x, 0, -c.y);
    key.target.position.copy(point); key.position.copy(point).addScaledVector(keyDir, 60);
    edgeDir.subVectors(lamp, point).normalize(); edgeDir.x = -edgeDir.x;
    edge.target.position.copy(point); edge.position.copy(point).addScaledVector(edgeDir, 60);
    key.intensity = LIGHT.key * linS; edge.intensity = LIGHT.edge * linS; ambient.intensity = 0.05 * linS;
    for (const m of faded) m.envMapIntensity = (m.userData.env ?? 1) * linS;
    if (o.res) lineU.uRes.value.copy(o.res);
    lineU.uMinPx.value = 1.15 * (o.pr || 1);
    lineU.uColor.value.copy(inkLinear).multiplyScalar(linS);
    // the lit notes: every head played by now (its time <= t) glows, for good, and lights the paper around it
    glowU.uTime.value = live ? -1e9 : t; glowU.uFade.value = linS;
    for (let h = 0; h < 2; h++) poolU.uColor.value[h].copy(tintOfHand(h));
    out.focus = camera.position.distanceTo(focusAt.set(p.x, 0, -c.y));
    // the cinematic camera: a lens focused on the place being played (out.dof: how much of it, 0 for the Steady
    // camera; focusZ: that place's depth in front of the camera), and far lines fading only beyond its own distance
    out.dof = p.dof; out.focusZ = p.focus; out.range = p.dist * CINE.dof.range;
    { const ex = p.cine * Math.max(0, p.dist - 55); lineU.uFar0.value = 70 + ex; lineU.uFar1.value = 130 + 1.3 * ex; }
    glowN = 0; glowCam = camera;
    // the notes' shine (SHINE) and the balls' brightness (BALLK), from the app's two sliders
    const sh01 = clamp01(o.shine ?? SHINE.def), bk = ballGain(clamp01(o.ballK ?? BALLK.def));
    shineU.uShine.value.set(SHINE.k * Math.pow(sh01, SHINE.p), SHINE.rough[0] + (SHINE.rough[1] - SHINE.rough[0]) * sh01, SHINE.dome, SHINE.haze[1] * sh01 * sh01);
    lineU.uGlint.value.set(FX.lineGlow[0] * (1 + SHINE.line[0] * sh01), FX.lineGlow[1] * (1 + SHINE.line[1] * sh01));
    lineU.uMax.value = lineMax + (Math.max(lineMax, SHINE.lineCap) - lineMax) * sh01;
    // the balls, their reflections, their light on the paper and on everything that shines, their shadows and trails
    for (let hand = 0; hand < 2; hand++) {
      const m = balls[hand], shown = !live && o.paths !== false && linB > 0 && ballAt(hand, t, L, c, camera.aspect, bp);
      const pb = paperU.uBall.value[hand], tr = trails[hand], trailOn = shown && !!o.trails;
      m.visible = shown; probe.shown[hand] = shown; tr.mesh.visible = tr.pool.visible = trailOn;
      if (!shown) { pb.w = 0; continue; }
      probe.balls[hand].copy(bp); // (also where its shadow is cast from)
      m.position.copy(bp); ballU[hand].uAlpha.value = linB; ballU[hand].uGain.value.set(bk.core, bk.halo);
      pb.set(bp.x, bp.y, bp.z, BALL.r);
      paperU.uBallColor.value[hand].copy(looks[hand].refl).lerp(WHITE, POOL.ball.pale).multiplyScalar(linB * bk.refl);
      paperU.uPoolColor.value[hand].copy(ballTint[hand]).lerp(WHITE, POOL.ball.pale).multiplyScalar(linB * bk.refl);
      setGlow(bp.x, bp.y, bp.z, GLINT.r.ball, paperU.uPoolColor.value[hand], GLINT.k.ball * bk.light / bk.refl); // (its pale light, as above: already faded)
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
        if (w > 0) setGlow(n.x, GLINT.lift, -n.y, GLINT.r.note, tint[hand], GLINT.k.note * w * linS, SHINE.note * sstep(0, SHINE.noteIn, t - n.t)); // (its shine eases in)
      }
    }
    probe.glows = glowN;
    for (let i = glowN; i < GLOWS; i++) { glU.uGL.value[i].w = 0; lineU.uGW.value[i].w = 0; }
    // the corner light and the powder sparks (both optional), set off by the touches
    const cs = Math.max(0, CORNER.ids.indexOf(o.corner)), np = Math.round(Math.min(1, Math.max(0, Number(o.sparks) || 0)) * SPARK.max);
    if (cs || np) touches(t, live, np, linB);
    if (cs) corner(cs, camera, o.pr || 1, linS, Math.min(1, Math.max(0, o.cornerK ?? 0.5))); else cornerOff();
    const zk = clamp01(o.zap ?? 0); // the electric notes (optional)
    if (zk > 0 && linB > 0) zap(t, live, camera, o.pr || 1, linB, zk); else zapOff();
    probe.zap = zk;
    const ck = clamp01(o.current ?? 0); // the current with the balls (optional; only with the balls, never in live playing)
    if (ck > 0 && !live && o.paths !== false && linB > 0) current(t, L, c, camera, o.pr || 1, linB, ck); else currentOff();
    probe.current = ck;
    // the cracks of light in the notes (optional)
    const crk = clamp01(o.cracks ?? 0);
    crackOn(crk > 0 && !!S);
    if (crk > 0 && S) {
      crackU.uCrK.value.set(crk, CRACK.cells, CRACK.hz, linS); crackU.uCrT.value = live ? 1e9 : t; crackU.uCrL.value.set(S.t0, S.start, S.speed, (TOP[1] + BOTTOM[0]) / 2);
      for (let h = 0; h < 2; h++) full(crackU.uCrC.value[h], looks[h].halo).multiplyScalar(CRACK.gain);
    }
    probe.cracks = crk;
    sparkMesh.visible = sparkPool.visible = np > 0;
    if (np) {
      sparkGeo.instanceCount = np * 2 * SPARK.slots; sparkMU.uMinPx.value = SPARK.minPx * (o.pr || 1); sparkMU.uFade.value = linB;
      for (let h = 0; h < 2; h++) sparkU.uCol.value[h].copy(ballTint[h]);
    }
    probe.corner = CORNER.ids[cs]; probe.sparks = np;
    // the shadows of everything raised, in a window of the page that steps along in whole texels, and the glows' light
    // on the paper over the same window
    const mk = camera.aspect < 1 ? MASK.tall : MASK.wide, pad = cineOn && !live && c.yawAmp ? CINE.shadowPad : 1, mW = mk.W * pad, texel = mW / MASK.texels[0]; // (wider for the cinematic camera's high views, the same all through its piece)
    drawShadows(Math.floor((p.x - mk.back * pad) / texel) * texel, mW, (paperTone.dark ? DARK[paperTone.dark].ball : SHADE.ball) * linB, probe.balls, probe.shown);
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

  return { scene, render, setHands, setPaper, paperId: () => paperTone.id, finish: fid, bloom: { get pass() { return paperTone.dark ? DARK[paperTone.dark].bloom : GLOW.bloom; }, mips: GLOW.bloomMips }, layout: S, heads, hands, balls, paths, ballAt: (hand, t, aspect = 16 / 9, p = new THREE.Vector3(), motion = true) => (layout && ballAt(hand, t, layout, camFor(aspect, motion), aspect, p) ? p : null),
    pose, probe, framing: frm, get cine() { return cine; }, plans,
    // the camera's pose at music time t for a picture shape, without drawing (for checking the motion from outside)
    poseOf: (t, aspect, pos, quat, camMove = 'steady', motion = true) => { const keep = cineOn, keepPlan = cine; pickCam(camMove); const r = layout ? poseAt(layout, t, camFor(aspect, motion || cineOn), aspect, poseV, poseR, poseQ) : null; cineOn = keep; cine = keepPlan; if (r) { pos.x = poseV.x; pos.y = poseV.y; pos.z = poseV.z; quat.x = poseR.x; quat.y = poseR.y; quat.z = poseR.z; quat.w = poseR.w; } return r; }, uniforms: { paper: paperU, line: lineU, glow: glowU, halo: haloU, glows: glU, pool: poolU, balls: ballU }, lights: { key, edge, ambient }, trails,
    materials: { ink, head: headMat, face, chrome, fleck, pin: pinMat, paper: paperMat, line: lineMat }, printed, camX: (t) => camX(layout || liveLayout, t), timing: layout };
}
