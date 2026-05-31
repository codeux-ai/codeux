import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { CelestialBody } from "./RaceCourse.js";

export const SubtleWaves: FunctionComponent<{ isDark: boolean }> = memo(({ isDark }) => {
    const waveColor = isDark ? "white" : "#334155";
    return (
        <g>
            {[80, 140, 200, 260, 320, 380].map((y, i) => {
                const amp = 3 + i * 0.6;
                const freq = 160 + i * 15;
                const dur = 7 + i * 1.5;
                const op = isDark ? 0.02 + i * 0.004 : 0.03 + i * 0.005;
                const curves = Array.from({ length: 10 }, (_, j) => {
                    const x0 = -100 + j * freq;
                    const x1 = x0 + freq / 2;
                    const x2 = x0 + freq;
                    return `Q${x1} ${y - amp} ${x2} ${y}`;
                }).join(" ");
                return (
                    <path key={i} d={`M-100 ${y} ${curves}`} fill="none" stroke={waveColor} strokeWidth={0.4} opacity={op}>
                        <animateTransform attributeName="transform" type="translate"
                            values={`0 0; ${freq / 3} ${amp * 0.4}; 0 0`}
                            dur={`${dur}s`} repeatCount="indefinite" />
                    </path>
                );
            })}
        </g>
    );
});

export const BoatRaceBackground = memo(({ isDark, ripples }: { isDark: boolean; ripples: {x: number, y: number, id: number}[] }) => {
    return (
        <g>
            <defs>
                <linearGradient id="br-wake" x1="1" y1="0.5" x2="0" y2="0.5">
                    <stop offset="0%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.14} />
                    <stop offset="50%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0} />
                </linearGradient>
                <radialGradient id="br-harbour-glow" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#FFB800" stopOpacity={isDark ? 0.06 : 0.04} />
                    <stop offset="100%" stopColor="transparent" />
                </radialGradient>
                <radialGradient id="br-finish-glow" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#00AB84" stopOpacity={isDark ? 0.08 : 0.05} />
                    <stop offset="100%" stopColor="transparent" />
                </radialGradient>
                <filter id="br-glow"><feGaussianBlur stdDeviation="2.5" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id="br-glow2"><feGaussianBlur stdDeviation="6" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id="br-ripple"><feGaussianBlur stdDeviation="1.5" /></filter>
            </defs>
            <CelestialBody isDark={isDark} />
            <SubtleWaves isDark={isDark} />
            {ripples.map(r => (
                <g key={r.id}>
                    <circle cx={r.x} cy={r.y} r={2} fill="none"
                        stroke={isDark ? "white" : "#334155"} strokeWidth={0.5} opacity={0}>
                        <animate attributeName="r" values="2;40" dur="2s" fill="freeze" />
                        <animate attributeName="opacity" values="0.12;0" dur="2s" fill="freeze" />
                    </circle>
                    <circle cx={r.x} cy={r.y} r={2} fill="none"
                        stroke={isDark ? "white" : "#334155"} strokeWidth={0.3} opacity={0}>
                        <animate attributeName="r" values="2;25" dur="1.5s" fill="freeze" />
                        <animate attributeName="opacity" values="0.08;0" dur="1.5s" fill="freeze" />
                    </circle>
                </g>
            ))}
        </g>
    );
});