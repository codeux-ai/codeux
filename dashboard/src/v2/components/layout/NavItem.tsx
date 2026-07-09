import { Link } from "@tanstack/react-router";
import { FunctionComponent, JSX } from "preact";
import { useCallback, useState } from "preact/hooks";
import { prefetchRoute } from "../../router/route-prefetch.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import {
    getNavigationItemLabel,
    isRouteNavigationItem,
    type PrimaryNavigationItem,
} from "../../lib/navigation-items.js";

interface NavItemProps {
    item: PrimaryNavigationItem;
    isActive: boolean;
    isMinimized: boolean;
    isMobile?: boolean;
    onClose?: () => void;
    elementRef?: preact.Ref<HTMLElement>;
}

export const NavItem: FunctionComponent<NavItemProps> = ({ item, isActive, isMinimized, isMobile, onClose, elementRef }) => {
    const [tooltipTop, setTooltipTop] = useState<number>(0);
    const interactionTokens = useInteractionTokens();
    const controlTransitionStyle: JSX.CSSProperties = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const selectionTransitionStyle: JSX.CSSProperties = {
        transitionDuration: interactionTokens.selectionMovement.duration,
        transitionTimingFunction: interactionTokens.selectionMovement.ease,
    };
    const label = getNavigationItemLabel(item, "sidebar");
    const isUnavailable = !!item.unavailableReason;
    const sidebarControlId = item.id === "config" ? "settings" : item.id;
    const tooltipId = isMinimized && !isMobile ? `nav-tooltip-${sidebarControlId}` : undefined;
    const unavailableId = isUnavailable ? `nav-unavailable-${sidebarControlId}` : undefined;
    const updateTooltipPosition = useCallback((element: HTMLElement | null): void => {
        if (!element || !isMinimized || isMobile) {
            return;
        }
        const rect = element.getBoundingClientRect();
        setTooltipTop(rect.top + (rect.height / 2));
    }, [isMinimized, isMobile]);
    const handleTooltipMouseEnter = useCallback((event: JSX.TargetedMouseEvent<HTMLElement>): void => {
        updateTooltipPosition(event.currentTarget);
    }, [updateTooltipPosition]);
    const handleTooltipFocus = useCallback((event: JSX.TargetedFocusEvent<HTMLElement>): void => {
        updateTooltipPosition(event.currentTarget);
    }, [updateTooltipPosition]);
    const handleRouteMouseEnter = useCallback((event: JSX.TargetedMouseEvent<HTMLAnchorElement>): void => {
        handleTooltipMouseEnter(event);
        if (isRouteNavigationItem(item)) {
            prefetchRoute(item.path);
        }
    }, [handleTooltipMouseEnter, item]);
    const handleRouteFocus = useCallback((event: JSX.TargetedFocusEvent<HTMLAnchorElement>): void => {
        handleTooltipFocus(event);
        if (isRouteNavigationItem(item)) {
            prefetchRoute(item.path);
        }
    }, [handleTooltipFocus, item]);
    const tooltipStyle: JSX.CSSProperties = {
        ...controlTransitionStyle,
        top: `${tooltipTop}px`,
    };
    const className = `relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-2 min-h-[40px] rounded-2xl transition-[background-color,border-color,box-shadow,color,opacity,transform] motion-reduce:transition-none group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-2xl focus-visible:z-10 decoration-none ${isUnavailable ? 'cursor-not-allowed opacity-60' : ''}`;
    const content = (
        <>
            <div
                className={`absolute inset-0 rounded-2xl transition-[opacity,transform,background-color] motion-reduce:transition-none pointer-events-none origin-left bg-black/[0.05] dark:bg-white/[0.05] ${isUnavailable ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
                style={controlTransitionStyle}
            />

            <item.icon aria-hidden="true" className={`relative z-10 w-4 h-4 transition-[color,filter] shrink-0 ${isActive ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : isUnavailable ? 'text-slate-300 dark:text-slate-600' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} strokeWidth={isActive ? 2 : 1.5} style={selectionTransitionStyle} />

            <div className={`relative z-10 overflow-hidden transition-[width,opacity] motion-reduce:transition-none ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`} style={selectionTransitionStyle}>
                <span className={`font-medium text-sm tracking-wide transition-colors whitespace-nowrap ${isActive ? 'text-slate-900 dark:text-white font-semibold' : isUnavailable ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} style={controlTransitionStyle}>
                    {label}
                </span>
                {isUnavailable && !isMinimized && (
                    <span id={unavailableId} className="block text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-600">
                        {item.unavailableReason}
                    </span>
                )}
            </div>

            {isUnavailable && (isMinimized || isMobile) && (
                <span id={unavailableId} className="sr-only">
                    {item.unavailableReason}
                </span>
            )}

            {isMinimized && !isMobile && (
                <div id={tooltipId} aria-hidden="true" className="fixed left-[104px] -translate-y-1/2 px-3 py-1.5 bg-white/95 dark:bg-void-800/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs font-bold tracking-wide rounded-2xl opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] motion-reduce:transition-none pointer-events-none shadow-2xl z-[100] flex w-max max-w-[18rem] items-center gap-2 whitespace-nowrap" style={tooltipStyle}>
                    <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_6px_rgba(0,224,160,0.6)] shrink-0 ${isUnavailable ? 'bg-slate-400/80' : 'bg-signal-500/80'}`}></span>
                    {isUnavailable ? `${label}: ${item.unavailableReason}` : label}
                </div>
            )}
        </>
    );

    if (isUnavailable) {
        return (
            <span
                aria-label={label}
                aria-describedby={unavailableId}
                aria-disabled="true"
                ref={elementRef as preact.Ref<HTMLSpanElement>}
                role="link"
                tabIndex={0}
                onMouseEnter={handleTooltipMouseEnter}
                onFocus={handleTooltipFocus}
                data-tour-id={item.tourId}
                data-nav-item
                className={className}
                style={controlTransitionStyle}
            >
                {content}
            </span>
        );
    }

    if (!isRouteNavigationItem(item)) {
        return (
            <a
                aria-label={label}
                aria-describedby={tooltipId}
                ref={elementRef as preact.Ref<HTMLAnchorElement>}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                onMouseEnter={handleTooltipMouseEnter}
                onFocus={handleTooltipFocus}
                onClick={isMobile ? onClose : undefined}
                data-tour-id={item.tourId}
                data-nav-item
                className={className}
                style={controlTransitionStyle}
            >
                {content}
            </a>
        );
    }

    return (
        <Link
            aria-label={label}
            aria-describedby={tooltipId}
            ref={elementRef as preact.Ref<HTMLAnchorElement>}
            to={item.path}
            onClick={isMobile ? onClose : undefined}
            onMouseEnter={handleRouteMouseEnter}
            onPointerDown={() => prefetchRoute(item.path)}
            onFocus={handleRouteFocus}
            aria-current={isActive ? "page" : undefined}
            data-tour-id={item.tourId}
            data-nav-item
            className={className}
            style={controlTransitionStyle}
        >
            {content}
        </Link>
    );
};
