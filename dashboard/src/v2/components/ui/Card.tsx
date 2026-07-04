import type { FunctionComponent, ComponentProps } from "preact";

export interface CardProps extends ComponentProps<"div"> {}

export const Card: FunctionComponent<CardProps> = ({ className = "", children, ...props }) => {
  return (
    <div
      className={`rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] shadow-[var(--elevation-base)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow] duration-[150ms] motion-reduce:transition-none ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
