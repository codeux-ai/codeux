import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";

/**
 * SVG sparkline with smooth cubic bezier curves (tension 0.35).
 * Draws on mount via GSAP stroke-dashoffset animation.
 * On hover (detected via closest `.group`): replays from the start and adds a glow.
 */
export const Sparkline: FunctionComponent<{ points: number[]; color: string; className?: string; ariaLabel?: string }> = ({
    points,
    color,
    className = "absolute bottom-0 left-0 h-20 w-full pointer-events-none",
    ariaLabel,
}) => {
    const isReducedMotion = useReducedMotion();
    const tokens = useGsapInteractionTokens();

    const pathRef = useRef<SVGPathElement>(null);
    const svgRef  = useRef<SVGSVGElement>(null);

    const hasPoints = points.length > 0;
    const max = hasPoints ? Math.max(...points) : 0;
    const min = hasPoints ? Math.min(...points) : 0;
    const range = max - min || 1;

    // Smooth cubic bezier path (tension 0.35)
    const pathD = hasPoints ? points.map((p, i) => {
        const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
        const y = 100 - ((p - min) / range) * 80;
        if (i === 0) return `M ${x} ${y}`;
        const prevX = points.length === 1 ? 50 : ((i - 1) / (points.length - 1)) * 100;
        const prevY = 100 - ((points[i - 1] - min) / range) * 80;
        const dx = x - prevX;
        return `C ${prevX + dx * 0.35} ${prevY} ${x - dx * 0.35} ${y} ${x} ${y}`;
    }).join(' ') : "";

    const gradId = `sg-${color.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    const applyDrawState = (animate: boolean) => {
        if (!pathRef.current || !pathRef.current.getTotalLength) return;
        const len = pathRef.current.getTotalLength();
        gsap.killTweensOf(pathRef.current);
        if (isReducedMotion) {
            gsap.set(pathRef.current, { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 });
            return;
        }
        gsap.set(pathRef.current, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len });
        if (animate) {
            gsap.to(pathRef.current, { strokeDashoffset: 0, duration: tokens.listReveal.duration, ease: tokens.listReveal.ease, delay: tokens.controlFeedback.duration });
            return;
        }
        gsap.set(pathRef.current, { strokeDashoffset: 0 });
    };

    // Recompute the path contract whenever the rendered line changes.
    useLayoutEffect(() => {
        if (!pathD) return;
        applyDrawState(true);
        return () => {
            if (pathRef.current) {
                gsap.killTweensOf(pathRef.current);
            }
        };
    }, [pathD, isReducedMotion, tokens.listReveal.duration, tokens.listReveal.ease, tokens.controlFeedback.duration]);

    // Hover: replay from the start + glow the whole SVG
    useEffect(() => {
        const group = svgRef.current?.closest('.group') as HTMLElement | null;
        if (!group || isReducedMotion) return;

        const onEnter = () => {
            if (!pathRef.current || !svgRef.current) return;
            applyDrawState(false);
            const len = pathRef.current.getTotalLength();
            gsap.fromTo(pathRef.current, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: tokens.controlFeedback.duration, ease: tokens.controlFeedback.ease });
            gsap.to(svgRef.current, {
                filter: `drop-shadow(0 0 5px ${color})`,
                opacity: 0.55,
                duration: tokens.controlFeedback.duration,
            });
        };

        const onLeave = () => {
            if (!svgRef.current) return;
            gsap.to(svgRef.current, {
                filter: 'none',
                opacity: 0.2,
                duration: tokens.controlFeedback.duration,
            });
        };

        group.addEventListener('mouseenter', onEnter);
        group.addEventListener('mouseleave', onLeave);
        return () => {
            group.removeEventListener('mouseenter', onEnter);
            group.removeEventListener('mouseleave', onLeave);
            if (pathRef.current) gsap.killTweensOf(pathRef.current);
            if (svgRef.current) gsap.killTweensOf(svgRef.current);
        };
    }, [color, isReducedMotion, tokens.controlFeedback.duration, tokens.controlFeedback.ease]);

    if (!hasPoints) {
        return null;
    }

    return (
        <svg
            ref={svgRef}
            className={className}
            style={{ opacity: isReducedMotion ? 0.32 : 0.2 }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role={ariaLabel ? "img" : undefined}
            aria-label={ariaLabel}
            aria-hidden={ariaLabel ? undefined : "true"}
            data-reduced-motion={isReducedMotion ? "true" : "false"}
        >
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.55" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            {/* Area fill */}
            <path d={`${pathD} L 100 100 L 0 100 Z`} fill={`url(#${gradId})`} />
            {/* Smooth line */}
            <path
                ref={pathRef}
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};
