// Material cache. Facade and sign materials react to WORLD_U.night: windows
// light up bay by bay (a hash of the bay coordinate decides which), neon
// brightens after dusk.
import * as THREE from 'three';
import { T } from './textures.js';
import { WORLD_U } from './build.js';

const cache = new Map();
const get = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

export function std(color, { rough = 0.8, metal = 0, map, normal, key = '', emissive, ei = 1, side, transparent, opacity, envI } = {}) {
  return get(`std:${color}:${rough}:${metal}:${key}:${emissive}:${ei}:${side}:${opacity}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    if (map) m.map = map;
    if (normal) { m.normalMap = normal; m.normalScale.set(0.6, 0.6); }
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei; }
    if (side) m.side = side;
    if (transparent) { m.transparent = true; m.opacity = opacity ?? 0.5; m.depthWrite = false; }
    if (envI !== undefined) m.envMapIntensity = envI;
    return m;
  });
}

// Night-lit material: emissive is multiplied by WORLD_U.night (and, for
// windows, by a per-bay coin toss so no two buildings light the same way).
export function nightLit(m, { windows = false, floor = 0.0, strength = 1.0 } = {}) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = WORLD_U.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        float bayHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${windows ? `{
          vec2 bay = floor(vEmissiveMapUv + vec2(0.001));
          float h = bayHash(bay);
          float lit = step(0.42, h) * (0.55 + 0.45 * bayHash(bay + 7.0));
          vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.75, 0.85, 1.0), step(0.85, bayHash(bay + 3.0)));
          totalEmissiveRadiance *= warm * lit * uNight * ${strength.toFixed(2)};
        }` : `totalEmissiveRadiance *= ${floor.toFixed(2)} + (1.0 - ${floor.toFixed(2)}) * uNight;`}`);
  };
  m.customProgramCacheKey = () => `night:${windows}:${floor}:${strength}`;
  return m;
}

// Tinting: base colour from the per-vertex `tint` (and `tint2` for trim),
// written by Batcher.add from a {isTint} wrapper. A mask texture (R = wall,
// G = trim) decides which parts of a facade texture take which tint.
function tintShader(m, { mask = false, key }) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 tint; attribute vec3 tint2; varying vec3 vTint; varying vec3 vTint2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = tint; vTint2 = tint2;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTint; varying vec3 vTint2;${mask ? '\nuniform sampler2D tintMask;' : ''}`)
      .replace('#include <map_fragment>', mask
        ? `#include <map_fragment>
          { vec4 mk = texture2D(tintMask, vMapUv);
            vec3 tc = mix(vec3(1.0), vTint, mk.r) * mix(vec3(1.0), vTint2, mk.g);
            diffuseColor.rgb *= tc; }`
        : '#include <map_fragment>\n diffuseColor.rgb *= vTint;');
    if (mask) sh.uniforms.tintMask = { value: m.userData.tintMask };
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `tint:${mask}:${key}:${prevKey ? prevKey() : ''}`;
  return m;
}

const tinted = (material, c1, c2) => ({ isTint: true, material, tint: new THREE.Color(c1), tint2: new THREE.Color(c2 || c1) });

export function wallT(color) {
  return tinted(get('wallT', () => tintShader(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, normalMap: T.stucco().normal }), { key: 'wall' })), color);
}

export function trimT(color) {
  return tinted(get('trimT', () => tintShader(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), { key: 'trim' })), color);
}

// One material per facade style (and glass tint): walls and trims tinted.
export function facadeT(style, wall, trim, glass) {
  const g = style === 'glass' ? glass : '#5f8fa0';
  const mat = get(`facadeT:${style}:${g}`, () => {
    const t = T.facade(style, '#ffffff', '#ffffff', g, 1, true);
    const m = new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.6,
      roughness: style === 'glass' ? 0.25 : 0.85, metalness: style === 'glass' ? 0.35 : 0,
      normalMap: style === 'glass' ? null : T.stucco().normal,
    });
    if (m.normalMap) m.normalScale.set(0.35, 0.35);
    m.userData.tintMask = t.mask;
    nightLit(m, { windows: true, strength: style === 'glass' ? 0.9 : 1.2 });
    return tintShader(m, { mask: true, key: `facade:${style}` });
  });
  return tinted(mat, wall, trim);
}

export function facadeMat(style, wall, trim, glass) {
  return get(`facade:${style}:${wall}:${trim}:${glass}`, () => {
    const t = T.facade(style, wall, trim, glass);
    const m = new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.6,
      roughness: style === 'glass' ? 0.25 : 0.85, metalness: style === 'glass' ? 0.35 : 0,
      normalMap: style === 'glass' ? null : T.stucco().normal,
    });
    if (m.normalMap) m.normalScale.set(0.35, 0.35);
    return nightLit(m, { windows: true, strength: style === 'glass' ? 0.9 : 1.2 });
  });
}

export function shopMat(wall, trim, sign, text) {
  return get(`shop:${wall}:${trim}:${sign}:${text}`, () => {
    const t = T.shopfront(wall, trim, sign, text);
    const m = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffe2b8'), emissiveIntensity: 1.4, roughness: 0.7 });
    return nightLit(m, { floor: 0.12 });
  });
}

export const SHOP_NAMES = ['CAFE', 'BAKERY', 'PHARMACY', 'BOOKS', 'FLOWERS', 'SURF SHOP', 'PIZZA', 'LAUNDRY', 'TACOS', 'SUSHI', 'GELATO', 'RECORDS', 'BARBER', 'NAILS', 'DELI', 'TATTOO', 'HARDWARE', 'VINTAGE', 'LOBBY', 'MARKET', 'BANK', 'GYM', 'HOTEL', 'DINER'];
const SHOP_COLORS = ['#2a9d8f', '#e76f51', '#264653', '#8338ec', '#d62828', '#1d3557', '#6a994e', '#bc6c25'];

export function shopAtlasMat() {
  return get('shopAtlas', () => {
    const t = T.shopAtlas(SHOP_NAMES, SHOP_COLORS);
    const m = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color('#ffe2b8'), emissiveIntensity: 1.4, roughness: 0.7 });
    m.userData.cells = t.cells;
    return nightLit(m, { floor: 0.12 });
  });
}

export function neonMat(text, color, opts = {}) {
  return get(`neon:${text}:${color}:${opts.bg}`, () => {
    const t = T.sign(text, color, opts.bg, opts.font);
    const m = new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.map, emissive: new THREE.Color(opts.bg ? '#ffffff' : color), emissiveIntensity: opts.bg ? 0.9 : 2.8, transparent: !opts.bg, alphaTest: opts.bg ? 0 : 0.05, roughness: 0.5, side: THREE.DoubleSide, depthWrite: !!opts.bg });
    return nightLit(m, { floor: opts.bg ? 0.2 : 0.25 });
  });
}

export function glowMat(color, ei = 3, floor = 0.1) {
  return get(`glow:${color}:${ei}:${floor}`, () => nightLit(new THREE.MeshStandardMaterial({ color: '#222', emissive: new THREE.Color(color), emissiveIntensity: ei, roughness: 0.4 }), { floor }));
}

export const M = {
  asphalt: () => get('asphalt', () => { const t = T.asphalt(); const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.92, color: '#ffffff' }); m.normalScale.set(0.5, 0.5); return m; }),
  sidewalk: () => get('sidewalk', () => { const t = T.sidewalk(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.88 }); }),
  curb: () => std('#c8c3b8', { rough: 0.8, key: 'curb' }),
  promenade: () => get('promenade', () => { const t = T.promenade(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.8 }); }),
  sand: () => get('sand', () => { const t = T.sand(); const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.97 }); m.normalScale.set(0.8, 0.8); return m; }),
  grass: () => get('grass', () => { const t = T.grass(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.95 }); }),
  paint: () => std('#f2f0e6', { rough: 0.7, key: 'paint' }),
  yellowPaint: () => std('#e8b83a', { rough: 0.7, key: 'ypaint' }),
  roof: () => std('#8d8a84', { rough: 0.95, key: 'roof', map: T.sidewalk().map }),
  metal: () => std('#5a5f66', { rough: 0.45, metal: 0.7, key: 'metal' }),
  darkMetal: () => std('#2a2d31', { rough: 0.5, metal: 0.6, key: 'dmetal' }),
  chrome: () => std('#d8dde2', { rough: 0.15, metal: 1, key: 'chrome' }),
  glass: () => std('#8fb3c8', { rough: 0.05, metal: 0.2, key: 'glass', transparent: true, opacity: 0.28 }),
  wood: (tone = '#8a5a36') => get(`woodm:${tone}`, () => { const t = T.wood(tone); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.7 }); }),
  planks: (tone = '#9a6a42') => get(`planksm:${tone}`, () => { const t = T.planks(tone); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.75 }); }),
  fabric: (c) => get(`fab:${c}`, () => { const t = T.fabric(c); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.95 }); }),
  tiles: (a, b, n, k) => get(`tilem:${a}:${b}:${n}:${k}`, () => { const t = T.tiles(a, b, n, k); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.35 }); }),
  carpet: (c) => get(`carpm:${c}`, () => { const t = T.carpet(c); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 1 }); }),
  wallpaper: (a, b) => get(`wpm:${a}:${b}`, () => new THREE.MeshStandardMaterial({ map: T.wallpaper(a, b).map, roughness: 0.9 })),
  plaster: (c) => std(c, { rough: 0.92, normal: T.stucco().normal, key: 'plaster' }),
  stripes: (a, b, n) => get(`strm:${a}:${b}:${n}`, () => new THREE.MeshStandardMaterial({ map: T.stripes(a, b, n).map, roughness: 0.85, side: THREE.DoubleSide })),
  bark: () => get('bark', () => { const t = T.bark(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.95 }); }),
  leaves: () => get('leaves', () => { const t = T.leaves(); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.85 }); }),
  frond: () => get('frond', () => new THREE.MeshStandardMaterial({ map: T.frond().map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, transparent: false })),
  lampGlow: () => glowMat('#ffd9a0', 4, 0.05),
  screen: () => glowMat('#9ad0ff', 1.2, 1),
};
