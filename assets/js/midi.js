// MIDI in and out, and the shared note-event format every other part of the studio reads:
// { source, duration, tracks, tempoMap:[{time,bpm}], notes:[{pitch,name,onset,dur,vel,track,end}], pedal:[{time,down}] }
// Times are seconds. vel is 0..1. "end" is when the sound stops (later than onset+dur when the sustain pedal holds it).

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
export const isBlack = (p) => [1, 3, 6, 8, 10].includes(p % 12);

function finish(piece) {
  piece.notes.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
  // Sustain pedal: a note released while the pedal is down keeps sounding until the pedal lifts or the same key is struck again.
  const downs = [];
  let from = null;
  for (const p of piece.pedal) {
    if (p.down && from == null) from = p.time;
    else if (!p.down && from != null) { downs.push([from, p.time]); from = null; }
  }
  if (from != null) downs.push([from, Infinity]);
  const nextSame = new Map();
  for (let i = piece.notes.length - 1; i >= 0; i--) {
    const n = piece.notes[i], off = n.onset + n.dur;
    n.name = noteName(n.pitch);
    const held = downs.find(([a, b]) => off >= a && off < b);
    n.end = held ? Math.min(held[1], nextSame.get(n.pitch) ?? Infinity, off + 8) : off;
    nextSame.set(n.pitch, n.onset);
  }
  piece.duration = piece.notes.reduce((m, n) => Math.max(m, n.onset + n.dur), 0);
  const ids = [...new Set(piece.notes.map((n) => n.track))].sort((a, b) => a - b);
  for (const n of piece.notes) n.track = ids.indexOf(n.track);
  piece.tracks = ids.length;
  return piece;
}

export function parseMidi(buffer) {
  const d = new DataView(buffer);
  let p = 0;
  const u8 = () => d.getUint8(p++);
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (d.byteLength < 14 || tag() !== 'MThd') throw new Error('This is not a MIDI file.');
  const hlen = d.getUint32(p); p += 4;
  const format = d.getUint16(p), ntracks = d.getUint16(p + 2), division = d.getUint16(p + 4);
  p += hlen;
  if (division & 0x8000) throw new Error('This MIDI file uses a timing format the studio cannot read yet.');
  const ev = [], info = {};
  for (let tr = 0; tr < ntracks && p < d.byteLength - 8; tr++) {
    const id = tag(), len = d.getUint32(p); p += 4;
    const end = p + len;
    if (id !== 'MTrk') { p = end; tr--; continue; }
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      if (d.getUint8(p) & 0x80) status = u8();
      if (status === 0xff) {
        const type = u8(), l = vlq();
        if (type === 0x51 && l === 3) ev.push({ tick, order: 0, tempo: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        else if (type === 0x58 && l >= 2) { // time signature; a piece can change it (a one-beat pickup bar, for example)
          const m = [d.getUint8(p), 2 ** d.getUint8(p + 1)];
          if (!info.meter) info.meter = m;
          ev.push({ tick, order: 0, meter: m });
        }
        else if (type === 0x03 && l > 0 && !info.label) { // a track's name: the first meaningful one usually names the piece
          const s = new TextDecoder().decode(new Uint8Array(d.buffer, d.byteOffset + p, l)).trim();
          if (/[a-z]/i.test(s) && !/^(control track|track ?\d*|piano|untitled|sequence|right hand|left hand|staff|unnamed)\b/i.test(s)) info.label = s;
        }
        else if (type === 0x59 && l >= 2 && !info.key) info.key = { sf: d.getInt8(p), minor: d.getUint8(p + 1) === 1 }; // key signature: sharps (+) or flats (-)
        p += l;
      } else if (status === 0xf0 || status === 0xf7) { p += vlq(); }
      else {
        const hi = status & 0xf0, ch = status & 0x0f, a = u8(), b = hi === 0xc0 || hi === 0xd0 ? 0 : u8();
        const track = format === 0 ? ch : tr;
        if (hi === 0x90 && b > 0) ev.push({ tick, order: 2, on: a, vel: b / 127, track, ch });
        else if (hi === 0x80 || hi === 0x90) ev.push({ tick, order: 1, off: a, track, ch });
        else if (hi === 0xb0 && a === 64) ev.push({ tick, order: 1, pedal: b >= 64 });
      }
    }
    p = end;
  }
  ev.sort((x, y) => x.tick - y.tick || x.order - y.order);
  const piece = { source: 'midi', notes: [], pedal: [], tempoMap: [], meterMap: [], ...info };
  let tempo = 500000, lastTick = 0, time = 0;
  const open = new Map();
  for (const e of ev) {
    time += ((e.tick - lastTick) * tempo) / division / 1e6;
    lastTick = e.tick;
    if (e.tempo) { tempo = e.tempo; piece.tempoMap.push({ time, bpm: Math.round(6e7 / tempo) }); }
    else if (e.meter) { const last = piece.meterMap[piece.meterMap.length - 1]; if (last && Math.abs(last.time - time) < 1e-6) last.meter = e.meter; else piece.meterMap.push({ time, meter: e.meter }); }
    else if (e.pedal != null) piece.pedal.push({ time, down: e.pedal });
    else if (e.on != null) {
      const k = e.track * 2048 + e.ch * 128 + e.on;
      open.set(k, [...(open.get(k) || []), { pitch: e.on, onset: time, vel: e.vel, track: e.track }]);
    } else {
      const k = e.track * 2048 + e.ch * 128 + e.off, n = (open.get(k) || []).shift();
      if (n) { n.dur = Math.max(0.03, time - n.onset); piece.notes.push(n); }
    }
  }
  for (const list of open.values()) for (const n of list) { n.dur = 0.5; piece.notes.push(n); }
  if (!piece.notes.length) throw new Error('This MIDI file has no notes in it.');
  return finish(piece);
}

// Live playing captured from the piano: events are { t (seconds), on|off: pitch, vel } or { t, pedal: true|false }.
export function fromRecording(events) {
  const first = events.find((e) => e.on != null);
  if (!first) throw new Error('No notes were played.');
  const shift = first.t - 0.5;
  const piece = { source: 'recording', notes: [], pedal: [], tempoMap: [] };
  const open = new Map();
  let last = 0;
  for (const e of events) {
    const time = Math.max(0, e.t - shift);
    last = Math.max(last, time);
    if (e.pedal != null) piece.pedal.push({ time, down: e.pedal });
    else if (e.on != null) open.set(e.on, { pitch: e.on, onset: time, vel: e.vel, track: 0 });
    else if (open.has(e.off)) { const n = open.get(e.off); open.delete(e.off); n.dur = Math.max(0.03, time - n.onset); piece.notes.push(n); }
  }
  for (const n of open.values()) { n.dur = Math.max(0.03, last - n.onset); piece.notes.push(n); }
  return finish(piece);
}

// Standard MIDI file (format 0, 120 bpm, 480 ticks per quarter = 960 ticks per second) so recordings can be kept and reopened.
export function writeMidi(piece) {
  const ev = [];
  for (const n of piece.notes) {
    ev.push([Math.round(n.onset * 960), 1, [0x90, n.pitch, Math.max(1, Math.round(n.vel * 127))]]);
    ev.push([Math.round((n.onset + n.dur) * 960), 0, [0x80, n.pitch, 0]]);
  }
  for (const p of piece.pedal) ev.push([Math.round(p.time * 960), 0, [0xb0, 64, p.down ? 127 : 0]]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const body = [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20];
  let last = 0;
  const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); return out; };
  for (const [tick, , bytes] of ev) { body.push(...vlq(tick - last), ...bytes); last = tick; }
  body.push(0x00, 0xff, 0x2f, 0x00);
  const out = new Uint8Array(22 + body.length), d = new DataView(out.buffer);
  out.set([0x4d, 0x54, 0x68, 0x64]); d.setUint32(4, 6); d.setUint16(8, 0); d.setUint16(10, 1); d.setUint16(12, 480);
  out.set([0x4d, 0x54, 0x72, 0x6b], 14); d.setUint32(18, body.length); out.set(body, 22);
  return out;
}

// A short original pattern so the studio can be tried before any real recording exists.
export function demoPiece() {
  const piece = { source: 'demo', notes: [], pedal: [], tempoMap: [{ time: 0, bpm: 96 }] };
  const beat = 60 / 96, chords = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]];
  const shape = [0, 1, 2, 1, 2, 1, 0, 1];
  let t = 0.5;
  for (let bar = 0; bar < 8; bar++) {
    const c = chords[bar % 4], loud = 0.45 + 0.4 * Math.sin((bar / 7) * Math.PI);
    piece.pedal.push({ time: t, down: true });
    for (const pitch of c) piece.notes.push({ pitch, onset: t, dur: beat * 3.8, vel: loud * 0.8, track: 1 });
    shape.forEach((s, i) => piece.notes.push({ pitch: c[s] + 24 + (bar >= 4 && i % 4 === 3 ? 12 : 0), onset: t + i * beat / 2, dur: beat * 0.45, vel: loud + (i % 4 === 0 ? 0.12 : 0), track: 0 }));
    t += beat * 4;
    piece.pedal.push({ time: t - 0.05, down: false });
  }
  for (const pitch of [48, 55, 64, 72]) piece.notes.push({ pitch, onset: t, dur: beat * 4, vel: 0.5, track: pitch < 60 ? 1 : 0 });
  return finish(piece);
}
