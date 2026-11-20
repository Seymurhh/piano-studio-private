// The studio's instruments. Most are real recordings (sample packs in assets/sounds/) played back at the right pitch and
// loudness; "Simple synth" needs no files. The same code makes the live sound, playback, and the sound in exported videos.
// Credits: grand piano = Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), recordings of a Yamaha C5 grand.
// Electric grand, electric piano and harpsichord = FluidR3 GM by Frank Wen (MIT). See assets/sounds/CREDITS.txt.

const V = '?v=7';
// Phones have little memory, and a browser tab that uses too much is closed without warning. On a phone each instrument
// keeps one recording per note, in mono, at most six seconds long: about a sixth of what a computer loads.
const LITE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.deviceMemory || 8) <= 2;
function slim(buf) {
  const n = Math.min(buf.length, Math.floor(buf.sampleRate * 6)), out = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: buf.sampleRate }), d = out.getChannelData(0), fade = Math.floor(buf.sampleRate * 1.2);
  for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] += x[i] / buf.numberOfChannels; }
  if (n < buf.length) for (let k = 0; k < fade; k++) d[n - 1 - k] *= k / fade;
  return out;
}
export const INSTRUMENTS = [
  { id: 'grand', name: 'Concert Grand', about: 'A real Yamaha C5 grand, recorded note by note. Soft and loud playing use different recordings.', pack: 'grand', gain: 1 },
  { id: 'bright', name: 'Bright Grand', about: 'The same grand voiced brighter and harder, the way pop and stage pianos are set up.', pack: 'grand', gain: 0.9, bias: 0.3,
    eq: [['highshelf', 3200, 6], ['peaking', 1800, 2.5]] },
  { id: 'felt', name: 'Soft Felt', about: 'The grand played with felt over the strings: close, warm and quiet. Good for slow pieces.', pack: 'grand', gain: 0.95, bias: -2, attack: 0.012, lp: [900, 2600],
    eq: [['lowshelf', 220, 3]] },
  { id: 'upright', name: 'Honky-tonk Upright', about: 'Two slightly out-of-tune strings per note, like an old saloon upright.', pack: 'grand', gain: 0.62, bias: 0.12, detune: 8,
    eq: [['highpass', 110, 0], ['peaking', 1500, 4], ['lowpass', 7500, 0]] },
  { id: 'egrand', name: 'Electric Grand', about: 'The stage piano of the 1970s and 80s: strings with pickups, bright and glassy.', pack: 'electric_grand_piano', gain: 3.6, lp: [2500, 14000], release: 0.1 },
  { id: 'epiano', name: 'Electric Piano', about: 'A warm, bell-like electric piano in the style of a Rhodes. Jazz and soul.', pack: 'electric_piano_1', gain: 2.2, lp: [1800, 12000], release: 0.09 },
  { id: 'harpsi', name: 'Harpsichord', about: 'Plucked strings, the keyboard Bach wrote for. Every note is the same loudness, as on the real thing.', pack: 'harpsichord', gain: 2.8, flat: 0.75, release: 0.05 },
  { id: 'synth', name: 'Simple Synth', about: 'A plain electronic tone. Loads instantly and needs no sound files.', pack: null, gain: 1 },
];
export const ROOMS = [
  { id: 'dry', name: 'Close', seconds: 0, wet: 0 },
  { id: 'room', name: 'Room', seconds: 0.9, wet: 0.5 },
  { id: 'hall', name: 'Concert hall', seconds: 2.6, wet: 0.6 },
];
export const instrument = (id) => INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];
export const room = (id) => ROOMS.find((r) => r.id === id) || ROOMS[0];

// ---------- sample packs: [uint32 header length][JSON {files:[{p: pitch, l: layer, o: offset, n: bytes}]}][mp3 data] ----------
const packs = new Map(); // name -> Promise<{ layers: [ Map(pitch -> { p, buf, start }) ], pick: [ [index per pitch] ] }>
let decoder = null;

async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('The sound files could not be loaded.');
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const out = new Uint8Array(total), reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > total) return new Uint8Array(await (await fetch(url)).arrayBuffer()); // compressed transfer: sizes differ
    out.set(value, got); got += value.length;
    onProgress?.(0.6 * got / total);
  }
  return out.subarray(0, got);
}

function prepare(buf) {
  // MP3 files begin with a few milliseconds of silence. Find where the sound really starts so a key press is heard at once.
  const d = buf.getChannelData(0), limit = Math.min(d.length, Math.floor(buf.sampleRate * 0.25));
  let i = 0;
  while (i < limit && Math.abs(d[i]) < 0.0025) i++;
  // Short recordings (about three seconds) end while still sounding: fade their last quarter second.
  if (buf.duration < 4) {
    const n = Math.floor(buf.sampleRate * 0.3);
    for (let c = 0; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let k = 0; k < n; k++) x[x.length - 1 - k] *= k / n; }
  }
  return Math.max(0, i / buf.sampleRate - 0.002);
}

function loadPack(name, onProgress) {
  if (!packs.has(name)) {
    packs.set(name, (async () => {
      const bytes = await fetchBytes(`assets/sounds/${name}.pack${V}`, onProgress);
      const hlen = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hlen))), base = 4 + hlen;
      decoder = decoder || new OfflineAudioContext(2, 1, 44100);
      const layers = [];
      let done = 0;
      const top = Math.max(...head.files.map((f) => f.l)), files = LITE ? head.files.filter((f) => f.l === top) : head.files;
      const one = async (f) => {
        let buf = await decoder.decodeAudioData(bytes.slice(base + f.o, base + f.o + f.n).buffer);
        const start = prepare(buf);
        if (LITE) buf = slim(buf);
        const l = LITE ? 0 : f.l;
        (layers[l] = layers[l] || []).push({ p: f.p, buf, start });
        onProgress?.(0.6 + 0.4 * ++done / files.length);
      };
      if (LITE) for (const f of files) await one(f); // one at a time, so the full-size recordings are never all in memory together
      else await Promise.all(files.map(one));
      // for every key, the recording closest in pitch
      const pick = layers.map((list) => Array.from({ length: 128 }, (_, p) => list.reduce((a, b) => (Math.abs(b.p - p) < Math.abs(a.p - p) ? b : a))));
      return { pick };
    })().catch((e) => { packs.delete(name); throw e; }));
  }
  return packs.get(name);
}

const ready = new Map(); // pack name -> decoded pack, once loaded
export async function loadInstrument(id, onProgress) {
  const inst = instrument(id);
  if (inst.pack && !ready.has(inst.pack)) ready.set(inst.pack, await loadPack(inst.pack, onProgress));
  onProgress?.(1);
  return inst;
}
export const isLoaded = (id) => { const i = instrument(id); return !i.pack || ready.has(i.pack); };

// ---------- the room: a reverb made from shaped noise, the same every time so a video sounds exactly like playback ----------
function impulse(ctx, seconds) {
  const rate = ctx.sampleRate, pre = Math.floor(rate * 0.012), n = Math.floor(rate * seconds) + pre, buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 1234567 + c * 7919, low = 0;
    for (let i = pre; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = (i - pre) / rate, white = seed / 2147483648 - 1;
      const k = 0.55 * Math.exp(-t * 2.2 / seconds) + 0.06; // the tail gets darker as it fades, as in a real hall
      low += k * (white - low);
      d[i] = low * Math.exp(-6.9 * t / seconds) * Math.min(1, t / 0.004);
    }
  }
  return buf;
}

// Everything the notes pass through: instrument tone, room, limiter, volume. Notes connect to .input.
export function makeOutput(ctx, opts = {}) {
  const inst = instrument(opts.instrument), rm = room(opts.room);
  const input = ctx.createGain(), sum = ctx.createGain(), comp = ctx.createDynamicsCompressor(), vol = ctx.createGain();
  let tail = input;
  for (const [type, freq, gain] of inst.eq || []) {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.gain.value = gain; f.Q.value = 0.8;
    tail.connect(f); tail = f;
  }
  tail.connect(sum);
  if (rm.wet) {
    const conv = ctx.createConvolver(), wet = ctx.createGain();
    conv.buffer = impulse(ctx, rm.seconds); wet.gain.value = rm.wet * 2.2;
    tail.connect(conv); conv.connect(wet); wet.connect(sum);
  }
  input.gain.value = 0.95;
  comp.threshold.value = -9; comp.knee.value = 9; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  vol.gain.value = opts.volume ?? 1;
  sum.connect(comp); comp.connect(vol); vol.connect(ctx.destination);
  return { input, tap: vol, instrument: inst, tail: rm.seconds,
    setVolume(v) { vol.gain.value = v; },
    close() { vol.gain.setTargetAtTime(0, ctx.currentTime, 0.03); setTimeout(() => vol.disconnect(), 400); } };
}

// ---------- one note ----------
const smooth = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };

// Start a note at context time `when`. Returns { release(at) }: call it when the key (or the pedal) lets go.
export function noteOn(ctx, out, pitch, vel, when = 0) {
  const inst = out.instrument, set = inst.pack && ready.get(inst.pack);
  when = Math.max(when, ctx.currentTime);
  if (!set) return synthNote(ctx, out.input, pitch, vel, when);
  const v = inst.flat ?? vel, amp = (0.03 + 0.97 * v ** 1.7) * inst.gain;
  const env = ctx.createGain();
  if (inst.attack) { env.gain.setValueAtTime(0, when); env.gain.linearRampToValueAtTime(1, when + inst.attack); }
  let dest = env;
  if (inst.lp) { // one recording per note: make soft notes rounder and loud notes brighter with a filter
    const f = ctx.createBiquadFilter(), hz = 440 * 2 ** ((pitch - 69) / 12);
    f.type = 'lowpass'; f.Q.value = 0.5; f.frequency.value = Math.min(18000, Math.max(inst.lp[0] + (inst.lp[1] - inst.lp[0]) * v, hz * (1.5 + 5 * v)));
    f.connect(env); dest = f;
  }
  env.connect(out.input);
  const sources = [];
  const add = (layer, gain, cents) => {
    const s = set.pick[layer][pitch], src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = s.buf; src.playbackRate.value = 2 ** ((pitch - s.p + cents / 100) / 12); g.gain.value = gain;
    src.connect(g); g.connect(dest); src.start(when, s.start); sources.push(src);
  };
  const spread = inst.detune ? [-inst.detune * (0.7 + ((pitch * 7) % 5) * 0.12), inst.detune * (0.8 + ((pitch * 3) % 4) * 0.1)] : [0];
  if (set.pick.length > 1) { // soft and loud recordings, blended by how hard the key was struck
    const x = smooth((vel + (inst.bias || 0) - 0.3) / 0.5);
    for (const c of spread) {
      if (x < 0.98) add(0, amp * Math.sqrt(1 - x) * 2.3, c);
      if (x > 0.02) add(1, amp * Math.sqrt(x), c);
    }
  } else for (const c of spread) add(0, amp, c);
  return {
    release(at) {
      at = Math.max(at, when + 0.03);
      // The top octave and a half of a piano has no dampers: those notes ring on. Low strings take longer to stop than high ones.
      const tau = inst.release ?? (pitch >= 90 && inst.pack === 'grand' ? 0.9 : 0.16 - 0.1 * Math.min(1, Math.max(0, (pitch - 30) / 60)));
      env.gain.setTargetAtTime(0, at, tau);
      for (const s of sources) s.stop(at + tau * 7 + 0.05);
    },
  };
}

function synthNote(ctx, dest, pitch, vel, when) {
  const f = 440 * 2 ** ((pitch - 69) / 12), peak = 0.02 + 0.16 * vel * vel;
  const tau = Math.max(0.3, 2.4 - ((pitch - 21) / 87) * 2); // low notes ring longer
  const env = ctx.createGain(), tone = ctx.createBiquadFilter(), oscs = [];
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + 0.006);
  env.gain.setTargetAtTime(0, when + 0.006, tau);
  tone.type = 'lowpass'; tone.frequency.value = Math.min(11000, f * (3 + 6 * vel));
  tone.connect(env); env.connect(dest);
  for (const [mult, type, gain] of [[1, 'triangle', 1], [2, 'sine', 0.28], [3, 'sine', 0.1 * vel]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f * mult; g.gain.value = gain;
    o.connect(g); g.connect(tone); o.start(when); oscs.push(o);
  }
  return {
    release(at) {
      at = Math.max(at, when + 0.03);
      env.gain.cancelScheduledValues(at);
      env.gain.setTargetAtTime(0, at, 0.07);
      for (const o of oscs) o.stop(at + 0.6);
    },
  };
}

// A whole note whose length is already known (playback and video).
export function voice(ctx, out, pitch, vel, when, length) {
  noteOn(ctx, out, pitch, vel, when).release(Math.max(when, ctx.currentTime) + Math.max(length, 0.05));
}

// Render the whole piece to a stereo buffer (for video export). The instrument must be loaded first.
export async function renderPiece(piece, lead, tail, opts = {}, rate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil((lead + piece.duration + tail) * rate), rate);
  const out = makeOutput(ctx, opts);
  for (const n of piece.notes) voice(ctx, out, n.pitch, n.vel, lead + n.onset, n.end - n.onset);
  return ctx.startRendering();
}
