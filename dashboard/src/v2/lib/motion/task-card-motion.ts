import { useLayoutEffect, useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import gsap from "gsap";
import { MOTION_TOKENS, INTERACTION_TOKENS } from "./tokens.js";

export function useTaskCardMotion(ref: RefObject<HTMLElement>, status: string, isReducedMotion: boolean, index: number = 0) {
  const isMounted = useRef(false);

  useLayoutEffect(() => {
    if (!ref.current) return;

    if (isReducedMotion) {
      gsap.set(ref.current, { opacity: 1, y: 0, clearProps: "transform" });
      return;
    }

    gsap.fromTo(ref.current,
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000, ease: INTERACTION_TOKENS.enterExit.ease, delay: index * (parseFloat(INTERACTION_TOKENS.listReorder.duration) / 1000) * 0.2, clearProps: "transform,opacity", overwrite: "auto" }
    );
  }, [isReducedMotion, index]);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (!ref.current) return;

    if (isReducedMotion) {
      gsap.set(ref.current, { boxShadow: '0 0 0 2px rgba(0, 224, 160, 0.4)' });
      setTimeout(() => {
        if (ref.current) gsap.set(ref.current, { clearProps: "boxShadow" });
      }, parseFloat(INTERACTION_TOKENS.controlFeedback.duration));
      return;
    }

    gsap.fromTo(ref.current,
      { scale: 1.02, boxShadow: '0 0 0 2px rgba(0, 224, 160, 0.4)' },
      { scale: 1, boxShadow: 'none', duration: parseFloat(INTERACTION_TOKENS.controlFeedback.duration) / 1000, ease: INTERACTION_TOKENS.controlFeedback.ease, clearProps: "boxShadow,transform", overwrite: "auto" }
    );
  }, [status, isReducedMotion]);
}

export function useTaskCardDragMotion(ref: RefObject<HTMLElement>, isDragging: boolean, isReducedMotion: boolean) {
  useEffect(() => {
    if (!ref.current) return;

    if (isReducedMotion) {
      if (isDragging) {
        gsap.set(ref.current, { opacity: 0.6, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' });
      } else {
        gsap.set(ref.current, { clearProps: 'boxShadow,opacity' });
      }
      return;
    }

    if (isDragging) {
      gsap.killTweensOf(ref.current);
      gsap.to(ref.current, {
        scale: 1.05,
        opacity: 0.6,
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        duration: parseFloat(INTERACTION_TOKENS.selectionMovement.duration) / 1000,
        ease: INTERACTION_TOKENS.selectionMovement.ease,
        overwrite: "auto",
      });
    } else {
      gsap.killTweensOf(ref.current);
      gsap.to(ref.current, {
        scale: 1,
        opacity: 1,
        boxShadow: 'none',
        duration: parseFloat(INTERACTION_TOKENS.selectionMovement.duration) / 1000,
        ease: MOTION_TOKENS.easing.bounce,
        clearProps: 'boxShadow,transform,opacity',
        overwrite: "auto",
      });
    }
  }, [isDragging, isReducedMotion]);
}
