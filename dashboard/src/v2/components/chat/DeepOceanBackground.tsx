import { useEffect, useRef } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";

/* ─────────────────────────────────────────────────────────────────────────────
 * DeepOceanBackground
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-viewport Three.js animated background.
 *
 * Dark mode : abyssal water — deep black with morphing jade caustic light
 * Light mode: sun-through-water — warm ivory with golden/jade caustics on marble
 *
 * Performance budget:
 *  - Renders at 0.5× device resolution
 *  - 1 fullscreen quad (caustic shader) + 1 points draw (particles)
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
  uniform float uDark;          /* 1.0 = dark mode, 0.0 = light mode */
  varying vec2  vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

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

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

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

    float c1 = caustic(uv, uTime);
    float c2 = caustic(uv * 0.7 + 3.5, uTime * 0.8);
    float cRaw = c1 * 0.6 + c2 * 0.4;

    /* dark mode: tight contrast for subtle caustic glow */
    float cDark = smoothstep(0.28, 0.72, cRaw);
    cDark = pow(cDark, 2.6);

    vec3 dBase   = vec3(0.024, 0.032, 0.038);
    vec3 dDeep   = vec3(0.012, 0.05, 0.048);
    vec3 dBright = vec3(0.0, 0.878, 0.627);

    vec3 darkColor = dBase;
    darkColor = mix(darkColor, dDeep,   cDark * 0.7);
    darkColor = mix(darkColor, dBright, cDark * cDark * 0.08);

    /* light mode: soft cloudy sky — wide contrast, cloud-like formations */
    float cLight = smoothstep(0.18, 0.82, cRaw);  /* wider band = softer clouds */
    cLight = pow(cLight, 1.2);                     /* gentle curve, preserve volume */

    vec3 skyBase   = vec3(0.86, 0.91, 0.97);       /* soft sky blue */
    vec3 cloudWhite = vec3(0.97, 0.98, 1.0);       /* bright cloud white */
    vec3 cloudGray  = vec3(0.78, 0.83, 0.90);      /* cloud shadow */
    vec3 skyDeep    = vec3(0.72, 0.82, 0.95);       /* deeper blue between clouds */
    vec3 warmEdge   = vec3(0.92, 0.88, 0.82);       /* warm sunlit edge */

    vec3 lightColor = mix(skyBase, skyDeep, (1.0 - cLight) * 0.6);
    lightColor = mix(lightColor, cloudWhite, cLight * 0.85);
    lightColor = mix(lightColor, cloudGray,  (1.0 - cLight) * cLight * 0.5);
    lightColor = mix(lightColor, warmEdge,   cLight * cLight * 0.15);

    /* ── blend by mode ── */
    vec3 color = mix(lightColor, darkColor, uDark);

    /* subtle vignette */
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.5, vigUv * 0.5);
    vig = smoothstep(0.0, 1.0, vig);
    color = mix(color * 0.92, color, vig);

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

    vec3 pos = offset;
    float t = uTime * 0.08;
    pos.y = mod(pos.y + t * aSize * 0.5, 2.0) - 1.0;
    pos.x += sin(pos.y * 3.0 + uTime * 0.15 + offset.z * 6.0) * 0.02;

    float edgeFade = smoothstep(-1.0, -0.7, pos.y) * smoothstep(1.0, 0.7, pos.y);
    vAlpha *= edgeFade;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPos.z);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const particleFrag = /* glsl */ `
  precision mediump float;
  uniform float uDark;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.15, 0.5, d);
    a *= a;  /* softer falloff — no hard bright center */

    /* dark: jade glow, light: warm gold-jade shimmer */
    vec3 darkCol  = vec3(0.0, 0.88, 0.63);
    vec3 lightCol = vec3(0.6, 0.75, 0.9);
    vec3 col = mix(lightCol, darkCol, uDark);

    float opacity = mix(0.25, 0.22, uDark);
    gl_FragColor = vec4(col, a * vAlpha * opacity);
  }
`;

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function isDarkMode(forceDark = false): boolean {
  return forceDark || document.documentElement.classList.contains("dark");
}

/* ── Component ────────────────────────────────────────────────────────────── */
export const DeepOceanBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    try {
      const tc = document.createElement("canvas");
      const ctx = tc.getContext("webgl") || tc.getContext("experimental-webgl");
      if (!ctx) return;
    } catch { return; }

    /* ── state ── */
    let currentDark = isDarkMode(forceDark) ? 1.0 : 0.0;
    let targetDark = currentDark;

    /* ── renderer ── */
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * RENDER_SCALE);
    renderer.setClearColor(isDarkMode(forceDark) ? 0x060a0d : 0xdbe8f8, 1);
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
    });

    /* ── caustic scene ── */
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const causticMat = new THREE.ShaderMaterial({
      vertexShader: causticVert,
      fragmentShader: causticFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(el.clientWidth, el.clientHeight) },
        uDark: { value: currentDark },
      },
      depthWrite: false,
      depthTest: false,
    });
    const quadGeo = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(quadGeo, causticMat));

    /* ── particle scene ── */
    const particleScene = new THREE.Scene();
    const pCam = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 10);
    pCam.position.z = 1.8;

    const offsets = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const alphas = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      offsets[i * 3]     = (Math.random() - 0.5) * 3;
      offsets[i * 3 + 1] = (Math.random() - 0.5) * 2;
      offsets[i * 3 + 2] = (Math.random() - 0.5) * 2;
      sizes[i]  = 1.0 + Math.random() * 1.8;
      alphas[i] = 0.15 + Math.random() * 0.45;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    pGeo.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));
    pGeo.setAttribute("aSize", new THREE.InstancedBufferAttribute(sizes, 1));
    pGeo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));

    const pMat = new THREE.ShaderMaterial({
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      uniforms: {
        uTime: { value: 0 },
        uDark: { value: currentDark },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    particleScene.add(new THREE.Points(pGeo, pMat));

    /* ── dark/light observer ── */
    const mo = new MutationObserver(() => {
      targetDark = isDarkMode(forceDark) ? 1.0 : 0.0;
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    /* ── animation loop ── */
    let animId = 0;
    const startTime = performance.now() - 200_000;
    const darkClear = new THREE.Color(0x060a0d);
    const lightClear = new THREE.Color(0xdbe8f8);
    const lerpTarget = new THREE.Color();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) * 0.001;

      currentDark += (targetDark - currentDark) * 0.03;
      if (Math.abs(currentDark - targetDark) < 0.001) currentDark = targetDark;

      causticMat.uniforms.uTime.value = elapsed;
      causticMat.uniforms.uDark.value = currentDark;
      pMat.uniforms.uTime.value = elapsed;
      pMat.uniforms.uDark.value = currentDark;

      lerpTarget.copy(darkClear).lerp(lightClear, 1.0 - currentDark);
      renderer.setClearColor(lerpTarget);

      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.render(particleScene, pCam);
    };
    animate();

    /* ── resize ── */
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      causticMat.uniforms.uResolution.value.set(width, height);
      pCam.aspect = width / height;
      pCam.updateProjectionMatrix();
    });
    ro.observe(el);

    /* ── cleanup ── */
    return () => {
      cancelAnimationFrame(animId);
      mo.disconnect();
      ro.disconnect();
      renderer.dispose();
      causticMat.dispose();
      pMat.dispose();
      pGeo.dispose();
      quadGeo.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [forceDark]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`fixed inset-0 overflow-hidden ${forceDark ? "bg-[#060a0d]" : "bg-[#dbe8f8] dark:bg-[#060a0d]"} ${className}`}
      style={{ zIndex: 0, contain: "strict" }}
    />
  );
};
