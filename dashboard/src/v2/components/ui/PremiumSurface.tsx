import type { ComponentChildren, FunctionComponent, JSX } from "preact";
import { useRef } from "preact/hooks";
import gsap from "gsap";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";

interface PremiumSurfaceProps {
  children: ComponentChildren;
  accentHex: string;
  className?: string;
  hoverTint?: string;
  isSelected?: boolean;
  isOptimistic?: boolean;
  watermark?: string;
  showWave?: boolean;
  showBorder?: boolean;
  onClick?: JSX.MouseEventHandler<HTMLDivElement>;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  tabIndex?: number;
}

export const PremiumSurface: FunctionComponent<PremiumSurfaceProps> = ({
  children,
  accentHex,
  className = "",
  hoverTint = "group-hover:bg-signal-500/[0.03] dark:group-hover:bg-signal-500/[0.05]",
  isSelected = false,
  isOptimistic = false,
  watermark,
  showWave = true,
  showBorder = true,
  onClick,
  role,
  tabIndex,
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const interactive = Boolean(onClick);
  const resolvedRole = role ?? (interactive ? "button" : undefined);
  const resolvedTabIndex = tabIndex ?? (interactive ? 0 : undefined);

  const handleMouseMove: JSX.MouseEventHandler<HTMLDivElement> = (event) => {
    const element = surfaceRef.current;
    if (!element) return;

    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    gsap.to(element, {
      rotationY: x * 10,
      rotationX: -y * 8,
      z: 12,
      transformPerspective: 800,
      duration: 0.4,
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  const resetTilt = () => {
    if (!surfaceRef.current) return;
    gsap.to(surfaceRef.current, {
      rotationY: 0,
      rotationX: 0,
      z: 0,
      transformPerspective: 800,
      duration: 0.8,
      ease: "elastic.out(1, 0.5)",
      overwrite: "auto",
    });
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!interactive) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick?.(event as unknown as JSX.TargetedMouseEvent<HTMLDivElement>);
  };

  return (
    <div
      ref={surfaceRef}
      role={resolvedRole}
      tabIndex={resolvedTabIndex}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={resetTilt}
      onBlur={resetTilt}
      className={[
        "group relative flex flex-col overflow-hidden rounded-[1.75rem] bg-white/70 p-7 backdrop-blur-2xl",
        "shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900",
        interactive ? "cursor-pointer" : "cursor-default",
        isSelected
          ? "border border-ember-500/45 ring-1 ring-ember-500/18 shadow-[0_8px_30px_rgba(255,184,0,0.08)]"
          : "border border-black/[0.06] dark:border-white/[0.06]",
        isOptimistic ? "pointer-events-none border-2 border-dashed border-slate-300 opacity-60 dark:border-slate-600" : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{ transformStyle: "preserve-3d", willChange: "transform" }}
    >
      {watermark && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-5 -right-2 select-none font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.03] dark:text-white/[0.025]"
        >
          {watermark}
        </div>
      )}
      <div className={`pointer-events-none absolute inset-0 bg-transparent ${hoverTint} transition-colors duration-500`} />
      {showWave && <WaveFluid accentHex={accentHex} />}
      {showBorder && <BorderTrace accentHex={accentHex} />}
      {children}
    </div>
  );
};
