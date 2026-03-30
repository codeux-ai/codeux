import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { DEFAULT_AGENT_AVATAR_CONFIG } from "../../lib/agent-avatar.js";

interface AgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  fallbackMode?: boolean;
}

const BODY_COLORS = {
  male: 0xdeb887,
  female: 0xf5deb3,
};

const HAIR_COLORS = {
  style1: 0x222222, // Black
  style2: 0x8b4513, // Brown
  style3: 0xffd700, // Blonde
  style4: 0xff4500, // Red
};

const SHIRT_COLORS = {
  style1: 0x4169e1, // Royal Blue
  style2: 0x2e8b57, // Sea Green
  style3: 0xcd5c5c, // Indian Red
  style4: 0x9370db, // Medium Purple
};

const BOTTOM_COLORS = {
  style1: 0x000080, // Navy
  style2: 0x808080, // Gray
  style3: 0xf5f5dc, // Beige
  style4: 0x000000, // Black
};

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
    materials: Record<string, THREE.Material>;
    meshes: {
      avatarGroup: THREE.Group;
      head: THREE.Mesh;
      torso: THREE.Mesh;
      hair: THREE.Mesh;
      leftEye: THREE.Mesh;
      rightEye: THREE.Mesh;
      mouth: THREE.Mesh;
    };
    geometries: Record<string, THREE.BufferGeometry>;
    animationId: number;
  } | null>(null);

  // Check for reduced motion preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Initialize Scene Once
  useEffect(() => {
    if (fallbackMode || webglError) return;
    const mount = mountRef.current;
    if (!mount) return;

    // Check if already initialized to prevent double-mounting in strict mode or dev
    if (sceneRef.current) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (e) {
      console.warn("WebGL not supported:", e);
      setWebglError(true);
      return;
    }

    const { clientWidth, clientHeight } = mount;
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      45,
      clientWidth / clientHeight,
      0.1,
      100
    );
    camera.position.z = 10;
    camera.position.y = 2;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    const materials = {
      body: new THREE.MeshStandardMaterial({ color: 0xdeb887 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x222222 }),
      shirt: new THREE.MeshStandardMaterial({ color: 0x4169e1 }),
      bottom: new THREE.MeshStandardMaterial({ color: 0x000080 }),
      eye: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      mouth: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    };

    const geometries = {
      head: new THREE.SphereGeometry(1.2, 32, 32),
      hair: new THREE.SphereGeometry(1.25, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      torso: new THREE.CapsuleGeometry(0.9, 1.5, 4, 16),
      leg: new THREE.CapsuleGeometry(0.3, 1.0, 4, 8),
      eye: new THREE.SphereGeometry(0.15, 16, 16),
      mouthBox: new THREE.BoxGeometry(0.4, 0.1, 0.1),
    };

    const head = new THREE.Mesh(geometries.head, materials.body);
    head.position.y = 3.5;
    avatarGroup.add(head);

    const hair = new THREE.Mesh(geometries.hair, materials.hair);
    hair.position.y = 3.5;
    avatarGroup.add(hair);

    const torso = new THREE.Mesh(geometries.torso, materials.shirt);
    torso.position.y = 1.0;
    avatarGroup.add(torso);

    const leftLeg = new THREE.Mesh(geometries.leg, materials.bottom);
    leftLeg.position.set(-0.4, -0.8, 0);
    avatarGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(geometries.leg, materials.bottom);
    rightLeg.position.set(0.4, -0.8, 0);
    avatarGroup.add(rightLeg);

    const faceGroup = new THREE.Group();
    head.add(faceGroup);

    const leftEye = new THREE.Mesh(geometries.eye, materials.eye);
    leftEye.position.set(-0.4, 0.1, 1.1);
    faceGroup.add(leftEye);

    const rightEye = new THREE.Mesh(geometries.eye, materials.eye);
    rightEye.position.set(0.4, 0.1, 1.1);
    faceGroup.add(rightEye);

    const mouth = new THREE.Mesh(geometries.mouthBox, materials.mouth);
    mouth.position.set(0, -0.4, 1.15);
    faceGroup.add(mouth);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      materials,
      geometries,
      meshes: {
        avatarGroup,
        head,
        torso,
        hair,
        leftEye,
        rightEye,
        mouth,
      },
      animationId: 0,
    };

    const handleResize = () => {
      if (!mountRef.current || !sceneRef.current) return;
      const { clientWidth, clientHeight } = mountRef.current;
      sceneRef.current.renderer.setSize(clientWidth, clientHeight);
      sceneRef.current.camera.aspect = clientWidth / clientHeight;
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

        Object.values(sceneRef.current.materials).forEach((mat) => mat.dispose());
        Object.values(sceneRef.current.geometries).forEach((geo) => geo.dispose());

        sceneRef.current = null;
      }
    };
  }, [fallbackMode, webglError]);

  // Update loop for properties and animation
  useEffect(() => {
    if (!sceneRef.current || fallbackMode || webglError) return;

    const { materials, meshes, renderer, scene, camera } = sceneRef.current;

    // Update Materials immediately
    (materials.body as THREE.MeshStandardMaterial).color.setHex(
      BODY_COLORS[config.body as keyof typeof BODY_COLORS] || BODY_COLORS.male
    );
    (materials.hair as THREE.MeshStandardMaterial).color.setHex(
      HAIR_COLORS[config.hair as keyof typeof HAIR_COLORS] || HAIR_COLORS.style1
    );
    (materials.shirt as THREE.MeshStandardMaterial).color.setHex(
      SHIRT_COLORS[config.shirt as keyof typeof SHIRT_COLORS] || SHIRT_COLORS.style1
    );
    (materials.bottom as THREE.MeshStandardMaterial).color.setHex(
      BOTTOM_COLORS[config.bottom as keyof typeof BOTTOM_COLORS] || BOTTOM_COLORS.style1
    );

    // Apply structural configuration (Hair & Face styles)
    // Hair variants
    meshes.hair.scale.set(1, 1, 1);
    meshes.hair.position.y = 3.5;
    if (config.hair === "style2") {
      meshes.hair.scale.set(1.1, 0.9, 1.1); // Flatter, wider
    } else if (config.hair === "style3") {
      meshes.hair.scale.set(0.9, 1.2, 0.9); // Taller
    } else if (config.hair === "style4") {
      meshes.hair.scale.set(1.05, 1.05, 1.05); // Slightly larger overall
      meshes.hair.position.y = 3.4;
    }

    // Face variants (adjusting default eye distance and mouth width)
    let baseEyeX = 0.4;
    let baseMouthScaleX = 1;
    let baseEyeY = 0.1;

    if (config.face === "style2") {
      baseEyeX = 0.5; // Wider eyes
      baseMouthScaleX = 0.8; // Smaller mouth
    } else if (config.face === "style3") {
      baseEyeX = 0.35; // Closer eyes
      baseEyeY = 0.15; // Higher eyes
    } else if (config.face === "style4") {
      baseMouthScaleX = 1.2; // Wider mouth
      baseEyeY = 0.05; // Lower eyes
    }

    meshes.leftEye.position.x = -baseEyeX;
    meshes.rightEye.position.x = baseEyeX;
    meshes.leftEye.position.y = baseEyeY;
    meshes.rightEye.position.y = baseEyeY;

    // Animation states
    let targetHeadRotY = 0;
    let targetHeadRotZ = 0;
    let targetHeadRotX = 0;
    let jumpOffset = 0;
    let eyeScaleY = 1;
    let mouthScale = new THREE.Vector3(baseMouthScaleX, 1, 1);

    switch (expression) {
      case "happy":
        mouthScale.set(baseMouthScaleX * 1.5, 1, 1);
        jumpOffset = 0.5;
        eyeScaleY = 1;
        break;
      case "sad":
        mouthScale.set(baseMouthScaleX, 0.2, 1); // Frown/thin mouth
        targetHeadRotX = 0.2; // Look down
        break;
      case "angry":
        mouthScale.set(baseMouthScaleX * 0.8, 0.2, 1);
        targetHeadRotX = -0.1; // Look up slightly
        break;
      case "sleepy":
        eyeScaleY = 0.2; // Squinting
        mouthScale.set(baseMouthScaleX * 0.5, 0.5, 1);
        targetHeadRotZ = 0.2; // Tilt head
        targetHeadRotX = 0.1;
        break;
      case "bored":
        eyeScaleY = 0.5; // Half-open
        mouthScale.set(baseMouthScaleX, 0.2, 1); // Neutral straight line
        break;
      case "hyped":
        mouthScale.set(baseMouthScaleX * 1.5, 2, 1); // Open wide
        jumpOffset = 1;
        eyeScaleY = 1.2;
        break;
      case "shake_head":
        mouthScale.set(baseMouthScaleX, 0.5, 1);
        break;
      case "nod":
        mouthScale.set(baseMouthScaleX, 1, 1);
        break;
    }

    let time = 0;

    const animate = () => {
      if (!sceneRef.current) return;
      sceneRef.current.animationId = requestAnimationFrame(animate);

      if (!isReducedMotion) {
        time += 0.05;

        // Smoothly interpolate eye and mouth scales
        meshes.leftEye.scale.setY(THREE.MathUtils.lerp(meshes.leftEye.scale.y, eyeScaleY, 0.2));
        meshes.rightEye.scale.setY(THREE.MathUtils.lerp(meshes.rightEye.scale.y, eyeScaleY, 0.2));

        meshes.mouth.scale.x = THREE.MathUtils.lerp(meshes.mouth.scale.x, mouthScale.x, 0.2);
        meshes.mouth.scale.y = THREE.MathUtils.lerp(meshes.mouth.scale.y, mouthScale.y, 0.2);
        meshes.mouth.scale.z = THREE.MathUtils.lerp(meshes.mouth.scale.z, mouthScale.z, 0.2);

        // Apply animations based on expression
        if (expression === "hyped" || expression === "happy") {
          meshes.avatarGroup.position.y = Math.abs(Math.sin(time * 3)) * jumpOffset;
        } else {
          meshes.avatarGroup.position.y = THREE.MathUtils.lerp(
            meshes.avatarGroup.position.y,
            0,
            0.1
          );
        }

        if (expression === "shake_head") {
          meshes.head.rotation.y = Math.sin(time * 5) * 0.3;
          meshes.hair.rotation.y = meshes.head.rotation.y;
        } else if (expression === "nod") {
          meshes.head.rotation.x = Math.sin(time * 4) * 0.3;
          meshes.hair.rotation.x = meshes.head.rotation.x;
        } else {
          meshes.head.rotation.y = THREE.MathUtils.lerp(meshes.head.rotation.y, targetHeadRotY, 0.1);
          meshes.head.rotation.x = THREE.MathUtils.lerp(meshes.head.rotation.x, targetHeadRotX, 0.1);
          meshes.head.rotation.z = THREE.MathUtils.lerp(meshes.head.rotation.z, targetHeadRotZ, 0.1);

          meshes.hair.rotation.copy(meshes.head.rotation);
        }
      } else {
        // Fallback for reduced motion: snap to target states
        meshes.leftEye.scale.setY(eyeScaleY);
        meshes.rightEye.scale.setY(eyeScaleY);
        meshes.mouth.scale.copy(mouthScale);
        meshes.avatarGroup.position.y = 0;
        meshes.head.rotation.set(targetHeadRotX, targetHeadRotY, targetHeadRotZ);
        meshes.hair.rotation.copy(meshes.head.rotation);
      }

      renderer.render(scene, camera);
    };

    // Cancel previous animation frame to prevent multiple loops
    cancelAnimationFrame(sceneRef.current.animationId);
    animate();

    return () => {
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
      }
    };
  }, [config, expression, isReducedMotion, fallbackMode, webglError]);

  if (fallbackMode || webglError) {
    const shirtColorStr = `#${(SHIRT_COLORS[config.shirt as keyof typeof SHIRT_COLORS] || SHIRT_COLORS.style1).toString(16).padStart(6, '0')}`;
    const hairColorStr = `#${(HAIR_COLORS[config.hair as keyof typeof HAIR_COLORS] || HAIR_COLORS.style1).toString(16).padStart(6, '0')}`;
    const bodyColorStr = `#${(BODY_COLORS[config.body as keyof typeof BODY_COLORS] || BODY_COLORS.male).toString(16).padStart(6, '0')}`;

    return (
      <div
        className={`flex items-center justify-center bg-gray-50 rounded-lg ${className}`}
        style={{ minHeight: "200px", width: "100%", height: "100%" }}
        data-testid="agent-avatar-fallback"
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full max-w-[200px]"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Torso */}
          <rect x="30" y="55" width="40" height="45" rx="10" fill={shirtColorStr} />
          {/* Head */}
          <circle cx="50" cy="40" r="25" fill={bodyColorStr} />
          {/* Hair (Simplified dome) */}
          <path d="M 22 40 C 22 15, 78 15, 78 40 L 78 45 L 22 45 Z" fill={hairColorStr} />

          {/* Eyes & Mouth depending on expression */}
          {expression === "sleepy" || expression === "bored" ? (
             <>
               <line x1="40" y1="38" x2="44" y2="38" stroke="black" stroke-width="2" stroke-linecap="round"/>
               <line x1="56" y1="38" x2="60" y2="38" stroke="black" stroke-width="2" stroke-linecap="round"/>
             </>
          ) : (
             <>
               <circle cx="42" cy="38" r="3" fill="black" />
               <circle cx="58" cy="38" r="3" fill="black" />
             </>
          )}

          {expression === "happy" || expression === "hyped" ? (
            <path d="M 45 45 Q 50 50 55 45" stroke="black" stroke-width="2" fill="none" stroke-linecap="round" />
          ) : expression === "sad" ? (
            <path d="M 45 48 Q 50 43 55 48" stroke="black" stroke-width="2" fill="none" stroke-linecap="round" />
          ) : (
            <line x1="45" y1="46" x2="55" y2="46" stroke="black" stroke-width="2" stroke-linecap="round"/>
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
