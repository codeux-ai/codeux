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
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.0 + vec2(100.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    uv.x *= aspect;

    // Neon flow pattern
    vec2 p = uv * 2.0;
    float t = uTime * 0.15;
    
    float n = fbm(p + vec2(cos(t), sin(t)));
    float n2 = fbm(p * 1.5 - vec2(sin(t * 0.8), cos(t * 0.8)) + n * 2.0);
    
    // Colorful bands
    vec3 col1 = vec3(0.9, 0.1, 0.5); // Neon Pink
    vec3 col2 = vec3(0.2, 0.1, 0.8); // Deep Purple
    vec3 col3 = vec3(0.1, 0.8, 0.9); // Cyan
    
    vec3 color = mix(col2, col1, n2);
    color = mix(color, col3, fbm(p * 0.8 + t));
    
    // Smooth out and increase contrast for neon effect
    color = smoothstep(0.1, 0.9, color);
    
    // Add grid lines for a synthwave feel
    vec2 grid = fract(uv * 10.0 + t * vec2(0.0, -1.0));
    float gridLine = smoothstep(0.95, 1.0, grid.x) + smoothstep(0.95, 1.0, grid.y);
    color += col1 * gridLine * 0.3 * (1.0 - n2);

    // Adjust based on light/dark mode
    vec3 darkColor = color * 0.4 + vec3(0.02, 0.01, 0.05); // Deeper for dark mode
    vec3 lightColor = color * 0.6 + vec3(0.9, 0.85, 0.95); // Brighter for light mode
    
    vec3 finalColor = mix(lightColor, darkColor, uDark);
    
    // Vignette
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.5, vigUv * 0.5);
    finalColor *= smoothstep(0.0, 1.0, vig);
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

function isDarkMode(forceDark = false): boolean {
  return forceDark || document.documentElement.classList.contains("dark");
}

export const NeonDreamsBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
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
