import re

with open("dashboard/src/v2/components/ui/Button.tsx", "r") as f:
    content = f.read()

# I will find the previousState useLayoutEffect and insert the new logic or replace it entirely.
old_effect = """  const previousState = useRef({ isPending, isSuccess, isError });
  useLayoutEffect(() => {
    if (!iconContainerRef.current) return;

    const prev = previousState.current;

    // Only animate if a state has changed
    if (prev.isPending !== isPending || prev.isSuccess !== isSuccess || prev.isError !== isError) {
      const activeIcon = iconContainerRef.current.querySelector('[data-active="true"]');
      if (activeIcon) {
        gsap.fromTo(
          activeIcon,
          { x: -4, scale: 0.6, opacity: 0 },
          { x: 0, scale: 1, opacity: 1, duration: gsapTokens.controlFeedback.duration, ease: "power2.out", clearProps: "all" }
        );
      }
    }

    previousState.current = { isPending, isSuccess, isError };
  }, [isPending, isSuccess, isError, durations.fast, reducedMotion]);"""

new_effect = """  const previousState = useRef({ isPending, isSuccess, isError });
  useLayoutEffect(() => {
    const prev = previousState.current;

    // Animate original icon container (if any)
    if (iconContainerRef.current && (prev.isPending !== isPending || prev.isSuccess !== isSuccess || prev.isError !== isError)) {
      const activeIcon = iconContainerRef.current.querySelector('[data-active="true"]');
      if (activeIcon) {
        gsap.fromTo(
          activeIcon,
          { x: -4, scale: 0.6, opacity: 0 },
          { x: 0, scale: 1, opacity: 1, duration: gsapTokens.controlFeedback.duration, ease: "power2.out", clearProps: "all" }
        );
      }
    }

    if (!reducedMotion) {
      if (isPending && !prev.isPending) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 0, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.fromTo(
            spinnerRef.current,
            { opacity: 0, scale: 0.7 },
            { opacity: 1, scale: 1, duration: durations.fast, ease: GSAP_EASINGS.spring }
          );
        }
      }

      if (isSuccess && !prev.isSuccess) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
        if (buttonRef.current) {
          const tl = gsap.timeline();
          tl.to(buttonRef.current, {
            boxShadow: "0 0 0 6px rgba(var(--accent-primary-rgb), 0.3)",
            duration: 0.2,
            ease: "power2.out",
          }).to(buttonRef.current, {
            boxShadow: "0 0 0 0px rgba(var(--accent-primary-rgb), 0)",
            duration: 0.2,
            ease: "power2.in",
          });
        }
      }

      if (isError && !prev.isError) {
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, scale: 0.7, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
        if (buttonRef.current) {
          gsap.to(buttonRef.current, {
            keyframes: [{ x: -5 }, { x: 4 }, { x: -3 }, { x: 2 }, { x: 0 }],
            duration: 0.3,
            ease: "none",
          });
        }
      }

      if (!isPending && !isSuccess && !isError && (prev.isPending || prev.isSuccess || prev.isError)) {
        // Restore label when returning to idle
        if (labelRef.current && spinnerRef.current) {
          gsap.to(labelRef.current, { opacity: 1, duration: durations.fast, ease: GSAP_EASINGS.smooth });
          gsap.to(spinnerRef.current, { opacity: 0, duration: durations.fast, ease: GSAP_EASINGS.smooth });
        }
      }
    } else {
      // If reduced motion, just ensure visibility states immediately without animation
      if (labelRef.current && spinnerRef.current) {
        labelRef.current.style.opacity = isPending ? "0" : "1";
        spinnerRef.current.style.opacity = isPending ? "1" : "0";
        spinnerRef.current.style.transform = isPending ? "scale(1)" : "scale(0.7)";
      }
    }

    previousState.current = { isPending, isSuccess, isError };
  }, [isPending, isSuccess, isError, durations.fast, reducedMotion]);"""

content = content.replace(old_effect, new_effect)

with open("dashboard/src/v2/components/ui/Button.tsx", "w") as f:
    f.write(content)
