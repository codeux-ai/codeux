import { h, ComponentChildren, VNode, cloneElement, isValidElement, toChildArray } from "preact";
import { useEffect, useState, useId } from "preact/hooks";

export interface FieldWrapperProps {
  helperTextId?: string;
  label: string;
  error?: string;
  helperText?: ComponentChildren;
  children: ComponentChildren;
  htmlFor?: string;
  required?: boolean;
  forceTouch?: boolean;
  valid?: boolean;
}

export function FieldWrapper({ label, error, children, htmlFor, required, helperTextId, helperText, forceTouch, valid }: FieldWrapperProps) {
  const [shake, setShake] = useState(false);
  const [touched, setTouched] = useState(false);

  const generatedId = useId();
  const inputId = htmlFor ?? generatedId;
  const showError = (touched || !!forceTouch) && !!error;
  const errorId = `${inputId}-error`;
  const actualHelperId = helperText ? (helperTextId || `${inputId}-helper`) : helperTextId;

  const [previousError, setPreviousError] = useState<string | undefined>(undefined);
  const [previousShowError, setPreviousShowError] = useState<boolean>(false);

  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const [displayedError, setDisplayedError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let timer: any;

    if (showError && (error !== previousError || !previousShowError)) {
      setShake(true);
      timer = setTimeout(() => {
        setShake(false);
      }, 400); // Must be slightly longer than animation duration
      setPreviousError(error);
      setPreviousShowError(true);
    } else if (!showError) {
      if (previousError !== undefined) setPreviousError(undefined);
      if (previousShowError) setPreviousShowError(false);
    }

    return () => {
        if (timer) clearTimeout(timer);
    }
  }, [showError, error]); // ONLY depend on the current values to avoid re-triggering from state setter delays

  useEffect(() => {
    if (showError && error) {
      setDisplayedError(error);
      setIsVisible(true);
      setIsAnimatingIn(true);
      setIsFadingOut(false);
    } else if (!showError && isVisible) {
      setIsFadingOut(true);
      setIsAnimatingIn(false);
    }
  }, [error, showError, isVisible]);

  // Combine multiple aria-describedby ids if needed
  let ariaDescribedBy: string | undefined = undefined;
  const ids = [actualHelperId, showError ? errorId : undefined].filter(Boolean);
  if (ids.length > 0) {
    ariaDescribedBy = ids.join(' ');
  }

  // Clone children to append aria attributes if valid
  let idAssigned = false;
  const child = toChildArray(children).map(child => {
    if (!isValidElement(child)) return child;
    const existingOnBlur = (child as any)?.props?.onBlur;

    const childProps: any = {
      "aria-invalid": showError ? "true" : undefined,
      "aria-describedby": ariaDescribedBy || undefined,
      "aria-errormessage": showError ? errorId : undefined,
      "aria-required": required ? "true" : undefined,
      onBlur: (e: any) => {
        setTouched(true);
        existingOnBlur?.(e);
      },
      valid: !error ? valid : undefined,
    };

    if (!idAssigned) {
      childProps.id = inputId;
      idAssigned = true;
    }

    return cloneElement(child as VNode<any>, childProps);
  });

  return (
    <div class="flex flex-col mb-4">
      <label htmlFor={inputId} class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex gap-1">
        {label}
        {required && <span class="text-status-red" aria-hidden="true">*</span>}
        {required && <span class="sr-only">(Required)</span>}
      </label>
      <div
        class={`
          relative rounded-md
          ${shake && showError ? 'motion-safe:animate-form-shake' : ''}
          ${showError ? 'ring-1 ring-status-red transition-shadow duration-200 ease-in-out' : 'transition-shadow duration-200 ease-in-out'}
        `}
      >
        <div class={`
          [&_input]:transition-colors [&_input]:duration-200 [&_input]:ease-in-out
          [&_textarea]:transition-colors [&_textarea]:duration-200 [&_textarea]:ease-in-out
          ${showError ? '[&_input]:border-status-red [&_textarea]:border-status-red [&_input]:ring-status-red [&_textarea]:ring-status-red' : ''}
        `}>
          {child}
        </div>
      </div>
      <div class={`grid grid-cols-1 overflow-hidden relative ${helperText || displayedError ? 'mt-1.5' : ''}`}>
        {helperText && (
          <div
            id={actualHelperId}
            aria-hidden={isVisible}
            class={`
              col-start-1 row-start-1
              text-xs text-slate-500 dark:text-slate-400
              ${isVisible
                ? 'opacity-0 pointer-events-none'
                : 'opacity-100 visible'}
            `}
          >
            {helperText}
          </div>
        )}
        <p
          id={errorId}
          role="alert"
          aria-hidden={!isVisible}
          class={`col-start-1 row-start-1 text-xs font-medium text-status-red ${
            isAnimatingIn ? 'motion-safe:animate-form-slide-down' : ''
          } ${
            isFadingOut ? 'fading transition-opacity duration-150 opacity-0' : 'opacity-100'
          } ${!isVisible && !isFadingOut ? 'invisible' : 'visible'}`}
          style={isAnimatingIn ? { animationDelay: '50ms', animationFillMode: 'both' } : undefined}
          onAnimationEnd={() => setIsAnimatingIn(false)}
          onTransitionEnd={() => {
            if (isFadingOut) {
              setIsVisible(false);
              setIsFadingOut(false);
            }
          }}
        >
          {displayedError}
        </p>
      </div>
    </div>
  );
}
