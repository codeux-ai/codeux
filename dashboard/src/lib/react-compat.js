export { default } from "preact/compat";
export * from "preact/hooks";
export {
  Children,
  Component,
  Fragment,
  PureComponent,
  StrictMode,
  Suspense,
  SuspenseList,
  cloneElement,
  createContext,
  createElement,
  createFactory,
  createPortal,
  createRef,
  findDOMNode,
  flushSync,
  forwardRef,
  hydrate,
  isValidElement,
  lazy,
  memo,
  render,
  startTransition,
  unmountComponentAtNode,
  unstable_batchedUpdates,
  useDeferredValue,
  useInsertionEffect,
  useSyncExternalStore,
  useTransition,
  version,
} from "preact/compat";

// React 19 libraries may probe for `React.use` even when they can operate
// without it. Exporting the symbol avoids bundler warnings under Preact compat.
export const use = undefined;
