/**
 * Renderer, environment and post-processing.
 *
 * The post stack is hand-rolled rather than pulled from three/examples so the
 * whole app can ship as one self-contained file. It is deliberately short:
 * threshold bloom, chromatic aberration, vignette, grain, letterbox. Those
 * five do most of the work of making real-time output read as photographed
 * rather than rendered.
 */

import * as THREE from 'three';

const FULLSCREEN_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uSoft;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + uSoft, l);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
varying vec2 vUv;
void main() {
  // 9-tap gaussian, linear-sampled to 5 fetches.
  vec2 o1 = uDirection * 1.3846153846;
  vec2 o2 = uDirection * 3.2307692308;
  vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  c += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
  c += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
  c += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
  c += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

// three.js keeps its tone-mapping functions in a shader chunk that the renderer
// splices into materials it owns. A raw ShaderMaterial gets none of them, so
// the chunk is spliced in by hand below. Taking it from ShaderChunk rather than
// transcribing it means an upgrade of three carries its own curve with it.
// Note the chunk declares `toneMappingExposure` itself; this pipeline drives
// exposure through its own uniform instead, so that one is pinned to 1.
const TONEMAP_CHUNK = THREE.ShaderChunk.tonemapping_pars_fragment;

const COMPOSITE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uChroma;
uniform float uLetterbox;
uniform float uFade;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uExposure;
varying vec2 vUv;

// three.js's own tone-mapping functions, pasted in rather than relied upon.
// WebGLRenderer only applies renderer.toneMapping when it renders to the
// DEFAULT framebuffer; this pipeline renders the scene into a HalfFloat target
// and composites, so the renderer's setting was never reached and both
// toneMapping and toneMappingExposure were dead the whole time. The tonemap
// belongs at the end of the chain anyway, which is here.
${TONEMAP_CHUNK}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 centred = uv - 0.5;
  float r2 = dot(centred, centred);

  // Chromatic aberration grows toward the edge of frame, as a real lens does.
  float ca = uChroma * r2;
  vec3 col;
  col.r = texture2D(tDiffuse, uv - centred * ca).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv + centred * ca).b;

  col += texture2D(tBloom, uv).rgb * uBloom;

  // Exposure, then AgX — the same transform the Blender half grades with, so
  // the preview and the film agree about how bright a scene is. Under ACES
  // (the previous setting, and unreachable besides) a backlit dusk exterior
  // came out at a mean luminance of 12/255 against the film's 111: the viewer
  // saw night and the render came back dusk.
  col = AgXToneMapping(col * uExposure);

  // Lift / gain grade.
  col = col * uGain + uLift * (1.0 - col);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);

  // Vignette.
  col *= 1.0 - uVignette * smoothstep(0.15, 0.78, r2);

  // Grain, scaled down in the highlights where it would read as noise.
  float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5;
  col += g * uGrain * (1.0 - luma * 0.7);

  col *= uFade;

  // Letterbox.
  float bar = uLetterbox;
  if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);

  gl_FragColor = vec4(col, 1.0);
}`;

function fullscreenMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    // The renderer splices <tonemapping_pars_fragment> into any material whose
    // `toneMapped` is true, so leaving this on gave the composite shader two
    // copies of every tone-mapping function and a shader that would not
    // compile. These passes grade explicitly; none of them wants an implicit
    // transform applied on top.
    toneMapped: false,
  });
}

/**
 * Owns the canvas, the render targets and the frame loop's draw step.
 */
export class Engine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.mobile = options.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.mobile,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 2 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // AgX, not ACES. The Blender half of this project grades with AgX and the
    // preview must not disagree with the film about how bright the scene is.
    // ACES crushes shadows hard on the way to its filmic roll-off, and on a
    // backlit dusk exterior — which is most of what this program renders — it
    // took the preview to a mean luminance of 12/255 against the film's 111.
    // A viewer opening the preview saw night and the render came back dusk.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.06, 220);
    this.camera.position.set(0, 1.6, 5);

    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.BufferGeometry();
    this.quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(
      [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3,
    ));
    this.quadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(this.quadGeometry, null);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    this.#buildTargets(1, 1);
    this.#buildMaterials();
    this.#buildEnvironment();

    this.postEnabled = true;
    this.bloomStrength = 0.55;
    this.letterbox = 0.0;
    this.fade = 1.0;
    this.grade = { lift: new THREE.Color(0, 0, 0), gain: new THREE.Color(1, 1, 1), saturation: 1.05 };
  }

  #buildTargets(w, h) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
    this.sceneTarget?.dispose();
    this.brightTarget?.dispose();
    this.blurA?.dispose();
    this.blurB?.dispose();

    this.sceneTarget = new THREE.WebGLRenderTarget(w, h, opts);
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));
    this.brightTarget = new THREE.WebGLRenderTarget(bw, bh, { ...opts, depthBuffer: false });
    this.blurA = new THREE.WebGLRenderTarget(Math.max(1, bw >> 1), Math.max(1, bh >> 1), { ...opts, depthBuffer: false });
    this.blurB = new THREE.WebGLRenderTarget(Math.max(1, bw >> 1), Math.max(1, bh >> 1), { ...opts, depthBuffer: false });
  }

  #buildMaterials() {
    this.brightMaterial = fullscreenMaterial(BRIGHT_FRAG, {
      tDiffuse: { value: null },
      uThreshold: { value: 0.62 },
      uSoft: { value: 0.35 },
    });
    this.blurMaterial = fullscreenMaterial(BLUR_FRAG, {
      tDiffuse: { value: null },
      uDirection: { value: new THREE.Vector2() },
    });
    this.compositeMaterial = fullscreenMaterial(COMPOSITE_FRAG, {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0.55 },
      uTime: { value: 0 },
      uGrain: { value: 0.035 },
      uVignette: { value: 0.42 },
      uChroma: { value: 0.006 },
      uLetterbox: { value: 0.0 },
      uFade: { value: 1.0 },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1.05 },
      uExposure: { value: 1.0 },
      // Pinned: the spliced-in chunk declares this and every function in it
      // multiplies by it. Exposure is driven by uExposure so that all the
      // grading lives in one place.
      toneMappingExposure: { value: 1.0 },
    });
  }

  /** A gradient sky baked to an IBL probe — cheap ambient that isn't flat grey. */
  #buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color('#7f9dc4') },
        uHorizon: { value: new THREE.Color('#c8b79c') },
        uBottom: { value: new THREE.Color('#2a2420') },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.5));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    envScene.add(new THREE.Mesh(geo, mat));

    this.envTarget = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envTarget.texture;
    this.envMaterial = mat;
    pmrem.dispose();
    geo.dispose();
  }

  /** Recolour the IBL probe for a mood. Cheap enough to do on scene changes. */
  setEnvironmentColours(top, horizon, bottom) {
    this.envMaterial.uniforms.uTop.value.set(top);
    this.envMaterial.uniforms.uHorizon.value.set(horizon);
    this.envMaterial.uniforms.uBottom.value.set(bottom);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), this.envMaterial));
    const next = pmrem.fromScene(envScene, 0.04);
    this.envTarget?.dispose();
    this.envTarget = next;
    this.scene.environment = next.texture;
    pmrem.dispose();
  }

  /** Apply a stage's mood: background, fog, exposure and grade. */
  applyMood(mood) {
    this.scene.background = new THREE.Color(mood.background);
    this.scene.fog = mood.fog
      ? new THREE.FogExp2(new THREE.Color(mood.fog[1]), mood.fog[0])
      : null;
    // Both paths: the composite when post is on, the renderer when it is off.
    this.renderer.toneMappingExposure = mood.exposure ?? 1.0;
    this.compositeMaterial.uniforms.uExposure.value = mood.exposure ?? 1.0;

    const grades = {
      NIGHT: { lift: [0.012, 0.016, 0.034], gain: [0.95, 0.98, 1.10], sat: 0.98, bloom: 0.72 },
      DAY: { lift: [0.006, 0.006, 0.008], gain: [1.03, 1.01, 0.98], sat: 1.06, bloom: 0.42 },
      DUSK: { lift: [0.020, 0.012, 0.016], gain: [1.04, 1.00, 0.98], sat: 1.00, bloom: 0.62 },
      DAWN: { lift: [0.022, 0.018, 0.024], gain: [1.06, 1.00, 0.99], sat: 1.05, bloom: 0.60 },
      STORM: { lift: [0.010, 0.014, 0.020], gain: [0.96, 0.99, 1.06], sat: 0.88, bloom: 0.50 },
    };
    const g = grades[mood.name] || grades.NIGHT;
    this.compositeMaterial.uniforms.uLift.value.set(...g.lift);
    this.compositeMaterial.uniforms.uGain.value.set(...g.gain);
    this.compositeMaterial.uniforms.uSaturation.value = g.sat;
    this.bloomStrength = g.bloom;

    const skies = {
      NIGHT: ['#1b2740', '#2c3346', '#0a0c12'],
      DAY: ['#7f9dc4', '#c8b79c', '#2a2420'],
      DUSK: ['#4a3a5e', '#d08a54', '#1a1418'],
      DAWN: ['#5a6a92', '#e0b490', '#20202c'],
      STORM: ['#3a4250', '#6a7080', '#14181e'],
    };
    const s = skies[mood.name] || skies.NIGHT;
    this.setEnvironmentColours(s[0], s[1], s[2]);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.#buildTargets(Math.floor(width * dpr), Math.floor(height * dpr));
  }

  #blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(elapsed) {
    if (!this.postEnabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Bright pass.
    this.brightMaterial.uniforms.tDiffuse.value = this.sceneTarget.texture;
    this.#blit(this.brightMaterial, this.brightTarget);

    // Separable blur, two iterations for a wide, soft falloff.
    const iterations = this.mobile ? 1 : 2;
    let src = this.brightTarget;
    for (let i = 0; i < iterations; i++) {
      this.blurMaterial.uniforms.tDiffuse.value = src.texture;
      this.blurMaterial.uniforms.uDirection.value.set((1.6 + i) / this.blurA.width, 0);
      this.#blit(this.blurMaterial, this.blurA);

      this.blurMaterial.uniforms.tDiffuse.value = this.blurA.texture;
      this.blurMaterial.uniforms.uDirection.value.set(0, (1.6 + i) / this.blurA.height);
      this.#blit(this.blurMaterial, this.blurB);
      src = this.blurB;
    }

    const u = this.compositeMaterial.uniforms;
    u.tDiffuse.value = this.sceneTarget.texture;
    u.tBloom.value = src.texture;
    u.uBloom.value = this.bloomStrength;
    u.uTime.value = elapsed;
    u.uLetterbox.value = this.letterbox;
    u.uFade.value = this.fade;
    this.#blit(this.compositeMaterial, null);
  }

  dispose() {
    this.sceneTarget?.dispose();
    this.brightTarget?.dispose();
    this.blurA?.dispose();
    this.blurB?.dispose();
    this.envTarget?.dispose();
    this.renderer.dispose();
  }
}

/** Recursively free geometries and materials under a node. */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        Object.values(m).forEach((v) => {
          if (v && v.isTexture) v.dispose();
        });
        m.dispose();
      });
    }
  });
}
