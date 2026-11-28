// The 3D scene: a lacquered piano with jewel-coloured notes travelling toward the keys they play.
// Everything is a pure function of the music time t, so a video export draws exactly what playback shows.
import * as THREE from '../vendor/three.min.js?v=7';
import { isBlack, noteName } from './midi.js?v=13';
import { buildFlight, voicesFromPiece } from './flight.js?v=14';
import { buildDancer } from './dancer.js?v=9';
import { buildScore } from './score.js?v=20';
import { buildSheet } from './sheet.js?v=9';
import { buildPaper, HAND_PAIRS, PAPERS, PAPER_DEFAULT, FINISHES, FINISH_DEFAULT, CORNER_STYLES, CAM_MOVES, SHINE_DEFAULT, CAM, stillFit } from './paper.js?v=80'; // v80: the play point past the middle (openAt glide, centred shadow window)
import { loadGlyphs } from './glyphs.js?v=2';
import { buildKeys } from './keys.js?v=84';   // v84: curl fix (the curl limit kept on near the keys and in fast passages: a free finger never curls more than it plays; fingertips no longer dip into each black key as the hand slides across them); v83: curl round (a curl limit: free fingers a gentle arch, never a claw; strikes and holds not hooked); v82: fingers round 2 (the hand leans toward a key out of reach at the strike, no snap as a finger lets go, fingers never fold under the hand); v81: fingers round 1 (a held note let go early instead of a finger stretched straight, free fingers within their spread, strikes out of reach moved to the key's front); v80: posture fixes (fingers only as deep between the black keys as they fit), the Black keys setting; v79: hand posture (lyrical, classical, auto), black keys as on a real piano; v78: hand proportions (longer, slimmer fingers, a smaller palm); v77: S5 review fixes (no finger snaps, hand-over-hand crossings); v76: hand motion S5 (two hands); v75: S0-S4 + all the view work (framing, dark notes, appear, play point, hands look, piano side)
import { buildBeams } from './beams.js?v=45'; // v45: the bursts at the keys in their own sprites, the puff's core capped

const THEMES = {
  aurora: { bg: ['#000000', '#01030a'], fog: '#000103', runway: '#020304', trim: '#3dffa0', led: '#35ff8a', ledLight: 1.1, dim: 0.3, felt: '#06301c', white: '#eef5f1', black: '#050607',
    notes: ['#2f9bff', '#30f0d0', '#b57bff', '#ffd45a'], label: '#f2f9ff', glow: 0.72, bloom: [0.62, 0.6, 0.82], additive: true, mirror: 0.3, outline: true, env: 0.07 },
  ember: { bg: ['#000000', '#0a0204'], fog: '#030001', runway: '#040203', trim: '#ffb24a', led: '#ff8a2a', ledLight: 1.1, dim: 0.3, felt: '#3a0d10', white: '#f6efe8', black: '#070505',
    notes: ['#ff4fa3', '#ffc23d', '#8f7bff', '#4fe0ff'], label: '#fff6ee', glow: 0.72, bloom: [0.62, 0.6, 0.82], additive: true, mirror: 0.3, outline: true, env: 0.07 },
  noir: { bg: ['#020203', '#1a0d10'], fog: '#0a0608', runway: '#050507', trim: '#e2b659', felt: '#8a1228', white: '#f7f1e6', black: '#0a0a0c',
    notes: ['#ffc24d', '#ff4f86', '#2fe3b0', '#5b9bff'], label: '#170a05', glow: 1.0, bloom: [0.5, 0.5, 0.92], additive: true, mirror: 0.2 },
  jewel: { bg: ['#03061a', '#1c0a33'], fog: '#0a0820', runway: '#050818', trim: '#f0d07a', felt: '#5d1a78', white: '#f4f1fb', black: '#0a0b16',
    notes: ['#3fd8ff', '#ff62d0', '#ffd24d', '#7dffb0'], label: '#0b0620', glow: 1.0, bloom: [0.55, 0.55, 0.92], additive: true, mirror: 0.22 },
  emerald: { bg: ['#010806', '#0b2417'], fog: '#04100b', runway: '#030a07', trim: '#e8c56a', felt: '#0e6b45', white: '#f5f3e8', black: '#080b09',
    notes: ['#35f0a0', '#ffcf5a', '#ff6b9a', '#7fd0ff'], label: '#04140d', glow: 1.0, bloom: [0.55, 0.55, 0.92], additive: true, mirror: 0.22 },
};

// Notes as water: each one is a stream of light that wanders a little far away, runs straight as it nears its key,
// narrows and brightens as it pours in. Drawn by a small program on the graphics card, on a flat strip per note.
const WATER_VERT = 'varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const WATER_FRAG = `
uniform float uTime, uLen, uHalf, uPlane, uPhase, uGain, uFar, uKind; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vW;
void main() {
  float near = -vW.z;                                   // distance still to travel to the keys
  if (near < 0.1) discard;
  float d = vUv.y * uLen, e = uLen - d;                 // distance from the leading end, and from the trailing end
  float pour = 1.0 + 0.5 * smoothstep(1.5, 0.1, near);
  float fade = smoothstep(uFar, uFar * 0.55, near);
  if (uKind > 0.5) {
    // A trail of light: a round bright head that reaches the key first, and a straight tail that thins and dims behind it.
    float x = (vUv.x - 0.5) * 2.0 * uPlane;
    float along = clamp(d / max(uLen, 0.001), 0.0, 1.0);
    float w = uHalf * mix(0.62, 0.16, pow(along, 0.8)) * sqrt(clamp(e / 0.2, 0.0, 1.0));
    float tail = exp(-2.6 * x * x / max(w * w, 0.00001)) * mix(0.9, 0.2, along) * smoothstep(0.0, 0.18, d);
    tail *= 0.86 + 0.14 * sin(d * 2.4 + uTime * 5.0 + uPhase);                         // a slow shimmer running down the tail
    float hr = uHalf * 0.78, hd = d - hr;                                              // the head: a soft ball of light
    float head = exp(-2.2 * (hd * hd + x * x) / (hr * hr));
    float I = max(tail, head);
    if (I < 0.01) discard;
    vec3 c = uColor * I * 0.95 + vec3(1.0) * pow(head, 3.0) * 0.28 + uColor * pow(tail, 4.0) * 0.2;
    gl_FragColor = vec4(c * uGain * pour * fade, 1.0);
    return;
  }
  float flow = uTime * 2.6 + uPhase;
  float calm = smoothstep(0.6, 7.0, near);
  float wob = calm * (0.1 * sin(vW.z * 0.36 + flow * 0.7) + 0.035 * sin(vW.z * 0.8 - flow * 1.1));
  float w = uHalf * (0.86 + 0.14 * calm * sin(vW.z * 0.8 + flow * 1.2));
  w *= sqrt(clamp(d / 0.28, 0.0, 1.0)) * mix(0.3, 1.0, smoothstep(0.0, min(1.6, uLen * 0.7), e)) * sqrt(clamp(e / 0.12, 0.0, 1.0)); // a round head, a tail drawn out thin
  w *= mix(0.6, 1.0, smoothstep(0.1, 1.4, near));       // the pour narrows into the key
  float x = (vUv.x - 0.5) * 2.0 * uPlane - wob;
  float r = abs(x) / max(w, 0.0001);
  float body = smoothstep(1.0, 0.62, r);
  if (body <= 0.003) discard;
  float rim = smoothstep(0.5, 0.86, r) * smoothstep(1.0, 0.86, r);                       // the bright edge of a bead of water
  float glint = pow(0.5 + 0.5 * sin(d * 0.9 + uTime * 3.2 + uPhase), 4.0) * smoothstep(0.6, 0.0, r); // highlights sliding toward the keys
  vec3 c = uColor * (0.42 * body + 0.7 * rim) + mix(uColor, vec3(1.0), 0.5) * glint * 0.45;
  gl_FragColor = vec4(c * uGain * pour * fade, 1.0);
}`;
const SPEED = 9; // runway units per second; one unit = one white key width
const A0 = 21, C8 = 108, DECK = 0.7; // DECK = height of the runway surface

function keyX(p) {
  let n = 0;
  for (let i = A0; i < p; i++) if (!isBlack(i)) n++;
  return (isBlack(p) ? n - 0.5 : n) - 25.5;
}
const KX = Array.from({ length: 128 }, (_, p) => (p >= A0 && p <= C8 ? keyX(p) : 0));
const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }; // repeatable "random"
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Depth of field, as a camera lens gives it: sharp where the music is being played, softer nearer and further away.
// Each pixel's distance comes from the depth the graphics card recorded while drawing the scene, so a ball flying
// above the glass is judged by its own distance, not by the glass behind it. Each pixel gathers its neighbours on a
// spiral; a neighbour only spreads into it if its own blur is wide enough to reach, so sharp things do not smear.
const DOF_FRAG = `
uniform sampler2D tDiffuse, tDepth; uniform vec2 uRes; uniform float uFocus, uRange, uMax, uSky, uNear, uFar, uTaps;
varying vec2 vUv;
float blurAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 0.99999) return uMax * uSky; // nothing drawn there but the sky: kept nearly sharp, so stars stay stars
  float z = (uNear * uFar) / (uFar - d * (uFar - uNear)); // distance in front of the camera
  float c = clamp((abs(z - uFocus) - 3.0) / uRange, 0.0, 1.0);
  return c * c * uMax;
}
void main() {
  vec4 sum = texture2D(tDiffuse, vUv);
  float r = blurAt(vUv), w = 1.0;
  if (r > 0.6) {
    for (int i = 0; i < 36; i++) {
      if (float(i) >= uTaps) break; // (36 in the night look; fewer on paper, where the blur is smaller)
      float a = float(i) * 2.39996323, rr = sqrt((float(i) + 0.5) / uTaps) * r;
      vec2 uv2 = vUv + vec2(cos(a), sin(a)) * rr / uRes;
      float k = clamp(blurAt(uv2) - rr + 1.0, 0.0, 1.0);
      sum += texture2D(tDiffuse, uv2) * k; w += k;
    }
  }
  gl_FragColor = sum / w;
}`;
const DOF_PAPER = 0.004; // the cinematic paper camera's widest blur, as a share of the picture's shorter side
function depthOfField() {
  const material = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: 20 }, uRange: { value: 9 }, uMax: { value: 0 }, uSky: { value: 1 }, uNear: { value: 0.5 }, uFar: { value: 600 }, uTaps: { value: 36 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: DOF_FRAG, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad.frustumCulled = false;
  return { enabled: false, needsSwap: true, clear: false, renderToScreen: false, material,
    setSize(w, h) { material.uniforms.uRes.value.set(w, h); },
    render(renderer, writeBuffer, readBuffer) { material.uniforms.tDiffuse.value = readBuffer.texture; material.uniforms.tDepth.value = readBuffer.depthTexture; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); renderer.render(quad, cam); },
    dispose() { material.dispose(); quad.geometry.dispose(); } };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 600);
  const env = new THREE.PMREMGenerator(renderer).fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  // Drawn first into a multisampled picture, so thin lines (staff lines, stems) are smooth instead of jagged.
  const target = new THREE.WebGLRenderTarget(960, 540, { type: THREE.HalfFloatType, samples: 4 });
  target.depthTexture = new THREE.DepthTexture(960, 540); // the depth of every pixel, for the depth of field
  const composer = new THREE.EffectComposer(renderer, target);
  const renderPass = new THREE.RenderPass(new THREE.Scene(), camera);
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(960, 540), 0.6, 0.5, 0.8);
  const dof = depthOfField();
  composer.addPass(renderPass); composer.addPass(dof); composer.addPass(bloom); composer.addPass(new THREE.OutputPass());
  const bloomMips = [...bloom.compositeMaterial.uniforms.bloomFactors.value];
  // The "Sheet music + hands" picture: the paper's sheet music in the top part, the keyboard and hands in the bottom part
  // (on a backdrop of the same paper), and the light between them over the whole picture. One pass draws all three.
  const camKeys = new THREE.PerspectiveCamera(30, 1, 0.5, 600), camPaper = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
  // top: the share of the picture's height the sheet music is framed in, per picture shape (the paper carries on below
  // it, behind the keys); overlap: how far the keys' part reaches up into it; drop: how far that part is lowered from
  // the top edge (shares of the height; 0 since the music was moved up again, with FLAT.margin, so the glass bubbles
  // rise further below it; the opening shot keeps it clear of the keys, see OPEN)
  const SPLIT = { wide: 0.6, tall: 0.5, overlap: 0.1, drop: { wide: 0, tall: 0 } };
  // how far the glass bubbles rise, per picture shape: where they start to fade and where they are gone, as shares of
  // the way from the keys up to just under the lowest music near the picture (beams.js; near: see riseTo; min: at
  // least this far above the line of light, share of the height).
  const RISE = { wide: [0.4, 0.92], tall: [0.35, 0.88], near: { reach: 16, k: 0.5, gap: 0.015, min: 0.03 } };
  // The opening shot over the music (paper.js openFit, openBox): from the first picture until the shot has eased into
  // the steady framing, the title and all the printed music in the picture's width stay above the keyboard, at least
  // `m` of the picture's height clear of its top edge (highest over the opening, as the tall picture's keys follow the
  // hands); the title may rise to the picture's top edge (paper.js keeps its usual margin there).
  const OPEN = { m: 0.025 };
  // The sheet music above the keys: the camera looks down on the page from nearly overhead, so the staves run level and
  // the music travels from left to right (the place being played a little past the middle, `at` 57% of the way in, so
  // more of what has just been played shows; the opening starts it at openAt, a third of the way in, and glides it out,
  // see paper.js openAtW; titleHold: the opening's title stays under the picture's top edge until that many seconds
  // after the first note, as the shot eases out to the music now standing higher, see paper.js openFit). It
  // keeps one height and centres on one page height for the whole piece (stillFit, from how low and high the piece's
  // music reaches, its channel name included), so nothing is ever cut at the top and the page never drifts. h: the
  // height for the size wanted (wide: about 19 px a staff space at 1080p; tall: about 24 at 1080 wide), higher when a
  // piece's music would not fit; margin: [top, bottom] room kept in the music's part (shares of its height: less above
  // than below, so the music stands high in the picture, its highest note about 4-5% of the height under the top edge);
  // lampH: the lamp stays where the designed camera has it, so standing higher does not dim the paper; far: the thin
  // lines fade only further off than the camera's own distance; mask: the shadows' window (ss), centred on the picture
  // whatever `at` is, and as wide as the widest opening shot;
  // inkLift: the ink's shadow cast from nearer its real height, so that seen from overhead a shadow stays a thin soft
  // edge beside its note instead of a grey copy of each stem and beam (a steeper key light would shorten it too, but
  // its highlight then turns the noteheads grey).
  const FLAT_BASE = { ...CAM.tall, yaw: 90, yawAmp: 0, hAmp: 0, tilt: 80, fov: 36, at: [0.57, 0.5], openAt: 0.34, titleHold: 2, lampH: 24, far: [140, 220], mask: { centre: true, W: 180 }, inkLift: 1 };
  const FLAT = { wide: { ...FLAT_BASE, h: 54.8, margin: [0.045, 0.075] }, tall: { ...FLAT_BASE, h: 55, margin: [0.06, 0.05] } };
  let flat = { ...FLAT }; // (fitted to the piece when its scene is built)
  // Over the music, under this level overhead camera: the paper's corner shade kept to its corner (its reach halved),
  // and the room's darkness away from the music starting only above the picture's top (paper.js DARKNESS), so neither
  // lies as a dark band across the top; the light trails leave out the leaps, whose hops lie flat from overhead and
  // would draw straight lines across the staves (paper.js TRAIL.leap).
  const FLAT_SHADE = { reach: 2, music: [-7, -1, 26, 40] };
  const TALL_TITLE_W = 46; // (ss: the 3D title's widest line in the tall picture)
  // The powder and the flash at a struck key in the hand pictures (the Look tab's "Powder at the keys" and "Flash at the
  // keys"): a slider's value s (0 .. 1) as a multiple of their usual strength: 0 none, `usual` the strength they had
  // before the sliders, rising to `max` times it at 1; the default, `def`, a little stronger than usual (1.5 times).
  // Above `usual` it eases off (1 - (1 - v)^ease of the way up, v the share of the way along the slider; `ease` keeps
  // the default at 1.5 times), so each step adds less than the one before: 0.7 is 1.92 times, 0.85 is 2.23 times and
  // 1 is 2.4 times (a straight line to 3 times made the step from 0.8 to 1 a big jump into a clipped white cloud).
  const AT_KEYS = { usual: 0.4, max: 2.4, def: 0.55, ease: 1.536 };
  const atKeys = (s) => (s <= AT_KEYS.usual ? s / AT_KEYS.usual
    : 1 + (AT_KEYS.max - 1) * (1 - (1 - (s - AT_KEYS.usual) / (1 - AT_KEYS.usual)) ** AT_KEYS.ease));
  // the camera over the music for this picture shape, with its openBox (see OPEN): worked out once per shape and scene,
  // from the shares in SPLIT (not the rounded pixels), so every size of one shape frames the opening alike
  let openCam = { key: '', flat: null, keys: null, cam: null };
  const camPeek = new THREE.PerspectiveCamera(30, 1, 0.5, 600), edgeV = new THREE.Vector3();
  function flatCam(tall, W, H) {
    const key = (W / H).toFixed(6);
    if (openCam.key === key && openCam.flat === flat && openCam.keys === S.keysView) return openCam.cam;
    const top = tall ? SPLIT.tall : SPLIT.wide, drop = tall ? SPLIT.drop.tall : SPLIT.drop.wide, kb = 1 - top + SPLIT.overlap;
    camPeek.aspect = W / (H * kb); camPeek.updateProjectionMatrix();
    const t1 = S.paper.timing ? S.paper.timing.t1 : 0;
    let yk = 0; // (the keyboard's top edge, share of the height from the bottom)
    for (let t = Math.min(-1.5, t1 - 1.5); t <= t1 + 6; t += 0.5) { S.keysView.place(t, camPeek); S.keysView.topEdge(edgeV).project(camPeek); yk = Math.max(yk, (edgeV.y * 0.5 + 0.5) * kb); }
    const ndc = (y) => (2 * (y - (1 - drop - top))) / top - 1; // (a height in the picture, share from the bottom, in the music's part: -1 its bottom, 1 its top)
    const cam = { ...(tall ? flat.tall : flat.wide), openBox: { floor: ndc(yk + OPEN.m), top: ndc(1) - 0.1 } };
    openCam = { key, flat, keys: S.keysView, cam };
    return cam;
  }
  const splitPass = { enabled: true, needsSwap: false, clear: false, renderToScreen: false, t: 0, opts: null,
    setSize() {}, dispose() {},
    render(r, writeBuffer, readBuffer) {
      const W = readBuffer.width, H = readBuffer.height, tall = W < H;
      const top = tall ? SPLIT.tall : SPLIT.wide, hb = Math.round(H * (1 - top + SPLIT.overlap)), ht = Math.round(H * top), dy = Math.round(H * (tall ? SPLIT.drop.tall : SPLIT.drop.wide));
      const keepAuto = r.autoClear;
      r.setRenderTarget(readBuffer); r.setClearColor(0x000000, 1); r.clear();
      readBuffer.scissorTest = true;
      // the sheet music
      // the paper fills the whole picture: its camera frames the music in the top part, and the same page simply
      // carries on down behind the keys (the same grain and fibres; only the darkness over it differs)
      camPaper.aspect = W / ht; camPaper.clearViewOffset();
      // (each note lit whole as it is played, unless the cracks of light are chosen; the thin lines, trails and the
      // corner shade sized for the whole picture as drawn; drawn at full light, the whole picture faded at the end)
      S.paper.render(this.t, camPaper, { ...this.opts, res: bufSize.set(W, H), fade: false, cam: flatCam(tall, W, H), camMove: 'steady', cracks: S.cracks > 0 ? S.cracks : 0.85, crackSolid: !(S.cracks > 0), shadeFit: FLAT_SHADE, trailLeap: true });
      camPaper.setViewOffset(W, ht, 0, -dy, W, H);
      readBuffer.viewport.set(0, 0, W, H); readBuffer.scissor.set(0, 0, W, H); r.setRenderTarget(readBuffer);
      r.render(S.paper.scene, camPaper);
      // the keys and hands
      r.autoClear = false;
      camKeys.aspect = W / hb; camKeys.updateProjectionMatrix();
      S.keysView.render(this.t, camKeys, { effects: S.effects, motion: S.motion, powder: atKeys(S.powder), flash: atKeys(S.flash) });
      readBuffer.viewport.set(0, 0, W, hb); readBuffer.scissor.set(0, 0, W, hb); r.setRenderTarget(readBuffer);
      r.clearDepth(); r.render(S.keysView.scene, camKeys);
      // the light between them
      readBuffer.viewport.set(0, 0, W, H); readBuffer.scissor.set(0, 0, W, H); readBuffer.scissorTest = false; r.setRenderTarget(readBuffer);
      // (and the fade in at the start and out at the end, over everything: smooth to the eye, as linear light ^2.2)
      S.beamFeed(this.t, { W, H, ht, hb, dy, fade: Math.pow(S.paper.probe.fade, 2.2) });
      r.clearDepth(); r.render(S.beams.scene, S.beams.cam);
      r.autoClear = keepAuto;
    } }; // how much each blur size adds (the paper look keeps only the small ones)

  const clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]; // hide the part of a note that has passed the keys
  const dot = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
  const beamTex = canvasTex(32, 128, (g, w, h) => { const r = g.createLinearGradient(0, h, 0, 0); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.25, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const S = { sleeves: true, powder: AT_KEYS.def, flash: AT_KEYS.def, look: 'paper', title: null, composer: '', mark: '', glyphs: null, hands: 'rose', paperTone: PAPER_DEFAULT, finish: FINISH_DEFAULT, trails: false, corner: 'off', cornerK: 0.5, dark: 0, cornerDark: 0, sparks: 0, zap: 0, current: 0, cracks: 0, race: 0, ballStyle: 'light', camMove: 'steady', shine: SHINE_DEFAULT, ballK: 0.5, notes: 'trails', ribbon: true, dots: true, strip: 'notes', paths: true, sheet: null, sheetCam: 'side', glow: 0.45, sky: 'stars', landing: 'sparks', score: null, theme: 'aurora', camera: 'front', trail: null, pool: [], labels: true, effects: true, motion: true, piece: null, view: 'piano', voices: [], mic: null, flight: null, scene: null, keys: [], items: [], beams: [], live: new Map(), far: 60, cam: null };
  const labelMats = new Map(), ray = new THREE.Raycaster(), point = new THREE.Vector2(), bufSize = new THREE.Vector2();
  const paperLook = () => S.view === 'sheet' && S.look === 'paper';
  const paperIn = () => paperLook() || S.view === 'sheetkeys'; // (the pictures with the paper in them)
  // The paper look's 3D lettering needs the glyph outlines, which load in the background. Until they arrive the paper
  // is drawn plain; then the scene is built again. ready() resolves once they are in and the current scene is built.
  const glyphsLoaded = loadGlyphs().then((g) => { S.glyphs = g; if (paperLook() || S.view === 'sheetkeys') S.scene = null; }).catch((e) => { console.warn(e); });

  function labelMaterial(pitch, T) {
    const k = S.theme + pitch;
    if (!labelMats.has(k)) {
      const tex = canvasTex(128, 64, (g) => { g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.label; g.fillText(noteName(pitch), 64, 34); });
      labelMats.set(k, new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
    }
    return labelMats.get(k);
  }

  function build() {
    if (S.score) { S.score.dispose(); S.score = null; }
    camera.removeFromParent(); // only the piano picture carries the camera inside its scene
    if (S.old) S.old.traverse((o) => { if (o.isSprite) return; o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose(); });
    if (!paperLook() && (camera.fov !== 42 || camera.near !== 0.5 || camera.far !== 600)) { camera.fov = 42; camera.near = 0.5; camera.far = 600; camera.updateProjectionMatrix(); } // the paper look sets its own lens
    renderer.toneMapping = paperLook() ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; // paper: its colours are set exactly, nothing may tint or wash them out
    bloom.compositeMaterial.uniforms.bloomFactors.value = bloomMips;
    if (S.view === 'dancer') {
      S.dancer = buildDancer(THEMES[S.theme], { canvasTex, dot });
      [bloom.strength, bloom.radius, bloom.threshold] = [0.7, 0.5, 0.3];
      renderPass.scene = S.scene = S.old = S.dancer.scene;
      return;
    }
    dof.enabled = S.view === 'sheet' && !paperLook();
    if (paperLook()) {
      S.paper = buildPaper(THEMES[S.theme], { renderer }, S.piece, { title: S.title ?? (S.piece && S.piece.label) ?? '', composer: S.title === '' ? '' : S.composer, mark: S.mark, glyphs: S.glyphs, hands: S.hands, paper: S.paperTone, finish: S.finish });
      [bloom.strength, bloom.radius, bloom.threshold] = S.paper.bloom.pass; // tight, and only for what is brighter than white (the glows)
      bloom.compositeMaterial.uniforms.bloomFactors.value = S.paper.bloom.mips;
      renderer.toneMappingExposure = 1;
      renderPass.scene = S.scene = S.old = S.paper.scene;
      return;
    }
    if (composer.passes[0] !== renderPass) composer.passes[0] = renderPass;
    if (S.view === 'sheetkeys') {
      // (the tall picture is narrow: its 3D title is set narrower, on two lines when it is long)
      const tallPic = renderer.getSize(bufSize).x < bufSize.y;
      S.paper = buildPaper(THEMES[S.theme], { renderer }, S.piece, { title: S.title ?? (S.piece && S.piece.label) ?? '', composer: S.title === '' ? '' : S.composer, mark: S.mark, glyphs: S.glyphs, hands: S.hands, paper: S.paperTone, finish: S.finish, titleW: tallPic ? TALL_TITLE_W : 0 });
      // the camera over the music, fitted to this piece for each picture shape (see FLAT)
      const [lo, hi] = S.paper.musicSpan();
      flat = Object.fromEntries(Object.entries(FLAT).map(([k, c]) => [k, stillFit(c, lo, hi, c.margin[0], c.margin[1])]));
      const handColors = S.paper.hands.map((c) => c.clone());
      const tone = (PAPERS.find((p) => p.id === S.paperTone) || PAPERS[0]).swatch;
      S.keysView = buildKeys(THEMES[S.theme], { canvasTex, dot, env }, S.piece, { style: S.glass, handLook: S.handLook, handPosture: S.handPosture, keyLayout: S.keyLayout, sleeves: S.sleeves, combined: true, bars: S.combBars, keyRange: S.keyRange || 'piano', noBackdrop: true, handColors, floor: tone[0] });
      S.beams = buildBeams({ dot });
      // every note: the light leaves its head on the paper and its key at the same moment
      const heads = new Map();
      for (const h of S.paper.heads) { const hd = h.chord && h.chord.heads.find((q) => q.y === h.y); if (hd) heads.set(`${hd.pitch}@${h.t.toFixed(3)}`, h); }
      const proj = new THREE.Vector3(), kp = new THREE.Vector3(), kq = new THREE.Vector3(), kl = new THREE.Vector3();
      const evs = (S.piece ? S.piece.notes : []).map((n, i) => {
        const head = heads.get(`${n.pitch}@${n.onset.toFixed(3)}`);
        const pl = S.keysView.played(n);             // only what a finger plays, for as long as it holds the key
        return pl ? { id: i, on: n.onset, dur: pl.off - pl.on, vel: n.vel ?? 0.7, pitch: n.pitch, color: handColors[S.keysView.handOf(n)], head } : null;
      }).filter((e) => e && e.head).sort((a, b) => a.on - b.on);
      let G = null;
      for (const e of evs) {
        e.from = () => { proj.set(e.head.x, 0.05, -e.head.y).project(camPaper); return { x: proj.x * 0.5 + 0.5, y: proj.y * 0.5 + 0.5 }; };
        e.to = () => {
          S.keysView.keyPoint(e.pitch, kp); kq.copy(kp).setX(kp.x + 0.45).project(camKeys); kp.project(camKeys);
          return { x: kp.x * 0.5 + 0.5, y: ((kp.y * 0.5 + 0.5) * G.hb) / G.H, w: Math.abs(kq.x - kp.x) };
        };
      }
      // (ss: a staff space where the music is played, as a share of the picture's width)
      const sa = new THREE.Vector3(), sb = new THREE.Vector3(), ray = new THREE.Raycaster(), page = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
      // How high the bubbles may rise (RISE.near): to just under the lowest printed music near the picture, rather than
      // under the whole piece's lowest note, which the music's framing leaves room for. Each page x within the
      // picture's width counts as it is, one further off as k ss higher for every ss outside (so the line glides as
      // the music travels, never jumps); share of the height from the bottom.
      const pageX = (sx, y) => { ndc.set(sx, 2 * y - 1); ray.setFromCamera(ndc, camPaper); return ray.ray.intersectPlane(page, hit) ? hit.x : null; };
      const riseTo = (y0) => { // (y0: the least, see RISE.near.min)
        const xl = pageX(-1, y0), xr = pageX(1, y0), N = RISE.near;
        if (xl == null || xr == null) return y0;
        let lo = Infinity;
        for (let x = Math.floor(xl - N.reach); x <= xr + N.reach; x++) lo = Math.min(lo, S.paper.musicReach(x, x + 0.5)[0] + N.k * Math.max(0, xl - x, x - xr));
        if (!Number.isFinite(lo)) return y0;
        proj.set((xl + xr) / 2, 0, -lo).project(camPaper);
        return Math.max(y0, proj.y * 0.5 + 0.5 - N.gap);
      };
      S.beamFeed = (t, g) => { G = g; const lo = t - 4; let a = 0, b = evs.length; while (a < b) { const m = (a + b) >> 1; if (evs[m].on < lo) a = m + 1; else b = m; } const list = []; for (let i = a; i < evs.length && evs[i].on <= t; i++) list.push(evs[i]); S.keysView.keyPoint(60, kl).project(camKeys);
        const c = g.W < g.H ? flat.tall : flat.wide, x = S.paper.camX(t); sa.set(x, 0, -c.y).project(camPaper); sb.set(x + 1, 0, -c.y).project(camPaper);
        const paperY = (g.H - g.ht - g.dy) / g.H + 0.03, lineY = ((kl.y * 0.5 + 0.5) * g.hb) / g.H;
        S.beams.update(t, list, { aspect: g.W / g.H, W: g.W, H: g.H, tone: (PAPERS.find((p) => p.id === S.paperTone) || PAPERS[0]).swatch, lineY, paperY,
          ss: Math.abs(sb.x - sa.x) / 2, fade: g.fade ?? 1, rise: g.W < g.H ? RISE.tall : RISE.wide, riseY: riseTo(lineY + RISE.near.min), powder: atKeys(S.powder), flash: atKeys(S.flash) }); };
      [bloom.strength, bloom.radius, bloom.threshold] = S.paper.bloom.pass;
      bloom.compositeMaterial.uniforms.bloomFactors.value = S.paper.bloom.mips;
      renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = 1;
      dof.enabled = false;
      composer.passes[0] = splitPass;
      S.scene = S.old = S.paper.scene;
      return;
    }
    if (S.view === 'keys') {
      S.keysView = buildKeys(THEMES[S.theme], { canvasTex, dot, env }, S.piece, { style: S.glass, handLook: S.handLook, handPosture: S.handPosture, keyLayout: S.keyLayout, sleeves: S.sleeves });
      [bloom.strength, bloom.radius, bloom.threshold] = S.keysView.bloom;
      renderer.toneMappingExposure = 1;
      renderPass.scene = S.scene = S.old = S.keysView.scene;
      return;
    }
    if (S.view === 'sheet') {
      S.sheet = buildSheet(THEMES[S.theme], { canvasTex, dot, env }, S.piece);
      [bloom.strength, bloom.radius, bloom.threshold] = [0.7, 0.55, 0.78];
      renderer.toneMappingExposure = 1;
      renderPass.scene = S.scene = S.old = S.sheet.scene;
      return;
    }
    if (S.view === 'flight') {
      S.flight = buildFlight(THEMES[S.theme], { canvasTex, dot });
      [bloom.strength, bloom.radius, bloom.threshold] = [0.55, 0.55, 0.5];
      renderPass.scene = S.scene = S.old = S.flight.scene;
      return;
    }
    const T = THEMES[S.theme], scene = new THREE.Scene();
    scene.add(camera); S.score = buildScore(T, camera); // the camera carries the score ribbon, so it has to be part of the scene
    scene.background = canvasTex(4, 256, (g, w, h) => { const r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, T.bg[0]); r.addColorStop(1, T.bg[1]); g.fillStyle = r; g.fillRect(0, 0, w, h); });
    scene.environment = env; scene.environmentIntensity = T.env ?? 0.22;
    [bloom.strength, bloom.radius, bloom.threshold] = T.bloom;

    // Frame the part of the keyboard the piece uses (at least three octaves), so the notes are large.
    let lo = 36, hi = 96;
    if (S.piece) { lo = Math.min(...S.piece.notes.map((n) => n.pitch)); hi = Math.max(...S.piece.notes.map((n) => n.pitch)); }
    lo = Math.max(A0, Math.floor(lo / 12) * 12); hi = Math.min(C8, Math.ceil((hi + 1) / 12) * 12);
    while (hi - lo < 36) { if (lo > A0 + 5) lo = Math.max(A0, lo - 12); if (hi - lo < 36) hi = Math.min(C8, hi + 12); }
    const x0 = KX[lo] - 1, x1 = KX[hi] + 1, width = x1 - x0, cx = (x0 + x1) / 2;
    const half = Math.atan(Math.tan((camera.fov / 2) * Math.PI / 180) * camera.aspect);
    const dist = (width / 2) / Math.tan(half) * 1.03;
    const ref = width * 0.77; // sizes of the runway and the haze do not depend on the picture shape or the camera
    S.cam = { cx, dist, width, x0, ref };
    S.far = ref * 2.3;
    scene.fog = new THREE.Fog(T.fog, ref * 1.1, ref * 3.4);
    const led = T.led || T.trim;

    scene.add(new THREE.AmbientLight('#ffffff', 0.12 * (T.dim || 1)));
    const key = new THREE.DirectionalLight('#fff1dc', 1.15 * (T.dim || 1));
    key.position.set(cx - 12, 38, 22); key.target.position.set(cx, 0, -6);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005; key.shadow.radius = 4;
    Object.assign(key.shadow.camera, { left: -width / 2 - 6, right: width / 2 + 6, top: 30, bottom: -30, near: 1, far: 140 });
    scene.add(key, key.target);
    const rim = new THREE.PointLight(T.trim, T.additive ? 2 : 1, 0, 1.2); rim.position.set(cx, 12, -34); scene.add(rim);

    // The lacquered deck the notes travel over. It is slightly see-through so dim mirror copies below read as reflections.
    const lacquer = new THREE.MeshPhysicalMaterial({ color: T.runway, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3, transparent: true, opacity: 1 - T.mirror, envMapIntensity: T.additive ? 0.5 : 1 });
    const deckLen = S.far * 0.62;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(60, 0.1, deckLen), lacquer);
    deck.position.set(0, DECK - 0.05, -deckLen / 2); deck.receiveShadow = true; deck.renderOrder = 1; scene.add(deck);
    // (the bright bar that used to mark the far end of the deck is gone: it showed as a stray line beside the score strip)

    // The hall around the piano: a polished floor far below, a back wall of light columns, and haze. These give the eye real distances to read.
    const hall = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshPhysicalMaterial({ color: T.additive ? '#07060a' : '#e9dcd2', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 }));
    hall.rotation.x = -Math.PI / 2; hall.position.set(cx, -14, -120); hall.receiveShadow = true; scene.add(hall);
    S.horizon = new THREE.Mesh(new THREE.PlaneGeometry(width * 3.2, width * 0.9), new THREE.MeshBasicMaterial({ map: dot, color: T.notes[0], fog: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    S.horizon.position.set(cx, 4, -S.far * 1.15); scene.add(S.horizon);
    // The light strip along the back of the keys, and the light it throws on them.
    for (const dx of [-0.36, 0, 0.36]) { const l = new THREE.PointLight(led, T.ledLight || 0.5, width * 0.5, 1.6); l.position.set(cx + dx * width, 2.2, -0.9); scene.add(l); }
    // Coloured light thrown by the notes being played, and ripples on the lacquer where they land.
    S.flash = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#ffffff', 0, 26, 1.8); scene.add(l); return l; });
    const ringGeo = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    S.rings = Array.from({ length: 28 }, () => { const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, toneMapped: false })); r.visible = false; r.renderOrder = 3; scene.add(r); return r; });
    const gold = new THREE.MeshStandardMaterial({ color: T.trim, metalness: 1, roughness: 0.25, emissive: T.trim, emissiveIntensity: 0.12 * T.glow });
    for (let p = 24; p <= C8; p += 12) { // a fine inlay line at every C
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, deckLen), gold); l.position.set(KX[p] - 0.5, DECK + 0.01, -deckLen / 2); l.renderOrder = 2; scene.add(l);
    }
    S.strike = new THREE.Mesh(new THREE.BoxGeometry(60, T.outline ? 0.16 : 0.07, T.outline ? 0.2 : 0.1), new THREE.MeshStandardMaterial({ color: led, emissive: led, emissiveIntensity: 1.6 * T.glow, metalness: 0.6, roughness: 0.3 }));
    S.strike.position.set(0, DECK + (T.outline ? 0.1 : 0.05), -0.14); S.strike.renderOrder = 2; scene.add(S.strike);
    const felt = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: T.felt, roughness: 1 }));
    felt.position.set(0, DECK + 0.1, 0.02); scene.add(felt);
    const body = new THREE.MeshPhysicalMaterial({ color: T.additive ? '#060607' : '#2a1d20', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 });
    const rail = new THREE.Mesh(new THREE.RoundedBoxGeometry(60, 1.5, 1.4, 3, 0.25), body); rail.position.set(0, 0.1, 7.15); rail.castShadow = true; rail.receiveShadow = true; scene.add(rail);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 7), body); bed.position.set(0, -0.2, 3.3); scene.add(bed);
    const railTrim = new THREE.Mesh(new THREE.BoxGeometry(60, 0.05, 0.06), gold); railTrim.position.set(0, 0.86, 6.5); scene.add(railTrim);

    // Keys pivot at the back like real ones.
    const whiteGeo = new THREE.RoundedBoxGeometry(0.93, 1, 6.2, 2, 0.07).translate(0, -0.5, 3.1);
    const blackGeo = new THREE.RoundedBoxGeometry(0.56, 0.78, 3.9, 2, 0.1).translate(0, -0.39, 1.95);
    S.keys = [];
    for (let p = A0; p <= C8; p++) {
      const black = isBlack(p);
      const mat = new THREE.MeshPhysicalMaterial({ color: black ? T.black : T.white, roughness: black ? 0.22 : 0.3, clearcoat: black ? 1 : 0.5, clearcoatRoughness: 0.15, emissive: '#000000' });
      const m = new THREE.Mesh(black ? blackGeo : whiteGeo, mat);
      m.position.set(KX[p], black ? 1.62 : 1, 0.14);
      m.castShadow = true; m.receiveShadow = true;
      m.userData = { base: new THREE.Color(black ? T.black : T.white), max: black ? 0.05 : 0.034 };
      scene.add(m); S.keys[p] = m;
    }

    // Light beams that rise from a key while it sounds.
    S.beams = [];
    const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    for (let p = A0; p <= C8; p++) {
      const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, opacity: 0, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, toneMapped: false }));
      b.position.set(KX[p], DECK + 0.05, -0.2); b.rotation.x = -0.35; b.visible = false; b.renderOrder = 4;
      scene.add(b); S.beams[p] = b;
    }

    // Notes: glossy jewel bars, with a dim mirror copy under the deck.
    S.items = [];
    const mats = new Map(), geos = new Map();
    const noteMat = (track, level, mirror) => {
      const k = `${track}|${level}|${mirror}`;
      if (!mats.has(k)) {
        const c = new THREE.Color(T.notes[track % T.notes.length]);
        mats.set(k, mirror
          ? new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(T.additive ? 0.5 : 0.85), clippingPlanes: clip, fog: true })
          : new THREE.MeshPhysicalMaterial({ color: c, emissive: c, emissiveIntensity: T.glow * (0.7 + 0.33 * level), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, clippingPlanes: clip }));
      }
      return mats.get(k);
    };
    const noteGeo = (w, len) => {
      const k = `${w.toFixed(2)}|${len.toFixed(1)}`;
      if (!geos.has(k)) geos.set(k, new THREE.RoundedBoxGeometry(w, 0.5, Number(len.toFixed(1)), 2, Math.min(0.16, w / 2.5, len / 2.5)));
      return geos.get(k);
    };
    const coreMats = new Map();
    const coreMat = (ci) => { if (!coreMats.has(ci)) coreMats.set(ci, new THREE.MeshBasicMaterial({ color: new THREE.Color(T.notes[ci % T.notes.length]).multiplyScalar(0.1), clippingPlanes: clip })); return coreMats.get(ci); };
    const oneTrack = !S.piece || S.piece.tracks === 1;
    const colorIndex = (n) => (oneTrack ? (n.pitch < 60 ? 1 : 0) : n.track); // one track (a recording): lower and upper halves get their own colour
    S.colorOf = (pitch) => new THREE.Color(T.notes[(pitch < 60 ? 1 : 0) % T.notes.length]);
    const water = S.notes !== 'bars', trails = S.notes === 'trails'; // 'water' here means: drawn as light on a flat strip (trails or streams), not as solid bars
    S.waterTime = { value: 0 };
    const strip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const waterMat = (color, half, gain) => new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: S.waterTime, uLen: { value: 1 }, uHalf: { value: half }, uPlane: { value: half + 0.26 }, uPhase: { value: 0 }, uGain: { value: gain }, uFar: { value: S.far }, uKind: { value: trails ? 1 : 0 }, uColor: { value: color } } });
    (S.piece ? S.piece.notes : []).forEach((n, idx) => {
      if (n.pitch < A0 || n.pitch > C8) return;
      const level = Math.min(3, Math.floor(n.vel * 4)), black = isBlack(n.pitch);
      const len = Math.max(0.4, n.dur * SPEED - 0.1);
      // Louder notes are wider and brighter, so loudness never depends on colour alone.
      const w = (black ? 0.5 : 0.8) * (0.6 + 0.4 * n.vel), geo = noteGeo(w, len), y = black ? 1.75 : 1.2;
      const ci = colorIndex(n), tint = new THREE.Color(T.notes[ci % T.notes.length]);
      let mesh, twin;
      if (water) {
        const half = (trails ? 1.35 : 1) * (black ? 0.3 : 0.46) * (0.62 + 0.38 * n.vel), m = waterMat(tint, half, 0.6 + 0.5 * n.vel), m2 = waterMat(tint, half, 0.16 + 0.14 * n.vel);
        const shown = trails ? Math.max(len, 1.1) : len; // a trail needs room for its round head, however short the note
        m.uniforms.uLen.value = m2.uniforms.uLen.value = shown; m.uniforms.uPhase.value = m2.uniforms.uPhase.value = rnd(idx, 5) * 6.28;
        mesh = new THREE.Mesh(strip, m); twin = new THREE.Mesh(strip, m2);
        mesh.scale.set(2 * (half + 0.26), 1, shown); twin.scale.copy(mesh.scale); mesh.renderOrder = twin.renderOrder = 3;
        mesh.userData.shown = shown;
      } else { mesh = new THREE.Mesh(geo, noteMat(ci, level, false)); mesh.castShadow = true; twin = new THREE.Mesh(geo, noteMat(ci, level, true)); }
      if (!water && T.outline && len > 0.55) { const core = new THREE.Mesh(noteGeo(w * 0.56, len - 0.3), coreMat(ci)); core.position.y = 0.035; mesh.add(core); }
      const sprite = new THREE.Sprite(labelMaterial(n.pitch, T)); sprite.scale.set(1.9, 0.95, 1); sprite.renderOrder = 6;
      scene.add(mesh, twin, sprite);
      S.items.push({ n, idx, mesh, twin, sprite, len, y, color: tint });
    });
    // Bars for notes played live: they leave the key when it is pressed and travel away over the deck.
    const unit = new THREE.RoundedBoxGeometry(1, 0.5, 1, 2, 0.12);
    S.pool = Array.from({ length: 140 }, () => {
      if (water) { const mesh = new THREE.Mesh(strip, waterMat(new THREE.Color(), 0.3, 1)), twin = new THREE.Mesh(strip, waterMat(new THREE.Color(), 0.3, 0.3)); mesh.visible = twin.visible = false; mesh.renderOrder = twin.renderOrder = 3; scene.add(mesh, twin); return { mesh, twin, core: null, water: true }; }
      const mesh = new THREE.Mesh(unit, new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: T.glow, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, clippingPlanes: clip }));
      const twin = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: '#ffffff', clippingPlanes: clip }));
      const core = T.outline ? new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: '#000000', clippingPlanes: clip })) : null;
      if (core) { core.position.y = 0.035; mesh.add(core); }
      mesh.visible = twin.visible = false; scene.add(mesh, twin);
      return { mesh, twin, core };
    });

    // Sparks thrown up when a note lands, and slow dust in the light.
    const mkPoints = (count, size, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: T.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false }));
      pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
      return pts;
    };
    S.sparks = mkPoints(2400, 0.34, 1);
    S.dust = mkPoints(140, 0.22, T.additive ? 0.5 : 0.35);
    S.mist = mkPoints(1600, 0.7, 0.05);
    S.defaultColor = new THREE.Color(T.notes[0]);
    S.trimColor = new THREE.Color(T.trim);
    renderPass.scene = scene;
    S.scene = S.old = scene;
  }

  function render(t, live = false) {
    if (!S.scene) build();
    if (S.view === 'dancer') { S.dancer.render(camera, S.music, { effects: S.effects, motion: S.motion, style: S.dance }); composer.render(); return; }
    if (paperLook()) {
      renderer.getDrawingBufferSize(bufSize);
      const view = S.paper.render(t, camera, { live: live ? S.trail || [] : null, res: bufSize, pr: renderer.getPixelRatio(), paths: S.paths, trails: S.trails, corner: S.corner, cornerK: S.cornerK, dark: S.dark, cornerDark: S.cornerDark, sparks: S.sparks, zap: S.zap, current: S.current, cracks: S.cracks, race: S.race, ballStyle: S.ballStyle, shine: S.shine, ballK: S.ballK, glow: S.glow, effects: S.effects, motion: S.motion, camMove: S.camMove, appear: S.appear, darkNotes: S.darkNotes });
      // the cinematic camera's lens: sharp where the music is being played, the paper softening nearer and further off
      // (the Steady camera has none)
      dof.enabled = S.effects && view.dof > 0.001;
      if (dof.enabled) {
        const u = dof.material.uniforms;
        u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = view.focusZ; u.uRange.value = view.range;
        u.uMax.value = view.dof * DOF_PAPER * Math.min(bufSize.x, bufSize.y); u.uSky.value = 1; u.uTaps.value = 16;
      }
      composer.render();
      return;
    }
    if (S.view === 'sheetkeys') {
      splitPass.t = t;
      splitPass.opts = { pr: renderer.getPixelRatio(), live: live ? S.trail || [] : null, paths: S.paths, trails: S.trails, corner: S.corner, cornerK: S.cornerK, dark: S.dark, cornerDark: S.cornerDark, sparks: S.sparks, zap: S.zap, current: S.current, cracks: S.cracks, race: S.race, ballStyle: S.ballStyle, shine: S.shine, ballK: S.ballK, glow: S.glow, effects: S.effects, motion: S.motion, camMove: S.camMove, appear: S.appear, darkNotes: S.darkNotes };
      composer.render();
      return;
    }
    if (S.view === 'keys') {
      S.keysView.render(t, camera, { effects: S.effects, motion: S.motion, live: live ? S.trail || [] : null, powder: atKeys(S.powder), flash: atKeys(S.flash) });
      composer.render();
      return;
    }
    if (S.view === 'sheet') {
      const px = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 1080;
      const view = S.sheet.render(t, camera, { live: live ? S.trail || [] : null, effects: S.effects, motion: S.motion, paths: S.paths, cam: S.sheetCam, glow: S.glow, sky: S.sky, px, landing: S.landing });
      bloom.strength = 0.85 * (0.3 + S.glow);
      camera.updateMatrixWorld();
      const u = dof.material.uniforms, size = renderer.getDrawingBufferSize(new THREE.Vector2());
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uFocus.value = -view.point.applyMatrix4(camera.matrixWorldInverse).z; u.uRange.value = view.range; u.uTaps.value = 36; u.uMax.value = S.effects ? 0.0075 * Math.min(size.x, size.y) : 0; u.uSky.value = view.sky ? 0.1 : 1;
      composer.render();
      return;
    }
    if (S.view === 'flight') {
      const src = S.mic ? S.mic.slice(-400) : S.piece ? S.piece.notes : [];
      let lo = 48, hi = 84;
      if (src.length) { lo = Math.min(...src.map((n) => n.pitch)); hi = Math.max(...src.map((n) => n.pitch)); }
      if (hi - lo < 24) { const m = (lo + hi) / 2; lo = m - 12; hi = m + 12; }
      S.flight.render(t, camera, { voices: S.mic ? [S.mic] : S.voices, notes: S.mic || !S.piece ? [] : S.piece.notes, range: [lo, hi], labels: S.labels, effects: S.effects, motion: S.motion });
      composer.render();
      return;
    }
    const T = THEMES[S.theme], { cx, dist, width, x0, ref } = S.cam;
    S.waterTime.value = t;
    const sway = S.motion ? 1 : 0, trail = live ? S.trail || [] : [];
    // fx = every note that matters right now (from the piece, or played live), in one shape for the keys and the effects
    const fx = [];
    const span = S.far / SPEED;
    for (const it of S.items) {
      const { n, mesh, twin, sprite, len, y } = it, ahead = n.onset - t, off = n.onset + n.dur;
      const show = !live && ahead < span && (off > t - 0.05 || n.onset + (mesh.userData.shown || 0) / SPEED > t);
      mesh.visible = twin.visible = show;
      sprite.visible = show && S.labels && ahead > 0.02;
      if (show) {
        const z = -(ahead * SPEED + (mesh.userData.shown || len) / 2 + 0.05);
        mesh.position.set(KX[n.pitch], y, z);
        twin.position.set(KX[n.pitch], 2 * DECK - y, z);
        if (sprite.visible) sprite.position.set(KX[n.pitch], y + 0.95, -(ahead * SPEED + 0.6));
      }
      if (!live && ahead <= 0 && t < off + 2.5) fx.push({ pitch: n.pitch, vel: n.vel, onset: n.onset, off, idx: it.idx, color: it.color });
    }
    let used = 0;
    for (let i = trail.length - 1; i >= 0; i--) {
      const n = trail[i];
      if (n.pitch < A0 || n.pitch > C8) continue;
      const end = n.t1 ?? t, near = (t - end) * SPEED, far = (t - n.t0) * SPEED, color = S.colorOf(n.pitch);
      if (t - end < 2.5 || n.t1 == null) fx.push({ pitch: n.pitch, vel: n.vel, onset: n.t0, off: n.t1 ?? Infinity, idx: i + (n.t0 * 100 | 0), color });
      if (near > S.far || used >= S.pool.length || far - near < 0.05) continue;
      const q = S.pool[used++], black = isBlack(n.pitch), len = far - near, w = (black ? 0.5 : 0.8) * (0.6 + 0.4 * n.vel), y = black ? 1.75 : 1.2, z = -(near + len / 2 + 0.3);
      q.mesh.visible = q.twin.visible = true;
      if (q.water) { // live notes run the other way (away from the keys), so the strip is turned round: its round head leads
        const half = w / 2;
        for (const [m, gain] of [[q.mesh, 0.6 + 0.5 * n.vel], [q.twin, 0.16 + 0.14 * n.vel]]) { const u = m.material.uniforms; u.uLen.value = len; u.uHalf.value = half; u.uPlane.value = half + 0.26; u.uGain.value = gain; u.uColor.value.copy(color); u.uPhase.value = n.pitch; m.scale.set(2 * (half + 0.26), 1, -len); }
        q.mesh.position.set(KX[n.pitch], y, z); q.twin.position.set(KX[n.pitch], 2 * DECK - y, z);
        continue;
      }
      q.mesh.scale.set(w, 1, len); q.twin.scale.set(w, 1, len);
      q.mesh.position.set(KX[n.pitch], y, z); q.twin.position.set(KX[n.pitch], 2 * DECK - y, z);
      q.mesh.material.color.copy(color); q.mesh.material.emissive.copy(color); q.mesh.material.emissiveIntensity = T.glow * (0.7 + 0.5 * n.vel);
      q.twin.material.color.copy(color).multiplyScalar(0.5);
      if (q.core) { q.core.visible = len > 0.7; q.core.scale.set(0.56, 1, Math.max(0.05, (len - 0.34) / len)); q.core.material.color.copy(color).multiplyScalar(0.1); }
    }
    for (let i = used; i < S.pool.length; i++) S.pool[i].mesh.visible = S.pool[i].twin.visible = false;

    // how much is sounding right now (0..1): drives the room light and a slight push of the camera toward the keys
    let pulse = 0;
    for (const f of fx) { const age = t - f.onset; if (age >= 0 && age < 2.5) pulse += f.vel * Math.exp(-age / 0.55); }
    pulse = Math.min(1, pulse * 0.3);
    const push = 1 - 0.035 * pulse * sway, sx = Math.sin(t * 0.19) * sway, sy = Math.sin(t * 0.13 + 1) * sway;
    if (S.camera === 'side') { // from beyond the low notes, looking along the keyboard: the notes arrive from the left
      camera.position.set(x0 - width * (0.3 - 0.012 * sx), width * (0.36 + 0.008 * sy) * push, width * (0.2 + 0.01 * sx));
      camera.lookAt(cx - width * 0.08, 0, -width * 0.12);
    } else if (S.camera === 'top') { // straight down, like sheet music scrolling toward the player
      const h = dist * 1.02;
      const zc = 8.3 + h * 0.035; // far enough toward the player that the whole length of the keys is in the picture
      camera.position.set(cx + sx * width * 0.01, h * push, zc);
      camera.lookAt(cx + sx * width * 0.01, 0, zc - h * 0.42);
    } else if (camera.aspect < 1) { // front view in the tall picture: from higher up, the keys along the bottom and the runway filling the height
      camera.position.set(cx + sx * width * 0.04, (dist * 0.8 + sy * dist * 0.015) * push, (dist * 0.42 + 2) * push);
      camera.lookAt(cx + sx * width * 0.012, 0.3, -dist * 0.34);
    } else {
      camera.position.set(cx + sx * width * 0.05, (dist * 0.66 + sy * dist * 0.02) * push, (dist * 0.72 + 2) * push);
      camera.lookAt(cx + sx * width * 0.015, 0.3, -dist * 0.24);
    }
    // The haze starts beyond the piano. In the tall picture the camera stands much further back to fit the keyboard in, so the haze moves back with it.
    const reach = S.camera === 'side' ? 1 : Math.max(1, dist / ref);
    S.scene.fog.near = ref * 1.1 * reach; S.scene.fog.far = ref * 3.4 * reach;
    renderer.toneMappingExposure = camera.aspect < 1 && S.camera !== 'side' ? 1.3 : 1; // small and far away: a little more light
    S.horizon.material.opacity = S.effects ? 0.02 + 0.1 * pulse : 0;

    // press[pitch] = how far down the key is (0..1), with its colour and loudness
    const press = new Map();
    for (const [p, v] of S.live) press.set(p, { a: 1, vel: v.vel, color: S.colorOf(p) });
    const sp = S.sparks.geometry.attributes, mp = S.mist.geometry.attributes;
    let energy = 0, mused = 0;
    used = 0;
    for (const f of fx) {
      const age = t - f.onset;
      if (t < f.off + 0.1) {
        const a = clamp01(age / 0.035) * (1 - clamp01((t - f.off) / 0.1)), old = press.get(f.pitch);
        if (!old || a > old.a) press.set(f.pitch, { a, vel: f.vel, color: f.color });
        energy += f.vel * a;
      }
      if (!S.effects) continue;
      if (age < 0.9) { // sparks: same arc every time for the same note
        const count = Math.round(5 + 12 * f.vel), fade = (1 - age / 0.9) ** 1.5;
        for (let j = 0; j < count && used < 2400; j++, used++) {
          const vx = (rnd(f.idx, j) - 0.5) * 3.2, vy = (2.2 + 4.5 * rnd(f.idx, j + 50)) * (0.5 + f.vel), vz = -rnd(f.idx, j + 99) * 2.4;
          sp.position.setXYZ(used, KX[f.pitch] + vx * age, DECK + 0.4 + vy * age - 4.2 * age * age, -0.2 + vz * age);
          const warm = j % 3 === 0 ? S.trimColor : f.color;
          sp.color.setXYZ(used, warm.r * fade, warm.g * fade, warm.b * fade);
        }
      }
      // mist: while a note is held, soft light keeps rising where it meets the keys
      const STEP = 0.07, LIFE = 1.5, last = Math.floor((Math.min(t, f.off) - f.onset) / STEP);
      for (let j = Math.max(0, Math.ceil((t - LIFE - f.onset) / STEP)); j <= last && mused < 1600; j++, mused++) {
        const a = t - (f.onset + j * STEP), k = a / LIFE, fade = (1 - k) ** 2 * Math.min(1, a / 0.08) * (0.35 + 0.65 * f.vel);
        mp.position.setXYZ(mused, KX[f.pitch] + (rnd(f.idx, j) - 0.5) * (0.7 + 2.4 * k), DECK + 0.5 + a * (0.9 + 1.6 * rnd(f.idx, j + 31)), -0.5 - rnd(f.idx, j + 77) * 1.4 - a * 1.1);
        mp.color.setXYZ(mused, f.color.r * fade, f.color.g * fade, f.color.b * fade);
      }
    }
    S.sparks.geometry.setDrawRange(0, used); sp.position.needsUpdate = true; sp.color.needsUpdate = true;
    S.sparks.visible = used > 0;
    S.mist.geometry.setDrawRange(0, mused); mp.position.needsUpdate = true; mp.color.needsUpdate = true;
    S.mist.visible = mused > 0;

    const dp = S.dust.geometry.attributes;
    S.dust.visible = S.effects;
    for (let i = 0; i < 140 && S.effects; i++) {
      const d = 0.25 + 0.2 * rnd(i, 7);
      dp.position.setXYZ(i, cx + (rnd(i, 1) - 0.5) * width * 1.3 + Math.sin(t * 0.11 + i) * 0.8,
        1.5 + rnd(i, 2) * ref * 0.35 + Math.sin(t * 0.17 + i * 2.1) * 0.5, -rnd(i, 3) * S.far * 0.75);
      dp.color.setXYZ(i, S.trimColor.r * d, S.trimColor.g * d, S.trimColor.b * d);
    }
    dp.position.needsUpdate = true; dp.color.needsUpdate = true;

    for (let p = A0; p <= C8; p++) {
      const k = S.keys[p], b = S.beams[p], a = press.get(p);
      k.rotation.x = a ? k.userData.max * a.a : 0;
      if (a) {
        k.material.emissive.copy(a.color); k.material.emissiveIntensity = T.glow * (0.4 + 0.6 * a.vel) * a.a;
        k.material.color.copy(k.userData.base).lerp(a.color, 0.6 * a.a);
      } else { k.material.emissiveIntensity = 0; k.material.color.copy(k.userData.base); }
      b.visible = !!a && S.effects;
      if (b.visible) { b.material.color.copy(a.color); b.material.opacity = (T.dim ? 0.2 : 0.3) * a.a * (0.45 + 0.55 * a.vel); b.scale.set(isBlack(p) ? 0.9 : 1.3, 2.5 + 6 * a.vel, 1); b.rotation.y = S.camera === 'side' ? -1.1 : 0; }
    }
    let ri = 0;
    for (const f of S.effects ? fx : []) {
      const age = t - f.onset;
      if (age < 0 || age > 0.8 || ri >= S.rings.length) continue;
      const r = S.rings[ri++], k = age / 0.8, size = 1 + k * (5 + 7 * f.vel);
      r.visible = true; r.position.set(KX[f.pitch], DECK + 0.02, -0.9 - k * 1.5); r.scale.set(size, 1, size * 1.5);
      r.material.color.copy(f.color); r.material.opacity = (1 - k) ** 1.5 * (0.25 + 0.6 * f.vel) * 0.55;
    }
    for (; ri < S.rings.length; ri++) S.rings[ri].visible = false;
    const lit = [...press].map(([p, a]) => ({ p, a, s: a.a * a.vel })).sort((x, y) => y.s - x.s);
    S.flash.forEach((l, i) => {
      const h = lit[i];
      l.intensity = h ? (T.dim ? 6 : 9) * h.s : 0;
      if (h) { l.color.copy(h.a.color); l.position.set(KX[h.p], 2.6, -1.2); }
    });
    S.strike.material.emissiveIntensity = T.glow * (1.1 + Math.min(1, energy * 0.3));
    S.score.mesh.visible = S.ribbon;
    if (S.ribbon) S.score.update(t, S.piece, live ? trail : null, S.dots, S.strip === 'lines');
    composer.render();
  }

  return {
    render,
    // Live view: draw at the screen's pixel ratio (at most 2), but keep the drawing to about 5.2 million pixels (a
    // 1512x850 window at ratio 2) so a large window on a high-density screen stays at 60 fps. Exports pass their own ratio.
    resize(w, h, ratio = Math.max(1, Math.min(devicePixelRatio || 1, 2, Math.sqrt(5.2e6 / Math.max(1, w * h))))) {
      renderer.setPixelRatio(ratio); renderer.setSize(w, h, false);
      composer.setPixelRatio(ratio); composer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix(); S.scene = null;
    },
    setPiece(piece) { S.piece = piece; S.voices = piece ? voicesFromPiece(piece) : []; S.scene = null; },
    setView(v) { S.view = ['flight', 'dancer', 'sheet', 'keys', 'sheetkeys'].includes(v) ? v : 'piano'; S.scene = null; },
    // The "Sheet music + hands" picture: the molten bars falling between the sheet and the keys as well as the light (rebuilds).
    setKeyRange(v) { if (v !== S.keyRange) { S.keyRange = v; if (S.view === 'sheetkeys') S.scene = null; } },
    setCombBars(on) { if (!!on !== !!S.combBars) { S.combBars = !!on; if (S.view === 'sheetkeys') S.scene = null; } },
    // The Keys picture's style of falling notes ('molten' for now).
    // The Keys picture's hands: 'skin', 'glass' or 'porcelain' (no rebuild).
    setHandLook(v) { S.handLook = v; if (S.keysView) S.keysView.setHandLook(v); },
    // The hands' posture: 'auto' (the default: lyrical in slow music, classical in fast), 'lyrical' (flat fingers, the hand
    // further in over the keys, the wrist low), 'classical' (curved fingers), or 'legacy' (the posture before this choice,
    // for comparison only: not in the menu). The hands are planned again (the picture is rebuilt).
    setHandPosture(v) { const p = ['auto', 'lyrical', 'classical', 'legacy'].includes(v) ? v : 'auto'; if (p !== (S.handPosture || 'auto')) { S.handPosture = p; if (S.view === 'keys' || S.view === 'sheetkeys') S.scene = null; } },
    // The hand pictures' black keys: 'piano' (the default: spread a little within each group as on a real piano, so that
    // flat fingers fit between them) or 'even' (on the white keys' boundaries, as before). The keys and hands are rebuilt.
    setKeyLayout(v) { const k = v === 'even' ? 'even' : 'piano'; if (k !== (S.keyLayout || 'piano')) { S.keyLayout = k; if (S.view === 'keys' || S.view === 'sheetkeys') S.scene = null; } },
    // The hands' dark sleeves over the forearms, from just past the wrist (skin and porcelain; on by default; no rebuild).
    setSleeves(on) { S.sleeves = on !== false; if (S.keysView && S.keysView.setSleeves) S.keysView.setSleeves(S.sleeves); },
    // The hand pictures' powder and flash at a struck key: 0 (none) to 1 (2.4 times their usual strength, which is at
    // 0.4); 0.55 by default (AT_KEYS). With the flash at 0 a played key still glows softly in its hand's colour while it
    // is held. No rebuild.
    setPowder(v) { const k = Number(v); S.powder = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : AT_KEYS.def; },
    setFlash(v) { const k = Number(v); S.flash = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : AT_KEYS.def; },
    setGlass(v) { if (v !== S.glass) { S.glass = v; if (S.view === 'keys') S.scene = null; } },
    // The sheet view's look: 'paper' (real paper in one of a few calm colours, a gliding camera; the default) or 'night'
    // (the dark glass slab under the stars).
    setLook(v) { const look = v === 'night' ? 'night' : 'paper'; if (look !== S.look) { S.look = look; S.scene = null; } },
    // The title lettered in 3D at the start of the paper look (null: the piece's own name from its file).
    setTitle(text) { const v = text == null ? null : String(text); if (v !== S.title) { S.title = v; if (paperIn()) S.scene = null; } },
    // The composer's name, printed under the right end of the 3D title in the paper look ('' for none).
    setComposer(text) { const v = String(text || '').trim(); if (v !== S.composer) { S.composer = v; if (paperIn()) S.scene = null; } },
    // The channel's name, raised on the page every 30 s of music in the paper look ('' for none).
    setMark(text) { const v = String(text || '').trim(); if (v !== S.mark) { S.mark = v; if (paperIn()) S.scene = null; } },
    // The paper look's colours for the two hands: the id of one of the pairs handPairs() lists (no rebuild needed).
    setHands(id) { S.hands = HAND_PAIRS.some((p) => p.id === id) ? id : 'rose'; if (S.paper) S.paper.setHands(S.hands); if (S.view === 'sheetkeys') S.scene = null; },
    handPairs: () => HAND_PAIRS.map(({ id, name, chips }) => ({ id, name, chips })),
    // The paper look's paper colour: the id of one of the colours papers() lists (no rebuild needed).
    setPaper(id) { S.paperTone = PAPERS.some((p) => p.id === id) ? id : PAPER_DEFAULT; if (S.paper) { S.paper.setPaper(S.paperTone); if (paperIn()) [bloom.strength, bloom.radius, bloom.threshold] = S.paper.bloom.pass; }
      if (S.view === 'sheetkeys' && S.keysView && S.keysView.setFloor) S.keysView.setFloor((PAPERS.find((p) => p.id === S.paperTone) || PAPERS[0]).swatch[0]); }, // (the floor under the keys takes the paper's colour)
    papers: () => PAPERS.map(({ id, name, desc, swatch, dark, css }) => ({ id, name, desc, swatch, dark: !!dark, css })),
    // What the paper look's notation is made of: the id of one of the finishes finishes() lists (the scene is built again).
    setFinish(id) { const v = FINISHES.some((f) => f.id === id) ? id : FINISH_DEFAULT; if (v !== S.finish) { S.finish = v; if (paperIn()) S.scene = null; } },
    finishes: () => FINISHES.map(({ id, name, desc, chip, best, dark }) => ({ id, name, desc, chip, best, dark })),
    // The paper look's light trails behind the balls (on or off).
    setTrails(on) { S.trails = !!on; },
    // The paper pictures' notes appear as they are played (on or off; off by default): each note is printed only as its
    // key is pressed (as its ball lands, in the paper look), so the music is written from left to right. No rebuild.
    setAppear(on) { S.appear = !!on; },
    // The paper pictures' dark notes (on or off; off by default): on a dark paper or marble the notes are printed dark
    // (each finish as it is made for light paper), quiet on the dark page, and each lights up in its hand's colour as it
    // is played. A light paper is unchanged. No rebuild.
    setDarkNotes(on) { S.darkNotes = !!on; },
    // The paper look's corner light: the id of one of the styles corners() lists ('off' by default).
    setCorner(id) { S.corner = CORNER_STYLES.some((c) => c.id === id) ? id : 'off'; },
    // Its strength: 0 (faint) to 1 (strong), 0.5 by default; it changes only uniforms, so no rebuild is needed.
    setCornerStrength(v) { const k = Number(v); S.cornerK = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 0.5; },
    // The paper look's darkness of the room: 0 (as lit) to 1 (the lamp dimmed, as in a dark room), and its shadow in the
    // corners: 0 (none) to 1 (the top-left and bottom-right corners in deep shade). The balls, glows and lit notes keep
    // their light. Both 0 here (the app starts them at its own defaults). No rebuild.
    setDarkness(v) { S.dark = Math.max(0, Math.min(1, Number(v) || 0)); },
    setCornerShadow(v) { S.cornerDark = Math.max(0, Math.min(1, Number(v) || 0)); },
    // The paper look's shine of the notes: how strongly the notation mirrors the balls and the lit notes, 0 (the quiet
    // sheen of before) to 1 (strongly metallic); SHINE_DEFAULT unless chosen. No rebuild.
    setShine(v) { const k = Number(v); S.shine = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : SHINE_DEFAULT; },
    // The paper look's brightness of the balls: 0 (soft and dim) to 1 (brighter), 0.5 as designed; the light they throw
    // goes with them. No rebuild.
    setBallBrightness(v) { const k = Number(v); S.ballK = Number.isFinite(k) ? Math.max(0, Math.min(1, k)) : 0.5; },
    // The paper look's ball style: 'light' (balls of light, as designed) or 'dark' (dark-energy orbs: dark, a ring of light
    // outside, a dark-red nucleus sparking inside). No rebuild.
    setBallStyle(v) { S.ballStyle = v === 'dark' ? 'dark' : 'light'; },
    corners: () => CORNER_STYLES.map(({ id, name, desc }) => ({ id, name, desc })),
    // The paper look's powder sparks: how many, 0 (none) to 1 (the most).
    setSparks(v) { S.sparks = Math.max(0, Math.min(1, Number(v) || 0)); },
    // The paper look's electric notes: how strongly each note crackles with current as its ball lands, 0 (none) to 1.
    setZap(v) { S.zap = Math.max(0, Math.min(1, Number(v) || 0)); },
    // The paper look's current with the balls (an electric tail, sparks, a leap ahead) and cracks of light in the notes:
    // each 0 (none) to 1 (strongest). No rebuild (the cracks compile into the notes' shaders while they are on).
    setCurrent(v) { S.current = Math.max(0, Math.min(1, Number(v) || 0)); },
    setCracks(v) { S.cracks = Math.max(0, Math.min(1, Number(v) || 0)); },
    // The paper look's race between the balls: how far ahead of the music a ball runs as they take turns passing each
    // other, 0 (none: always level, in time) to 1. No rebuild (the touches and the notes' lighting move with it).
    setRace(v) { S.race = Math.max(0, Math.min(1, Number(v) || 0)); },
    // The paper look's camera: 'steady' (the default) or 'cinematic' (moves with the music, planned from the piece).
    setCamMove(v) { S.camMove = CAM_MOVES.some((c) => c.id === v) ? v : 'steady'; },
    camMoves: () => CAM_MOVES.map(({ id, name, desc }) => ({ id, name, desc })),
    // Resolves once everything the current picture needs has loaded and its scene is built (the frame bench and the
    // video export wait for it before drawing).
    async ready() { await glyphsLoaded; if (!S.scene) build(); },
    setMusic(features) { S.music = features; },
    beams: () => S.beams,
    keysView: () => S.keysView,
    dancer: () => S.dancer,
    paper: () => (paperLook() ? S.paper : null), // the paper look's scene and its last frame (for checking pictures from outside)
    // the "Sheet music + hands" picture's parts and cameras as last drawn (for checking pictures from outside)
    sheetKeys: () => (S.view === 'sheetkeys' && S.paper ? { paper: S.paper, keys: S.keysView, camPaper, camKeys, cams: flat, split: SPLIT } : null),
    setDance(style) { S.dance = style; },
    setMic(points) { S.mic = points; },
    // Which key is under a point of the picture? x and y run from -1 to 1 across it. Used for playing by touch or mouse.
    pick(x, y) {
      if (S.view !== 'piano' || !S.keys.length || !S.scene) return null;
      ray.setFromCamera(point.set(x, y), camera);
      const hit = ray.intersectObjects(S.keys.filter(Boolean), false)[0];
      return hit ? { pitch: S.keys.indexOf(hit.object), depth: hit.point.z } : null;
    },
    setLabels(on) { S.labels = on; },
    setRibbon(on) { S.ribbon = on; },
    setDots(on) { S.dots = on; },
    setStrip(kind) { S.strip = kind === 'lines' ? 'lines' : 'notes'; },
    setPaths(on) { S.paths = on; },
    setSheetCam(c) { S.sheetCam = ['low', 'side', 'top', 'move'].includes(c) ? c : 'side'; },
    setGlow(v) { S.glow = Math.max(0, Math.min(1, Number(v) || 0)); },
    setLanding(v) { S.landing = ['sparks', 'powder', 'both'].includes(v) ? v : 'sparks'; },
    setSky(v) { S.sky = ['plain', 'stars', 'aurora', 'galaxy'].includes(v) ? v : 'stars'; },
    setNotes(kind) { S.notes = ['bars', 'water'].includes(kind) ? kind : 'trails'; S.scene = null; },
    setEffects(on) { S.effects = on; },
    setMotion(on) { S.motion = on; },
    setTheme(name) { S.theme = THEMES[name] ? name : 'aurora'; S.scene = null; },
    setLive(map) { S.live = map; },
    setTrail(list) { S.trail = list; },
    setCamera(c) { S.camera = ['side', 'top'].includes(c) ? c : 'front'; },
    isLight: () => false,
    themes: () => Object.fromEntries(Object.entries(THEMES).map(([k, T]) => [k, [T.led || T.trim, ...T.notes]])),
  };
}
