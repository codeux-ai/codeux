import type { ComponentChildren, FunctionComponent, JSX, Ref } from "preact";

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
};

export const PageContainer: FunctionComponent<PageContainerProps> = ({
  children,
  className = "",
  containerRef,
  padding = "standard",
  as = "div",
  ...props
}) => {
  const classes = [
    "relative z-10 mx-auto flex w-full flex-col animate-in fade-in duration-200 motion-reduce:animate-none",
    PAGE_CONTAINER_WIDTH,
    pageContainerPadding[padding],
    className,
  ].filter(Boolean).join(" ");

  const Component = as;

  return (
    <Component {...props} ref={containerRef as any} className={classes}>
      {children}
    </Component>
  );
};

