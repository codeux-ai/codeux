export const FORM_CONTROL_BASE_CLASSES = `
  w-full
  bg-white dark:bg-void-900
  border border-slate-200 dark:border-white/10
  rounded-lg
  text-sm text-slate-900 dark:text-slate-100
  placeholder:text-slate-400 dark:placeholder:text-slate-500
  transition-all duration-200 motion-reduce:transition-none
  focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:border-signal-500
  hover:border-slate-300 dark:hover:border-white/20
  disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200 dark:disabled:hover:border-white/10
`;

export const FORM_CONTROL_INVALID_CLASSES = `
  border-status-red/50 dark:border-status-red/50
  focus-visible:ring-status-red/20 focus-visible:border-status-red
  hover:border-status-red/80 dark:hover:border-status-red/80
`;

export const FORM_CONTROL_READONLY_CLASSES = `
  bg-slate-50 dark:bg-void-800/50
  cursor-default
  focus-visible:ring-0 focus-visible:border-slate-200 dark:focus-visible:border-white/10
  hover:border-slate-200 dark:hover:border-white/10
`;

export function getFormControlClasses(state: { invalid?: boolean; disabled?: boolean; readOnly?: boolean; className?: string }) {
  const classes = [FORM_CONTROL_BASE_CLASSES];
  if (state.invalid) classes.push(FORM_CONTROL_INVALID_CLASSES);
  if (state.readOnly) classes.push(FORM_CONTROL_READONLY_CLASSES);
  if (state.className) classes.push(state.className);
  return classes.join(" ").replace(/\s+/g, " ").trim();
}
