import type { FunctionComponent, ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import gsap from "gsap";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";

interface PremiumSurfaceProps {
    children: ComponentChildren;
    className?: string;
    accentHex?: string;
    hoverTint?: string; // e.g. "group-hover:bg-signal-500/[0.03]"
    isSelected?: boolean;
    isOptimistic?: boolean;
    onClick?: () => void;
    showWave?: boolean;
    showBorder?: boolean;
    watermark?: string;
    tilt?: boolean;
    tabIndex?: number;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

export const PremiumSurface: FunctionComponent<PremiumSurfaceProps> = ({
    children,
    className = "",
    accentHex,
    hoverTint = "group-hover:bg-signal-500/[0.03] dark:group-hover:bg-signal-500/[0.05]",
    isSelected = false,
    isOptimistic = false,
    onClick,
    showWave = true,
    showBorder = true,
    watermark,
    tilt = true,
    tabIndex,
    onMouseEnter,
    onMouseLeave,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (event: MouseEvent) => {
        if (!tilt || !cardRef.current) return;
        const element = cardRef.current;
        const bounds = element.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        
        gsap.to(element, {
            rotationY: x * 10,
            rotationX: -y * 8,
            y: -4,
            z: 12,
            scale: 1.01,
            transformPerspective: 800,
            duration: 0.4,
            ease: "power2.out",
            overwrite: "auto",
        });
    };

    const handleMouseEnter = () => {
        onMouseEnter?.();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onClick();
        }
    };

    const handleMouseLeave = () => {
        onMouseLeave?.();
        if (!cardRef.current) return;
        
        gsap.to(cardRef.current, {
            rotationY: 0,
            rotationX: 0,
            y: 0,
            z: 0,
            scale: 1,
            transformPerspective: 800,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
    };

    const baseClasses = `
        group relative flex flex-col
        bg-white/70 dark:bg-void-800/60
        backdrop-blur-2xl
        rounded-[1.75rem]
        p-7
        overflow-hidden
        transition-shadow duration-500
        ${onClick ? "cursor-pointer" : "cursor-default"}
        ${isSelected
          ? "border border-ember-500/45 shadow-[0_8px_30px_rgba(255,184,0,0.08)] ring-1 ring-ember-500/18"
          : "border border-black/[0.06] dark:border-white/[0.06] shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]"
        }
        ${isOptimistic ? "border-dashed border-2 border-slate-300 dark:border-slate-600 opacity-60 pointer-events-none" : ""}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2
    `;

    return (
        <div
            ref={cardRef}
            onClick={onClick}
            onKeyDown={handleKeyDown}
            onMouseMove={tilt ? handleMouseMove : undefined}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            tabIndex={tabIndex ?? (onClick ? 0 : undefined)}
            className={`${baseClasses} ${className}`}
            style={tilt ? { transformStyle: "preserve-3d", willChange: "transform" } : {}}
        >
            {/* Ghost watermark */}
            {watermark && (
                <div
                    aria-hidden="true"
                    className="absolute -bottom-5 -right-2 text-[7rem] font-black tracking-tighter
                               text-black/[0.03] dark:text-white/[0.025]
                               pointer-events-none select-none font-display leading-none"
                >
                    {watermark}
                </div>
            )}

            {/* Hover tint */}
            <div className={`absolute inset-0 transition-colors duration-300 pointer-events-none ${hoverTint}`} />

            {/* Wave + border trace */}
            {showWave && accentHex && <WaveFluid accentHex={accentHex} />}
            {showBorder && accentHex && <BorderTrace accentHex={accentHex} />}

            <div className="relative z-10 flex flex-col h-full">
                {children}
            </div>
        </div>
    );
};
