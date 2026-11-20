// Listens to music (the microphone, or the studio's own sound) and describes it in a few numbers the dancer can use:
// how loud it is, where the beat falls, how fast it is, and what kind of movement it calls for.
// It does not recognise genres by name. It measures four things — how clear the beat is, the tempo, how many
// attacks there are each second (drum hits, plucked or struck notes), and loudness — and chooses a way of dancing from those.

export const STYLES = ['flow', 'sway', 'groove', 'energy'];
export const STYLE_NAMES = { flow: 'Flowing', sway: 'Swaying', groove: 'Groove', energy: 'Energetic' };

const HOP = 0.01, HIST = 800; // the "attack" curve is kept at 100 points a second, for the last 8 seconds
const BANDS = 24;
const bell = (x, mid, width) => Math.exp(-0.5 * ((x - mid) / width) ** 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createListener(ctx) {
  const node = ctx.createAnalyser();
  node.fftSize = 2048; node.smoothingTimeConstant = 0; node.minDecibels = -100; node.maxDecibels = 0;
  const wave = new Float32Array(2048), spec = new Float32Array(node.frequencyBinCount);
  const hzPerBin = ctx.sampleRate / node.fftSize;
  // band edges: 24 bands from 40 Hz to 9 kHz, evenly spaced as the ear hears them
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((40 * (9000 / 40) ** (i / BANDS)) / hzPerBin)));
  const prev = new Float32Array(BANDS), env = new Float32Array(HIST), scratch = new Float32Array(HIST);
  const F = { active: false, level: 0, hit: 0, beat: 0, bpm: 100, step: 100, clear: 0, rate: 0, style: 'flow', mix: { flow: 1, sway: 0, groove: 0, energy: 0 }, bands: new Float32Array(BANDS) };
  let last = 0, head = 0, carry = 0, peak = 0.02, slow = 0, quiet = 99, period = 0.6, nextTempo = 0, fluxAvg = 0.001, candidate = 'flow', since = 0;
  const tempos = [];

  function tempo() {
    // 1) how strongly does the attack curve repeat at each beat length between 60 and 180 beats a minute?
    let mean = 0;
    for (let i = 0; i < HIST; i++) mean += env[i];
    mean /= HIST;
    for (let i = 0; i < HIST; i++) scratch[i] = env[(head + i) % HIST] - mean; // oldest first
    let zero = 1e-9;
    for (let i = 0; i < HIST; i++) zero += scratch[i] * scratch[i];
    const ac = (lag) => { let s = 0; for (let i = lag; i < HIST; i++) s += scratch[i] * scratch[i - lag]; return s / zero; };
    let best = 0, bestLag = 60, scores = [];
    for (let lag = 33; lag <= 100; lag++) {
      // a real beat also repeats at two and three times its length
      const s = (ac(lag) + 0.5 * ac(lag * 2) + 0.25 * ac(lag * 3)) * (0.6 + 0.4 * bell(Math.log2(60 / (lag * HOP) / 112), 0, 0.55));
      scores[lag] = s;
      if (s > best) { best = s; bestLag = lag; }
    }
    const a = scores[bestLag - 1] ?? best, c = scores[bestLag + 1] ?? best, d = a - 2 * best + c;
    const lag = bestLag + (d ? (0.5 * (a - c)) / d : 0);
    tempos.push(60 / (lag * HOP)); if (tempos.length > 7) tempos.shift();
    const sorted = [...tempos].sort((x, y) => x - y), bpm = sorted[sorted.length >> 1];
    // a clear beat stands well above the other beat lengths; a smooth sound scores about the same at all of them
    const all = scores.slice(33).sort((x, y) => x - y), typical = all[all.length >> 1];
    const sharpness = clamp01((best - typical) * 3.2);
    F.bpm += (bpm - F.bpm) * (Math.abs(bpm - F.bpm) > 12 ? 1 : 0.3);
    // The dancer steps between 70 and 140 times a minute: faster music is danced at half speed, as people do.
    let step = F.bpm; while (step > 140) step /= 2; while (step < 70) step *= 2;
    period = 60 / step; F.step = step;
    // 2) where in the beat are we? Try every position and keep the one where the attacks line up best.
    const P = period / HOP;
    let top = -1, at = 0;
    for (let o = 0; o < P; o++) {
      let s = 0;
      for (let k = 0; k < 10; k++) { const i = HIST - 1 - Math.round(o + k * P); if (i < 0) break; s += scratch[i] * (1 - k * 0.07); }
      if (s > top) { top = s; at = o; }
    }
    const measured = ((at * HOP + 0.03) / period) % 1; // 0.03 s: roughly the delay of the microphone
    let err = measured - (F.beat % 1); err -= Math.round(err);
    F.beat += err * 0.35 * F.clear;
    // 3) how many separate attacks are there each second? An attack is a jump that stands well above the steady
    //    shimmer of held sound; where nothing stands out (a soft pad, a held chord), there is no beat to speak of.
    const sorted2 = Float32Array.from(env).sort(), strong = sorted2[HIST - 4], usual = sorted2[HIST >> 1];
    const stands = clamp01((strong / (usual + 0.05 * strong + 1e-6) - 3.5) / 3), limit = 0.4 * strong - mean;
    let count = 0, lastPeak = -99;
    for (let i = 6; i < HIST - 6; i++) {
      if (scratch[i] < limit || i - lastPeak < 7) continue;
      let top = true;
      for (let k = 1; k <= 5 && top; k++) top = scratch[i] >= scratch[i - k] && scratch[i] >= scratch[i + k];
      if (top) { count++; lastPeak = i; }
    }
    F.rate += ((count / (HIST * HOP)) * stands - F.rate) * 0.35;
    // a real beat keeps its tempo; free playing gives a different answer every half second
    const fold = tempos.map((v) => { while (v > 140) v /= 2; while (v < 70) v *= 2; return v; }).sort((x, y) => x - y);
    const spread = fold.length < 5 ? 1 : (fold[fold.length - 2] - fold[1]) / fold[fold.length >> 1], steady = clamp01(1.2 - spread / 0.07);
    F.clear += (sharpness * stands * steady - F.clear) * 0.35;
  }

  function choose(dt, loud) {
    const c = F.clear, r = F.rate, bpm = F.bpm;
    const score = {
      flow: (1 - c) * 1.2 + bell(r, 0.8, 1.0) * 0.4,
      sway: c * 0.6 + bell(r, 1.4, 0.7) * 0.7 + bell(bpm, 90, 25) * 0.2,
      groove: c * 0.6 + bell(r, 2.7, 0.6) * 0.7 + bell(bpm, 108, 22) * 0.3,
      energy: c * 0.6 + clamp01((r - 3) / 0.8) * 0.9 + clamp01((bpm - 116) / 20) * 0.5 + loud * 0.1,
    };
    let top = STYLES[0];
    for (const k of STYLES) if (score[k] > score[top]) top = k;
    // change style only when the new one has led for a few seconds, so the dancer does not flicker between two
    if (top === candidate) since += dt; else { candidate = top; since = 0; }
    if (candidate !== F.style && since > 2.5) F.style = candidate;
    for (const k of STYLES) F.mix[k] += ((k === F.style ? 1 : 0) - F.mix[k]) * Math.min(1, dt * 1.6);
  }

  // Call once per frame with the time in seconds. Returns the same object each time, updated.
  function update(now) {
    const dt = Math.min(0.25, Math.max(0.001, now - (last || now - 0.016))); last = now;
    node.getFloatTimeDomainData(wave);
    let sq = 0;
    for (let i = 0; i < wave.length; i++) sq += wave[i] * wave[i];
    const rms = Math.sqrt(sq / wave.length);
    quiet = rms > 0.004 ? 0 : quiet + dt;
    F.active = quiet < 1.5;
    slow += (rms - slow) * Math.min(1, dt * 3);
    peak = Math.max(slow, peak * Math.exp(-dt / 15), 0.01);
    F.level = F.active ? clamp01(slow / peak) : 0;
    const loud = clamp01((20 * Math.log10(rms + 1e-6) + 46) / 30);

    node.getFloatFrequencyData(spec);
    let flux = 0;
    for (let b = 0; b < BANDS; b++) {
      let m = 0;
      for (let i = edges[b]; i < Math.max(edges[b] + 1, edges[b + 1]); i++) m += 10 ** (spec[i] / 20);
      const v = Math.log1p(m * 300);
      if (v > prev[b]) flux += v - prev[b];
      prev[b] = v;
      F.bands[b] += (clamp01(v / 4) - F.bands[b]) * Math.min(1, dt * 14);
    }
    fluxAvg += (flux - fluxAvg) * Math.min(1, dt * 0.4);
    const rel = flux / (fluxAvg + 0.05);
    F.hit = Math.max(F.hit * Math.exp(-dt / 0.14), clamp01((rel - 1.6) / 3));
    // write the attack curve at a steady 100 points a second, whatever the frame rate
    carry += dt;
    while (carry >= HOP) { env[head] = F.active ? flux : 0; head = (head + 1) % HIST; carry -= HOP; }

    F.beat += dt / period;
    if (now >= nextTempo) { nextTempo = now + 0.5; if (F.active) tempo(); else { F.clear *= 0.8; } }
    choose(dt, loud);
    return F;
  }
  return { node, update, features: F };
}
