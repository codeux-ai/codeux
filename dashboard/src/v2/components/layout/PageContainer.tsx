import type { ComponentChildren, FunctionComponent, JSX, Ref } from "preact";

const PAGE_CONTAINER_WIDTH = "max-w-[1600px] xl:max-w-[1800px]";

const pageContainerPadding = {
  overview: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12 md:py-24",
  standard: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-24",
  section: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-16",
  stats: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-20",
  settings: "px-4 sm:px-6 md:px-8 xl:px-12 py-16",
  agents: "px-4 sm:px-6 md:px-8 lg:px-16 xl:px-20 py-14",
  browser: "px-4 sm:px-6 md:px-8 py-6",
  workbench: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12",
  chat: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12",
  sprintsEmpty: "px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-12",
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
    "relative z-10 mx-auto flex w-full flex-col animate-in fade-in duration-200 motion-reduce:animate-none",
    PAGE_CONTAINER_WIDTH,
    pageContainerPadding[padding],
    className,
  ].filter(Boolean).join(" ");

  return (
    <div {...props} ref={containerRef as any} className={classes}>
      {children}
    </div>
  );
};

