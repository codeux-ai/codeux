import type { FunctionComponent } from "preact";

interface ShipProps {
  accentColor: string;
  isMoving: boolean;
  isDark: boolean;
}

export const ContainerShip: FunctionComponent<ShipProps> = ({ accentColor, isMoving, isDark }) => {
  const hullFill = isDark ? "#0f1d33" : "#c8d6e5";
  const hullStroke = isDark ? "#1a3050" : "#8395a7";
  const deckFill = isDark ? "#162840" : "#a4b0be";
  const bridgeFill = isDark ? "#1a2d50" : "#8395a7";
  const bridgeStroke = isDark ? "#25406a" : "#576574";
  const funnelFill = isDark ? "#1e3450" : "#8395a7";
  const windowFill = isDark ? "#4a8ad4" : "#2e86de";
  const smokeFill = isDark ? "#b8c8d8" : "#636e72";

  return (
    <g transform="scale(0.8)">
      <ellipse cx={0} cy={24} rx={46} ry={8} fill={accentColor} opacity={0.08}>
        {isMoving && <animate attributeName="ry" values="8;10;8" dur="2.5s" repeatCount="indefinite" />}
      </ellipse>
      <path d="M-52 4 L52 4 L42 22 L-42 22 Z" fill={hullFill} stroke={hullStroke} strokeWidth={1.5} />
      <path d="M-44 4 L44 4 L38 18 L-38 18 Z" fill={deckFill} opacity={0.4} />
      <rect x={-12} y={-18} width={28} height={22} rx={2} fill={bridgeFill} stroke={bridgeStroke} strokeWidth={1} />
      <rect x={-8} y={-14} width={20} height={6} rx={1} fill={windowFill} opacity={0.6} />
      <rect x={-1} y={-28} width={6} height={10} rx={1} fill={funnelFill} />
      <rect x={-1} y={-28} width={6} height={3} fill={isDark ? "#ff4d4d" : "#e3000f"} opacity={0.8} />
      {isMoving && (
        <g opacity={0.4}>
          {[0, 1, 2, 3, 4].map(j => (
            <circle key={j} cx={2 + j * 0.8} cy={-30} r={1} fill={smokeFill}>
              <animate attributeName="cy" values="-30;-52" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
              <animate attributeName="r" values="1;4" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
              <animate attributeName="opacity" values="0.2;0" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
            </circle>
          ))}
        </g>
      )}
    </g>
  );
};

export const WoodenShip: FunctionComponent<ShipProps> = ({ accentColor, isMoving, isDark }) => {
  const hullFill = isDark ? "#5C3D0E" : "#8B6914";
  const hullStroke = isDark ? "#7A5518" : "#A67B20";
  const deckFill = isDark ? "#7A5518" : "#A67B20";
  const mastStroke = isDark ? "#4A3008" : "#5C3D0E";
  const sailFill = isDark ? "#F5EFE0" : "#FFF8E7";
  const sailStroke = isDark ? "#C9BFA8" : "#B8A888";

  return (
    <g transform="scale(0.8)">
      <ellipse cx={0} cy={24} rx={38} ry={7} fill={accentColor} opacity={0.06}>
        {isMoving && <animate attributeName="ry" values="7;9;7" dur="2.8s" repeatCount="indefinite" />}
      </ellipse>
      <path d="M-40 4 L40 4 L32 20 L-32 20 Z" fill={hullFill} stroke={hullStroke} strokeWidth={1.5} />
      <path d="M-34 4 L34 4 L28 16 L-28 16 Z" fill={deckFill} opacity={0.3} />
      <line x1={0} y1={4} x2={0} y2={-32} stroke={mastStroke} strokeWidth={2.5} />
      <path d="M2 -30 Q22 -16 2 2 Z" fill={sailFill} stroke={sailStroke} strokeWidth={1} />
      <path d="M-2 -30 Q-22 -16 -2 2 Z" fill={sailFill} stroke={sailStroke} strokeWidth={1} />
      {isMoving && (
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
