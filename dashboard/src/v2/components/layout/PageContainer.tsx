import type { ComponentChildren, FunctionComponent, JSX, Ref } from "preact";

const PAGE_CONTAINER_WIDTH = "max-w-[2400px]";

const pageContainerPadding = {
  overview: "px-4 py-12 md:px-20 md:py-24",
  standard: "px-4 py-24 md:px-20",
  section: "px-4 py-16 md:px-20",
  stats: "px-4 py-20 md:px-20",
  settings: "px-4 py-16 md:px-8 xl:px-12",
  agents: "px-4 py-14 md:px-16 lg:px-20",
  browser: "px-4 py-6 md:px-8",
  workbench: "px-4 py-12 md:px-20",
  chat: "px-4 py-12 md:px-20",
  sprintsEmpty: "px-4 py-12 md:px-20",
  none: "",
} as const;

type PageContainerPadding = keyof typeof pageContainerPadding;

type PageContainerProps = Omit<JSX.HTMLAttributes<HTMLElement>, "ref"> & {
  children: ComponentChildren;
  className?: string;
  containerRef?: Ref<HTMLElement>;
  padding?: PageContainerPadding;
};

export const PageContainer: FunctionComponent<PageContainerProps> = ({
  children,
  className = "",
  containerRef,
  padding = "standard",
  ...props
}) => {
  const classes = [
    "relative z-10 mx-auto flex w-full flex-col animate-in fade-in duration-200",
    PAGE_CONTAINER_WIDTH,
    pageContainerPadding[padding],
    className,
  ].filter(Boolean).join(" ");

  return (
    <main id="main-content" tabIndex={-1} {...props} ref={containerRef} className={classes}>
      {children}
    </main>
  );
};

