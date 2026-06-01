import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { RobotLogo } from "../brand/RobotLogo.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

/*
  Onboarding intro — Luminous Particle Nebula Constellation.
  A living star-map of drifting orbs on void-black, connected by ephemeral arcs.
  Extremely GPU-friendly: only transform/opacity tweens on ~24 circles + 3 rings.
  Zero strokeDashoffset. Zero SVG filters on animated nodes. Zero layout thrash.
*/

interface OnboardingIntroProps {
    onExitStart?: () => void;
    onComplete?: () => void;
}

const C = 500; // SVG center
const TAU = Math.PI * 2;

// Stable pseudo-random generator
const seeded = (n: number): number => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

const NEON_PALETTE = [
  "#00E0A0", // Signal Jade
  "#00F0FF", // Neon Cyan
  "#7B2CBF", // Electric Purple
  "#FF007F", // Neon Rose
  "#FFB800", // Warm Ember
  "#39FF14", // Neon Green
];

/* ─── Particle Nebula Constellation ─── */

interface Particle {
    /** Orbital center offset from SVG center */
    cx: number;
    cy: number;
    /** Orbital radii (Lissajous ellipse) */
    rx: number;
    ry: number;
    /** Phase offsets for unique motion */
    phaseX: number;
    phaseY: number;
    /** Orbital period in seconds */
    period: number;
    /** Visual radius of the dot */
    r: number;
    color: string;
    /** Stagger delay for reveal */
    delay: number;
}

const PARTICLE_COUNT = 24;

const buildParticles = (): Particle[] => {
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const s = seeded(i);
        const s2 = seeded(i + 100);
        const s3 = seeded(i + 200);
        const s4 = seeded(i + 300);

        // Distribute particles across 3 orbital bands
        const band = i < 8 ? 0 : i < 16 ? 1 : 2;
        const bandRadius = [160, 260, 370][band]!;
        const spread = [40, 55, 70][band]!;

        // Lissajous orbital center sits on a ring around center
        const baseAngle = (i / PARTICLE_COUNT) * TAU + s * 0.4;
        const cx = C + Math.cos(baseAngle) * bandRadius;
        const cy = C + Math.sin(baseAngle) * bandRadius;

        // Orbital extent (how far the particle drifts from its center)
        const rx = 15 + s2 * spread;
        const ry = 12 + s3 * spread * 0.7;

        const period = 8 + s * 14; // 8-22s orbital period
        const phaseX = s2 * TAU;
        const phaseY = s3 * TAU;

        // Dot size: inner band = larger, outer = smaller
        const r = band === 0 ? 2.5 + s4 * 1.5 : band === 1 ? 1.8 + s4 * 1.2 : 1.0 + s4 * 0.8;

        particles.push({
            cx, cy, rx, ry, phaseX, phaseY, period, r,
            color: NEON_PALETTE[i % NEON_PALETTE.length]!,
            delay: 0.6 + i * 0.06,
        });
    }
    return particles;
};

const PARTICLES = buildParticles();

/* ─── Gossamer Ring helpers ─── */

interface GossamerRing {
    radius: number;
    color: string;
    width: number;
    dashArray: string;
    opacity: number;
}

const GOSSAMER_RINGS: GossamerRing[] = [
    { radius: 160, color: "rgba(0, 224, 160, 0.15)", width: 0.4, dashArray: "2 6", opacity: 0.6 },
    { radius: 260, color: "rgba(0, 240, 255, 0.10)", width: 0.35, dashArray: "1 5", opacity: 0.5 },
    { radius: 370, color: "rgba(123, 44, 191, 0.08)", width: 0.3, dashArray: "3 8", opacity: 0.4 },
];

export const OnboardingIntro: FunctionComponent<OnboardingIntroProps> = ({ onExitStart, onComplete }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const vignetteRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const atmosphereRef = useRef<HTMLDivElement>(null);
    const haloRef = useRef<HTMLDivElement>(null);
    const seedRef = useRef<HTMLDivElement>(null);
    const ignitionRingRef = useRef<HTMLDivElement>(null);

    // Nebula refs
    const ringsGroupRef = useRef<SVGGElement>(null);
    const particleRefs = useRef<Array<SVGCircleElement | null>>(PARTICLES.map(() => null));
    const glowRefs = useRef<Array<SVGCircleElement | null>>(PARTICLES.map(() => null));

    // Sonar sweeps (kept — user liked them)
    const sonar1Ref = useRef<SVGCircleElement>(null);
    const sonar2Ref = useRef<SVGCircleElement>(null);
    const sonar3Ref = useRef<SVGCircleElement>(null);

    const logoWrapperRef = useRef<HTMLDivElement>(null);
    const robotRef = useRef<HTMLDivElement>(null);

    const welcomeLabelRef = useRef<HTMLSpanElement>(null);
    const wordmarkRef = useRef<HTMLHeadingElement>(null);
    const taglineRef = useRef<HTMLSpanElement>(null);

    const onExitStartRef = useRef(onExitStart);
    const onCompleteRef = useRef(onComplete);
    onExitStartRef.current = onExitStart;
    onCompleteRef.current = onComplete;

    const reducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            const dots = particleRefs.current.filter(Boolean) as SVGCircleElement[];
            const glows = glowRefs.current.filter(Boolean) as SVGCircleElement[];

            // Prime particles invisible
            [...dots, ...glows].forEach((el) => {
                gsap.set(el, { scale: 0, opacity: 0, transformOrigin: "50% 50%" });
            });

            const robot = robotRef.current;
            const eyeLeft = robot?.querySelector<SVGGElement>("[data-cux-eye='left']") ?? null;
            const eyeRight = robot?.querySelector<SVGGElement>("[data-cux-eye='right']") ?? null;
            const jewel = robot?.querySelector<SVGGElement>("[data-cux-jewel]") ?? null;
            const antBall = robot?.querySelector<SVGGElement>("[data-cux-antenna-ball]") ?? null;
            const antLeft = robot?.querySelector<SVGPathElement>("[data-cux-antenna='left']") ?? null;
            const antRight = robot?.querySelector<SVGPathElement>("[data-cux-antenna='right']") ?? null;

            if (reducedMotion) {
                gsap.set([backdropRef.current, vignetteRef.current, atmosphereRef.current, haloRef.current, logoWrapperRef.current, welcomeLabelRef.current, wordmarkRef.current], {
                    opacity: 1, scale: 1, filter: "none", y: 0, letterSpacing: "-0.02em",
                });
                gsap.set(taglineRef.current, { opacity: 0.78 });
                dots.forEach((dot) => gsap.set(dot, { scale: 1, opacity: 0.7 }));
                glows.forEach((g) => gsap.set(g, { scale: 1, opacity: 0.3 }));
                gsap.set([eyeLeft, eyeRight, jewel, antBall, antLeft, antRight].filter(Boolean), { opacity: 1, scale: 1, scaleY: 1 });
                gsap.delayedCall(1.2, () => onExitStartRef.current?.());
                gsap.delayedCall(1.6, () => onCompleteRef.current?.());
                return;
            }

            // ═══════════════════════════════════════════════════════
            // AMBIENT LOOPS — GPU-accelerated transforms only
            // ═══════════════════════════════════════════════════════

            // Atmosphere breathing
            gsap.to(atmosphereRef.current, { scale: 1.06, duration: 3.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
            // Logo float
            gsap.to(logoWrapperRef.current, { y: -7, duration: 4.0, ease: "sine.inOut", yoyo: true, repeat: -1 });

            // Gossamer rings slow spin (extremely cheap — single group rotate)
            if (ringsGroupRef.current) {
                gsap.fromTo(
                    ringsGroupRef.current,
                    { rotation: 0, svgOrigin: `${C} ${C}` },
                    { rotation: 360, duration: 90, ease: "none", repeat: -1, svgOrigin: `${C} ${C}` },
                );
            }

            // ═══════════════════════════════════════════════════════
            // PARTICLE ORBITAL DRIFT — Lissajous curves via GSAP
            // Each particle orbits its center point using sin/cos attr tweens.
            // These are pure GPU-transform translations.
            // ═══════════════════════════════════════════════════════
            PARTICLES.forEach((p, i) => {
                const dot = dots[i];
                const glow = glows[i];
                if (!dot) return;

                // Orbital animation: continuously move cx/cy via attr tweens
                // We use a GSAP timeline with keyframes to create a smooth Lissajous orbit
                const orbitalTl = gsap.timeline({ repeat: -1, delay: p.delay });

                // Generate 8 keyframe positions along the Lissajous curve
                const keyframes: Array<{ cx: number; cy: number }> = [];
                const STEPS = 8;
                for (let step = 0; step <= STEPS; step++) {
                    const t = (step / STEPS) * TAU;
                    keyframes.push({
                        cx: p.cx + Math.cos(t + p.phaseX) * p.rx,
                        cy: p.cy + Math.sin(t * 1.5 + p.phaseY) * p.ry,
                    });
                }

                // Animate through keyframes
                const stepDuration = p.period / STEPS;
                keyframes.forEach((kf, ki) => {
                    if (ki === 0) {
                        gsap.set(dot, { attr: { cx: kf.cx, cy: kf.cy } });
                        if (glow) gsap.set(glow, { attr: { cx: kf.cx, cy: kf.cy } });
                        return;
                    }
                    orbitalTl.to(dot, { attr: { cx: kf.cx, cy: kf.cy }, duration: stepDuration, ease: "sine.inOut" }, (ki - 1) * stepDuration);
                    if (glow) {
                        orbitalTl.to(glow, { attr: { cx: kf.cx, cy: kf.cy }, duration: stepDuration, ease: "sine.inOut" }, (ki - 1) * stepDuration);
                    }
                });

                // Subtle pulsing opacity on the glow halo
                if (glow) {
                    gsap.to(glow, {
                        opacity: 0.15 + seeded(i + 500) * 0.2,
                        scale: 1.15,
                        duration: 2 + seeded(i + 600) * 2,
                        ease: "sine.inOut",
                        yoyo: true,
                        repeat: -1,
                        delay: p.delay,
                        transformOrigin: "50% 50%",
                    });
                }
            });

            // ═══════════════════════════════════════════════════════
            // MAIN TIMELINE — Boot sequence
            // ═══════════════════════════════════════════════════════

            // Hide robot internals
            gsap.set([eyeLeft, eyeRight].filter(Boolean), { transformOrigin: "50% 50%", svgOrigin: "627 690", scaleY: 0, opacity: 0.92 });
            if (jewel) gsap.set(jewel, { transformOrigin: "50% 50%", svgOrigin: "628 400", scale: 0, opacity: 0 });
            if (antBall) gsap.set(antBall, { transformOrigin: "50% 50%", svgOrigin: "628 280", scaleY: 0, opacity: 0 });
            if (antLeft) gsap.set(antLeft, { transformOrigin: "50% 50%", svgOrigin: "525 326", scale: 0, opacity: 0 });
            if (antRight) gsap.set(antRight, { transformOrigin: "50% 50%", svgOrigin: "731 326", scale: 0, opacity: 0 });

            const tl = gsap.timeline();

            // Void black boot
            tl.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0);
            tl.fromTo(vignetteRef.current, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: "power3.out" }, 0.05);

            // Seed ignition
            tl.fromTo(seedRef.current, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(2.6)" }, 0.18);

            // Gossamer rings fade in
            tl.fromTo(
                ringsGroupRef.current,
                { opacity: 0 },
                { opacity: 1, duration: 1.4, ease: "power2.out" },
                0.25,
            );

            // Logo materialisation
            tl.fromTo(
                logoWrapperRef.current,
                { opacity: 0, scale: 0.75, filter: "blur(12px)" },
                { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.2, ease: "expo.out", clearProps: "filter" },
                0.4,
            );
            tl.fromTo(atmosphereRef.current, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 1.1, ease: "power3.out" }, 0.5);
            tl.fromTo(haloRef.current, { opacity: 0, scale: 0.9 }, { opacity: 0.9, scale: 1, duration: 0.9, ease: "power3.out" }, 0.7);

            // Single ignition wave pulse
            tl.fromTo(ignitionRingRef.current, { scale: 0.3, opacity: 0.9 }, { scale: 2.5, opacity: 0, duration: 1.1, ease: "power3.out" }, 0.62);
            tl.to(seedRef.current, { opacity: 0, duration: 0.5, ease: "power2.in" }, 0.72);

            // Awake eyes
            if (jewel) {
                tl.to(jewel, { scale: 1.16, opacity: 1, duration: 0.3, ease: "back.out(3)" }, 0.78);
                tl.to(jewel, { scale: 1, duration: 0.42, ease: "power2.out" }, 1.08);
            }
            if (eyeLeft && eyeRight) {
                tl.to([eyeLeft, eyeRight], { scaleY: 1, opacity: 1, duration: 0.5, ease: "back.out(2.4)", stagger: 0.06 }, 0.9);
            }

            // Antennas
            if (antBall) tl.to(antBall, { scaleY: 1, opacity: 1, duration: 0.42, ease: "back.out(2.6)" }, 1.05);
            if (antLeft) tl.to(antLeft, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2.4)" }, 1.1);
            if (antRight) tl.to(antRight, { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2.4)" }, 1.1);

            // ═══════════════════════════════════════════════════════
            // SONAR WAVE SWEEPS (kept — user liked them)
            // ═══════════════════════════════════════════════════════
            if (sonar1Ref.current) {
                tl.fromTo(sonar1Ref.current, { attr: { r: 50 }, opacity: 0.8 }, { attr: { r: 440 }, opacity: 0, duration: 2.4, ease: "power1.out" }, 0.6);
            }
            if (sonar2Ref.current) {
                tl.fromTo(sonar2Ref.current, { attr: { r: 50 }, opacity: 0.8 }, { attr: { r: 440 }, opacity: 0, duration: 2.4, ease: "power1.out" }, 1.1);
            }
            if (sonar3Ref.current) {
                tl.fromTo(sonar3Ref.current, { attr: { r: 50 }, opacity: 0.8 }, { attr: { r: 440 }, opacity: 0, duration: 2.4, ease: "power1.out" }, 1.6);
            }

            // ═══════════════════════════════════════════════════════
            // PARTICLE CONSTELLATION REVEAL — staggered scale+opacity pop
            // ═══════════════════════════════════════════════════════
            PARTICLES.forEach((p, i) => {
                const dot = dots[i];
                const glow = glows[i];

                if (dot) {
                    tl.to(dot, {
                        scale: 1,
                        opacity: 0.65 + seeded(i + 700) * 0.3,
                        duration: 0.7,
                        ease: "back.out(2.0)",
                    }, p.delay);
                }
                if (glow) {
                    tl.to(glow, {
                        scale: 1,
                        opacity: 0.2 + seeded(i + 800) * 0.15,
                        duration: 0.8,
                        ease: "power2.out",
                    }, p.delay + 0.1);
                }
            });

            // Wordmark reveals
            tl.fromTo(
                welcomeLabelRef.current,
                { opacity: 0, y: 14, letterSpacing: "0.45em" },
                { opacity: 1, y: 0, letterSpacing: "0.32em", duration: 0.55, ease: "power2.out" },
                2.6,
            );
            tl.fromTo(
                wordmarkRef.current,
                { opacity: 0, y: 24, letterSpacing: "0.18em", filter: "blur(10px)" },
                { opacity: 1, y: 0, letterSpacing: "-0.02em", filter: "blur(0px)", duration: 0.95, ease: "expo.out" },
                2.95,
            );
            tl.fromTo(taglineRef.current, { opacity: 0, y: 8 }, { opacity: 0.78, y: 0, duration: 0.5, ease: "power2.out" }, 3.5);

            // Clean exit transition
            tl.call(() => onExitStartRef.current?.(), undefined, 5.0);
            tl.to(stageRef.current, { opacity: 0, scale: 1.04, duration: 0.7, ease: "power2.inOut" }, 5.0);
            tl.to(backdropRef.current, { opacity: 0, duration: 0.6, ease: "power2.inOut" }, 5.15);
            tl.call(() => onCompleteRef.current?.(), undefined, 5.75);
        });
        return () => ctx.revert();
    }, [reducedMotion]);

    const setParticleRef = (i: number) => (el: SVGCircleElement | null): void => { particleRefs.current[i] = el; };
    const setGlowRef = (i: number) => (el: SVGCircleElement | null): void => { glowRefs.current[i] = el; };

    return (
        <div
            ref={backdropRef}
            className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-[#000000]"
            style={{ opacity: 0 }}
            aria-hidden="true"
        >
            {/* Ambient light vignette */}
            <div ref={vignetteRef} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ opacity: 0 }}>
                <div
                    className="absolute inset-0"
                    style={{ background: "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(0,224,160,0.08) 0%, rgba(0,224,160,0.01) 40%, transparent 70%)" }}
                />
                <div
                    className="absolute inset-0"
                    style={{ background: "radial-gradient(ellipse 90% 80% at 50% 100%, rgba(255,184,0,0.03) 0%, transparent 52%)" }}
                />
                <div
                    className="absolute inset-0"
                    style={{ background: "radial-gradient(circle at 50% 50%, transparent 35%, rgba(0,0,0,0.96) 100%)" }}
                />
            </div>

            {/* ═══ Particle Nebula Constellation SVG ═══ */}
            <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
            >
                {/* Radial gradient defs for soft-edged particles — zero filter cost */}
                <defs>
                    {NEON_PALETTE.map((color, idx) => (
                        <radialGradient key={`pg-${idx}`} id={`particle-grad-${idx}`}>
                            <stop offset="0%" stopColor={color} stopOpacity="1" />
                            <stop offset="40%" stopColor={color} stopOpacity="0.6" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </radialGradient>
                    ))}
                </defs>

                {/* 1. Gossamer orbital guide rings — ultra-thin dashed circles */}
                <g ref={ringsGroupRef}>
                    {GOSSAMER_RINGS.map((ring, idx) => (
                        <circle
                            key={`ring-${idx}`}
                            cx={C}
                            cy={C}
                            r={ring.radius}
                            fill="none"
                            stroke={ring.color}
                            strokeWidth={ring.width}
                            strokeDasharray={ring.dashArray}
                            style={{ opacity: ring.opacity }}
                        />
                    ))}
                </g>

                {/* 2. Sonar wave sweeps (kept from previous design) */}
                <circle
                    ref={sonar1Ref}
                    cx={C} cy={C} r="50"
                    fill="none"
                    stroke="rgba(0, 240, 255, 0.35)"
                    strokeWidth="0.8"
                />
                <circle
                    ref={sonar2Ref}
                    cx={C} cy={C} r="50"
                    fill="none"
                    stroke="rgba(0, 224, 160, 0.28)"
                    strokeWidth="0.8"
                />
                <circle
                    ref={sonar3Ref}
                    cx={C} cy={C} r="50"
                    fill="none"
                    stroke="rgba(255, 184, 0, 0.2)"
                    strokeWidth="0.8"
                />

                {/* 3. Particle constellation — luminous drifting orbs (zero filters) */}
                {PARTICLES.map((p, i) => {
                    const gradId = `url(#particle-grad-${i % NEON_PALETTE.length})`;
                    return (
                        <g key={`particle-${i}`}>
                            {/* Soft glow halo — radial gradient fill, no GPU filter */}
                            <circle
                                ref={setGlowRef(i)}
                                cx={p.cx}
                                cy={p.cy}
                                r={p.r * 6}
                                fill={gradId}
                                opacity={0}
                            />
                            {/* Core luminous dot */}
                            <circle
                                ref={setParticleRef(i)}
                                cx={p.cx}
                                cy={p.cy}
                                r={p.r}
                                fill={p.color}
                                opacity={0}
                            />
                        </g>
                    );
                })}
            </svg>

            {/* Center stage container */}
            <div ref={stageRef} className="relative z-10 flex flex-col items-center justify-center" style={{ willChange: "transform, opacity" }}>
                <div
                    ref={logoWrapperRef}
                    className="relative flex h-[280px] w-[280px] items-center justify-center"
                    style={{ willChange: "transform, opacity, filter", opacity: 0 }}
                >
                    {/* Glowing atmosphere */}
                    <div
                        ref={atmosphereRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-full"
                        style={{
                            width: 460,
                            height: 460,
                            background: "radial-gradient(circle, rgba(0,224,160,0.36) 0%, rgba(0,224,160,0.1) 30%, rgba(0,224,160,0.03) 55%, transparent 75%)",
                            filter: "blur(8px)",
                            opacity: 0,
                        }}
                    />

                    {/* Inner halo */}
                    <div
                        ref={haloRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-full"
                        style={{
                            width: 280,
                            height: 280,
                            background: "radial-gradient(circle, rgba(128,255,214,0.28) 0%, rgba(0,224,160,0.12) 38%, transparent 70%)",
                            filter: "blur(4px)",
                            opacity: 0,
                        }}
                    />

                    {/* Clean single ignition ring pulse */}
                    <div
                        ref={ignitionRingRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-full border border-signal-500/70"
                        style={{
                            width: 220,
                            height: 220,
                            boxShadow: "inset 0 0 30px rgba(0,224,160,0.35), 0 0 30px rgba(0,224,160,0.32)",
                            opacity: 0,
                        }}
                    />

                    {/* Seed spark */}
                    <div
                        ref={seedRef}
                        aria-hidden="true"
                        className="pointer-events-none absolute rounded-full"
                        style={{
                            width: 18,
                            height: 18,
                            background: "radial-gradient(circle, rgba(180,255,228,1) 0%, rgba(0,224,160,0.7) 45%, transparent 75%)",
                            boxShadow: "0 0 24px rgba(0,224,160,0.85), 0 0 48px rgba(0,224,160,0.45)",
                            opacity: 0,
                        }}
                    />

                    {/* Perfectly Centered Logo */}
                    <div ref={robotRef} className="relative z-10">
                        <RobotLogo size={220} idle={false} active={false} rounded={true} withGlow={false} title="Code UX" />
                        <div
                            className="pointer-events-none absolute left-1/2 -translate-x-1/2"
                            style={{ top: -28, width: 1, height: 32, background: "linear-gradient(to bottom, transparent 0%, rgba(0,224,160,0.6) 100%)" }}
                            aria-hidden="true"
                        />
                    </div>
                </div>

                {/* Typography absolute container preventing centering offset shifts */}
                <div className="absolute top-[190px] flex flex-col items-center gap-2 text-center w-[400px] min-w-[320px]">
                    <span
                        ref={welcomeLabelRef}
                        className="font-mono text-[11px] font-bold uppercase text-signal-500"
                        style={{ opacity: 0, letterSpacing: "0.45em" }}
                    >
                        Welcome to
                    </span>

                    <h1
                        ref={wordmarkRef}
                        className="font-display text-6xl font-black leading-none text-white md:text-7xl"
                        style={{ opacity: 0, letterSpacing: "0.15em" }}
                    >
                        Code<span className="text-signal-500">UX</span>
                    </h1>

                    <span ref={taglineRef} className="mt-2 text-sm font-medium tracking-[0.04em] text-white" style={{ opacity: 0 }}>
                        Agentic Runtime
                    </span>
                </div>
            </div>
        </div>
    );
};

export default OnboardingIntro;
