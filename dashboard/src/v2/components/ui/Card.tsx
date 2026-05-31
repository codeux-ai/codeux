import type { FunctionComponent, ComponentProps } from "preact";

export interface CardProps extends ComponentProps<"div"> {}

export const Card: FunctionComponent<CardProps> = ({ className = "", children, ...props }) => {
  return (
    <div
      className={`rounded-[var(--radius-ui)] border border-[color:var(--color-border-muted)] dark:border-white/[0.06] bg-white dark:bg-void-800 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
