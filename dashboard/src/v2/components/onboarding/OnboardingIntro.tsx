import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Atom } from "../brand/Atom.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

/*
  Onboarding intro — the macOS-feel first-touch sequence.

  TIMELINE (5.2s total):
    0.00  backdrop fade-in (0.6s)
    0.30  atom defocus reveal — scale 0.55→1, blur 28→0, opacity 0→1
    1.50  atom transitions to atomic mode (orbits + electrons engage)
    2.60  "Welcome to" small-caps label rises in
    2.85  CodeUX wordmark — letter-spacing collapses from 0.15em → −0.02em
    3.55  "Agentic Runtime" tagline fades in
    4.05  composed hold (400ms)
    4.45  onExitStart() fires → parent crossfades onboarding shell up underneath
    4.45  stage scales out (1 → 1.08) + fades
    4.65  backdrop fades to transparent
    5.20  onComplete() fires — intro unmounts (already invisible)

  Reduced motion: collapses to a static composition with instant text fades.
*/

interface OnboardingIntroProps {
    onExitStart?: () => void;
    onComplete?: () => void;
}

export const OnboardingIntro: FunctionComponent<OnboardingIntroProps> = ({ onExitStart, onComplete }) => {
    const backdropRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const atomContainerRef = useRef<HTMLDivElement>(null);
    const welcomeLabelRef = useRef<HTMLSpanElement>(null);
    const wordmarkRef = useRef<HTMLHeadingElement>(null);
    const taglineRef = useRef<HTMLSpanElement>(null);
    const vignetteRef = useRef<HTMLDivElement>(null);

    const reducedMotion = useReducedMotion();
    const [atomActive, setAtomActive] = useState(false);

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            if (reducedMotion) {
                gsap.set(
                    [backdropRef.current, vignetteRef.current, atomContainerRef.current, welcomeLabelRef.current, wordmarkRef.current, taglineRef.current],
                    { opacity: 1, scale: 1, filter: "none", y: 0, letterSpacing: "-0.02em" },
                );
                gsap.set(taglineRef.current, { opacity: 0.75 });
                setAtomActive(true);
                gsap.delayedCall(1.2, () => onExitStart?.());
                gsap.delayedCall(1.6, () => onComplete?.());
                return;
            }

            const tl = gsap.timeline();

            tl.fromTo(
                backdropRef.current,
                { opacity: 0 },
                { opacity: 1, duration: 0.6, ease: "power2.out" },
                0,
            );

            tl.fromTo(
                vignetteRef.current,
                { opacity: 0, scale: 1.18 },
                { opacity: 1, scale: 1, duration: 1.4, ease: "power3.out" },
                0.05,
            );

            tl.fromTo(
                atomContainerRef.current,
                { opacity: 0, scale: 0.55, filter: "blur(28px)" },
                { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.3, ease: "expo.out" },
                0.3,
            );

            tl.call(() => setAtomActive(true), undefined, 1.5);

            tl.fromTo(
                welcomeLabelRef.current,
                { opacity: 0, y: 14, letterSpacing: "0.45em" },
                { opacity: 1, y: 0, letterSpacing: "0.32em", duration: 0.6, ease: "power2.out" },
                2.6,
            );

            tl.fromTo(
                wordmarkRef.current,
                { opacity: 0, y: 26, letterSpacing: "0.15em", filter: "blur(8px)" },
                { opacity: 1, y: 0, letterSpacing: "-0.02em", filter: "blur(0px)", duration: 0.95, ease: "expo.out" },
                2.85,
            );

            tl.fromTo(
                taglineRef.current,
                { opacity: 0, y: 8 },
                { opacity: 0.75, y: 0, duration: 0.55, ease: "power2.out" },
                3.55,
            );

            tl.call(() => onExitStart?.(), undefined, 4.45);

            tl.to(
                stageRef.current,
                { opacity: 0, scale: 1.08, duration: 0.85, ease: "power2.inOut" },
                4.45,
            );

            tl.to(
                backdropRef.current,
                { opacity: 0, duration: 0.75, ease: "power2.inOut" },
                4.65,
            );

            tl.call(() => onComplete?.(), undefined, 5.2);
        });
        return () => ctx.revert();
    }, [reducedMotion, onExitStart, onComplete]);

    return (
        <div
            ref={backdropRef}
            className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-[#05080B]"
            style={{ opacity: 0 }}
            aria-hidden="true"
        >
            {/* Dimensional backdrop — warm void with subtle brand wash */}
            <div
                ref={vignetteRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ opacity: 0 }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "radial-gradient(ellipse 80% 60% at 50% 45%, rgba(0,224,160,0.08) 0%, rgba(0,224,160,0.02) 35%, transparent 65%)",
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "radial-gradient(ellipse 90% 70% at 50% 100%, rgba(255,184,0,0.06) 0%, transparent 55%)",
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{
                        background:
                            "radial-gradient(circle at 50% 50%, transparent 45%, rgba(0,0,0,0.55) 100%)",
                    }}
                />
            </div>

            {/* Center stage */}
            <div
                ref={stageRef}
                className="relative z-10 flex flex-col items-center"
                style={{ willChange: "transform, opacity" }}
            >
                <div
                    ref={atomContainerRef}
                    className="relative mb-10 flex h-[160px] w-[160px] items-center justify-center text-white/55"
                    style={{ willChange: "transform, opacity, filter" }}
                >
                    <Atom size={144} active={atomActive} intensity="cinematic" title="Code UX" />
                </div>

                <div className="flex flex-col items-center gap-3 text-center">
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

                    <span
                        ref={taglineRef}
                        className="mt-2 text-sm font-medium tracking-[0.04em] text-white"
                        style={{ opacity: 0 }}
                    >
                        Agentic Runtime
                    </span>
                </div>
            </div>
        </div>
    );
};

export default OnboardingIntro;
