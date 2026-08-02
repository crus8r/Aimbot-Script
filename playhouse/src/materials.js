/**
 * Shared material factory.
 *
 * Everything is MeshStandardMaterial / MeshPhysicalMaterial on purpose: the
 * cinematic look here comes from the lighting rig, the PMREM environment and
 * the post stack rather than from bespoke shaders. That keeps the renderer
 * portable and avoids shader-chunk patching that breaks on Three upgrades.
 */

import * as THREE from 'three';

const cache = new Map();

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export function skinMaterial(color) {
  return memo(`skin:${color}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.66,
    metalness: 0.0,
    envMapIntensity: 0.55,
  }));
}

export function clothMaterial(color, { sheen = 0.15, rough = 0.85 } = {}) {
  return memo(`cloth:${color}:${sheen}:${rough}`, () => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: rough,
    metalness: 0.0,
    sheen,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35),
    envMapIntensity: 0.4,
  }));
}

export function hairMaterial(color) {
  return memo(`hair:${color}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.42,
    metalness: 0.08,
    envMapIntensity: 0.8,
  }));
}

export function eyeWhiteMaterial() {
  return memo('eyewhite', () => new THREE.MeshStandardMaterial({
    color: '#f2f0ec', roughness: 0.22, metalness: 0, envMapIntensity: 1.1,
  }));
}

export function irisMaterial(color) {
  return memo(`iris:${color}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.12,
    metalness: 0.1,
    envMapIntensity: 1.6,
  }));
}

export function darkMaterial(color = '#120c0a') {
  return memo(`dark:${color}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.9, metalness: 0,
  }));
}

export function woodMaterial(color = '#5a3a22', rough = 0.62) {
  return memo(`wood:${color}:${rough}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: rough, metalness: 0.02, envMapIntensity: 0.6,
  }));
}

export function metalMaterial(color = '#b08d4f', rough = 0.28) {
  return memo(`metal:${color}:${rough}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: rough, metalness: 0.95, envMapIntensity: 1.3,
  }));
}

/** Clear glass — used by the oil lamp chimney and windows. */
export function glassMaterial(color = '#dfeaf0', opacity = 0.24) {
  return memo(`glass:${color}:${opacity}`, () => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity,
    transmission: 0.0, // kept off: real transmission is too costly on phones
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 2.0,
  }));
}

/** Additive, unlit material for flames, magic and glow cards. */
export function glowMaterial(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function fabricMaterial(color, rough = 0.95) {
  return memo(`fabric:${color}:${rough}`, () => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: rough, metalness: 0, envMapIntensity: 0.3,
  }));
}

export function clearMaterialCache() {
  cache.clear();
}
