import type { FunctionComponent } from "preact";

/**
 * Fluid wave at bottom of card.
 * Both SVG layers are 200% wide with exactly 2 wave cycles.
 * translateX(-50%) = one exact cycle → zero-jump seamless loop.
 * Layer 2 counter-drifts via reverse + negative delay (no second keyframe needed).
 */
export const WaveFluid: FunctionComponent<{ accentHex: string }> = ({ accentHex }) => (
    <div className="absolute bottom-0 left-0 right-0 h-16 overflow-hidden pointer-events-none opacity-0 group-hover:opacity-100 group-active:opacity-100 group-focus-within:opacity-100 transition-opacity duration-700 ease-out">
        {/* Primary wave — 2 cycles, drifts left */}
        <svg
            style={{
                position: 'absolute', bottom: 0,
                width: '200%', height: '100%', left: 0,
                animation: 'wave-drift 6s linear infinite',
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
                animation: 'wave-drift 9s linear infinite reverse',
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
