// Opening and closing cards for the videos: the name of the piece, the composer and the credits, drawn over the
// picture before the music starts and after it ends. Like the rest of the picture they depend only on time, so the
// preview on the page and every exported frame match. Three looks: Lumen (centred, gold line), Minimal (a quiet
// block at the lower left) and Cinematic (wide spaced capitals revealed by a sweep of light).
export const OPEN = 5, CLOSE = 7; // seconds each card lasts
export const STYLES = { lumen: 'Lumen', minimal: 'Minimal', cinema: 'Cinematic' };

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const ease = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif', SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const IVORY = '#efe6d2';

function wrap(g, text, maxW) { // split text into lines that fit
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (line && g.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
function text(g, str, x, y, { font, color = IVORY, alpha = 1, align = 'center', spacing = '0px', glow = 0, glowColor = '#fff', maxW = Infinity, lh = 1.2 }) {
  if (!str || alpha <= 0.002) return y;
  g.save();
  g.font = font; g.fillStyle = color; g.globalAlpha *= alpha; g.textAlign = align; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = spacing;
  if (glow) { g.shadowColor = glowColor; g.shadowBlur = glow; }
  const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]), lines = wrap(g, str, maxW);
  lines.forEach((l, i) => g.fillText(l, x, y + i * size * lh));
  g.restore();
  return y + (lines.length - 1) * size * lh;
}
function line(g, cx, y, half, color, alpha, thick) {
  if (half <= 0.5 || alpha <= 0) return;
  const gr = g.createLinearGradient(cx - half, 0, cx + half, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.globalAlpha *= alpha; g.fillStyle = gr; g.fillRect(cx - half, y - thick / 2, half * 2, thick); g.restore();
}
function veil(g, w, h, a) { if (a > 0) { g.fillStyle = `rgba(3,4,8,${a})`; g.fillRect(0, 0, w, h); } }

// kind: 'open' or 'close'; u: seconds since the card began; info: { title, composer, subtitle, channel, message, credits[] }
export function drawCard(g, w, h, kind, u, info, style, accent) {
  const tall = h > w, S = tall ? Math.min(w * 1.35, h) : Math.min(w, h), // a phone picture is narrow, so its text is sized to the width but larger
    cx = w / 2, dur = kind === 'open' ? OPEN : CLOSE;
  const a = kind === 'open' ? ease(u / 0.6) * ease((dur - u) / 1.0) : ease(u / 1.0); // the opening card fades away into the music; the closing one stays
  const step = (from, len = 0.7) => ease((u - from) / len) * a; // each line arrives a little after the one before
  const rise = (from) => (1 - ease((u - from) / 0.9)) * S * 0.018;
  const big = tall ? 0.1 : 0.078, maxW = w * (tall ? 0.86 : 0.78);
  const credits = (info.credits || []).filter(Boolean);
  g.save();

  if (style === 'minimal') {
    const gr = g.createLinearGradient(0, h * 0.45, 0, h); gr.addColorStop(0, 'rgba(3,4,8,0)'); gr.addColorStop(1, `rgba(3,4,8,${0.82 * a})`);
    g.fillStyle = gr; g.fillRect(0, h * 0.45, w, h * 0.55);
    if (kind === 'close') veil(g, w, h, 0.35 * a);
    const x = w * 0.07, left = { align: 'left', maxW: w * 0.8 };
    let y = h * (tall ? 0.7 : 0.66);
    g.save(); g.globalAlpha = step(0.2); g.fillStyle = accent; g.fillRect(x - S * 0.022, y - S * 0.01, Math.max(2, S * 0.004), S * (kind === 'open' ? 0.2 : 0.26) * ease((u - 0.2) / 0.8)); g.restore();
    y = text(g, (info.channel || '').toUpperCase(), x, y, { ...left, font: `600 ${S * 0.02}px ${SANS}`, color: accent, alpha: step(0.3), spacing: `${S * 0.006}px` }) + S * 0.06;
    y = text(g, kind === 'open' ? info.title : info.message, x, y + rise(0.5), { ...left, font: `600 ${S * 0.062}px ${SERIF}`, alpha: step(0.5) }) + S * 0.058;
    y = text(g, kind === 'open' ? info.composer : [info.title, info.composer].filter(Boolean).join(' · '), x, y, { ...left, font: `italic ${S * 0.032}px ${SERIF}`, color: '#d9cfb8', alpha: step(0.9) }) + S * 0.045;
    if (kind === 'open') text(g, (info.subtitle || '').toUpperCase(), x, y, { ...left, font: `500 ${S * 0.018}px ${SANS}`, alpha: step(1.2) * 0.75, spacing: `${S * 0.005}px` });
    else credits.forEach((c, i) => { y = text(g, c, x, y, { ...left, font: `${S * 0.021}px ${SANS}`, color: 'rgba(235,228,212,0.8)', alpha: step(1.4 + i * 0.25), lh: 1.35 }) + S * 0.028; });
  } else if (style === 'cinema') {
    veil(g, w, h, 0.66 * a);
    const sweep = ease((u - 0.3) / 1.4); // a band of light passes over the title and leaves it written
    let y = h * (kind === 'open' ? 0.44 : 0.3);
    const head = kind === 'open' ? info.title : info.message;
    g.save();
    g.beginPath(); g.rect(0, 0, w * (sweep * 1.1), h); g.clip();
    y = text(g, (head || '').toUpperCase(), cx, y, { font: `300 ${S * (tall ? 0.085 : 0.07)}px ${SERIF}`, alpha: a, spacing: `${S * 0.014}px`, glow: S * 0.02, glowColor: accent, maxW, lh: 1.15 });
    g.restore();
    const bx = w * sweep * 1.1;
    if (sweep > 0 && sweep < 1) { const gr = g.createLinearGradient(bx - S * 0.06, 0, bx + S * 0.02, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, accent); g.save(); g.globalAlpha = 0.35 * a; g.fillStyle = gr; g.fillRect(bx - S * 0.06, y - S * 0.12, S * 0.08, S * 0.24); g.restore(); }
    line(g, cx, y + S * 0.06, S * 0.28 * ease((u - 1.2) / 0.9), accent, a, Math.max(1, S * 0.002));
    y = text(g, (kind === 'open' ? info.composer : [info.title, info.composer].filter(Boolean).join(' — ')).toUpperCase(), cx, y + S * 0.11, { font: `500 ${S * 0.024}px ${SANS}`, color: '#d9cfb8', alpha: step(1.5), spacing: `${S * 0.008}px`, maxW }) + S * 0.06;
    if (kind === 'open') text(g, info.subtitle, cx, y, { font: `italic ${S * 0.026}px ${SERIF}`, alpha: step(1.9) * 0.8, maxW });
    else {
      y += S * 0.04;
      credits.forEach((c, i) => { y = text(g, c, cx, y, { font: `${S * 0.021}px ${SANS}`, color: 'rgba(235,228,212,0.8)', alpha: step(2 + i * 0.25), maxW, lh: 1.35 }) + S * 0.03; });
      text(g, (info.channel || '').toUpperCase(), cx, h * 0.9, { font: `600 ${S * 0.022}px ${SANS}`, color: accent, alpha: step(2.8), spacing: `${S * 0.01}px` });
    }
  } else { // lumen
    veil(g, w, h, 0.58 * a);
    let y = h * (kind === 'open' ? (tall ? 0.36 : 0.3) : (tall ? 0.24 : 0.2));
    y = text(g, (info.channel || '').toUpperCase(), cx, y, { font: `600 ${S * 0.022}px ${SANS}`, color: accent, alpha: step(0.2), spacing: `${S * 0.012}px`, glow: S * 0.012, glowColor: accent }) + S * (kind === 'open' ? 0.1 : 0.085);
    const head = kind === 'open' ? info.title : info.message;
    y = text(g, head, cx, y + rise(0.4), { font: `600 ${S * (kind === 'open' ? big : big * 0.72)}px ${SERIF}`, alpha: step(0.4, 0.9), glow: S * 0.018, glowColor: accent, maxW, lh: 1.12 }) + S * 0.065;
    line(g, cx, y, S * 0.2 * ease((u - 0.9) / 0.9), accent, a, Math.max(1, S * 0.0025));
    y += S * 0.06;
    y = text(g, kind === 'open' ? info.composer : [info.title, info.composer].filter(Boolean).join(' · '), cx, y, { font: `italic ${S * 0.04}px ${SERIF}`, color: '#e2d6bd', alpha: step(1.2), maxW }) + S * 0.06;
    if (kind === 'open') text(g, (info.subtitle || '').toUpperCase(), cx, y, { font: `500 ${S * 0.02}px ${SANS}`, alpha: step(1.6) * 0.75, spacing: `${S * 0.008}px`, maxW });
    else {
      y += S * 0.03;
      credits.forEach((c, i) => { y = text(g, c, cx, y, { font: `${S * 0.021}px ${SANS}`, color: 'rgba(235,228,212,0.82)', alpha: step(1.8 + i * 0.25), maxW, lh: 1.35 }) + S * 0.032; });
    }
  }
  g.restore();
  if (kind === 'close') veil(g, w, h, ease((u - (dur - 1.3)) / 1.3)); // the video ends by fading to black
}
