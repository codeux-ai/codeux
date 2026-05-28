import { useEffect, useRef } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";

const RENDER_SCALE = 0.35;

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
  uniform vec2  uMouse;
  uniform float uDark;
  varying vec2  vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(21.4, 65.2))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    vec2 aspectUv = vec2(uv.x * aspect, uv.y);
    
    vec2 mouse = vec2(uMouse.x * aspect, uMouse.y);
    float t = uTime * 0.5;
    
    // Grid settings
    float scale = 15.0;
    vec2 p = aspectUv * scale;
    
    // Gravitational pull towards mouse
    vec2 mousePos = mouse * scale;
    vec2 toMouse = mousePos - p;
    float dist = length(toMouse);
    float pull = 1.0 / (1.0 + dist * dist * 0.5);
    
    // Distort grid based on pull and time
    p += normalize(toMouse) * pull * 0.3;
    p.y += sin(p.x * 0.5 + t) * 0.2 * pull;
    
    // Calculate grid lines
    vec2 grid = fract(p);
    vec2 df = fwidth(p);
    
    // Anti-aliased lines
    vec2 lines = smoothstep(df * 1.5, vec2(0.0), grid) + smoothstep(1.0 - df * 1.5, vec2(1.0), grid);
    float lineMix = max(lines.x, lines.y);
    
    // Node dots at intersections
    float dots = smoothstep(0.1, 0.0, length(grid - vec2(0.5, 0.5)));
    
    // Lighting / Energy
    float energy = pull * 0.8 + 0.5; // Base energy + subtle mouse proximity
    
    vec3 colDark = vec3(0.05, 0.9, 0.7); // Cyberpunk Cyan
    vec3 colLight = vec3(0.1, 0.4, 0.8); // Deep Blue
    
    vec3 baseColor = mix(colLight, colDark, uDark);
    
    // Glow effect
    vec3 color = baseColor * lineMix * energy;
    color += baseColor * dots * energy * 2.0; // Brighter dots
    
    // Background color
    vec3 bgDark = vec3(0.02, 0.01, 0.04);
    vec3 bgLight = vec3(0.9, 0.92, 0.96);
    vec3 bg = mix(bgLight, bgDark, uDark);
    
    // Add subtle wave to background
    float wave = sin(p.x * 0.2 + p.y * 0.3 - t) * 0.5 + 0.5;
    bg += baseColor * wave * 0.05 * energy;
    
    color = bg + color;
    
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

export const QuantumFieldBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let currentDark = isDarkMode(forceDark) ? 1.0 : 0.0;
    let targetDark = currentDark;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * RENDER_SCALE);
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    let mouseX = 0.5;
    let mouseY = 0.5;
    let targetMouseX = 0.5;
    let targetMouseY = 0.5;

    const handleMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX / window.innerWidth;
      targetMouseY = 1.0 - (e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", handleMouseMove);

    const mat = new THREE.ShaderMaterial({
      vertexShader: causticVert,
      fragmentShader: causticFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(el.clientWidth, el.clientHeight) },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uDark: { value: currentDark },
      },
    });
    
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    const mo = new MutationObserver(() => { targetDark = isDarkMode(forceDark) ? 1.0 : 0.0; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let animId = 0;
    const startTime = performance.now();
    const FRAME_INTERVAL = 1000 / 20;
    let lastFrame = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      if (now - lastFrame < FRAME_INTERVAL) return;
      lastFrame = now;
      const elapsed = (now - startTime) * 0.001;

      currentDark += (targetDark - currentDark) * 0.05;

      mouseX += (targetMouseX - mouseX) * 0.02;
      mouseY += (targetMouseY - mouseY) * 0.02;

      mat.uniforms.uTime.value = elapsed;
      mat.uniforms.uDark.value = currentDark;
      mat.uniforms.uMouse.value.set(mouseX, mouseY);

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
      window.removeEventListener("mousemove", handleMouseMove);
      mo.disconnect();
      ro.disconnect();
      renderer.dispose();
      mat.dispose();
      quad.geometry.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [forceDark]);

  return <div ref={containerRef} aria-hidden="true" className={`fixed inset-0 overflow-hidden ${className}`} style={{ zIndex: 0, contain: "strict" }} />;
};
