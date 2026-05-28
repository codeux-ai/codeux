import type { FunctionComponent, ComponentChildren } from "preact";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";

interface MetricCardProps {
    children: ComponentChildren;
    hoverTint: string;
    accentHex: string;
}

export const MetricCard: FunctionComponent<MetricCardProps> = ({ children, hoverTint, accentHex }) => (
    <div className="relative overflow-hidden bg-white/80 dark:bg-void-800/75 backdrop-blur-sm border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] flex flex-col justify-between group stat-card-premium">
        {/* Hover tint */}
        <div className={`absolute inset-0 bg-transparent ${hoverTint} transition-colors duration-500 pointer-events-none`} />
        <WaveFluid accentHex={accentHex} />
        <BorderTrace accentHex={accentHex} />
        {children}
    </div>
);
