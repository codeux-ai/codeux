import type { FunctionComponent, ComponentChildren } from "preact";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";

interface MetricCardProps {
    children: ComponentChildren;
    hoverTint: string;
    accentHex: string;
}

export const MetricCard: FunctionComponent<MetricCardProps> = ({ children, hoverTint, accentHex }) => (
    <div className="relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-metric-card)] p-7 shadow-[var(--elevation-base)] backdrop-blur-sm dark:bg-[var(--surface-metric-card-dark)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] group stat-card-premium">
        {/* Hover tint */}
        <div
            className={`absolute inset-0 bg-transparent ${hoverTint} pointer-events-none motion-safe:transition-colors motion-reduce:transition-none`}
            style={{ transitionDuration: "var(--interaction-async-feedback-duration)", transitionTimingFunction: "var(--interaction-async-feedback-ease)" }}
        />
        <WaveFluid accentHex={accentHex} />
        <BorderTrace accentHex={accentHex} />
        {children}
    </div>
);
