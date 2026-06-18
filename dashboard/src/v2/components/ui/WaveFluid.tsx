import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

/**
 * Fluid wave at bottom of card.
 * Both SVG layers are 200% wide with exactly 2 wave cycles.
 * translateX(-50%) = one exact cycle → zero-jump seamless loop.
 * Layer 2 counter-drifts via reverse + negative delay (no second keyframe needed).
 */
export const WaveFluid: FunctionComponent<{ accentHex: string; isActive?: boolean }> = ({ accentHex, isActive }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const prefersReducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        if (!containerRef.current) return;

        if (prefersReducedMotion) return;

        let ctx = gsap.context(() => {
            if (isActive) {
                gsap.to(containerRef.current, {
                    opacity: 0.8,
                    duration: 2,
                    yoyo: true,
                    repeat: -1,
                    ease: "sine.inOut"
                });
            } else {
                gsap.killTweensOf(containerRef.current);
                gsap.to(containerRef.current, {
                    opacity: "",
                    duration: 0.5,
                    ease: "power2.out",
                    clearProps: "opacity"
                });
            }
        });

        return () => ctx.revert();
    }, [isActive]);

    return (
    <div
        ref={containerRef}
        className="absolute bottom-0 left-0 right-0 h-16 overflow-hidden pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 motion-safe:transition-opacity motion-safe:duration-700 motion-safe:ease-out"
    >
        {/* Primary wave — 2 cycles, drifts left */}
        <svg
            style={{
                position: 'absolute', bottom: 0,
                width: '200%', height: '100%', left: 0,
                animation: prefersReducedMotion ? 'none' : 'wave-drift 6s linear infinite',
            }}
            viewBox="0 0 200 64"
            preserveAspectRatio="none"
        >
            <path
                d="M 0 32 C 12.5 16 37.5 16 50 32 C 62.5 48 87.5 48 100 32 C 112.5 16 137.5 16 150 32 C 162.5 48 187.5 48 200 32 L 200 64 L 0 64 Z"
                fill={accentHex}
                fillOpacity="0.10"
            />
        </svg>
        {/* Secondary wave — shallower, counter-drifts via reverse + phase offset */}
        <svg
            style={{
                position: 'absolute', bottom: 0,
                width: '200%', height: '72%', left: 0,
                animation: prefersReducedMotion ? 'none' : 'wave-drift 9s linear infinite reverse',
                animationDelay: '-3.5s',
            }}
            viewBox="0 0 200 64"
            preserveAspectRatio="none"
        >
            <path
                d="M 0 38 C 12.5 26 37.5 26 50 38 C 62.5 50 87.5 50 100 38 C 112.5 26 137.5 26 150 38 C 162.5 50 187.5 50 200 38 L 200 64 L 0 64 Z"
                fill={accentHex}
                fillOpacity="0.065"
            />
        </svg>
    </div>
    );
};
