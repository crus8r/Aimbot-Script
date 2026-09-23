// Procedural textures, painted on canvases at load. No image files: the look
// is controlled in code, and a palette change is a one-line edit.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function noise(x, w, h, amount, r, alpha = 1) {
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    d[i + 3] = d[i + 3] * alpha;
  }
  x.putImageData(img, 0, 0);
}

// Soft blotches, for grime and wear.
function blotches(x, w, h, n, color, r, maxR = 40) {
  for (let i = 0; i < n; i++) {
    const cx = r() * w, cy = r() * h, rad = 4 + r() * maxR;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
}

// Tangent-space normal map from a canvas's luminance.
export function normalFrom(src, strength = 2) {
  const w = src.width, h = src.height;
  const sx = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, x] = canvas(w, h);
  const out = x.createImageData(w, h);
  const L = (i, j) => sx[(((j + h) % h) * w + ((i + w) % w)) * 4] / 255;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (L(i + 1, j) - L(i - 1, j)) * strength;
    const dy = (L(i, j + 1) - L(i, j - 1)) * strength;
    const nz = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const k = (j * w + i) * 4;
    out.data[k] = (-dx * nz * 0.5 + 0.5) * 255;
    out.data[k + 1] = (dy * nz * 0.5 + 0.5) * 255;
    out.data[k + 2] = nz * 255;
    out.data[k + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  return tex(c, { srgb: false });
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export const T = {
  asphalt: () => cached('asphalt', () => {
    const r = rng(11);
    const [c, x] = canvas(512);
    x.fillStyle = '#3b3d42'; x.fillRect(0, 0, 512, 512);
    noise(x, 512, 512, 38, r);
    blotches(x, 512, 512, 60, 'rgba(20,20,24,0.25)', r, 60);
    blotches(x, 512, 512, 40, 'rgba(120,120,125,0.08)', r, 30);
    // Aggregate speckle.
    for (let i = 0; i < 5000; i++) { x.fillStyle = r() < 0.5 ? 'rgba(160,160,160,0.25)' : 'rgba(10,10,10,0.3)'; x.fillRect(r() * 512, r() * 512, 1.5, 1.5); }
    // A few cracks.
    x.strokeStyle = 'rgba(15,15,18,0.55)'; x.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      let px = r() * 512, py = r() * 512;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 12; k++) { px += (r() - 0.5) * 30; py += (r() - 0.5) * 30; x.lineTo(px, py); }
      x.stroke();
    }
    return { map: tex(c), normal: normalFrom(c, 1.5) };
  }),

  sidewalk: () => cached('sidewalk', () => {
    const r = rng(12);
    const [c, x] = canvas(256);
    x.fillStyle = '#b9b4aa'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 22, r);
    blotches(x, 256, 256, 16, 'rgba(90,85,75,0.12)', r, 30);
    // 4 slabs per tile (tile = 3m).
    x.strokeStyle = 'rgba(70,66,60,0.7)'; x.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    return { map: tex(c), normal: normalFrom(c, 2.5) };
  }),

  promenade: () => cached('promenade', () => {
    const r = rng(13);
    const [c, x] = canvas(256);
    // Terracotta and cream pavers in a wave pattern, a nod to Copacabana.
    x.fillStyle = '#efe4cf'; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#c9785a';
    for (let y = 0; y < 256; y += 1) {
      const off = Math.sin(y / 256 * Math.PI * 4) * 40;
      x.fillRect(96 + off, y, 64, 1);
    }
    noise(x, 256, 256, 18, r);
    return { map: tex(c), normal: normalFrom(c, 1) };
  }),

  sand: () => cached('sand', () => {
    const r = rng(14);
    const [c, x] = canvas(512);
    x.fillStyle = '#e6d3a8'; x.fillRect(0, 0, 512, 512);
    noise(x, 512, 512, 30, r);
    blotches(x, 512, 512, 80, 'rgba(200,170,120,0.2)', r, 50);
    blotches(x, 512, 512, 50, 'rgba(255,245,220,0.18)', r, 40);
    // Ripples.
    x.strokeStyle = 'rgba(160,130,90,0.12)'; x.lineWidth = 2;
    for (let i = 0; i < 40; i++) { const y = r() * 512; x.beginPath(); for (let k = 0; k <= 512; k += 16) x.lineTo(k, y + Math.sin(k / 40 + i) * 5); x.stroke(); }
    return { map: tex(c), normal: normalFrom(c, 1.2) };
  }),

  grass: () => cached('grass', () => {
    const r = rng(15);
    const [c, x] = canvas(512);
    x.fillStyle = '#5f8a3e'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 22000; i++) {
      const g = 90 + r() * 80;
      x.strokeStyle = `rgba(${40 + r() * 50},${g},${30 + r() * 30},0.55)`;
      const px = r() * 512, py = r() * 512;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 3 - r() * 5); x.stroke();
    }
    blotches(x, 512, 512, 30, 'rgba(120,110,40,0.15)', r, 60);
    return { map: tex(c), normal: normalFrom(c, 1) };
  }),

  wood: (tone = '#8a5a36', key = 'wood') => cached(`wood:${tone}:${key}`, () => {
    const r = rng(16 + tone.length);
    const [c, x] = canvas(256);
    x.fillStyle = tone; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      x.strokeStyle = `rgba(${r() < 0.5 ? '30,15,5' : '255,230,200'},${0.05 + r() * 0.1})`;
      x.lineWidth = 1 + r() * 2;
      const y = r() * 256;
      x.beginPath();
      for (let k = 0; k <= 256; k += 8) x.lineTo(k, y + Math.sin(k / 30 + i) * 3);
      x.stroke();
    }
    noise(x, 256, 256, 14, r);
    return { map: tex(c), normal: normalFrom(c, 0.8) };
  }),

  planks: (tone = '#9a6a42') => cached(`planks:${tone}`, () => {
    const r = rng(17);
    const [c, x] = canvas(256);
    x.fillStyle = tone; x.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      const shade = (r() - 0.5) * 30;
      x.fillStyle = `rgba(${shade > 0 ? '255,240,220' : '20,10,0'},${Math.abs(shade) / 120})`;
      x.fillRect(0, y, 256, 32);
      x.fillStyle = 'rgba(30,18,8,0.6)'; x.fillRect(0, y, 256, 2);
      const cut = r() * 256; x.fillRect(cut, y, 2, 32);
    }
    for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(40,20,5,${0.05 + r() * 0.08})`; const y = r() * 256; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y + (r() - 0.5) * 4); x.stroke(); }
    noise(x, 256, 256, 12, r);
    return { map: tex(c), normal: normalFrom(c, 1.5) };
  }),

  tiles: (a = '#f2efe8', b = '#1f2326', n = 8, key = 'check') => cached(`tiles:${a}:${b}:${n}:${key}`, () => {
    const r = rng(18);
    const [c, x] = canvas(256);
    const s = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.fillStyle = key === 'check' ? ((i + j) % 2 ? b : a) : a;
      x.fillRect(i * s, j * s, s, s);
    }
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1.5;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, 256); x.stroke(); x.beginPath(); x.moveTo(0, i * s); x.lineTo(256, i * s); x.stroke(); }
    noise(x, 256, 256, 8, r);
    return { map: tex(c), normal: normalFrom(c, 1) };
  }),

  carpet: (color = '#6a4a5a') => cached(`carpet:${color}`, () => {
    const r = rng(19);
    const [c, x] = canvas(256);
    x.fillStyle = color; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 40, r);
    return { map: tex(c), normal: normalFrom(c, 0.6) };
  }),

  fabric: (color = '#556677') => cached(`fabric:${color}`, () => {
    const r = rng(20);
    const [c, x] = canvas(128);
    x.fillStyle = color; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 128; i += 2) { x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(i, 0, 1, 128); x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(0, i, 128, 1); }
    noise(x, 128, 128, 18, r);
    return { map: tex(c), normal: normalFrom(c, 0.7) };
  }),

  stripes: (a = '#e8e4dc', b = '#2a9d8f', n = 6) => cached(`stripes:${a}:${b}:${n}`, () => {
    const [c, x] = canvas(128);
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? b : a; x.fillRect((i * 128) / n, 0, 128 / n + 1, 128); }
    return { map: tex(c) };
  }),

  stucco: () => cached('stucco', () => {
    const r = rng(21);
    const [c, x] = canvas(256);
    x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 60, r);
    return { normal: normalFrom(c, 0.9) };
  }),

  wallpaper: (a = '#e9dcc8', b = '#d9c7ab') => cached(`wp:${a}:${b}`, () => {
    const [c, x] = canvas(128);
    x.fillStyle = a; x.fillRect(0, 0, 128, 128);
    x.fillStyle = b;
    for (let i = 0; i < 128; i += 16) x.fillRect(i, 0, 5, 128);
    return { map: tex(c) };
  }),

  // One window bay of a facade: 3m wide x 3.4m floor. Alpha channel of the
  // emissive map marks glass, so night windows can light per bay.
  facade: (style, wall, trim, glass, seed = 1) => cached(`facade:${style}:${wall}:${trim}:${glass}`, () => {
    const r = rng(30 + seed);
    const W = 128, H = 144;
    const [c, x] = canvas(W, H);
    const [ec, ex] = canvas(W, H);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    x.fillStyle = wall; x.fillRect(0, 0, W, H);
    noise(x, W, H, 10, r);
    const win = (wx, wy, ww, wh, frame = trim) => {
      x.fillStyle = frame; x.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, glass); g.addColorStop(0.55, shade(glass, 0.35)); g.addColorStop(1, shade(glass, -0.25));
      x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
      // Mullion.
      x.fillStyle = frame; x.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      ex.fillStyle = '#fff'; ex.fillRect(wx, wy, ww, wh);
      ex.fillStyle = '#000'; ex.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
    };
    if (style === 'deco') {
      win(22, 38, 84, 70);
      // Eyebrow shade above the window, with its shadow.
      x.fillStyle = trim; x.fillRect(12, 24, 104, 8);
      x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(16, 32, 96, 10);
      x.fillStyle = shade(wall, -0.08); x.fillRect(0, H - 6, W, 6);
    } else if (style === 'glass') {
      x.fillStyle = shade(trim, -0.1); x.fillRect(0, 0, W, H);
      const g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, shade(glass, 0.25)); g.addColorStop(0.5, glass); g.addColorStop(1, shade(glass, -0.2));
      x.fillStyle = g; x.fillRect(4, 10, W - 8, H - 20);
      x.fillStyle = trim; x.fillRect(W / 2 - 2, 0, 4, H); x.fillRect(0, H - 10, W, 10);
      ex.fillStyle = '#fff'; ex.fillRect(4, 10, W / 2 - 6, H - 20); ex.fillRect(W / 2 + 2, 10, W / 2 - 6, H - 20);
    } else if (style === 'apart') {
      win(30, 34, 68, 78);
      x.fillStyle = shade(wall, -0.15); x.fillRect(26, 112, 76, 6);   // sill
      x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(28, 118, 72, 6);
    } else if (style === 'brick') {
      for (let yy = 0; yy < H; yy += 8) for (let xx = (yy / 8) % 2 ? -8 : 0; xx < W; xx += 16) {
        x.fillStyle = shade(wall, (r() - 0.5) * 0.2); x.fillRect(xx + 1, yy + 1, 14, 6);
      }
      win(30, 34, 68, 80, '#e8e0d0');
      x.fillStyle = '#d8d0c0'; x.fillRect(26, 114, 76, 7);
    }
    return { map: tex(c), emissive: tex(ec, { srgb: true }) };
  }),

  // Ground-floor shopfront: 9m wide x 4.2m tall.
  shopfront: (wall, trim, sign, text, seed = 1) => cached(`shop:${wall}:${trim}:${sign}:${text}`, () => {
    const r = rng(50 + seed);
    const W = 512, H = 240;
    const [c, x] = canvas(W, H);
    const [ec, ex] = canvas(W, H);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    x.fillStyle = wall; x.fillRect(0, 0, W, H);
    noise(x, W, H, 8, r);
    // Sign band.
    x.fillStyle = sign; x.fillRect(20, 14, W - 40, 44);
    x.fillStyle = '#fff'; x.font = 'bold 32px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, W / 2, 37);
    ex.fillStyle = '#fff'; ex.font = 'bold 32px Georgia, serif'; ex.textAlign = 'center'; ex.textBaseline = 'middle';
    ex.fillText(text, W / 2, 37);
    // Big windows with a hint of a lit interior: shelves, a counter.
    const g = x.createLinearGradient(0, 70, 0, H);
    g.addColorStop(0, '#3a4a55'); g.addColorStop(1, '#1a2228');
    x.fillStyle = trim; x.fillRect(16, 66, W - 32, H - 70);
    x.fillStyle = g; x.fillRect(24, 74, 300, H - 90);
    x.fillStyle = 'rgba(255,220,160,0.25)';
    for (let i = 0; i < 4; i++) x.fillRect(34 + i * 72, 110, 60, 6);
    x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(24, 74, 120, H - 90);
    ex.fillStyle = '#b89060'; ex.fillRect(24, 74, 300, H - 90);
    // Door.
    x.fillStyle = shade(trim, -0.3); x.fillRect(350, 74, 130, H - 74);
    x.fillStyle = g; x.fillRect(362, 86, 106, H - 98);
    ex.fillStyle = '#806040'; ex.fillRect(362, 86, 106, H - 98);
    return { map: tex(c), emissive: tex(ec) };
  }),

  // Neon or painted sign text.
  sign: (text, color = '#ff4fa0', bg = null, font = 'bold 72px "Trebuchet MS", sans-serif', w = 512, h = 128) => cached(`sign:${text}:${color}:${bg}:${font}:${w}`, () => {
    const [c, x] = canvas(w, h);
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = color; x.shadowBlur = bg ? 0 : 18;
    x.fillStyle = bg ? color : '#fff';
    x.fillText(text, w / 2, h / 2 + 4);
    if (!bg) { x.shadowBlur = 0; x.strokeStyle = color; x.lineWidth = 3; x.strokeText(text, w / 2, h / 2 + 4); }
    return { map: tex(c, { repeat: false }) };
  }),

  frond: () => cached('frond', () => {
    const [c, x] = canvas(256, 64);
    // A palm leaf: a spine with leaflets angled toward the tip.
    x.strokeStyle = '#3c5a24'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, 32); x.lineTo(256, 32); x.stroke();
    for (let i = 4; i < 250; i += 5) {
      const len = 28 * Math.sin((i / 256) * Math.PI) + 4;
      const g = 110 + Math.random() * 50;
      x.strokeStyle = `rgb(${50 + Math.random() * 30},${g},${35})`;
      x.lineWidth = 2.2;
      x.beginPath(); x.moveTo(i, 32); x.lineTo(i + len * 0.55, 32 - len); x.stroke();
      x.beginPath(); x.moveTo(i, 32); x.lineTo(i + len * 0.55, 32 + len); x.stroke();
    }
    return { map: tex(c, { repeat: false }) };
  }),

  bark: () => cached('bark', () => {
    const r = rng(22);
    const [c, x] = canvas(64, 256);
    x.fillStyle = '#8a7a62'; x.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 10) { x.fillStyle = 'rgba(60,45,30,0.5)'; x.fillRect(0, y, 64, 3); x.fillStyle = 'rgba(200,185,160,0.3)'; x.fillRect(0, y + 3, 64, 2); }
    noise(x, 64, 256, 30, r);
    return { map: tex(c), normal: normalFrom(c, 2) };
  }),

  leaves: () => cached('leaves', () => {
    const r = rng(23);
    const [c, x] = canvas(256);
    x.fillStyle = '#3f6b2c'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      x.fillStyle = `rgba(${40 + r() * 60},${90 + r() * 80},${30 + r() * 30},0.7)`;
      x.beginPath(); x.ellipse(r() * 256, r() * 256, 3 + r() * 4, 1.5 + r() * 2, r() * 3, 0, Math.PI * 2); x.fill();
    }
    return { map: tex(c), normal: normalFrom(c, 1.5) };
  }),

  label: (bg, fg, text, seed = 0) => cached(`label:${bg}:${fg}:${text}`, () => {
    const [c, x] = canvas(64, 64);
    x.fillStyle = bg; x.fillRect(0, 0, 64, 64);
    x.fillStyle = fg; x.fillRect(0, 22, 64, 20);
    x.fillStyle = bg; x.font = 'bold 13px sans-serif'; x.textAlign = 'center'; x.fillText(text, 32, 37);
    return { map: tex(c, { repeat: false }) };
  }),
};

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt > 0) c.lerp(new THREE.Color('#ffffff'), amt); else c.lerp(new THREE.Color('#000000'), -amt);
  return `#${c.getHexString()}`;
}
