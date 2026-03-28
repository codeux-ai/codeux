import { useEffect, useRef } from "preact/hooks";
import * as THREE from "three";

/* ─────────────────────────────────────────────────────────────────────────────
 * DeepOceanBackground
 * ─────────────────────────────────────────────────────────────────────────────
 * A full-screen Three.js background rendered behind the chat UI.
 * Effect: dark abyssal water with slowly morphing caustic light patterns
 * and faint drifting bioluminescent particles.
 *
 * Performance budget:
 *  - Renders at 0.5× device resolution (configurable via RENDER_SCALE)
 *  - 1 fullscreen quad (caustic shader) + 1 instanced draw (particles)
 *  - Targets 60 fps on integrated GPUs; gracefully degrades
 * ───────────────────────────────────────────────────────────────────────────── */

const RENDER_SCALE = 0.5;
const PARTICLE_COUNT = 60;

/* ── Caustic fragment shader ──────────────────────────────────────────────── */
const causticVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const causticFrag = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform vec2  uResolution;
  varying vec2  vUv;

  /* ─ fast pseudo-random hash ─ */
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  /* ─ value noise ─ */
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  /* ─ fractal Brownian motion (3 octaves for perf) ─ */
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  /* ─ caustic pattern using warped domain ─ */
  float caustic(vec2 uv, float t) {
    float s = 0.18 * t;
    vec2 p = uv * 3.0;
    float f1 = fbm(p + vec2(s, s * 0.7));
    float f2 = fbm(p + vec2(-s * 0.6, s * 0.4) + f1 * 1.8);
    float f3 = fbm(p * 1.5 + vec2(s * 0.3, -s * 0.5) + f2 * 1.2);
    return f3;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    uv.x *= aspect;
    float t = uTime;

    /* two caustic layers at different scales for depth */
    float c1 = caustic(uv, t);
    float c2 = caustic(uv * 0.7 + 3.5, t * 0.8);
    float c  = c1 * 0.6 + c2 * 0.4;

    /* remap to tight bright range */
    c = smoothstep(0.28, 0.72, c);
    c = pow(c, 2.6);

    /* jade / teal tinted caustic highlights */
    vec3 base   = vec3(0.024, 0.032, 0.038);          /* almost black */
    vec3 deep   = vec3(0.012, 0.05, 0.048);            /* deep teal */
    vec3 bright = vec3(0.0, 0.878, 0.627);             /* signal-500 jade */

    vec3 color = base;
    color = mix(color, deep,   c * 0.7);
    color = mix(color, bright, c * c * 0.08);

    /* subtle vignette */
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.5, vigUv * 0.5);
    vig = smoothstep(0.0, 1.0, vig);
    color *= vig;

    gl_FragColor = vec4(color, 1.0);
  }
`;

/* ── Particle shaders ─────────────────────────────────────────────────────── */
const particleVert = /* glsl */ `
  attribute vec3 offset;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uTime;
  varying float vAlpha;

  void main() {
    vAlpha = aAlpha;

    /* gentle drift: slowly float upward and sway */
    vec3 pos = offset;
    float t = uTime * 0.08;
    pos.y = mod(pos.y + t * aSize * 0.5, 2.0) - 1.0;
    pos.x += sin(pos.y * 3.0 + uTime * 0.15 + offset.z * 6.0) * 0.02;

    /* fade near edges */
    float edgeFade = smoothstep(-1.0, -0.7, pos.y) * smoothstep(1.0, 0.7, pos.y);
    vAlpha *= edgeFade;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const particleFrag = /* glsl */ `
  precision mediump float;
  varying float vAlpha;

  void main() {
    /* soft circle */
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.3, 0.5, d);
    /* jade tint */
    gl_FragColor = vec4(0.0, 0.88, 0.63, a * vAlpha * 0.35);
  }
`;

/* ── Component ────────────────────────────────────────────────────────────── */
export const DeepOceanBackground = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /* respect reduced-motion preference */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* bail out gracefully when WebGL is unavailable (e.g. test env) */
    try {
      const testCanvas = document.createElement("canvas");
      const ctx = testCanvas.getContext("webgl") || testCanvas.getContext("experimental-webgl");
      if (!ctx) return;
    } catch { return; }

    /* ── renderer ── */
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * RENDER_SCALE);
    renderer.setClearColor(0x060a0d, 1);
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    /* ── scene & camera ── */
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    /* ── caustic quad ── */
    const causticMat = new THREE.ShaderMaterial({
      vertexShader: causticVert,
      fragmentShader: causticFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: new THREE.Vector2(el.clientWidth, el.clientHeight),
        },
      },
      depthWrite: false,
      depthTest: false,
    });
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      causticMat,
    );
    scene.add(quad);

    /* ── particles (separate scene, perspective camera) ── */
    const particleScene = new THREE.Scene();
    const pCam = new THREE.PerspectiveCamera(
      60,
      el.clientWidth / el.clientHeight,
      0.1,
      10,
    );
    pCam.position.z = 1.8;

    const offsets = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      offsets[i * 3] = (Math.random() - 0.5) * 3;
      offsets[i * 3 + 1] = (Math.random() - 0.5) * 2;
      offsets[i * 3 + 2] = (Math.random() - 0.5) * 2;
      sizes[i] = 1.5 + Math.random() * 3;
      alphas[i] = 0.2 + Math.random() * 0.8;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    pGeo.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));
    pGeo.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 1));
    pGeo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));

    const pMat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(pGeo, pMat);
    particleScene.add(points);

    /* ── animation loop ── */
    let animId = 0;
    let startTime = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) * 0.001;
      causticMat.uniforms.uTime.value = elapsed;
      pMat.uniforms.uTime.value = elapsed;

      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.render(particleScene, pCam);
    };
    animate();

    /* ── resize observer ── */
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      causticMat.uniforms.uResolution.value.set(width, height);
      pCam.aspect = width / height;
      pCam.updateProjectionMatrix();
    });
    ro.observe(el);

    /* ── cleanup ── */
    const cleanup = () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.dispose();
      causticMat.dispose();
      pMat.dispose();
      pGeo.dispose();
      quad.geometry.dispose();
      if (el.contains(renderer.domElement)) {
        el.removeChild(renderer.domElement);
      }
    };
    cleanupRef.current = cleanup;

    return cleanup;
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    />
  );
};
