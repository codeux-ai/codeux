import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";

/**
 * SVG sparkline with smooth cubic bezier curves (tension 0.35).
 * Draws on mount via GSAP stroke-dashoffset animation.
 * On hover (detected via closest `.group`): re-draws from midpoint + adds drop-shadow glow.
 */
export const Sparkline: FunctionComponent<{ points: number[]; color: string }> = ({ points, color }) => {
    const pathRef = useRef<SVGPathElement>(null);
    const svgRef  = useRef<SVGSVGElement>(null);

    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = max - min || 1;

    // Smooth cubic bezier path (tension 0.35)
    const pathD = points.map((p, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 100 - ((p - min) / range) * 80;
        if (i === 0) return `M ${x} ${y}`;
        const prevX = ((i - 1) / (points.length - 1)) * 100;
        const prevY = 100 - ((points[i - 1] - min) / range) * 80;
        const dx = x - prevX;
        return `C ${prevX + dx * 0.35} ${prevY} ${x - dx * 0.35} ${y} ${x} ${y}`;
    }).join(' ');

    const gradId = `sg-${color.replace('#', '')}`;

    // Mount: set initial dash state before paint, then animate
    useLayoutEffect(() => {
        if (!pathRef.current) return;
        const len = pathRef.current.getTotalLength();
        gsap.set(pathRef.current, { strokeDasharray: len, strokeDashoffset: len });
        gsap.to(pathRef.current, { strokeDashoffset: 0, duration: 1.4, ease: "power3.inOut", delay: 0.4 });
    }, []);

    // Hover: re-draw from mid-point + glow the whole SVG
    useEffect(() => {
        const group = svgRef.current?.closest('.group') as HTMLElement | null;
        if (!group) return;

        const onEnter = () => {
            if (!pathRef.current || !svgRef.current) return;
            const len = pathRef.current.getTotalLength();
            gsap.fromTo(pathRef.current,
                { strokeDashoffset: len * 0.5 },
                { strokeDashoffset: 0, duration: 0.85, ease: "power2.out" }
            );
            gsap.to(svgRef.current, {
                filter: `drop-shadow(0 0 5px ${color})`,
                opacity: 0.55,
                duration: 0.4,
            });
        };

        const onLeave = () => {
            if (!svgRef.current) return;
            gsap.to(svgRef.current, {
                filter: 'none',
                opacity: 0.2,
                duration: 0.5,
            });
        };

        group.addEventListener('mouseenter', onEnter);
        group.addEventListener('mouseleave', onLeave);
        return () => {
            group.removeEventListener('mouseenter', onEnter);
            group.removeEventListener('mouseleave', onLeave);
        };
    }, [color]);

    return (
        <svg
            ref={svgRef}
            className="absolute bottom-0 left-0 w-full h-20 pointer-events-none"
            style={{ opacity: 0.2 }}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
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
