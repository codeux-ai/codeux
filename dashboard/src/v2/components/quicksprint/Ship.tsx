import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useComputed } from "@preact/signals";
import type { StatusStyle } from "../boat-race/utils.js";
import { getTaskProgressPhase } from "../../../lib/task-progress.js";
import { type ShipDatum, type AnimatedShipPosition, useShipAnimation } from "./useBoatRaceAnimation.js";
import { TOW_LINE_LENGTH, BADGE_OFFSET } from "../../lib/boat-race-config.js";


export const ContainerShip: FunctionComponent<{ accentColor: string; dim: boolean; isMoving: boolean; isDark: boolean; isFailed?: boolean }> = memo(({ accentColor, dim, isMoving, isDark, isFailed }) => {
    const o = dim ? 0.35 : 1;
    const hullFill = isDark ? "#0f1d33" : "#c8d6e5";
    const hullStroke = isDark ? "#1a3050" : "#8395a7";
    const deckFill = isDark ? "#162840" : "#a4b0be";
    const bridgeFill = isDark ? "#1a2d50" : "#8395a7";
    const bridgeStroke = isDark ? "#25406a" : "#576574";
    const funnelFill = isDark ? "#1e3450" : "#8395a7";
    const windowFill = isDark ? "#4a8ad4" : "#2e86de";
    const smokeFill = isDark ? "#b8c8d8" : "#636e72";
    const failSmokeFill = isDark ? "#4b5563" : "#374151";
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={24} rx={46} ry={8} fill={accentColor} opacity={0.08}>
                {isMoving && <animate attributeName="ry" values="8;10;8" dur="2.5s" repeatCount="indefinite" />}
            </ellipse>
            {/* Hull shadow */}
            <ellipse cx={3} cy={20} rx={40} ry={6} fill={isDark ? "black" : "#2d3436"} opacity={isDark ? 0.4 : 0.15} />
            {/* Hull */}
            <path d="M-40 3 L-35 16 Q-32 20 0 20 Q32 20 35 16 L40 3 L34 -6 Q20 -10 0 -10 Q-20 -10 -34 -6 Z"
                fill={hullFill} stroke={hullStroke} strokeWidth={0.8} />
            {/* Waterline accent */}
            <path d="M-35 16 Q0 21 35 16 Q32 20 0 20 Q-32 20 -35 16 Z"
                fill={accentColor} opacity={0.18} />
            {/* Deck */}
            <rect x={-33} y={-7} width={66} height={9} rx={1.5} fill={deckFill} />
            {/* Containers row 1 */}
            {[["#E74C3C", -29], ["#3498DB", -18], ["#F1C40F", -7], ["#2ECC71", 4], ["#9B59B6", 15]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-10} width={10} height={7} rx={1.2} fill={c as string} opacity={0.85} />
            )}
            {/* Containers row 2 */}
            {[["#E67E22", -26], ["#1ABC9C", -15], ["#E74C3C", -4], ["#3498DB", 7]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-17} width={10} height={6.5} rx={1.2} fill={c as string} opacity={0.65} />
            )}
            {/* Bridge */}
            <rect x={-6} y={-29} width={12} height={12} rx={2} fill={bridgeFill} stroke={bridgeStroke} strokeWidth={0.6} />
            {/* Bridge windows */}
            <rect x={-4.5} y={-27} width={9} height={4} rx={1} fill={windowFill} opacity={isDark ? 0.25 : 0.5} />
            <rect x={-4.5} y={-22} width={9} height={2.5} rx={0.6} fill={windowFill} opacity={isDark ? 0.15 : 0.35} />
            {/* Funnel */}
            <rect x={-3} y={-37} width={6} height={8} rx={1.8} fill={funnelFill} />
            <rect x={-2.5} y={-37.5} width={5} height={2.5} rx={1} fill={accentColor} opacity={0.9} />
            {/* Radar mast */}
            <line x1={0} y1={-29} x2={0} y2={-40} stroke={bridgeStroke} strokeWidth={0.8} />
            <circle cx={0} cy={-40.5} r={1.2} fill={accentColor} opacity={0.5}>
                <animate attributeName="opacity" values="0.5;0.1;0.5" dur="1.8s" repeatCount="indefinite" />
            </circle>
            {/* Nav lights */}
            <circle cx={-36} cy={0} r={1.5} fill="#E3000F" opacity={0.7} />
            <circle cx={36} cy={0} r={1.5} fill="#2ECC71" opacity={0.7} />
            {/* Smoke when moving */}
            {isMoving && (
                <g opacity={0.12}>
                    {[0, 1, 2, 3, 4].map(j => (
                        <circle key={j} cx={-2 + j * 0.8} cy={-37} r={1} fill={smokeFill}>
                            <animate attributeName="cy" values="-37;-62" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                            <animate attributeName="r" values="1;5" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                            <animate attributeName="opacity" values="0.2;0" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                        </circle>
                    ))}
                </g>
            )}
            {/* Failure Smoke */}
            {isFailed && (
                <g opacity={0.8}>
                    {[0, 1, 2, 3, 4].map(j => (
                        <circle key={j} cx={j * 2 - 4} cy={-5} r={1.5} fill={failSmokeFill}>
                            <animate attributeName="cy" values="-5;-30" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                            <animate attributeName="r" values="1.5;6" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                            <animate attributeName="opacity" values="0.8;0" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                        </circle>
                    ))}
                </g>
            )}
        </g>
    );
});

export const WoodenShip: FunctionComponent<{ accentColor: string; dim: boolean; isMoving: boolean; isDark: boolean; isFailed?: boolean }> = memo(({ accentColor, dim, isMoving, isDark, isFailed }) => {
    const o = dim ? 0.35 : 1;
    const hullFill = isDark ? "#5C3D0E" : "#8B6914";
    const hullStroke = isDark ? "#7A5518" : "#A67B20";
    const plankStroke = isDark ? "#4A3008" : "#7A5518";
    const deckFill = isDark ? "#7A5518" : "#A67B20";
    const mastStroke = isDark ? "#4A3008" : "#5C3D0E";
    const sailFill = isDark ? "#F5EFE0" : "#FFF8E7";
    const sailStroke = isDark ? "#C9BFA8" : "#B8A888";
    const cabinFill = isDark ? "#4A3008" : "#7A5518";
    const windowFill = isDark ? "#FFD080" : "#FFE0A0";
    const failSmokeFill = isDark ? "#4b5563" : "#374151";
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={24} rx={38} ry={7} fill={accentColor} opacity={0.06}>
                {isMoving && <animate attributeName="ry" values="7;9;7" dur="2.8s" repeatCount="indefinite" />}
            </ellipse>
            {/* Hull shadow */}
            <ellipse cx={3} cy={20} rx={36} ry={5.5} fill={isDark ? "black" : "#2d3436"} opacity={isDark ? 0.35 : 0.12} />
            {/* Hull */}
            <path d="M-32 5 Q-36 5 -32 17 L-24 20 Q0 22 24 20 L32 17 Q36 5 32 5 Z"
                fill={hullFill} stroke={hullStroke} strokeWidth={0.9} />
            {/* Hull planking */}
            <path d="M-29 10 Q0 8 29 10" fill="none" stroke={plankStroke} strokeWidth={0.5} opacity={0.45} />
            <path d="M-27 14 Q0 12 27 14" fill="none" stroke={plankStroke} strokeWidth={0.4} opacity={0.35} />
            {/* Keel highlight */}
            <path d="M-32 17 Q0 20 32 17 Q30 19 0 19 Q-30 19 -32 17 Z"
                fill={accentColor} opacity={0.1} />
            {/* Deck */}
            <path d="M-28 5 Q0 2 28 5 Q22 2 0 2 Q-22 2 -28 5 Z" fill={deckFill} opacity={0.85} />
            {/* Railing */}
            {[-22, -14, -6, 2, 10, 18].map(x => (
                <line key={x} x1={x} y1={2} x2={x} y2={-1.5} stroke={isDark ? "#8B6914" : "#A67B20"} strokeWidth={0.5} opacity={0.35} />
            ))}
            <line x1={-24} y1={-1} x2={24} y2={-1} stroke={isDark ? "#8B6914" : "#A67B20"} strokeWidth={0.5} opacity={0.3} />
            {/* Main mast */}
            <line x1={-2} y1={2} x2={-2} y2={-48} stroke={mastStroke} strokeWidth={3} />
            {/* Cross spars */}
            <line x1={-22} y1={-36} x2={18} y2={-36} stroke={mastStroke} strokeWidth={2} />
            <line x1={-18} y1={-24} x2={14} y2={-24} stroke={mastStroke} strokeWidth={1.3} />
            {/* Main sail */}
            <path d="M0 -46 Q22 -34 22 -14 L0 -10 Z" fill={sailFill} opacity={0.92} stroke={sailStroke} strokeWidth={0.6}>
                <animate attributeName="d"
                    values="M0 -46 Q22 -34 22 -14 L0 -10 Z;M0 -46 Q24 -33 23 -13 L0 -10 Z;M0 -46 Q22 -34 22 -14 L0 -10 Z"
                    dur="5s" repeatCount="indefinite" />
            </path>
            {/* Topsail */}
            <path d="M0 -46 Q14 -42 14 -36 L0 -34 Z" fill={sailFill} opacity={0.7} stroke={sailStroke} strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M0 -46 Q14 -42 14 -36 L0 -34 Z;M0 -46 Q15 -41 15 -35 L0 -34 Z;M0 -46 Q14 -42 14 -36 L0 -34 Z"
                    dur="4s" repeatCount="indefinite" />
            </path>
            {/* Jib */}
            <path d="M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z" fill={sailFill} opacity={0.75} stroke={sailStroke} strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z;M-4 -44 Q-20 -31 -19 -13 L-4 -12 Z;M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z"
                    dur="4.5s" repeatCount="indefinite" />
            </path>
            {/* Rigging */}
            <line x1={-2} y1={-46} x2={22} y2={-14} stroke={mastStroke} strokeWidth={0.3} opacity={0.3} />
            <line x1={-2} y1={-46} x2={-18} y2={-14} stroke={mastStroke} strokeWidth={0.3} opacity={0.3} />
            {/* Flag */}
            <path d="M-2 -48 L10 -46 L-2 -44" fill={accentColor} opacity={0.9}>
                <animate attributeName="d"
                    values="M-2 -48 L10 -46 L-2 -44;M-2 -48 L11 -45.5 L-2 -44;M-2 -48 L10 -46 L-2 -44"
                    dur="2s" repeatCount="indefinite" />
            </path>
            {/* Fore mast */}
            <line x1={18} y1={3} x2={18} y2={-22} stroke={mastStroke} strokeWidth={1.6} />
            {/* Cabin */}
            <rect x={-20} y={-4.5} width={12} height={6.5} rx={1.5} fill={cabinFill} opacity={0.75} />
            <rect x={-18} y={-3.5} width={4.5} height={4} rx={0.8} fill={windowFill} opacity={0.35} />
            <rect x={-12.5} y={-3.5} width={3.5} height={4} rx={0.8} fill={windowFill} opacity={0.25} />
            {/* Lanterns */}
            <circle cx={30} cy={4} r={2} fill="#FFB800" opacity={0.6}>
                <animate attributeName="opacity" values="0.6;0.15;0.6" dur="3.5s" repeatCount="indefinite" />
            </circle>
            <circle cx={-30} cy={8} r={1.4} fill={accentColor} opacity={0.4}>
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
            </circle>
            {/* Failure Smoke */}
            {isFailed && (
                <g opacity={0.8}>
                    {[0, 1, 2, 3, 4].map(j => (
                        <circle key={j} cx={j * 2 - 4} cy={0} r={1.5} fill={failSmokeFill}>
                            <animate attributeName="cy" values="0;-25" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                            <animate attributeName="r" values="1.5;6" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                            <animate attributeName="opacity" values="0.8;0" dur={`${1.5 + j * 0.4}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
                        </circle>
                    ))}
                </g>
            )}
        </g>
    );
});

export const TowLine: FunctionComponent<{ color: string; length: number }> = memo(({ color, length }) => {
    const dotCount = 5;
    const spacing = length / (dotCount + 1);
    return (
        <g>
            {/* Main tow rope line */}
            <line x1={0} y1={0} x2={-length} y2={0}
                stroke={color} strokeWidth={0.5} opacity={0.15} strokeDasharray="2,3" />
            {/* Animated dots along the line */}
            {Array.from({ length: dotCount }, (_, i) => {
                const cx = -(spacing * (i + 1));
                const delay = i * 0.18;
                return (
                    <circle key={i} cx={cx} cy={0} r={1.8 - i * 0.15} fill={color} opacity={0.4}>
                        <animate attributeName="cy" values="0;-2;0;2;0" dur="1.6s"
                            repeatCount="indefinite" begin={`${delay}s`} />
                        <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1.6s"
                            repeatCount="indefinite" begin={`${delay}s`} />
                    </circle>
                );
            })}
        </g>
    );
});

export const ShipBadge: FunctionComponent<{
    taskId: string;
    title: string;
    style: StatusStyle;
    mergeIndicator?: string;
    isRunning: boolean;
    isDark: boolean;
}> = memo(({ taskId, title, style, mergeIndicator, isRunning, isDark }) => {
    const pillBg = isDark ? "rgba(4,8,16,0.92)" : "rgba(255,255,255,0.92)";
    const textColor = isDark ? "white" : "#1e293b";
    return (
        <g>
            {/* Halo glow */}
            <circle r={22} fill={style.color} opacity={0.06} />
            {/* Pill background */}
            <rect x={-58} y={-12} width={116} height={24} rx={12}
                fill={pillBg} stroke={style.color} strokeWidth={0.8} strokeOpacity={0.5} />
            {/* Running pulse ring */}
            {isRunning && (
                <rect x={-58} y={-12} width={116} height={24} rx={12}
                    fill="none" stroke={style.color} strokeWidth={0.9} opacity={0}>
                    <animate attributeName="opacity" values="0;0.4;0" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="x" values="-58;-61" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="y" values="-12;-15" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="width" values="116;122" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="height" values="24;30" dur="2s" repeatCount="indefinite" />
                </rect>
            )}
            {/* Status dot */}
            <circle cx={-42} cy={0} r={isRunning ? 3.5 : 2.5} fill={style.color}>
                {isRunning && (
                    <>
                        <animate attributeName="r" values="3.5;4.5;3.5" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
                    </>
                )}
            </circle>
            {/* Label */}
            <text x={-32} y={1} fill={style.color} fontSize={7.5} fontFamily="monospace" fontWeight="bold" opacity={0.9}
                dominantBaseline="middle">{style.label}</text>
            {/* Task ID */}
            <text x={16} y={1} fill={textColor} fontSize={7.5} fontFamily="monospace" fontWeight="bold" opacity={isDark ? 0.4 : 0.5}
                dominantBaseline="middle">#{taskId}</text>
            {/* Merge indicator badge */}
            {mergeIndicator && (
                <g transform="translate(44, 0)">
                    <circle r={7} fill={
                        mergeIndicator === "MERGED" ? "#00AB84"
                        : mergeIndicator === "CI" ? "#5dade2"
                        : mergeIndicator === "MERGE_CONFLICT" ? "#E3000F"
                        : "#F59E0B"
                    } opacity={0.85} />
                    <text y={0.5} textAnchor="middle" fill="white" fontSize={5.2} fontWeight="bold" fontFamily="monospace"
                        dominantBaseline="middle">
                        {mergeIndicator === "MERGED" ? "M" : mergeIndicator === "CI" ? "CI"
                        : mergeIndicator === "MERGE_CONFLICT" ? "!" : "AM"}
                    </text>
                </g>
            )}
            {/* Title */}
            <text y={20} textAnchor="middle" fill={textColor} fontSize={6.5} fontFamily="monospace" opacity={isDark ? 0.2 : 0.3}>
                {title.length > 34 ? title.slice(0, 32) + "…" : title}
            </text>
        </g>
    );
});



// Custom equality function for Ship
const shipPropsAreEqual = (prev: any, next: any) => {
    return prev.s.key === next.s.key &&
           prev.isDark === next.isDark &&
           prev.s.task.status === next.s.task.status &&
           prev.s.progress.stopped === next.s.progress.stopped &&
           prev.s.task.merge_indicator === next.s.task.merge_indicator;
};

export const BoatRaceShipItem = memo(({
    s,
    isDark,
    posSignal
}: {
    s: ShipDatum,
    isDark: boolean,
    posSignal: import("@preact/signals").Signal<AnimatedShipPosition>
}) => {
    const isRunning = getTaskProgressPhase(s.task) === "RUNNING";
    const isFailed = getTaskProgressPhase(s.task) === "FAILED";

    const pos = useComputed(() => posSignal.value || { x: -100, y: 0, scale: 0.6, opacity: 0, pingedCheckpoints: new Set<number>() });
    const x = useComputed(() => pos.value.x);
    const y = useComputed(() => pos.value.y);
    const scale = useComputed(() => pos.value.scale);
    const opacity = useComputed(() => pos.value.opacity);

    // transform directly via signal
    const transform = useComputed(() => `translate(${x.value}, ${y.value}) scale(${scale.value})`);

    const pingsCount = useComputed(() => pos.value.pingedCheckpoints?.size || 0);
    const { pingRef, bobRef, wrapperRef } = useShipAnimation(s, pingsCount);

    return (
        <g className="race-ship" transform={transform} opacity={opacity}>
            <g id={`ship-wrapper-${s.key}`} ref={wrapperRef}>
                <g id={`ship-bob-${s.key}`} ref={bobRef}>
                    <circle id={`ship-ping-${s.key}`} ref={pingRef} className="checkpoint-ping" cx={0} cy={24} r={0} fill="none" stroke={s.style.color} strokeWidth={1.5} opacity={0} />

                    <ellipse cx={-45} cy={14} rx={!s.progress.stopped ? 60 : 25} ry={!s.progress.stopped ? 4.5 : 2}
                        fill="url(#br-wake)" opacity={!s.progress.stopped ? 0.3 : 0.06}>
                        {!s.progress.stopped && (
                            <animate attributeName="rx" values="55;70;55" dur="3s" repeatCount="indefinite" />
                        )}
                    </ellipse>

                    <ellipse cx={0} cy={20} rx={45} ry={12} fill={s.style.color} opacity={0.12} filter="url(#br-glow2)" />
                    {isRunning && (
                        <ellipse cx={0} cy={20} rx={40} ry={10} fill={s.style.color} opacity={0.1} filter="url(#br-glow)">
                            <animate attributeName="opacity" values="0.1;0.25;0.1" dur="2s" repeatCount="indefinite" />
                            <animate attributeName="rx" values="40;46;40" dur="2s" repeatCount="indefinite" />
                        </ellipse>
                    )}

                    {s.shipType === "wooden" ? (
                        <WoodenShip accentColor={s.style.color} dim={s.style.dim} isMoving={!s.progress.stopped} isDark={isDark} isFailed={isFailed} />
                    ) : (
                        <ContainerShip accentColor={s.style.color} dim={s.style.dim} isMoving={!s.progress.stopped} isDark={isDark} isFailed={isFailed} />
                    )}

                    <g transform="translate(-44, 4)">
                        <TowLine color={s.style.color} length={TOW_LINE_LENGTH} />
                        <g transform={`translate(${-BADGE_OFFSET + 44}, 0)`}>
                            <ShipBadge
                                taskId={s.task.id}
                                title={s.task.title}
                                style={s.style}
                                isDark={isDark}
                                mergeIndicator={s.task.merge_indicator}
                                isRunning={isRunning}
                            />
                        </g>
                    </g>
                </g>
            </g>
        </g>
    );
}, shipPropsAreEqual);




export const BoatRaceShipsLayer = memo(({
    activeShips,
    animatedPositionsSignals,
    isDark,
    shipsGroupRef
}: {
    activeShips: ShipDatum[];
    animatedPositionsSignals: Record<string, import("@preact/signals").Signal<AnimatedShipPosition>>;
    isDark: boolean;
    shipsGroupRef: import("preact").Ref<SVGGElement>;
}) => {
    return (
        <g ref={shipsGroupRef}>
            {activeShips.map(s => (
                <BoatRaceShipItem
                    key={s.key}
                    s={s}
                    isDark={isDark}
                    posSignal={animatedPositionsSignals[s.key]!}
                />
            ))}
        </g>
    );
});
