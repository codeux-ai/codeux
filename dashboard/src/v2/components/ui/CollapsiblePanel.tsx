import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { ChevronDown } from "lucide-preact";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";

export const CollapsiblePanel: FunctionComponent<{
    title: string;
    icon: any;
    accentHex: string;
    defaultOpen?: boolean;
    badge?: string | number;
    children: any;
}> = ({ title, icon: Icon, accentHex, defaultOpen = false, badge, children }) => {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="group/collapse relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-xl shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex={accentHex} />
            <BorderTrace accentHex={accentHex} />

            {/* Header — always visible, clickable */}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="relative z-10 w-full flex items-center justify-between gap-3 p-5 hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors duration-200"
            >
                <div className="flex items-center gap-2.5">
                    <span style={{ color: accentHex }}><Icon className="w-4 h-4" strokeWidth={1.5} /></span>
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{title}</span>
                    {badge != null && (
                        <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.04] text-slate-400">
                            {badge}
                        </span>
                    )}
                </div>
                <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
                    strokeWidth={2}
                />
            </button>

            {/* Collapsible body */}
            <div className={`collapsible-section ${open ? "open" : ""}`}>
                <div className="collapsible-content">
                    <div className="relative z-10 px-5 pb-5 pt-0">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    );
};
