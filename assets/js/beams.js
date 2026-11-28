// The light between the keys and the sheet music (the "Sheet music + hands" picture), drawn over the whole picture in
// screen space (0..1 across and up) as a pure function of the music time.
// - The picture is dark at the bottom, over the keys, lightening steadily upward into the music (and darker toward
//   its edges), so the light glows out of the dark and the music sits in the light. The shade is multiplied into the
//   picture (a deeper, warmer tone of what is there), so black ink and black keys stay black instead of turning a
//   greyish brown. (The floor under the keyboard's front is the keys picture's own, keys.js: a screen-space shade
//   there would darken the hands too.)
// - The whole picture fades in at the start and out at the end (fade: multiplied in last, over everything).
// - A line of light runs along the back of the keys, brighter where they are being played, with a soft haze above.
// - When the hand strikes a key, it blows out a puff of sparkling dust that billows slowly upward like smoke (its
//   strength: `powder`), a white-hot flash bursts where the key meets the line of light (`flash`, above its usual
//   strength), and at the same moment the note on the paper glows and sparkles.
// - From the key a glass bubble rises straight up, slowly: a soft-edged rounded square for a short note, a longer
//   capsule for a held one (its length is how long the note is held), with a bright rim and glowing fluid swirling
//   inside, shedding dust; it fades away below the music, never reaching it.
import * as THREE from '../vendor/three.min.js?v=7';

const SPEED = 0.2;    // how fast a bubble rises (picture heights a second)
const LIFE = 1.8;     // how long the powder lasts
// the shade: SHADE_K = its strength where the gradient is full; DEEP = what is left there of the paper's dark tone's
// brightest channel (the others in proportion, halfway to neutral)
const SHADE_K = 0.8, DEEP = 0.32;
// the glow on a note as its light leaves it: its size (staff spaces across, at its largest, for a soft velocity and a
// loud one) and brightness
const FLASH = { size: [1.6, 3.2], gain: 1 };
// The flash at a struck key, beyond the key's usual glow (keys.js), when the Look tab's "Flash at the keys" is above
// its usual strength (flash > 1): a soft burst where the key meets the line of light, white fading to its hand's colour
// over `life` s, `size` of the key's width across (and a little more for a loud note), its brightness `gain` for each
// step above the usual strength. Kept small and short, so it never hides the bubble being born. It has its own sprites
// (`pool`: as many as the densest piece in the library needs, Beethoven's Pathetique 1 with up to 48 notes struck within
// 0.3 s), so in thick chords it never takes the sprites of the glows on the paper.
const KEY_FLASH = { life: 0.3, size: 3.2, gain: 0.8, pool: 48 };
// The puff at a struck key at `powder` times its usual strength (p): p times the grains, each brighter (bright: share
// that grows with p, at most `maxBright` times), flung further (spread) and larger (size, at most `maxSize` times).
// The two caps keep the puff's core from merging into one clipped white cloud at the top of the slider: there it is
// more and wider powder, not a brighter blob.
const PUFF = { bright: 0.3, maxBright: 1.15, spread: 0.35, size: 0.4, maxSize: 1.35 };
const addKeepAlpha = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
// (light from a texture with soft edges, its colour weighed by its alpha: the soft dot's edge fades out instead of
// being cut as a flat disc)
const addAlphaKeepAlpha = { ...addKeepAlpha, blendSrc: THREE.SrcAlphaFactor };
// (multiplied into what is there: the shade, the fade)
const multiply = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };

const QUAD_VERT = 'varying vec2 vUv; varying vec2 vL; attribute vec2 aL; void main() { vUv = uv; vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const NOISE = `
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;
// a bubble: in its own pixels (vL: along from its tail, across from its middle)
const BUBBLE_FRAG = `
uniform vec3 uColor; uniform float uAlpha, uLen, uW, uTime, uSeed, uCutA, uCutB, uPad, uFadeA, uFadeB;
varying vec2 vL;
${NOISE}
float sdRBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = vec2(vL.x - uLen * 0.5, vL.y);
  float r = min(uW, uLen * 0.5) * 0.92;
  float d = sdRBox(p, vec2(uLen * 0.5, uW), r);
  // where it is still coming out of the key, or already flowing into its note, it is cut off softly
  float cut = smoothstep(0.0, uW * 0.8, vL.x + uPad * (1.0 - uCutA)) * smoothstep(0.0, uW * 0.8, uLen - vL.x + uPad * (1.0 - uCutB));
  if (uCutA > 0.5) d = max(d, -vL.x); if (uCutB > 0.5) d = max(d, vL.x - uLen);
  float px = 1.0;
  float rim = exp(-abs(d + 0.8) / (0.9 * px)) * 1.1 + exp(-abs(d + 2.2) / 1.6) * 0.25;
  float inside = 1.0 - smoothstep(-1.0, 0.5, d);
  // the fluid inside: marbled glow that swirls and flows up the bubble
  vec2 q = p / max(uW, 3.0) * 1.3 + vec2(-uTime * 1.6, uSeed * 7.0);
  float w = fbm(q + 1.5 * vec2(fbm(q + uTime * 0.6), fbm(q + 3.1 - uTime * 0.5)));
  float marble = pow(abs(sin(w * 9.0 + uSeed * 3.0)), 6.0);
  float fill = inside * (0.18 + 0.5 * marble + 0.25 * smoothstep(-uW, 0.0, d));
  // its halo: soft, and down to nothing well inside the quad (cut off where it was still 0.004 of the light, it drew a
  // tinted box round each bubble on dark paper)
  float halo = exp(-max(d, 0.0) / (uW * 0.3 + 2.0)) * 0.22 * (1.0 - inside) * (1.0 - smoothstep(0.0, uPad * 0.8, max(d, 0.0)));
  float fade = smoothstep(uFadeB, uFadeA, gl_FragCoord.y);   // gone before it reaches the music
  // (the bright rim fades sooner than the body, so a fading bubble leaves no ring of light behind)
  float I = (rim * fade * fade + fill + halo * fade) * cut * uAlpha * fade * fade;
  if (I < 0.0004) discard;
  vec3 c = mix(uColor, vec3(1.0), 0.45 * rim + 0.25 * marble * inside);
  gl_FragColor = vec4(c * I, 1.0);
}`;
// the line of light along the back of the keys, and a haze over it
const LINE_FRAG = `
uniform float uY, uH, uAspect; uniform vec3 uColor; uniform float uHot[64]; varying vec2 vUv;
${NOISE}
void main() {
  float y = (vUv.y - uY) / uH;
  float x = vUv.x * 63.0; int i = int(floor(x)); float f = fract(x);
  float hot = mix(uHot[i], uHot[min(i + 1, 63)], f * f * (3.0 - 2.0 * f));
  float core = exp(-y * y * 1.6) * (0.8 + 1.6 * hot);
  // the haze: only over the keys being played, a low pool (its height a share of the picture's, not pixels), so no
  // grey band lies along the keys and no cone of light stands over a struck key
  float yp = vUv.y - uY;
  float haze = exp(-max(yp, 0.0) / 0.012) * step(0.0, yp) * 0.22 * hot * (0.6 + 0.8 * fbm(vec2(vUv.x * 18.0, vUv.y * 6.0)));
  float I = core + haze;
  if (I < 0.0003) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5 * exp(-y * y * 6.0)) * I, 1.0);
}`;
// the darkness: toward the edges, and in the space between the music and the keys. Multiplied into the picture: uDark
// is what is left in full shade (a share of each channel, a little warmer than neutral, from the paper's own dark tone).
const DARK_FRAG = `
uniform float uLo, uHi, uK, uAspect; uniform vec3 uDark; varying vec2 vUv;
void main() {
  vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(0.3, 1.0, length(c * vec2(1.35, 0.8)));
  // darkest at the bottom, just above the keys, lightening steadily upward into the music
  float up = clamp((vUv.y - uLo) / (uHi + 0.34 - uLo), 0.0, 1.0);          // a long, even gradient, reaching well into the music
  float grad = vUv.y < uLo ? 0.22 * smoothstep(uLo, 0.0, vUv.y) : (1.0 - up * up * (3.0 - 2.0 * up)) * 0.96;
  float a = clamp(max(grad, vig * 0.7) + grad * vig * 0.3, 0.0, 0.95) * uK;
  gl_FragColor = vec4(mix(vec3(1.0), uDark, a * ${SHADE_K.toFixed(3)}), 1.0);
}`;
const FADE_FRAG = 'uniform float uFade; void main() { gl_FragColor = vec4(vec3(uFade), 1.0); }';

const rnd = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const WHITE = new THREE.Color(1, 1, 1);

export function buildBeams({ dot }) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const quad = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setAttribute('aL', new THREE.BufferAttribute(new Float32Array(8), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };
  const full = (frag, uniforms, blend, order) => {
    const g = quad(); g.attributes.position.array.set([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VERT, fragmentShader: frag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, ...blend }));
    m.frustumCulled = false; m.renderOrder = order; scene.add(m); return m;
  };
  const dark = full(DARK_FRAG, { uLo: { value: 0.1 }, uHi: { value: 0.5 }, uK: { value: 1 }, uAspect: { value: 9 / 16 }, uDark: { value: new THREE.Color(DEEP, DEEP, DEEP) } }, multiply, -10);
  const fade = full(FADE_FRAG, { uFade: { value: 1 } }, multiply, 100); fade.visible = false;
  let toneKey = '';
  const hotArr = new Array(64).fill(0);
  const line = full(LINE_FRAG, { uY: { value: 0.1 }, uH: { value: 0.004 }, uAspect: { value: 9 / 16 }, uColor: { value: new THREE.Color('#b9a8ff') }, uHot: { value: hotArr } }, addKeepAlpha, -5);
  // bubbles: a pool of quads
  const POOL = 120;
  const bubbles = Array.from({ length: POOL }, () => {
    const m = new THREE.Mesh(quad(), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uLen: { value: 10 }, uW: { value: 5 }, uTime: { value: 0 }, uSeed: { value: 0 }, uCutA: { value: 0 }, uCutB: { value: 0 }, uPad: { value: 0 }, uFadeA: { value: 0 }, uFadeB: { value: 1e5 } },
      vertexShader: QUAD_VERT, fragmentShader: BUBBLE_FRAG, side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...addKeepAlpha }));
    m.frustumCulled = false; m.visible = false; scene.add(m);
    return m;
  });
  // flashes where a bubble reaches its note
  const flashMat = new THREE.SpriteMaterial({ map: dot, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...addAlphaKeepAlpha });
  const flashes = Array.from({ length: 48 }, () => { const s = new THREE.Sprite(flashMat.clone()); s.visible = false; scene.add(s); return s; });
  // the white-hot bursts at the keys, in their own pool (KEY_FLASH)
  const bursts = Array.from({ length: KEY_FLASH.pool }, () => { const s = new THREE.Sprite(flashMat.clone()); s.visible = false; scene.add(s); return s; });
  // dust and powder: the bubbles' dust and the notes' sparkles; the puffs at the keys (their own grains, sized by `powder`)
  const points = (max) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: dot, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, ...addKeepAlpha }));
    p.frustumCulled = false; scene.add(p); return p;
  };
  const MAX = 14000, PMAX = 40000;
  const powder = points(MAX), pg = powder.geometry, puff = points(PMAX), qg = puff.geometry;

  const debug = [], dustFade = { a: 0, b: 1 };
  const fadeAt = (y) => { const u = Math.min(1, Math.max(0, (dustFade.b - y) / (dustFade.b - dustFade.a))); return u * u * (3 - 2 * u); };
  // events: [{ id, on, dur, vel, color, from: () => {x,y} (the note), to: () => {x,y,w} (the key; w its width) }]
  // ss: one staff space on the paper, as a share of the picture's width (for the glows on the notes); fade: the whole
  // picture's light (1 in full, 0 black); rise: where the bubbles start to fade and where they are gone, as shares of
  // the way from the line of light (lineY) up to riseY (just under the music near the picture, even when that lies
  // below the bottom of the music's part; paperY, that bottom, when not given)
  // powder, flash: the puff and the flash at a struck key, as multiples of their usual strength (the Look tab's sliders,
  // stage.js; 1 by default, 0 none)
  function update(t, events, { aspect = 9 / 16, W = 1080, H = 1920, strength = 1, lineY = 0.1, paperY = 0.45, dark: darkK = 1, tone = null, ss = 0.01, fade: fadeK = 1, rise = [0.3, 0.8], riseY = null, powder: PM = 1, flash: FM = 1 } = {}) {
    // the darkness and the line of light take the paper's colour: a deep shade of it, and a pale glow of it
    if (tone && tone.join() !== toneKey) {
      toneKey = tone.join();
      const d = dark.material.uniforms.uDark.value.set(tone[1]), m = Math.max(d.r, d.g, d.b, 1e-4);
      d.setRGB(d.r / m, d.g / m, d.b / m).lerp(WHITE, 0.5).multiplyScalar(DEEP);
      line.material.uniforms.uColor.value.set(tone[0]).lerp(WHITE, 0.35).multiplyScalar(1.1);
    }
    fade.visible = fadeK < 1; fade.material.uniforms.uFade.value = fadeK;
    let bi = 0, fi = 0, ui = 0, e = 0, q = 0;
    const pos = pg.attributes.position.array, col = pg.attributes.color.array, qpos = qg.attributes.position.array, qcol = qg.attributes.color.array;
    powder.material.size = Math.max(1.2, H / 1000);   // teeny grains (about 2 px in a 1080 x 1920 picture)
    PM = Math.max(0, PM); FM = Math.max(0, FM);
    puff.material.size = powder.material.size * Math.min(PUFF.maxSize, 1 - PUFF.size + PUFF.size * PM);
    const puffB = Math.min(PUFF.maxBright, 1 - PUFF.bright + PUFF.bright * PM), puffS = 1 - PUFF.spread + PUFF.spread * PM;
    dark.material.uniforms.uLo.value = lineY; dark.material.uniforms.uHi.value = paperY; dark.material.uniforms.uK.value = darkK; dark.material.uniforms.uAspect.value = aspect;
    line.material.uniforms.uY.value = lineY; line.material.uniforms.uH.value = 3.2 / H;
    hotArr.fill(0);
    const grain = (x, y, c, k) => { if (e >= MAX) return; k *= 1.8; pos[e * 3] = x; pos[e * 3 + 1] = y; pos[e * 3 + 2] = 0; col[e * 3] = c.r * k; col[e * 3 + 1] = c.g * k; col[e * 3 + 2] = c.b * k; e++; };
    debug.length = 0;
    const top = riseY ?? paperY, fadeA = lineY + rise[0] * (top - lineY), fadeB = lineY + rise[1] * (top - lineY);   // the bubbles are gone before the music
    dustFade.a = fadeA; dustFade.b = fadeB;
    for (const ev of events) {
      const age = t - ev.on;
      if (age < 0) continue;
      const A = ev.to(), B = ev.from();      // the key, and its note on the paper
      if (!A) continue;
      const ax = A.x * W, ay = A.y * H;
      const v = SPEED * H, len = Math.max(0, (ev.dur || 0.2) * v);   // a bubble as long as the note is held
      const w0 = Math.max(4, (A.w || 0.012) * W * 0.62);
      const sH = age * v, sT = sH - len - 2 * w0;                    // its head and tail, above the key
      if (sT / H > fadeB - lineY + 0.05 && age > 1.6) continue;
      debug.push({ p: ev.pitch, age: +age.toFixed(2) });
      // the key's glow on the line
      const ki = Math.round(A.x * 63);
      if (ki >= 0 && ki < 64) { const hk = Math.max(0, 1 - age / Math.max(0.25, ev.dur || 0.2)) * (0.6 + 0.6 * ev.vel); for (let d = -2; d <= 2; d++) { const j = ki + d; if (j >= 0 && j < 64) hotArr[j] = Math.max(hotArr[j], hk * Math.exp(-d * d / 1.5)); } }
      // the bubble: rises straight up from its key, slowly, and fades away below the music
      const top = (fadeB - lineY) * H + 4 * w0;
      const s0 = Math.max(0, sT), s1 = Math.min(top, sH);
      if (s1 > s0 && bi < POOL) {
        const m = bubbles[bi++]; m.visible = true;
        const grow = 1 + 0.35 * ((s0 + s1) / 2) / top, w = w0 * grow, pad = w * 2.6 + 6;
        const p = m.geometry.attributes.position.array, l = m.geometry.attributes.aL.array;
        const c = (sv, side) => [(ax + side) / W, (ay + sv) / H, 0];
        p.set([...c(s0 - pad, w + pad), ...c(s0 - pad, -w - pad), ...c(s1 + pad, -w - pad), ...c(s1 + pad, w + pad)]);
        l.set([-pad, -w - pad, -pad, w + pad, s1 - s0 + pad, w + pad, s1 - s0 + pad, -w - pad]);
        m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.aL.needsUpdate = true;
        const U = m.material.uniforms;
        U.uColor.value.copy(ev.color); U.uLen.value = s1 - s0; U.uW.value = w; U.uTime.value = t; U.uSeed.value = rnd(ev.id, 3);
        U.uCutA.value = sT < 0 ? 1 : 0; U.uCutB.value = 0; U.uPad.value = pad;
        U.uFadeA.value = fadeA * H; U.uFadeB.value = fadeB * H;
        U.uAlpha.value = strength * (0.75 + 0.35 * ev.vel);
        // dust shed from its edges as it rises (fading out with it)
        const born = Math.min(age, (top + len) / v);
        for (let j = 0; j < 45 && e < MAX; j++) {
          const tb = born * (j + rnd(ev.id, j)) / 45, a2 = age - tb, life = 0.8 + 0.6 * rnd(j, ev.id);
          if (a2 < 0 || a2 > life) continue;
          const sb = Math.min(top, tb * v) - rnd(ev.id + 1, j) * Math.min(len, tb * v), side = (rnd(j + 2, ev.id) < 0.5 ? -1 : 1) * w * (0.8 + 0.4 * rnd(j, ev.id + 5));
          const k = a2 / life, x = ax + side + (side / w) * (6 + 22 * k) + 8 * Math.sin(a2 * 4 + j), y = ay + sb + 18 * k + 5 * Math.sin(a2 * 3 + j * 1.7);
          grain(x / W, y / H, ev.color, (1 - k) ** 1.5 * 0.8 * strength * (0.6 + 0.4 * Math.sin(a2 * 20 + j)) * fadeAt(y / H));
        }
      }
      // a white-hot flash where the key meets the line of light (above the flash's usual strength)
      if (FM > 1 && age < KEY_FLASH.life && ui < bursts.length) {
        const f = bursts[ui++], k = age / KEY_FLASH.life; f.visible = true;
        const sz = (A.w || 0.012) * KEY_FLASH.size * (0.6 + 0.4 * ev.vel) * (0.8 + 0.6 * Math.sqrt(k));
        f.position.set(A.x, A.y + 0.004 * aspect, 0); f.scale.set(sz, sz * aspect * 0.8, 1);
        f.material.color.copy(WHITE).lerp(ev.color, Math.min(1, k * 1.6)).multiplyScalar((1 - k) ** 1.8 * KEY_FLASH.gain * (FM - 1) * (0.6 + 0.6 * ev.vel) * strength);
      }
      // the key blows out a puff of sparkling dust that billows upward like smoke (PM times the grains, PUFF)
      {
        const count = Math.round((80 + 140 * ev.vel) * PM);
        for (let j = 0; j < count && q < PMAX; j++) {
          const life = 0.7 + 1.0 * rnd(ev.id + 11, j);
          if (age > life) continue;
          const k = age / life;
          const ang = Math.PI * (0.12 + 0.76 * rnd(j, ev.id + 13));              // mostly upward, fanning out
          const sp = (14 + 60 * rnd(j + 3, ev.id) ** 1.5) * (0.7 + 0.6 * ev.vel) * H / 1920 * puffS;
          const go = sp * (1 - Math.exp(-age * 4.0)) / 4.0 * 4.0;
          let x = Math.cos(ang) * go * 1.4, y = Math.sin(ang) * go;
          // a curl: grains on each side roll outward and up, like a puff of smoke
          const sd = x < 0 ? -1 : 1, turn = sd * 0.9 * Math.log(1 + age * 2.0) * (0.6 + 0.8 * rnd(ev.id + 17, j));
          const cx = sd * 10 * H / 1920, rx = x - cx, c = Math.cos(turn), s2 = Math.sin(turn);
          x = cx + rx * c - y * s2; y = rx * s2 + y * c;
          y += 40 * H / 1920 * age;                                                  // and the whole puff drifts slowly up
          x += 6 * Math.sin(age * 2.6 + j) * k;
          const wht = Math.max(0, 0.35 - age) / 0.35, tw = 0.7 + 0.3 * Math.sin(age * 22 + j);
          const f = (1 - k) ** 1.6 * (k < 0.03 ? k / 0.03 : 1) * 2.3 * strength * tw * puffB;
          qpos[q * 3] = (ax + x) / W; qpos[q * 3 + 1] = (ay + y) / H; qpos[q * 3 + 2] = 0;
          qcol[q * 3] = (ev.color.r * (1 - wht) + wht) * f; qcol[q * 3 + 1] = (ev.color.g * (1 - wht) + wht) * f; qcol[q * 3 + 2] = (ev.color.b * (1 - wht) + wht) * f; q++;
        }
      }
      // at the same moment its note on the paper glows and sparkles
      if (B) {
        if (age < 0.6 && fi < flashes.length) {
          const f = flashes[fi++], k = age / 0.6; f.visible = true;
          const sz = (FLASH.size[0] + (FLASH.size[1] - FLASH.size[0]) * ev.vel) * ss * (0.7 + 1.1 * Math.sqrt(k)) / 1.8;
          f.position.set(B.x, B.y, 0); f.scale.set(sz, sz * aspect, 1);
          f.material.color.copy(ev.color).lerp(WHITE, 0.45).multiplyScalar((1 - k) ** 1.6 * FLASH.gain * strength);
        }
        const count = Math.round(24 + 44 * ev.vel);
        for (let j = 0; j < count && e < MAX; j++) {
          const life = 0.5 + 0.7 * rnd(ev.id + 21, j);
          if (age > life) continue;
          const k = age / life, ang = rnd(j, ev.id + 23) * Math.PI * 2, sp = (0.01 + 0.03 * rnd(j + 7, ev.id)) * (1 - Math.exp(-age * 6));
          const x = Math.cos(ang) * sp + 0.004 * Math.sin(age * 5 + j), y = Math.sin(ang) * sp * 0.8 + 0.01 * k;
          const wht = Math.max(0, 0.3 - age) / 0.3, f = (1 - k) ** 1.5 * 2.3 * strength * (0.7 + 0.3 * Math.sin(age * 25 + j));
          if (e < MAX) { pos[e * 3] = B.x + x; pos[e * 3 + 1] = B.y + y * aspect * 1.2; pos[e * 3 + 2] = 0;
            col[e * 3] = (ev.color.r * (1 - wht) + wht) * f; col[e * 3 + 1] = (ev.color.g * (1 - wht) + wht) * f; col[e * 3 + 2] = (ev.color.b * (1 - wht) + wht) * f; e++; }
        }
      }
    }
    for (; bi < POOL; bi++) bubbles[bi].visible = false;
    for (; fi < flashes.length; fi++) flashes[fi].visible = false;
    for (; ui < bursts.length; ui++) bursts[ui].visible = false;
    pg.setDrawRange(0, Math.max(1, e));
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;
    puff.visible = q > 0; qg.setDrawRange(0, Math.max(1, q));
    qg.attributes.position.needsUpdate = true; qg.attributes.color.needsUpdate = true;
  }
  return { scene, cam, update, SPEED, LIFE, debug };
}
