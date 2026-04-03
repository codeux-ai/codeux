import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { DEFAULT_AGENT_AVATAR_CONFIG, getAccentHex } from "../../lib/agent-avatar.js";

interface AgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  fallbackMode?: boolean;
}

/* ── Accent color map ── */
const ACCENT_COLORS: Record<string, number> = {
  jade: 0x00e0a0,
  amber: 0xffb800,
  violet: 0x8b5cf6,
  coral: 0xff6b6b,
  sky: 0x38bdf8,
  pink: 0xf472b6,
};

function getAccentColor(id?: string): number {
  return ACCENT_COLORS[id ?? "jade"] ?? 0x00e0a0;
}

/* ── Build chassis geometry ── */
function createChassisGeometry(type?: string): THREE.BufferGeometry {
  switch (type) {
    case "square":
      return new THREE.BoxGeometry(2.2, 2.2, 2.2, 4, 4, 4);
    case "capsule":
      return new THREE.CapsuleGeometry(1.0, 1.2, 16, 24);
    case "egg": {
      const geo = new THREE.SphereGeometry(1.1, 32, 32);
      geo.scale(1, 1.3, 1);
      return geo;
    }
    default: // round
      return new THREE.SphereGeometry(1.2, 32, 32);
  }
}

/* ── Build eye meshes ── */
function createEyes(
  type: string | undefined,
  parent: THREE.Group,
  accentColor: number,
): { left: THREE.Mesh; right: THREE.Mesh | null; visorMesh: THREE.Mesh | null } {
  const glowMat = new THREE.MeshBasicMaterial({ color: accentColor });
  const darkMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  switch (type) {
    case "visor": {
      const visorGeo = new THREE.BoxGeometry(2.0, 0.5, 0.3, 8, 4, 1);
      const visor = new THREE.Mesh(visorGeo, glowMat);
      visor.position.set(0, 0.15, 1.15);

      // Pupil dots on the visor
      const pupilGeo = new THREE.SphereGeometry(0.12, 12, 12);
      const leftPupil = new THREE.Mesh(pupilGeo, darkMat);
      leftPupil.position.set(-0.4, 0, 0.18);
      visor.add(leftPupil);
      const rightPupil = new THREE.Mesh(pupilGeo, darkMat);
      rightPupil.position.set(0.4, 0, 0.18);
      visor.add(rightPupil);

      parent.add(visor);
      return { left: leftPupil, right: rightPupil, visorMesh: visor };
    }
    case "pixel": {
      const pxGeo = new THREE.BoxGeometry(0.4, 0.4, 0.15);
      const left = new THREE.Mesh(pxGeo, glowMat);
      left.position.set(-0.45, 0.15, 1.15);
      parent.add(left);
      const right = new THREE.Mesh(pxGeo, glowMat);
      right.position.set(0.45, 0.15, 1.15);
      parent.add(right);
      return { left, right, visorMesh: null };
    }
    case "cyclops": {
      // One big eye
      const outerGeo = new THREE.SphereGeometry(0.45, 24, 24);
      const outer = new THREE.Mesh(outerGeo, whiteMat);
      outer.position.set(0, 0.15, 1.1);
      parent.add(outer);
      const pupilGeo = new THREE.SphereGeometry(0.22, 16, 16);
      const pupil = new THREE.Mesh(pupilGeo, darkMat);
      pupil.position.set(0, 0, 0.3);
      outer.add(pupil);
      // Glow ring
      const ringGeo = new THREE.TorusGeometry(0.48, 0.04, 8, 32);
      const ring = new THREE.Mesh(ringGeo, glowMat);
      ring.position.set(0, 0.15, 1.1);
      parent.add(ring);
      return { left: outer, right: null, visorMesh: ring };
    }
    default: {
      // dual — two big round cute eyes
      const outerGeo = new THREE.SphereGeometry(0.32, 24, 24);
      const pupilGeo = new THREE.SphereGeometry(0.16, 16, 16);

      const leftOuter = new THREE.Mesh(outerGeo, whiteMat);
      leftOuter.position.set(-0.45, 0.15, 1.05);
      parent.add(leftOuter);
      const leftPupil = new THREE.Mesh(pupilGeo, darkMat);
      leftPupil.position.set(0, 0, 0.22);
      leftOuter.add(leftPupil);

      // Glint (cute sparkle in eye)
      const glintGeo = new THREE.SphereGeometry(0.055, 8, 8);
      const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const leftGlint = new THREE.Mesh(glintGeo, glintMat);
      leftGlint.position.set(0.06, 0.06, 0.25);
      leftOuter.add(leftGlint);

      const rightOuter = new THREE.Mesh(outerGeo, whiteMat);
      rightOuter.position.set(0.45, 0.15, 1.05);
      parent.add(rightOuter);
      const rightPupil = new THREE.Mesh(pupilGeo, darkMat);
      rightPupil.position.set(0, 0, 0.22);
      rightOuter.add(rightPupil);
      const rightGlint = new THREE.Mesh(glintGeo, glintMat);
      rightGlint.position.set(0.06, 0.06, 0.25);
      rightOuter.add(rightGlint);

      return { left: leftOuter, right: rightOuter, visorMesh: null };
    }
  }
}

/* ── Build antenna ── */
function createAntenna(type: string | undefined, parent: THREE.Object3D, accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 });
  const glowMat = new THREE.MeshBasicMaterial({ color: accentColor });

  switch (type) {
    case "dual": {
      // Bunny ears
      [-0.4, 0.4].forEach((x) => {
        const stickGeo = new THREE.CapsuleGeometry(0.06, 0.6, 4, 8);
        const stick = new THREE.Mesh(stickGeo, metalMat);
        stick.position.set(x, 1.6, 0);
        stick.rotation.z = x > 0 ? -0.2 : 0.2;
        group.add(stick);
        const tipGeo = new THREE.SphereGeometry(0.12, 12, 12);
        const tip = new THREE.Mesh(tipGeo, glowMat);
        tip.position.set(0, 0.42, 0);
        stick.add(tip);
      });
      break;
    }
    case "dish": {
      const stickGeo = new THREE.CapsuleGeometry(0.06, 0.4, 4, 8);
      const stick = new THREE.Mesh(stickGeo, metalMat);
      stick.position.set(0, 1.5, 0);
      group.add(stick);
      // Dish shape (half torus)
      const dishGeo = new THREE.SphereGeometry(0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const dish = new THREE.Mesh(dishGeo, glowMat);
      dish.position.set(0, 1.85, 0);
      dish.rotation.x = Math.PI;
      group.add(dish);
      break;
    }
    case "none":
      break;
    default: {
      // Single antenna
      const stickGeo = new THREE.CapsuleGeometry(0.05, 0.7, 4, 8);
      const stick = new THREE.Mesh(stickGeo, metalMat);
      stick.position.set(0, 1.6, 0);
      group.add(stick);
      const tipGeo = new THREE.SphereGeometry(0.14, 12, 12);
      const tip = new THREE.Mesh(tipGeo, glowMat);
      tip.position.set(0, 0.5, 0);
      stick.add(tip);
      break;
    }
  }

  parent.add(group);
  return group;
}

/* ── Build wings / propulsion ── */
function createWings(type: string | undefined, parent: THREE.Group, accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.7, roughness: 0.3 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.85,
  });

  switch (type) {
    case "jets": {
      [-1.5, 1.5].forEach((x) => {
        const wingGeo = new THREE.BoxGeometry(0.8, 0.15, 0.5);
        const wing = new THREE.Mesh(wingGeo, metalMat);
        wing.position.set(x, -0.2, 0);
        wing.rotation.z = x > 0 ? -0.15 : 0.15;
        group.add(wing);
        // Thruster glow
        const thrustGeo = new THREE.CylinderGeometry(0.12, 0.06, 0.3, 8);
        const thrust = new THREE.Mesh(thrustGeo, glowMat);
        thrust.position.set(0, -0.15, -0.2);
        wing.add(thrust);
      });
      break;
    }
    case "hover": {
      // Hover rings around body
      const ringGeo = new THREE.TorusGeometry(1.6, 0.06, 8, 32);
      const ring = new THREE.Mesh(ringGeo, glowMat);
      ring.position.y = -0.5;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      const ring2Geo = new THREE.TorusGeometry(1.35, 0.04, 8, 32);
      const ring2 = new THREE.Mesh(ring2Geo, glowMat);
      ring2.position.y = -0.8;
      ring2.rotation.x = Math.PI / 2;
      group.add(ring2);
      break;
    }
    case "tiny": {
      [-1.3, 1.3].forEach((x) => {
        const wingGeo = new THREE.SphereGeometry(0.25, 12, 12);
        wingGeo.scale(1.5, 0.5, 1);
        const wing = new THREE.Mesh(wingGeo, glowMat);
        wing.position.set(x, 0.3, 0);
        group.add(wing);
      });
      break;
    }
    default: {
      // Propeller
      const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.15, 8);
      const hub = new THREE.Mesh(hubGeo, metalMat);
      hub.position.set(0, 1.35, 0);
      group.add(hub);
      for (let i = 0; i < 3; i++) {
        const bladeGeo = new THREE.BoxGeometry(1.2, 0.03, 0.18);
        const blade = new THREE.Mesh(bladeGeo, glowMat);
        blade.rotation.y = (i * Math.PI * 2) / 3;
        hub.add(blade);
      }
      break;
    }
  }

  parent.add(group);
  return group;
}

/* ── Build mouth ── */
function createMouth(parent: THREE.Group, accentColor: number): THREE.Mesh {
  const mouthGeo = new THREE.BoxGeometry(0.35, 0.08, 0.08);
  const mouthMat = new THREE.MeshBasicMaterial({ color: accentColor });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, -0.35, 1.15);
  parent.add(mouth);
  return mouth;
}

/* ── Small arm nubs ── */
function createArms(parent: THREE.Group, accentColor: number): { left: THREE.Mesh; right: THREE.Mesh } {
  const armMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.6, roughness: 0.4 });
  const handMat = new THREE.MeshStandardMaterial({ color: accentColor, emissive: accentColor, emissiveIntensity: 0.15 });

  const armGeo = new THREE.CapsuleGeometry(0.12, 0.35, 4, 8);
  const handGeo = new THREE.SphereGeometry(0.14, 12, 12);

  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-1.35, -0.1, 0);
  leftArm.rotation.z = 0.5;
  parent.add(leftArm);
  const leftHand = new THREE.Mesh(handGeo, handMat);
  leftHand.position.set(0, -0.28, 0);
  leftArm.add(leftHand);

  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(1.35, -0.1, 0);
  rightArm.rotation.z = -0.5;
  parent.add(rightArm);
  const rightHand = new THREE.Mesh(handGeo, handMat);
  rightHand.position.set(0, -0.28, 0);
  rightArm.add(rightHand);

  return { left: leftArm, right: rightArm };
}

/* ── Cheek blush circles ── */
function createCheeks(parent: THREE.Group): { left: THREE.Mesh; right: THREE.Mesh } {
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9999, transparent: true, opacity: 0.0 });
  const cheekGeo = new THREE.CircleGeometry(0.15, 16);

  const left = new THREE.Mesh(cheekGeo, cheekMat);
  left.position.set(-0.7, -0.15, 1.05);
  parent.add(left);

  const right = new THREE.Mesh(cheekGeo, cheekMat);
  right.position.set(0.7, -0.15, 1.05);
  parent.add(right);

  return { left, right };
}

export function AgentAvatarScene({
  config = DEFAULT_AGENT_AVATAR_CONFIG,
  expression = "happy",
  className = "",
  fallbackMode = false,
}: AgentAvatarSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    avatarGroup: THREE.Group;
    chassis: THREE.Mesh;
    eyeLeft: THREE.Mesh;
    eyeRight: THREE.Mesh | null;
    visorMesh: THREE.Mesh | null;
    mouth: THREE.Mesh;
    antennaGroup: THREE.Group;
    wingsGroup: THREE.Group;
    leftArm: THREE.Mesh;
    rightArm: THREE.Mesh;
    cheekLeft: THREE.Mesh;
    cheekRight: THREE.Mesh;
    disposables: (THREE.BufferGeometry | THREE.Material)[];
    animationId: number;
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Tear down + rebuild whenever config changes (chassis shape, eyes, antenna, wings all affect geometry)
  useEffect(() => {
    if (fallbackMode || webglError) return;
    const mount = mountRef.current;
    if (!mount) return;

    // Clean up previous scene
    if (sceneRef.current) {
      cancelAnimationFrame(sceneRef.current.animationId);
      if (mount.contains(sceneRef.current.renderer.domElement)) {
        mount.removeChild(sceneRef.current.renderer.domElement);
      }
      sceneRef.current.renderer.dispose();
      sceneRef.current.disposables.forEach((d) => d.dispose());
      sceneRef.current = null;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setWebglError(true);
      return;
    }

    const { clientWidth, clientHeight } = mount;
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, clientWidth / clientHeight, 0.1, 100);
    camera.position.set(0, 1.2, 8);
    camera.lookAt(0, 0.5, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(4, 6, 5);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    const accentColor = getAccentColor(config.accent);
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

    // Avatar group (everything floats together)
    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    // Chassis (main body)
    const chassisGeo = createChassisGeometry(config.chassis);
    disposables.push(chassisGeo);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a,
      metalness: 0.5,
      roughness: 0.4,
    });
    disposables.push(chassisMat);

    // Accent panel overlay on the chassis
    const panelGeo = createChassisGeometry(config.chassis);
    panelGeo.scale(1.01, 1.01, 1.01);
    disposables.push(panelGeo);
    const panelMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.2,
    });
    disposables.push(panelMat);

    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = 0.5;
    avatarGroup.add(chassis);

    const panel = new THREE.Mesh(panelGeo, panelMat);
    chassis.add(panel);

    // Face group (attached to chassis)
    const faceGroup = new THREE.Group();
    chassis.add(faceGroup);

    // Eyes
    const { left: eyeLeft, right: eyeRight, visorMesh } = createEyes(config.eyes, faceGroup, accentColor);

    // Mouth
    const mouth = createMouth(faceGroup, accentColor);

    // Cheeks (blush)
    const { left: cheekLeft, right: cheekRight } = createCheeks(faceGroup);

    // Antenna
    const antennaGroup = createAntenna(config.antenna, chassis, accentColor);

    // Wings
    const wingsGroup = createWings(config.wings, avatarGroup, accentColor);

    // Arms
    const { left: leftArm, right: rightArm } = createArms(avatarGroup, accentColor);

    // Particle trail beneath (glow dots)
    const particleCount = 12;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = -1.5 - Math.random() * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    disposables.push(particleGeo);
    const particleMat = new THREE.PointsMaterial({
      color: accentColor,
      size: 0.08,
      transparent: true,
      opacity: 0.6,
    });
    disposables.push(particleMat);
    const particles = new THREE.Points(particleGeo, particleMat);
    avatarGroup.add(particles);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      avatarGroup,
      chassis,
      eyeLeft,
      eyeRight,
      visorMesh,
      mouth,
      antennaGroup,
      wingsGroup,
      leftArm,
      rightArm,
      cheekLeft,
      cheekRight,
      disposables,
      animationId: 0,
    };

    const handleResize = () => {
      if (!mountRef.current || !sceneRef.current) return;
      const { clientWidth: w, clientHeight: h } = mountRef.current;
      sceneRef.current.renderer.setSize(w, h);
      sceneRef.current.camera.aspect = w / h;
      sceneRef.current.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        if (mount.contains(sceneRef.current.renderer.domElement)) {
          mount.removeChild(sceneRef.current.renderer.domElement);
        }
        sceneRef.current.renderer.dispose();
        sceneRef.current.disposables.forEach((d) => d.dispose());
        sceneRef.current = null;
      }
    };
  }, [fallbackMode, webglError, config.chassis, config.eyes, config.antenna, config.wings, config.accent]);

  // Animation loop — runs on expression change
  useEffect(() => {
    if (!sceneRef.current || fallbackMode || webglError) return;
    const s = sceneRef.current;
    let time = 0;

    // Expression targets
    let eyeScaleY = 1;
    let mouthScaleX = 1;
    let mouthScaleY = 1;
    let headTiltX = 0;
    let headTiltZ = 0;
    let bounceAmp = 0.15; // idle float amplitude
    let bounceSpeed = 1.5;
    let armWaveSpeed = 0;
    let cheekOpacity = 0;
    let propellerSpeed = 8;

    switch (expression) {
      case "happy":
        mouthScaleX = 1.8;
        mouthScaleY = 0.6;
        bounceAmp = 0.25;
        bounceSpeed = 2;
        cheekOpacity = 0.5;
        armWaveSpeed = 2;
        break;
      case "sad":
        eyeScaleY = 0.6;
        mouthScaleX = 0.6;
        mouthScaleY = 0.3;
        headTiltX = 0.15;
        bounceAmp = 0.08;
        bounceSpeed = 0.8;
        propellerSpeed = 4;
        break;
      case "angry":
        eyeScaleY = 0.7;
        mouthScaleX = 0.5;
        mouthScaleY = 0.4;
        headTiltX = -0.1;
        bounceAmp = 0.1;
        bounceSpeed = 3;
        propellerSpeed = 14;
        break;
      case "sleepy":
        eyeScaleY = 0.15;
        mouthScaleX = 0.5;
        mouthScaleY = 0.5;
        headTiltZ = 0.2;
        headTiltX = 0.1;
        bounceAmp = 0.06;
        bounceSpeed = 0.6;
        propellerSpeed = 2;
        break;
      case "bored":
        eyeScaleY = 0.4;
        mouthScaleX = 0.8;
        mouthScaleY = 0.2;
        headTiltZ = 0.1;
        bounceAmp = 0.05;
        bounceSpeed = 0.7;
        propellerSpeed = 3;
        break;
      case "hyped":
        eyeScaleY = 1.3;
        mouthScaleX = 2;
        mouthScaleY = 1.5;
        bounceAmp = 0.6;
        bounceSpeed = 4;
        cheekOpacity = 0.7;
        armWaveSpeed = 5;
        propellerSpeed = 20;
        break;
      case "shake_head":
        mouthScaleX = 0.8;
        bounceAmp = 0.12;
        break;
      case "nod":
        mouthScaleX = 1;
        bounceAmp = 0.12;
        break;
    }

    const animate = () => {
      if (!sceneRef.current) return;
      sceneRef.current.animationId = requestAnimationFrame(animate);

      if (isReducedMotion) {
        s.renderer.render(s.scene, s.camera);
        return;
      }

      time += 0.016;

      // Floating bob
      s.avatarGroup.position.y = Math.sin(time * bounceSpeed) * bounceAmp;

      // Gentle sway
      s.avatarGroup.rotation.z = Math.sin(time * 0.8) * 0.03;

      // Head tilt (expression-driven)
      if (expression === "shake_head") {
        s.chassis.rotation.y = Math.sin(time * 5) * 0.3;
      } else if (expression === "nod") {
        s.chassis.rotation.x = Math.sin(time * 4) * 0.25;
      } else {
        s.chassis.rotation.x = THREE.MathUtils.lerp(s.chassis.rotation.x, headTiltX, 0.08);
        s.chassis.rotation.z = THREE.MathUtils.lerp(s.chassis.rotation.z, headTiltZ, 0.08);
        s.chassis.rotation.y = THREE.MathUtils.lerp(s.chassis.rotation.y, 0, 0.08);
      }

      // Eye scale
      s.eyeLeft.scale.y = THREE.MathUtils.lerp(s.eyeLeft.scale.y, eyeScaleY, 0.12);
      if (s.eyeRight) {
        s.eyeRight.scale.y = THREE.MathUtils.lerp(s.eyeRight.scale.y, eyeScaleY, 0.12);
      }
      if (s.visorMesh && expression !== "happy" && expression !== "hyped") {
        s.visorMesh.scale.y = THREE.MathUtils.lerp(s.visorMesh.scale.y, eyeScaleY, 0.12);
      }

      // Mouth
      s.mouth.scale.x = THREE.MathUtils.lerp(s.mouth.scale.x, mouthScaleX, 0.12);
      s.mouth.scale.y = THREE.MathUtils.lerp(s.mouth.scale.y, mouthScaleY, 0.12);

      // Cheek blush
      const cheekMat = s.cheekLeft.material as THREE.MeshBasicMaterial;
      cheekMat.opacity = THREE.MathUtils.lerp(cheekMat.opacity, cheekOpacity, 0.08);
      (s.cheekRight.material as THREE.MeshBasicMaterial).opacity = cheekMat.opacity;

      // Propeller / wing animation
      if (s.wingsGroup.children.length > 0) {
        const first = s.wingsGroup.children[0];
        if (first instanceof THREE.Mesh && first.geometry.type === "CylinderGeometry") {
          // Propeller hub — spin it
          first.rotation.y += propellerSpeed * 0.016;
        }
        // Hover rings — gentle spin
        s.wingsGroup.children.forEach((child) => {
          if (child instanceof THREE.Mesh && child.geometry.type === "TorusGeometry") {
            child.rotation.z += 0.5 * 0.016;
          }
        });
      }

      // Antenna bounce
      if (s.antennaGroup.children.length > 0) {
        s.antennaGroup.rotation.z = Math.sin(time * 3) * 0.05;
      }

      // Arm wave
      if (armWaveSpeed > 0) {
        s.leftArm.rotation.z = 0.5 + Math.sin(time * armWaveSpeed) * 0.3;
        s.rightArm.rotation.z = -0.5 - Math.sin(time * armWaveSpeed + 1) * 0.3;
      } else {
        s.leftArm.rotation.z = THREE.MathUtils.lerp(s.leftArm.rotation.z, 0.5, 0.05);
        s.rightArm.rotation.z = THREE.MathUtils.lerp(s.rightArm.rotation.z, -0.5, 0.05);
      }

      // Particle drift
      const posAttr = (s.avatarGroup.children.find((c) => c instanceof THREE.Points) as THREE.Points)
        ?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (posAttr) {
        for (let i = 0; i < posAttr.count; i++) {
          let y = posAttr.getY(i);
          y -= 0.01;
          if (y < -3.5) y = -1.2;
          posAttr.setY(i, y);
          posAttr.setX(i, posAttr.getX(i) + Math.sin(time + i) * 0.002);
        }
        posAttr.needsUpdate = true;
      }

      s.renderer.render(s.scene, s.camera);
    };

    cancelAnimationFrame(s.animationId);
    animate();

    return () => {
      if (sceneRef.current) cancelAnimationFrame(sceneRef.current.animationId);
    };
  }, [expression, isReducedMotion, fallbackMode, webglError]);

  // ── SVG Fallback ──
  if (fallbackMode || webglError) {
    const accentHex = getAccentHex(config.accent);
    return (
      <div
        className={`flex items-center justify-center rounded-2xl bg-void-800/40 ${className}`}
        style={{ minHeight: "200px", width: "100%", height: "100%" }}
        data-testid="agent-avatar-fallback"
      >
        <svg viewBox="0 0 120 120" className="w-full h-full max-w-[180px]" xmlns="http://www.w3.org/2000/svg">
          {/* Body */}
          <rect x="30" y="35" width="60" height="55" rx="18" fill="#2a2a3a" stroke={accentHex} strokeWidth="2" />
          {/* Antenna */}
          <line x1="60" y1="35" x2="60" y2="18" stroke="#888" strokeWidth="3" strokeLinecap="round" />
          <circle cx="60" cy="15" r="5" fill={accentHex} />
          {/* Eyes */}
          {expression === "sleepy" || expression === "bored" ? (
            <>
              <line x1="44" y1="55" x2="52" y2="55" stroke={accentHex} strokeWidth="3" strokeLinecap="round" />
              <line x1="68" y1="55" x2="76" y2="55" stroke={accentHex} strokeWidth="3" strokeLinecap="round" />
            </>
          ) : (
            <>
              <circle cx="48" cy="55" r="8" fill="white" />
              <circle cx="48" cy="55" r="4" fill="#111" />
              <circle cx="50" cy="53" r="1.5" fill="white" />
              <circle cx="72" cy="55" r="8" fill="white" />
              <circle cx="72" cy="55" r="4" fill="#111" />
              <circle cx="74" cy="53" r="1.5" fill="white" />
            </>
          )}
          {/* Mouth */}
          {expression === "happy" || expression === "hyped" ? (
            <path d="M 50 70 Q 60 80 70 70" stroke={accentHex} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          ) : expression === "sad" ? (
            <path d="M 50 75 Q 60 68 70 75" stroke={accentHex} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          ) : (
            <line x1="50" y1="72" x2="70" y2="72" stroke={accentHex} strokeWidth="2.5" strokeLinecap="round" />
          )}
          {/* Arms */}
          <line x1="30" y1="55" x2="18" y2="48" stroke="#888" strokeWidth="3" strokeLinecap="round" />
          <circle cx="16" cy="46" r="4" fill={accentHex} />
          <line x1="90" y1="55" x2="102" y2="48" stroke="#888" strokeWidth="3" strokeLinecap="round" />
          <circle cx="104" cy="46" r="4" fill={accentHex} />
          {/* Cheeks (happy/hyped only) */}
          {(expression === "happy" || expression === "hyped") && (
            <>
              <circle cx="38" cy="65" r="5" fill="#ff9999" opacity="0.4" />
              <circle cx="82" cy="65" r="5" fill="#ff9999" opacity="0.4" />
            </>
          )}
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className={`w-full h-full relative ${className}`}
      style={{ minHeight: "200px" }}
      data-testid="agent-avatar-scene"
    />
  );
}
