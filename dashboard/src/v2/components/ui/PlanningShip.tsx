import type { FunctionComponent } from "preact";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface ShipProps {
  accentColor: string;
  isMoving: boolean;
  isDark: boolean;
}

export const ContainerShipDef: FunctionComponent<ShipProps> = ({ accentColor, isMoving, isDark }) => {
  const isReducedMotion = useReducedMotion();
  const shouldAnimate = isMoving && !isReducedMotion;
  const hullFill = isDark ? "#10233d" : "#d9e4ee";
  const hullStroke = isDark ? "#2c4a70" : "#7d8fa3";
  const deckFill = isDark ? "#1b3354" : "#edf3f8";
  const railFill = isDark ? "#93c5fd" : "#475569";
  const bridgeFill = isDark ? "#203a5d" : "#f8fafc";
  const bridgeStroke = isDark ? "#3e5f8a" : "#94a3b8";
  const funnelFill = isDark ? "#263f5d" : "#64748b";
  const windowFill = isDark ? "#4a8ad4" : "#2e86de";
  const smokeFill = isDark ? "#dbeafe" : "#64748b";
  const containerFills = isDark
    ? ["#00E0A0", "#3b82f6", "#f59e0b", "#94a3b8"]
    : ["#005EB8", "#00AB84", "#FFB800", "#94a3b8"];

  return (
    <g>
      <ellipse cx={-8} cy={25} rx={48} ry={7} fill="#0f172a" opacity={isDark ? 0.28 : 0.12} />
      <ellipse cx={-16} cy={27} rx={34} ry={4} fill={accentColor} opacity={0.14}>
        {shouldAnimate && <animate attributeName="ry" values="4;5.5;4" dur="2.5s" repeatCount="indefinite" />}
      </ellipse>
      <path d="M-54 3 H50 C55 3 57 6 53 10 L43 23 H-41 C-47 23 -52 20 -54 14 L-58 5 C-58 4 -56 3 -54 3 Z" fill={hullFill} stroke={hullStroke} strokeWidth={1.4} />
      <path d="M-49 5 H48 L40 18 H-41 L-45 8 Z" fill={deckFill} opacity={0.66} />
      <path d="M-47 10 H47" stroke={railFill} strokeWidth={0.9} strokeLinecap="round" opacity={0.5} />
      <g stroke={isDark ? "#07111f" : "#ffffff"} strokeWidth={0.7} opacity={0.92}>
        {[-38, -28, -18, -8, 2, 12].map((x, index) => (
          <rect key={x} x={x} y={-7 - (index % 2) * 8} width={10} height={8} rx={1.2} fill={containerFills[index % containerFills.length]} />
        ))}
        {[-33, -23, -13, -3, 7].map((x, index) => (
          <rect key={x} x={x} y={1 - (index % 2) * 8} width={10} height={7} rx={1.1} fill={containerFills[(index + 2) % containerFills.length]} />
        ))}
      </g>
      <rect x={18} y={-20} width={24} height={23} rx={3} fill={bridgeFill} stroke={bridgeStroke} strokeWidth={1} />
      <rect x={22} y={-15} width={15} height={5} rx={1.5} fill={windowFill} opacity={0.72} />
      <rect x={22} y={-7} width={16} height={3} rx={1.2} fill={railFill} opacity={0.34} />
      <rect x={26} y={-31} width={7} height={11} rx={1.5} fill={funnelFill} />
      <rect x={26} y={-31} width={7} height={3} rx={1} fill={isDark ? "#ff6b6b" : "#e3000f"} opacity={0.86} />
      <path d="M-39 19 H38" stroke={isDark ? "#80FFD6" : "#005EB8"} strokeWidth={1.2} strokeLinecap="round" opacity={0.35} />
      {shouldAnimate && (
        <g opacity={0.4}>
          {[0, 1, 2, 3, 4].map(j => (
            <circle key={j} cx={29 + j * 0.9} cy={-33} r={1} fill={smokeFill}>
              <animate attributeName="cy" values="-33;-53" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
              <animate attributeName="r" values="1;4.5" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
              <animate attributeName="opacity" values="0.2;0" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
            </circle>
          ))}
        </g>
      )}
    </g>
  );
};

export const ContainerShip: FunctionComponent<ShipProps> = (props) => {
  return (
    <g transform="scale(0.8)">
      <ContainerShipDef {...props} />
    </g>
  );
};

export const WoodenShipDef: FunctionComponent<ShipProps> = ({ accentColor, isMoving, isDark }) => {
  const isReducedMotion = useReducedMotion();
  const shouldAnimate = isMoving && !isReducedMotion;
  const hullFill = isDark ? "#664414" : "#9a6d20";
  const hullStroke = isDark ? "#a16f24" : "#7c4f11";
  const deckFill = isDark ? "#8a5e20" : "#b9812e";
  const mastStroke = isDark ? "#3f2a0b" : "#5C3D0E";
  const sailFill = isDark ? "#f8f1dd" : "#fff8e7";
  const sailShade = isDark ? "#e6d8b8" : "#eadbbf";
  const sailStroke = isDark ? "#c9bfa8" : "#b8a888";

  return (
    <g>
      <ellipse cx={-8} cy={25} rx={40} ry={7} fill="#0f172a" opacity={isDark ? 0.26 : 0.1} />
      <ellipse cx={-15} cy={27} rx={28} ry={4} fill={accentColor} opacity={0.14}>
        {shouldAnimate && <animate attributeName="ry" values="4;5.5;4" dur="2.8s" repeatCount="indefinite" />}
      </ellipse>
      <path d="M-42 3 H42 L34 18 C31 23 -28 23 -34 18 Z" fill={hullFill} stroke={hullStroke} strokeWidth={1.5} />
      <path d="M-33 5 H34 L27 15 C20 18 -20 18 -27 15 Z" fill={deckFill} opacity={0.42} />
      <path d="M-30 12 C-14 16 11 16 30 12" fill="none" stroke={isDark ? "#c89142" : "#6b4310"} strokeWidth={1} opacity={0.45} />
      <line x1={0} y1={5} x2={0} y2={-34} stroke={mastStroke} strokeWidth={2.8} strokeLinecap="round" />
      <line x1={-18} y1={-13} x2={20} y2={-13} stroke={mastStroke} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
      <path d="M3 -32 Q25 -17 3 3 Z" fill={sailFill} stroke={sailStroke} strokeWidth={1.1} />
      <path d="M4 -27 Q17 -15 4 -2 Z" fill={sailShade} opacity={0.38} />
      <path d="M-3 -32 Q-24 -17 -3 3 Z" fill={sailFill} stroke={sailStroke} strokeWidth={1.1} />
      <path d="M-4 -27 Q-17 -15 -4 -2 Z" fill={sailShade} opacity={0.34} />
      <path d="M-31 19 H28" stroke={accentColor} strokeWidth={1.1} strokeLinecap="round" opacity={0.32} />
      {shouldAnimate && (
        <g opacity={0.4}>
          {[0, 1, 2].map(j => (
            <path key={j} d="M42 12 Q52 12 52 2" fill="none" stroke={isDark ? "white" : "#334155"} strokeWidth={0.5} opacity={0}>
              <animate attributeName="d" values="M42 12 Q52 12 52 2;M42 12 Q62 12 62 -8" dur={`${1 + j * 0.3}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
              <animate attributeName="opacity" values="0.4;0" dur={`${1 + j * 0.3}s`} repeatCount="indefinite" begin={`${j * 0.3}s`} />
            </path>
          ))}
        </g>
      )}
    </g>
  );
};

export const WoodenShip: FunctionComponent<ShipProps> = (props) => {
  return (
    <g transform="scale(0.8)">
      <WoodenShipDef {...props} />
    </g>
  );
};
