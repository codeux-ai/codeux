import { useEffect, useRef } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";

const RENDER_SCALE = 0.5;
const PARTICLE_COUNT = 400;

function isDarkMode(forceDark = false): boolean {
  return forceDark || document.documentElement.classList.contains("dark");
}

export const CosmicDustBackground = ({ forceDark = false, className = "" }: { forceDark?: boolean; className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let currentDark = isDarkMode(forceDark) ? 1.0 : 0.0;
    let targetDark = currentDark;

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * RENDER_SCALE);
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 100);
    camera.position.z = 5;

    // Mouse tracking
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX - window.innerWidth / 2);
      mouseY = (e.clientY - window.innerHeight / 2);
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Particles
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      
      sizes[i] = Math.random() * 2.0 + 0.5;
      phases[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    // Shader for particles
    const vertexShader = `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying float vAlpha;
      
      void main() {
        vec3 pos = position;
        
        // Slow drift
        pos.x += sin(uTime * 0.1 + aPhase) * 0.5;
        pos.y += cos(uTime * 0.15 + aPhase) * 0.5;
        pos.z += sin(uTime * 0.05 + aPhase) * 0.5;
        
        // Twinkle
        vAlpha = 0.5 + 0.5 * sin(uTime * 1.5 + aPhase * 10.0);
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * (30.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      uniform float uDark;
      varying float vAlpha;
      
      void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;
        
        // Soft circle glow
        float alpha = (0.5 - dist) * 2.0;
        alpha = pow(alpha, 1.5) * vAlpha;
        
        vec3 darkColor = vec3(0.5, 0.8, 1.0); // Bright blue/white stars
        vec3 lightColor = vec3(0.1, 0.4, 0.7); // Darker blue dust
        vec3 color = mix(lightColor, darkColor, uDark);
        
        gl_FragColor = vec4(color, alpha * mix(0.4, 0.8, uDark));
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uDark: { value: currentDark }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const mo = new MutationObserver(() => { targetDark = isDarkMode(forceDark) ? 1.0 : 0.0; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let animId = 0;
    const startTime = performance.now();
    const darkClear = new THREE.Color(0x060a0d);
    const lightClear = new THREE.Color(0xf0f4f8);
    const lerpTarget = new THREE.Color();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = (performance.now() - startTime) * 0.001;

      currentDark += (targetDark - currentDark) * 0.05;

      material.uniforms.uTime.value = elapsed;
      material.uniforms.uDark.value = currentDark;

      targetX = mouseX * 0.0003;
      targetY = mouseY * 0.0003;

      camera.position.x += (targetX - camera.position.x) * 0.005;
      camera.position.y += (-targetY - camera.position.y) * 0.005;
      camera.lookAt(scene.position);

      points.rotation.y = elapsed * 0.005;
      points.rotation.x = elapsed * 0.0025;

      lerpTarget.copy(darkClear).lerp(lightClear, 1.0 - currentDark);
      renderer.setClearColor(lerpTarget);

      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", handleMouseMove);
      mo.disconnect();
      ro.disconnect();
      renderer.dispose();
      material.dispose();
      geometry.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [forceDark]);

  return <div ref={containerRef} aria-hidden="true" className={`fixed inset-0 overflow-hidden ${className}`} style={{ zIndex: 0, contain: "strict" }} />;
};
