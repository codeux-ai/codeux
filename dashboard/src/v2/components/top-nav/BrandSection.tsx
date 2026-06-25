import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-preact";
import { RobotLogo } from "../brand/RobotLogo.js";

interface BrandSectionProps {
    isMobile?: boolean;
    onMenuToggle?: () => void;
    hideLogo?: boolean;
    isMobileMenuOpen?: boolean;
}

export const BrandSection: FunctionComponent<BrandSectionProps> = ({ isMobile, onMenuToggle, hideLogo, isMobileMenuOpen }) => {
    const [brandActive, setBrandActive] = useState(false);

    if (hideLogo && !isMobile) {
        return null;
    }

    return (
        <div className="flex shrink-0 items-center gap-4 md:gap-10">
            {isMobile && (
                <button
                    type="button"
                    onClick={onMenuToggle}
                    aria-label={isMobileMenuOpen ? "Close mobile menu" : "Open mobile menu"}
                    aria-expanded={!!isMobileMenuOpen}
                    aria-controls="primary-navigation"
                    className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 shrink-0"
                >
                    <Menu aria-hidden="true" className="w-5 h-5 text-slate-600 dark:text-slate-300" strokeWidth={2} />
                </button>
            )}
            {/* Logo */}
            <Link
                to="/"
                onMouseEnter={() => setBrandActive(true)}
                onMouseLeave={() => setBrandActive(false)}
                onFocus={() => setBrandActive(true)}
                onBlur={() => setBrandActive(false)}
                className="flex items-center gap-3 cursor-pointer group shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-xl"
            >
                <div className="relative w-9 h-9 rounded-2xl overflow-hidden ring-1 ring-inset ring-white/[0.06] dark:ring-white/[0.08] shadow-[0_0_22px_rgba(0,224,160,0.22)] transition-shadow duration-500 group-hover:shadow-[0_0_32px_rgba(0,224,160,0.42)]">
                    <RobotLogo
                        size={36}
                        rounded={false}
                        active={brandActive}
                        className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                    />
                </div>
                <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white hidden sm:flex items-center gap-0.5">
                    Code<span className="text-signal-500">UX</span>
                </span>
            </Link>
        </div>
    );
};
