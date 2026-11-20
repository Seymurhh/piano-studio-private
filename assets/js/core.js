// Shared helpers: encryption, DOM building, icons, dates.
// Everything personal is encrypted in the browser (AES-256-GCM). The passphrase never leaves the device.

export const ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();

export const b64 = {
  to(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  from(str) {
    const s = atob(str), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const newRawKey = () => rand(32);
export const newId = () => Array.from(rand(8), (b) => b.toString(16).padStart(2, '0')).join('');

export const importKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function passKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Encrypted bytes are stored as: 12-byte IV followed by ciphertext.
export async function sealBytes(key, bytes) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
export async function openBytes(key, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

// A vault file = a random data key wrapped by the passphrase, plus the body encrypted with the data key.
export async function wrapSection(pass, rawKey) {
  const salt = rand(16);
  const k = await passKey(pass, salt, ITER);
  return { kdf: { name: 'PBKDF2-SHA256', iter: ITER, salt: b64.to(salt) }, wrap: b64.to(await sealBytes(k, rawKey)) };
}
export async function sealVault(section, rawKey, data) {
  const key = await importKey(rawKey);
  return { v: 1, ...section, body: b64.to(await sealBytes(key, te.encode(JSON.stringify(data)))) };
}
export async function unwrapVault(pass, vault) {
  const k = await passKey(pass, b64.from(vault.kdf.salt), vault.kdf.iter);
  return openBytes(k, b64.from(vault.wrap)); // throws when the passphrase is wrong
}
export async function readVault(rawKey, vault) {
  const key = await importKey(rawKey);
  return JSON.parse(td.decode(await openBytes(key, b64.from(vault.body))));
}

export async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

// Keys stay only for this browser tab and are cleared by "Lock" or closing the tab.
const SKEY = 'journal.keys';
export const session = {
  save(keys) { try { sessionStorage.setItem(SKEY, JSON.stringify(keys)); } catch {} },
  load() { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch { return null; } },
  clear() { try { sessionStorage.removeItem(SKEY); } catch {} },
};

// ---------- seals: a fingerprint of an entry, published without its content, so its date and wording can be checked later ----------
export async function sha256hex(data) {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
export const sealHash = (e) => sha256hex(JSON.stringify([e.seal.salt, e.title, e.dateStart || '', e.dateEnd || '', e.datePrecision, e.category, e.subActivity || '',
  e.description || '', e.reflection || '', e.parentNote || '', e.mediaDigest || '']));
export const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// ---------- DOM ----------
export const $ = (s, r = document) => r.querySelector(s);
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
  chess: 'M15 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0zM9.5 10h5M10 10c0 4-3 5-3 9h10c0-4-3-5-3-9M6 21h12',
  math: 'M5 7h5M7.5 4.5v5M14 7h5M5 16.5h5M14.5 14.5l4 4M18.5 14.5l-4 4',
  art: 'M9 14L19 4a1.5 1.5 0 0 1 2 2L11 16M9 14l2 2M9 14c-2 0-3.500 1.500-3.500 3.500c0 1.500-1.500 2.500-2.500 2.500c4 1 8-.5 8-4',
  sports: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM5.500 5.500c3.500 3.500 3.500 9.500 0 13M18.500 5.500c-3.500 3.500-3.500 9.500 0 13',
  projects: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.500 15h9',
  community: 'M12 20s-7-4.500-7-10a4 4 0 0 1 7-2.500A4 4 0 0 1 19 10c0 5.500-7 10-7 10z',
  star: 'M12 3l2.700 5.600 6.100.800-4.500 4.300 1.100 6.100L12 16.900 6.600 19.800l1.100-6.100L3.200 9.400l6.100-.8z',
  book: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10',
  lock: 'M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3',
  play: 'M8 5l11 7-11 7z',
  image: 'M4 5h16v14H4zM4 16l4.500-4.500 3.500 3.500 3-3 5 5',
  audio: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  x: 'M6 6l12 12M18 6L6 18',
};
export const ICON_NAMES = ['music', 'chess', 'math', 'art', 'sports', 'projects', 'community', 'star', 'book'];
export const COLORS = ['teal', 'navy', 'gold', 'coral', 'green', 'plum', 'rose', 'slate'];

export function icon(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.star);
  svg.append(p);
  return svg;
}

// ---------- dates ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const season = (m) => (m === 12 || m <= 2 ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Fall');
export const hasDate = (e) => !!e.dateStart && e.datePrecision !== 'unknown';
export function fmtDate(e) {
  if (!hasDate(e)) return 'Date to be confirmed';
  const one = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    if (e.datePrecision === 'year') return String(y);
    if (e.datePrecision === 'season') return `${season(m)} ${y}`;
    if (e.datePrecision === 'month') return `${MONTHS[m - 1]} ${y}`;
    return `${MONTHS[m - 1]} ${day}, ${y}`;
  };
  const a = one(e.dateStart), b = e.dateEnd ? one(e.dateEnd) : a;
  return a === b ? a : `${a} – ${b}`;
}
export function sortEntries(list) {
  return [...list].sort((a, b) => {
    const da = hasDate(a), db = hasDate(b);
    if (da !== db) return da ? -1 : 1;
    if (da && a.dateStart !== b.dateStart) return a.dateStart < b.dateStart ? 1 : -1;
    return (a.sortOrder || 0) - (b.sortOrder || 0) || (a.title || '').localeCompare(b.title || '');
  });
}
export const yearOf = (e) => (hasDate(e) ? e.dateStart.slice(0, 4) : 'Date to be confirmed');

// ---------- media ----------
const urlCache = new Map();
export async function mediaURL(m, keys, thumb = false) {
  const id = m.id + (thumb ? '.t' : '');
  if (urlCache.has(id)) return urlCache.get(id);
  const key = keys[m.key];
  if (!key) throw new Error('locked');
  const r = await fetch(`media/${id}.enc`, { cache: 'no-store' });
  if (!r.ok) throw new Error('missing');
  const plain = await openBytes(key, new Uint8Array(await r.arrayBuffer()));
  const url = URL.createObjectURL(new Blob([plain], { type: thumb ? 'image/jpeg' : m.mime }));
  urlCache.set(id, url);
  return url;
}
export const dropMediaCache = (id) => { urlCache.delete(id); urlCache.delete(id + '.t'); };
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'Document', midi: 'MIDI', file: 'File' };
export const KIND_ICON = { image: 'image', video: 'play', audio: 'audio', pdf: 'file', midi: 'music', file: 'file' };
