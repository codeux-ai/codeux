import { useEffect, useRef } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";

const RENDER_SCALE = 0.35; // lower res for soft blur

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
    for (int i = 0; i < 4; i++) {
      f += a * noise(p);
      p = rot * p * 2.0;
      a *= 0.5;
    }
    return f;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / uResolution.y;
    vec2 aspectUv = vec2(uv.x * aspect, uv.y);
    
    vec2 mouse = vec2(uMouse.x * aspect, uMouse.y);
    
    // Very slow time
    float t = uTime * 0.05;
    
    // Subtle mouse displacement
    float mouseDist = length(aspectUv - mouse);
    float mouseInfluence = smoothstep(0.8, 0.0, mouseDist) * 0.15;
    vec2 mouseDir = normalize(aspectUv - mouse + vec2(0.001));
    
    vec2 p = aspectUv * 2.5;
    
    // Base mist movement
    vec2 offset = vec2(fbm(p + vec2(t, t * 0.5)), fbm(p + vec2(-t * 0.8, t)));
    
    // Apply mouse parting effect
    p += mouseDir * mouseInfluence;
    
    float mist1 = fbm(p + offset * 1.5 + t);
    float mist2 = fbm(p * 1.5 - offset * 2.0 - t * 0.5 + mist1 * 1.5);
    float mist3 = fbm(p * 0.8 + vec2(mist2, mist1) + t * 0.2);
    
    float finalMist = (mist1 * 0.4 + mist2 * 0.4 + mist3 * 0.2);
    
    // Colors
    vec3 darkSky = vec3(0.02, 0.03, 0.05);
    vec3 lightSky = vec3(0.92, 0.94, 0.96);
    vec3 bg = mix(lightSky, darkSky, uDark);
    
    vec3 darkMist = mix(vec3(0.08, 0.15, 0.2), vec3(0.2, 0.1, 0.3), mist1);
    vec3 lightMist = mix(vec3(0.8, 0.85, 0.9), vec3(0.95, 0.9, 0.85), mist1);
    vec3 mistColor = mix(lightMist, darkMist, uDark);
    
    // Blend mist
    float alpha = smoothstep(0.2, 0.8, finalMist);
    vec3 color = mix(bg, mistColor, alpha * 0.6); // Soft 60% opacity max
    
    // Soft studio lighting (vignette + top gradient)
    float topLight = smoothstep(0.0, 1.0, vUv.y);
    color += mix(vec3(1.0), vec3(0.5, 0.6, 0.8), uDark) * topLight * 0.05;
    
    vec2 vigUv = vUv * 2.0 - 1.0;
    float vig = 1.0 - dot(vigUv * 0.5, vigUv * 0.5);
    color *= smoothstep(0.0, 1.0, vig);
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

function isDarkMode(forceDark = false): boolean {
  return forceDark || document.documentElement.classList.contains("dark");
}

export const EtherealMistBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
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

      mouseX += (targetMouseX - mouseX) * 0.01;
      mouseY += (targetMouseY - mouseY) * 0.01;

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
