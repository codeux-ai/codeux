import type { FunctionComponent, ComponentChildren } from "preact";
import { PremiumSurface } from "./PremiumSurface.js";

interface MetricCardProps {
    children: ComponentChildren;
    hoverTint: string;
    accentHex: string;
}

export const MetricCard: FunctionComponent<MetricCardProps> = ({ children, hoverTint, accentHex }) => (
    <PremiumSurface
        accentHex={accentHex}
        hoverTint={hoverTint}
        className="stat-card-premium"
    >
        {children}
    </PremiumSurface>
);
