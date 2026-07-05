import { useLayoutEffect, useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import gsap from "gsap";
import { useGsapInteractionTokens } from "./constants.js";

const STATUS_FEEDBACK_SHADOW = "0 0 0 2px var(--status-static-running-ring)";
const DRAG_SHADOW = "var(--shadow-drag-active)";

export function useTaskCardMotion(ref: RefObject<HTMLElement>, status: string, isReducedMotion: boolean, index: number = 0) {
  const isMounted = useRef(false);
  const tokens = useGsapInteractionTokens();

  useLayoutEffect(() => {
    if (!ref.current) return;

    if (isReducedMotion) {
      gsap.set(ref.current, { opacity: 1, y: 0, clearProps: "transform" });
      return;
    }

    gsap.fromTo(ref.current,
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: tokens.enterExit.duration, ease: tokens.enterExit.ease, delay: index * tokens.listReorder.duration * 0.2, clearProps: "transform,opacity", overwrite: "auto" }
    );
  }, [isReducedMotion, index, tokens.enterExit.duration, tokens.enterExit.ease, tokens.listReorder.duration]);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (!ref.current) return;

    if (isReducedMotion) {
      gsap.set(ref.current, { boxShadow: STATUS_FEEDBACK_SHADOW });
      setTimeout(() => {
        if (ref.current) gsap.set(ref.current, { clearProps: "boxShadow" });
      }, Math.max(tokens.controlFeedback.duration * 1000, 1));
      return;
    }

    gsap.fromTo(ref.current,
      { scale: 1.02, boxShadow: STATUS_FEEDBACK_SHADOW },
      { scale: 1, boxShadow: "none", duration: tokens.controlFeedback.duration, ease: tokens.controlFeedback.ease, clearProps: "boxShadow,transform", overwrite: "auto" }
    );
  }, [status, isReducedMotion, tokens.controlFeedback.duration, tokens.controlFeedback.ease]);
}

export function useTaskCardDragMotion(ref: RefObject<HTMLElement>, isDragging: boolean, isReducedMotion: boolean) {
  const tokens = useGsapInteractionTokens();

  useEffect(() => {
    if (!ref.current) return;

    if (isReducedMotion) {
      gsap.killTweensOf(ref.current);
      gsap.set(ref.current, { opacity: 1, scale: 1, clearProps: 'boxShadow,transform,opacity' });
      return;
    }

    if (isDragging) {
      gsap.killTweensOf(ref.current);
      gsap.to(ref.current, {
        scale: 1.05,
        opacity: 0.6,
        boxShadow: DRAG_SHADOW,
        duration: tokens.selectionMovement.duration,
        ease: tokens.selectionMovement.ease,
        overwrite: "auto",
      });
    } else {
      gsap.killTweensOf(ref.current);
      gsap.to(ref.current, {
        scale: 1,
        opacity: 1,
        boxShadow: 'none',
        duration: tokens.selectionMovement.duration,
        ease: tokens.inlineValidation.ease,
        clearProps: 'boxShadow,transform,opacity',
        overwrite: "auto",
      });
    }
  }, [isDragging, isReducedMotion, tokens.selectionMovement.duration, tokens.selectionMovement.ease, tokens.inlineValidation.ease]);
}
