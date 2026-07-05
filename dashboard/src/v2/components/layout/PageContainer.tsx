import { useMemo } from "preact/hooks";
import type { ComponentChildren, FunctionComponent, JSX, Ref } from "preact";
import { useInteractionTokens } from "../../lib/motion/index.js";

// Fullscreen: containers span the full available width with no fixed cap.
const PAGE_CONTAINER_WIDTH = "max-w-none";

// Consistent horizontal rhythm across every page, with a unified top offset so
// page intro sections all start at the same distance from the top nav.
const PAGE_CONTAINER_X = "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16";
const PAGE_CONTAINER_Y = "py-10 md:py-14";

const pageContainerPadding = {
  overview: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  standard: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  section: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  stats: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  settings: `px-4 sm:px-6 md:px-8 xl:px-12 ${PAGE_CONTAINER_Y}`,
  agents: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  browser: "px-4 sm:px-6 md:px-8 py-6",
  workbench: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  chat: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  sprintsEmpty: `${PAGE_CONTAINER_X} ${PAGE_CONTAINER_Y}`,
  none: "",
} as const;

type PageContainerPadding = keyof typeof pageContainerPadding;

type PageContainerProps = Omit<JSX.HTMLAttributes<HTMLElement>, "ref"> & {
  children: ComponentChildren;
  className?: string;
  containerRef?: Ref<HTMLElement>;
  padding?: PageContainerPadding;
  as?: "div" | "main";
  id?: string;
  "data-focus-fallback"?: string;
};

function isCssProperties(style: JSX.HTMLAttributes<HTMLElement>["style"]): style is JSX.CSSProperties {
  return typeof style === "object" && style !== null && !("peek" in style) && !("subscribe" in style);
}

export const PageContainer: FunctionComponent<PageContainerProps> = ({
  children,
  className = "",
  containerRef,
  padding = "standard",
  as = "div",
  "aria-label": ariaLabel,
  "data-focus-fallback": dataFocusFallback,
  role,
  tabIndex,
  style,
  ...props
}) => {
  const interactionTokens = useInteractionTokens();
  const classes = [
    "relative z-10 mx-auto flex w-full flex-col animate-in fade-in motion-reduce:animate-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50",
    PAGE_CONTAINER_WIDTH,
    pageContainerPadding[padding],
    className,
  ].filter(Boolean).join(" ");
  const transitionStyle = useMemo<JSX.CSSProperties>(() => ({
    ...(isCssProperties(style) ? style : {}),
    animationDuration: interactionTokens.enterExit.duration,
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  }), [interactionTokens.controlFeedback.duration, interactionTokens.controlFeedback.ease, interactionTokens.enterExit.duration, style]);

  const Component = as;

  return (
    <Component
      {...props}
      aria-label={ariaLabel ?? "Page content"}
      data-focus-fallback={dataFocusFallback ?? ""}
      ref={containerRef as any}
      role={role ?? (as === "div" ? "region" : undefined)}
      tabIndex={tabIndex ?? -1}
      className={classes}
      style={transitionStyle}
    >
      {children}
    </Component>
  );
};
