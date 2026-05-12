import type { FunctionComponent, JSX, RefCallback } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

/*
  Code UX — "ATOM" cinematic mark.

  Layered composition (64-grid, center 32,32):

  1. Eye halo + satellite halo        — radial glows, breathe in idle
  2. Three orbital ellipses           — invisible at rest, fade in on activation
                                        rotations [0°, +58°, −42°], distinct rx/ry
  3. Eye outline + comet (idle mode)  — the SENTINEL state, visible at rest
  4. Three electrons (active mode)    — parametric orbital motion, infinite
                                        periods 4.6s / 3.4s / 5.8s — never sync
  5. Nucleus + glint                  — always visible, pulses on activation

  STATE MACHINE
    idle:       eye outline + halos breathing  (low energy, watching)
    active:     orbits fade in, electrons whip, halos surge, nucleus dilates
    cinematic:  always-on active, heavier glow, designed for fullscreen splash

  ANIMATION ARCHITECTURE
    - Idle breath timeline: one GSAP timeline, looping forever, started on mount.
    - Orbital motion: three independent GSAP tweens, each driving a proxy {t}
      through 2π, with onUpdate computing the rotated elliptical position.
    - State transition: built fresh each time `active` flips, layers cross-fade.
    - All timelines killed on unmount.
    - Reduced motion: collapses to static eye, no orbital motion, no breath.
*/

const JADE = "#00E0A0";
const JADE_LIGHT = "#80FFD6";
const JADE_DEEP = "#33FFB8";

type OrbitSpec = {
    rx: number;
    ry: number;
    rotation: number;
    period: number;
    phase: number;
    electronR: number;
    electronColor: string;
    strokeOpacity: number;
};

const ORBITS: OrbitSpec[] = [
    { rx: 25, ry: 17, rotation: 0, period: 4.6, phase: 0.08, electronR: 2.2, electronColor: JADE, strokeOpacity: 0.28 },
    { rx: 24, ry: 8, rotation: 58, period: 3.4, phase: 0.43, electronR: 1.9, electronColor: JADE_LIGHT, strokeOpacity: 0.26 },
    { rx: 22, ry: 10, rotation: -42, period: 5.8, phase: 0.77, electronR: 2.0, electronColor: JADE_DEEP, strokeOpacity: 0.24 },
];

let svgIdCounter = 0;
const nextSvgId = (): string => `cux-atom-${++svgIdCounter}`;

export type AtomIntensity = "standard" | "cinematic";

interface AtomProps extends Omit<JSX.SVGAttributes<SVGSVGElement>, "size" | "title"> {
    size?: number | string;
    active?: boolean;
    triggerOnHover?: boolean;
    intensity?: AtomIntensity;
    withGlow?: boolean;
    title?: string;
    titleId?: string;
}

export const Atom: FunctionComponent<AtomProps> = ({
    size = 24,
    active,
    triggerOnHover = false,
    intensity = "standard",
    withGlow = true,
    title = "Code UX",
    titleId,
    className,
    ...rest
}) => {
    const dim = typeof size === "number" ? String(size) : size;
    const idRef = useRef<string>("");
    if (!idRef.current) idRef.current = nextSvgId();
    const uid = idRef.current;
    const labelId = titleId ?? `${uid}-title`;

    const prefersReducedMotion = useReducedMotion();

    const [hovering, setHovering] = useState(false);
    const isCinematic = intensity === "cinematic";
    const isActive = isCinematic || (active ?? (triggerOnHover ? hovering : false));

    const eyeHaloRef = useRef<SVGEllipseElement | null>(null);
    const satHaloRef = useRef<SVGCircleElement | null>(null);
    const eyeOutlineRef = useRef<SVGGElement | null>(null);
    const nucleusRef = useRef<SVGGElement | null>(null);
    const orbitRefs = useRef<Array<SVGEllipseElement | null>>([null, null, null]);
    const electronRefs = useRef<Array<SVGCircleElement | null>>([null, null, null]);

    const idleTlRef = useRef<gsap.core.Timeline | null>(null);
    const orbitTweensRef = useRef<gsap.core.Tween[]>([]);
    const activeTlRef = useRef<gsap.core.Timeline | null>(null);

    /* ===== Idle breath — nucleus + halo gently inhale ===== */
    useEffect(() => {
        if (prefersReducedMotion) return;
        const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } });
        if (nucleusRef.current) {
            tl.to(nucleusRef.current, {
                scale: 1.035,
                duration: 2.6,
                transformOrigin: "32px 32px",
                svgOrigin: "32 32",
            }, 0);
        }
        if (eyeHaloRef.current) {
            tl.to(eyeHaloRef.current, { opacity: 1.1, duration: 2.6 }, 0);
        }
        idleTlRef.current = tl;
        return () => {
            tl.kill();
            idleTlRef.current = null;
        };
    }, [prefersReducedMotion]);

    /* ===== Orbital motion — three independent parametric tweens ===== */
    useEffect(() => {
        if (prefersReducedMotion) return;
        const tweens: gsap.core.Tween[] = [];
        ORBITS.forEach((orbit, i) => {
            const proxy = { t: orbit.phase * Math.PI * 2 };
            const cosR = Math.cos((orbit.rotation * Math.PI) / 180);
            const sinR = Math.sin((orbit.rotation * Math.PI) / 180);
            const tw = gsap.to(proxy, {
                t: `+=${Math.PI * 2}`,
                duration: orbit.period,
                ease: "none",
                repeat: -1,
                onUpdate: () => {
                    const el = electronRefs.current[i];
                    if (!el) return;
                    const localX = orbit.rx * Math.cos(proxy.t);
                    const localY = orbit.ry * Math.sin(proxy.t);
                    const x = 32 + localX * cosR - localY * sinR;
                    const y = 32 + localX * sinR + localY * cosR;
                    el.setAttribute("cx", String(x.toFixed(3)));
                    el.setAttribute("cy", String(y.toFixed(3)));
                },
            });
            tweens.push(tw);
        });
        orbitTweensRef.current = tweens;
        return () => {
            tweens.forEach((t) => t.kill());
            orbitTweensRef.current = [];
        };
    }, [prefersReducedMotion]);

    /* ===== State transition — cross-fade idle ↔ active ===== */
    useEffect(() => {
        if (prefersReducedMotion) return;
        activeTlRef.current?.kill();
        const tl = gsap.timeline({ defaults: { overwrite: "auto" } });
        const orbits = orbitRefs.current.filter(Boolean) as SVGEllipseElement[];
        const electrons = electronRefs.current.filter(Boolean) as SVGCircleElement[];

        if (isActive) {
            tl.to(eyeOutlineRef.current, { opacity: 0, duration: 0.32, ease: "power2.out" }, 0);
            orbits.forEach((o, i) => {
                tl.to(o, {
                    opacity: ORBITS[i].strokeOpacity,
                    duration: 0.55,
                    ease: "power2.out",
                }, 0.04 + i * 0.06);
            });
            electrons.forEach((e, i) => {
                tl.fromTo(e,
                    { opacity: 0, attr: { r: 0 } },
                    {
                        opacity: 1,
                        attr: { r: ORBITS[i].electronR },
                        duration: 0.55,
                        ease: "back.out(1.9)",
                    },
                    0.12 + i * 0.08);
            });
            if (eyeHaloRef.current) {
                tl.to(eyeHaloRef.current, {
                    opacity: isCinematic ? 1.85 : 1.55,
                    scale: isCinematic ? 1.28 : 1.18,
                    duration: 0.95,
                    ease: "power3.out",
                    transformOrigin: "32px 32px",
                    svgOrigin: "32 32",
                }, 0);
            }
            if (satHaloRef.current) {
                tl.to(satHaloRef.current, { opacity: 0.4, duration: 0.4, ease: "power2.out" }, 0);
            }
            if (nucleusRef.current) {
                tl.to(nucleusRef.current, {
                    scale: 1.14,
                    duration: 0.75,
                    ease: "back.out(2.2)",
                    transformOrigin: "32px 32px",
                    svgOrigin: "32 32",
                }, 0.16);
            }
        } else {
            tl.to(orbits, { opacity: 0, duration: 0.38, ease: "power2.in" }, 0);
            tl.to(electrons, {
                opacity: 0,
                attr: { r: 0 },
                duration: 0.28,
                ease: "power2.in",
            }, 0);
            tl.to(eyeOutlineRef.current, { opacity: 1, duration: 0.42, ease: "power2.out" }, 0.18);
            if (eyeHaloRef.current) {
                tl.to(eyeHaloRef.current, {
                    opacity: 1,
                    scale: 1,
                    duration: 0.65,
                    ease: "power2.out",
                    transformOrigin: "32px 32px",
                    svgOrigin: "32 32",
                }, 0);
            }
            if (satHaloRef.current) {
                tl.to(satHaloRef.current, { opacity: 1, duration: 0.45, ease: "power2.out" }, 0);
            }
            if (nucleusRef.current) {
                tl.to(nucleusRef.current, {
                    scale: 1,
                    duration: 0.55,
                    ease: "power2.out",
                    transformOrigin: "32px 32px",
                    svgOrigin: "32 32",
                }, 0);
            }
        }
        activeTlRef.current = tl;
        return () => {
            tl.kill();
            activeTlRef.current = null;
        };
    }, [isActive, isCinematic, prefersReducedMotion]);

    const setOrbitRef = (i: number): RefCallback<SVGEllipseElement> => (el) => {
        orbitRefs.current[i] = el;
    };
    const setElectronRef = (i: number): RefCallback<SVGCircleElement> => (el) => {
        electronRefs.current[i] = el;
    };

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 64 64"
            width={dim}
            height={dim}
            role="img"
            aria-labelledby={labelId}
            className={className}
            onMouseEnter={triggerOnHover ? () => setHovering(true) : undefined}
            onMouseLeave={triggerOnHover ? () => setHovering(false) : undefined}
            onFocus={triggerOnHover ? () => setHovering(true) : undefined}
            onBlur={triggerOnHover ? () => setHovering(false) : undefined}
            {...rest}
        >
            <title id={labelId}>{title}</title>

            <defs>
                <linearGradient id={`${uid}-trail`} gradientUnits="userSpaceOnUse" x1="32" y1="49" x2="54" y2="41">
                    <stop offset="0%" stopColor={JADE} stopOpacity="0" />
                    <stop offset="100%" stopColor={JADE} stopOpacity="0.95" />
                </linearGradient>
                <radialGradient id={`${uid}-eye-halo`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={JADE} stopOpacity={isCinematic ? "0.72" : "0.55"} />
                    <stop offset="55%" stopColor={JADE} stopOpacity="0.14" />
                    <stop offset="100%" stopColor={JADE} stopOpacity="0" />
                </radialGradient>
                <radialGradient id={`${uid}-sat-halo`} cx="54" cy="41" r="8" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={JADE} stopOpacity="0.62" />
                    <stop offset="100%" stopColor={JADE} stopOpacity="0" />
                </radialGradient>
                <filter id={`${uid}-electron-glow`} x="-300%" y="-300%" width="700%" height="700%">
                    <feGaussianBlur stdDeviation="0.4" />
                </filter>
            </defs>

            {withGlow ? (
                <>
                    <ellipse ref={eyeHaloRef} cx="32" cy="32" rx="28" ry="21" fill={`url(#${uid}-eye-halo)`} />
                    <circle ref={satHaloRef} cx="54" cy="41" r="8" fill={`url(#${uid}-sat-halo)`} />
                </>
            ) : null}

            {/* Orbital ellipses — invisible at idle, fade in on activate */}
            {ORBITS.map((orbit, i) => (
                <ellipse
                    key={`orbit-${i}`}
                    ref={setOrbitRef(i)}
                    cx="32"
                    cy="32"
                    rx={orbit.rx}
                    ry={orbit.ry}
                    transform={`rotate(${orbit.rotation} 32 32)`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.0"
                    strokeLinecap="round"
                    opacity="0"
                />
            ))}

            {/* Eye outline + comet (idle) — fades out as orbital state takes over */}
            <g ref={eyeOutlineRef}>
                <path
                    d="M 54 23 A 25 17 0 1 0 54 41"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeOpacity="0.36"
                    strokeLinecap="round"
                />
                <path
                    d="M 32 49 A 25 17 0 0 0 54 41"
                    fill="none"
                    stroke={`url(#${uid}-trail)`}
                    strokeWidth="2.25"
                    strokeLinecap="round"
                />
                <circle cx="54" cy="41" r="3" fill={JADE} />
                <circle cx="53.2" cy="40.2" r="0.95" fill={JADE_LIGHT} opacity="0.85" />
            </g>

            {/* Electrons — orbital ghosts, computed each frame */}
            {ORBITS.map((orbit, i) => (
                <circle
                    key={`electron-${i}`}
                    ref={setElectronRef(i)}
                    cx={32 + orbit.rx}
                    cy={32}
                    r={orbit.electronR}
                    fill={orbit.electronColor}
                    opacity="0"
                    filter={`url(#${uid}-electron-glow)`}
                />
            ))}

            {/* Nucleus — always visible, gently breathing */}
            <g ref={nucleusRef}>
                <circle cx="32" cy="32" r="5" fill={JADE} />
                <circle cx="30.4" cy="30.5" r="1.5" fill={JADE_LIGHT} opacity="0.78" />
            </g>
        </svg>
    );
};

export default Atom;
