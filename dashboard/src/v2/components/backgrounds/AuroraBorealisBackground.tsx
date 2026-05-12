import { useEffect, useRef } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";

const RENDER_SCALE = 0.5;

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
  uniform float uDark;
  varying vec2  vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
               mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float f = 0.0;
    float a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 5; i++) {
      f += a * noise(p);
      p = rot * p * 2.0;
      a *= 0.5;
    }
    return f;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    uv.x *= aspect;
    
    float t = uTime * 0.1;
    
    // Create aurora waves
    vec2 q = vec2(0.0);
    q.x = fbm(uv + vec2(t));
    q.y = fbm(uv + vec2(t * 1.5));
    
    vec2 r = vec2(0.0);
    r.x = fbm(uv + 1.0 * q + vec2(t * 0.5, t * 1.2));
    r.y = fbm(uv + 1.0 * q + vec2(t * 1.5, t * 0.8));
    
    float f = fbm(uv + r * 2.0);
    
    // Aurora colors
    vec3 col1 = vec3(0.0, 0.8, 0.5); // Teal/Green
    vec3 col2 = vec3(0.4, 0.0, 0.8); // Deep Purple
    vec3 col3 = vec3(0.1, 0.9, 0.7); // Bright Cyan
    
    // Base sky
    vec3 darkSky = vec3(0.01, 0.02, 0.05);
    vec3 lightSky = vec3(0.85, 0.9, 0.95);
    vec3 bg = mix(lightSky, darkSky, uDark);
    
    // Aurora calculation
    float aurora = f * f * f * 2.5;
    
    vec3 auroraCol = mix(col1, col2, clamp(r.x, 0.0, 1.0));
    auroraCol = mix(auroraCol, col3, clamp(r.y, 0.0, 1.0));
    
    // Vertical mask so it looks like curtains hanging
    float mask = smoothstep(0.0, 0.8, 1.0 - uv.y) * smoothstep(0.0, 0.5, uv.y + 0.2);
    
    // Stars in dark mode
    float star = 0.0;
    if (uDark > 0.5) {
      float s1 = noise(uv * 150.0);
      star = smoothstep(0.9, 1.0, s1) * noise(uv * 50.0 + t * 5.0);
    }
    
    vec3 color = bg + (auroraCol * aurora * mask * (uDark * 0.8 + 0.2)) + (vec3(1.0) * star);
    
    // Vignette
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.6, vigUv * 0.6);
    color *= smoothstep(0.0, 1.0, vig);
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

function isDarkMode(forceDark = false): boolean {
  return forceDark || document.documentElement.classList.contains("dark");
}

export const AuroraBorealisBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let currentDark = isDarkMode(forceDark) ? 1.0 : 0.0;
    let targetDark = currentDark;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * RENDER_SCALE);
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const mat = new THREE.ShaderMaterial({
      vertexShader: causticVert,
      fragmentShader: causticFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(el.clientWidth, el.clientHeight) },
        uDark: { value: currentDark },
      },
    });
    
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    const mo = new MutationObserver(() => { targetDark = isDarkMode(forceDark) ? 1.0 : 0.0; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let animId = 0;
    const startTime = performance.now();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) * 0.001;

      currentDark += (targetDark - currentDark) * 0.05;
      mat.uniforms.uTime.value = elapsed;
      mat.uniforms.uDark.value = currentDark;

      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      mat.uniforms.uResolution.value.set(width, height);
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(animId);
      mo.disconnect();
      ro.disconnect();
      renderer.dispose();
      mat.dispose();
      quad.geometry.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [forceDark]);

  return <div ref={containerRef} aria-hidden="true" className={`fixed inset-0 overflow-hidden ${className}`} style={{ zIndex: 0 }} />;
};
