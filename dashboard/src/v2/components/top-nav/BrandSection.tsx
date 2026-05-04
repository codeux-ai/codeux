import type { FunctionComponent } from "preact";
import { Link } from "@tanstack/react-router";
import { Activity, Menu } from "lucide-preact";

interface BrandSectionProps {
    isMobile?: boolean;
    onMenuToggle?: () => void;
}

export const BrandSection: FunctionComponent<BrandSectionProps> = ({ isMobile, onMenuToggle }) => {
    return (
        <div className="flex items-center gap-4 md:gap-10 flex-1">
            {isMobile && (
                <button
                    type="button"
                    onClick={onMenuToggle}
                    aria-label="Toggle Navigation Menu"
                    className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 shrink-0"
                >
                    <Menu aria-hidden="true" className="w-5 h-5 text-slate-600 dark:text-slate-300" strokeWidth={2} />
                </button>
            )}
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 cursor-pointer group shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-xl">
                <div className="relative w-8 h-8 flex items-center justify-center bg-void-900 dark:bg-white rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,224,160,0.25)]">
                    <div className="absolute inset-0 bg-signal-500 opacity-0 group-hover:opacity-20 transition-opacity duration-500" />
                    <Activity aria-hidden="true" className="w-4 h-4 text-signal-500 dark:text-void-900 relative z-10 group-hover:scale-110 transition-transform duration-500" strokeWidth={2.5} />
                </div>
                <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-0.5 sm:flex">
                    Sprint<span className="text-signal-500">OS</span>
                </span>
            </Link>
        </div>
    );
};
