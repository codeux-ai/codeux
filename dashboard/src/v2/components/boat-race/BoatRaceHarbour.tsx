import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { SVG_H, HARBOUR_X } from "./constants.js";
import { hashStr } from "./utils.js";

export const HarbourBuilding: FunctionComponent<{ x: number; waitingCount: number; isDark: boolean }> = memo(({ x, waitingCount, isDark }) => {
    const buildingFill = isDark ? "#0c1825" : "#c8d6e5";
    const buildingStroke = isDark ? "#162840" : "#8395a7";
    const roofFill = isDark ? "#101c2e" : "#a4b0be";
    const roofStroke = isDark ? "#1a3050" : "#8395a7";
    const pilingFill = isDark ? "#0e1e30" : "#a4b0be";
    const plankStroke = isDark ? "#152540" : "#8395a7";
    const windowGlow = isDark ? "#FFCC44" : "#FFB800";
    const windowBg = isDark ? "#FFB800" : "#F59E0B";
    const labelColor = isDark ? "#1a3050" : "#8395a7";
    const craneFill = isDark ? "#1e3a5e" : "#8395a7";
    return (
        <g>
            {/* Ambient glow */}
            <ellipse cx={x} cy={SVG_H / 2} rx={90} ry={SVG_H * 0.6} fill="url(#br-harbour-glow)" />

            {/* Water-level dock pilings */}
            {[0, 14, 28, 42].map(dx => (
                <rect key={dx} x={x + dx - 6} y={70} width={5} height={SVG_H - 110} fill={pilingFill} opacity={0.6} rx={1.5} />
            ))}
            {/* Dock planks */}
            {[95, 140, 185, 230, 275, 320].map(yy => (
                <line key={yy} x1={x - 8} y1={yy} x2={x + 44} y2={yy}
                    stroke={plankStroke} strokeWidth={2.5} opacity={0.35} />
            ))}

            {/* Main building — stone warehouse */}
            <rect x={x - 36} y={30} width={56} height={65} rx={2} fill={buildingFill} stroke={buildingStroke} strokeWidth={0.8} />
            {/* Roof */}
            <path d={`M${x - 40} 30 L${x - 8} 10 L${x + 24} 30 Z`} fill={roofFill} stroke={roofStroke} strokeWidth={0.6} />
            {/* Roof ridge */}
            <line x1={x - 8} y1={10} x2={x - 8} y2={6} stroke={roofStroke} strokeWidth={1.2} />
            {/* Weather vane */}
            <line x1={x - 8} y1={6} x2={x + 2} y2={4} stroke={isDark ? "#2a4a70" : "#8395a7"} strokeWidth={0.6} />
            <polygon points={`${x + 2},2 ${x + 6},4 ${x + 2},6`} fill="#FFB800" opacity={isDark ? 0.5 : 0.7} />

            {/* Windows — warm amber glow */}
            {[[x - 30, 40], [x - 18, 40], [x - 6, 40], [x + 6, 40],
              [x - 30, 56], [x - 18, 56], [x - 6, 56], [x + 6, 56]].map(([wx, wy], i) => (
                <g key={i}>
                    <rect x={wx} y={wy} width={8} height={10} rx={1} fill={windowBg} opacity={isDark ? 0.06 : 0.12} />
                    <rect x={wx + 1} y={wy + 1} width={6} height={8} rx={0.8} fill={windowGlow} opacity={isDark ? 0.12 : 0.25}>
                        <animate attributeName="opacity" values={`${isDark ? 0.12 : 0.25};${(isDark ? 0.06 : 0.15) + (hashStr(`w${i}`) % 8) / 100};${isDark ? 0.12 : 0.25}`}
                            dur={`${3 + (hashStr(`wd${i}`) % 30) / 10}s`} repeatCount="indefinite" />
                    </rect>
                </g>
            ))}

            {/* Entrance arch (water level) */}
            <path d={`M${x - 10} 95 Q${x + 4} 76 ${x + 18} 95`} fill="none" stroke={roofStroke} strokeWidth={1.5} />
            <rect x={x - 10} y={85} width={28} height={10} fill={isDark ? "#060e18" : "#a4b0be"} opacity={0.6} rx={1} />

            {/* Crane */}
            <g opacity={isDark ? 0.25 : 0.35}>
                <line x1={x + 30} y1={60} x2={x + 30} y2={15} stroke={craneFill} strokeWidth={3} />
                <line x1={x + 30} y1={15} x2={x + 75} y2={15} stroke={craneFill} strokeWidth={2.2} />
                <line x1={x + 30} y1={60} x2={x + 75} y2={15} stroke={craneFill} strokeWidth={0.8} opacity={0.4} />
                <line x1={x + 72} y1={15} x2={x + 72} y2={34} stroke={craneFill} strokeWidth={0.8} strokeDasharray="2,2">
                    <animate attributeName="y2" values="34;42;34" dur="4s" repeatCount="indefinite" />
                </line>
                {/* Crane light */}
                <circle cx={x + 30} cy={13} r={2.5} fill="#FFB800" opacity={0.35} filter="url(#br-glow)">
                    <animate attributeName="opacity" values="0.35;0.1;0.35" dur="3s" repeatCount="indefinite" />
                </circle>
            </g>

            {/* Harbour lights */}
            <circle cx={x - 8} cy={28} r={3} fill="#FFB800" opacity={isDark ? 0.5 : 0.7} filter="url(#br-glow)">
                <animate attributeName="opacity" values={isDark ? "0.5;0.15;0.5" : "0.7;0.3;0.7"} dur="2.8s" repeatCount="indefinite" />
            </circle>
            <circle cx={x + 38} cy={58} r={2.5} fill="#FFB800" opacity={isDark ? 0.3 : 0.5} filter="url(#br-glow)">
                <animate attributeName="opacity" values={isDark ? "0.3;0.08;0.3" : "0.5;0.2;0.5"} dur="3.5s" repeatCount="indefinite" />
            </circle>

            {/* Waiting ships count badge */}
            {waitingCount > 0 && (
                <g transform={`translate(${x + 4}, ${75})`}>
                    {/* Badge background */}
                    <circle r={14} fill={isDark ? "#0a1520" : "#f0e6d2"} stroke="#FFB800" strokeWidth={1.2} opacity={0.95} />
                    <circle r={14} fill="none" stroke="#FFB800" strokeWidth={0.6} opacity={0}>
                        <animate attributeName="opacity" values="0;0.5;0" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="r" values="14;18;14" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    {/* Ship icon */}
                    <text y={-2} textAnchor="middle" fill="#FFB800" fontSize={10} fontWeight="bold" fontFamily="monospace"
                        dominantBaseline="middle" opacity={0.9}>
                        {waitingCount}
                    </text>
                    <text y={9} textAnchor="middle" fill="#FFB800" fontSize={4.5} fontFamily="monospace"
                        dominantBaseline="middle" opacity={0.5} letterSpacing="0.1em">
                        WAITING
                    </text>
                </g>
            )}

            {/* PORT label */}
            <text x={x + 4} y={SVG_H - 18} textAnchor="middle" fill={labelColor} fontSize={7.5} fontFamily="monospace"
                fontWeight="bold" letterSpacing="0.3em" opacity={isDark ? 0.5 : 0.6}>
                HARBOUR
            </text>
        </g>
    );
});



export const BoatRaceHarbourLayer = memo(({ isDark, waitingCount }: { isDark: boolean; waitingCount: number }) => {
    return (
        <HarbourBuilding x={HARBOUR_X - 40} waitingCount={waitingCount} isDark={isDark} />
    );
});
