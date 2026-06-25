import { Link } from "@tanstack/react-router";
import { FunctionComponent } from "preact";
import { prefetchRoute } from "../../router/route-prefetch.js";

interface NavItemProps {
    item: {
        icon: any;
        label: string;
        path: string;
    };
    isActive: boolean;
    isMinimized: boolean;
    isMobile?: boolean;
    onClose?: () => void;
    elementRef?: preact.Ref<HTMLAnchorElement>;
}

export const NavItem: FunctionComponent<NavItemProps> = ({ item, isActive, isMinimized, isMobile, onClose, elementRef }) => {
    return (
        <Link
            aria-label={isMinimized && !isMobile ? item.label : undefined}
            ref={elementRef}
            to={item.path}
            onClick={isMobile ? onClose : undefined}
            onMouseEnter={() => prefetchRoute(item.path)}
            onPointerDown={() => prefetchRoute(item.path)}
            onFocus={() => prefetchRoute(item.path)}
            aria-current={isActive ? "page" : undefined}
            data-tour-id={`nav-${item.label.toLowerCase()}`}
            data-nav-item
            className={`relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-2 min-h-[40px] rounded-2xl transition-all duration-300 group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-2xl focus-visible:z-10 decoration-none`}
        >
            {/* Hover state background - always present, but only visible on hover */}
            <div className={`absolute inset-0 rounded-2xl transition-all duration-300 pointer-events-none origin-left bg-black/[0.05] dark:bg-white/[0.05] opacity-0 group-hover:opacity-100`} />

            <item.icon aria-hidden="true" className={`relative z-10 w-4 h-4 transition-all duration-300 shrink-0 ${isActive ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} strokeWidth={isActive ? 2 : 1.5} />

            <div className={`relative z-10 overflow-hidden transition-all duration-500 ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`}>
                <span className={`font-medium text-sm tracking-wide transition-colors duration-300 whitespace-nowrap ${isActive ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                    {item.label}
                </span>
            </div>

            {/* Award Winning Tooltip for Minimized State */}
            {isMinimized && !isMobile && (
                <div aria-hidden="true" className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-white/95 dark:bg-void-800/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs font-bold tracking-wide rounded-2xl opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none shadow-2xl z-[100] whitespace-nowrap flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-signal-500/80 shadow-[0_0_6px_rgba(0,224,160,0.6)]"></span>
                    {item.label}
                </div>
            )}
        </Link>
    );
};
