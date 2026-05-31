import type { FunctionComponent, ComponentProps } from "preact";

export interface LabelProps extends ComponentProps<"label"> {
  // Label specific props can be added here
}

export const Label: FunctionComponent<LabelProps> = ({ className = "", children, ...props }) => {
  return (
    <label
      className={`mb-1.5 block text-sm font-semibold text-slate-900 dark:text-slate-100 ${className}`}
      {...props}
    >
      {children}
    </label>
  );
};
