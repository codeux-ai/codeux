import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { HARBOUR_X, FINISH_X } from "../../lib/boat-race-config.js";
import type { ShipDatum } from "./useBoatRaceAnimation.js";

export const Lane: FunctionComponent<{ isDark: boolean; activeShips: ShipDatum[] }> = memo(({ isDark, activeShips }) => {
    return (
        <g>
            {activeShips.map(s => (
                <line key={`ln-${s.key}`}
                    x1={HARBOUR_X + 40} y1={s.laneY + 16} x2={FINISH_X - 20} y2={s.laneY + 16}
                    stroke={isDark ? "white" : "black"} strokeWidth={0.2} strokeDasharray="2,24" opacity={0.025} />
            ))}
        </g>
    );
});
