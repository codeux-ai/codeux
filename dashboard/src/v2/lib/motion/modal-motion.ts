import { GSAP_INTERACTION_TOKENS } from "./constants.js";

export const MODAL_MOTION = {
  entry: {
    duration: GSAP_INTERACTION_TOKENS.enterExit.duration,
    ease: "power4.out",
    yStart: 20,
    yEnd: 0,
    opacityStart: 0,
    opacityEnd: 1,
    scaleStart: 0.985,
    scaleEnd: 1,
    filterStart: "blur(14px)",
    filterEnd: "blur(0px)"
  },
  exit: {
    duration: GSAP_INTERACTION_TOKENS.enterExit.duration,
    ease: "power3.in",
    yEnd: 10,
    opacityEnd: 0,
    scaleEnd: 0.985,
    filterEnd: "blur(14px)"
  },
  backdrop: {
    duration: GSAP_INTERACTION_TOKENS.enterExit.duration,
    ease: GSAP_INTERACTION_TOKENS.enterExit.ease
  },
  collapse: {
    duration: GSAP_INTERACTION_TOKENS.expansionCollapse.duration,
    ease: GSAP_INTERACTION_TOKENS.expansionCollapse.ease
  },
  overlay: {
    entry: GSAP_INTERACTION_TOKENS.enterExit.duration,
    entryEase: GSAP_INTERACTION_TOKENS.enterExit.ease,
    exit: GSAP_INTERACTION_TOKENS.controlFeedback.duration,
    exitEase: GSAP_INTERACTION_TOKENS.controlFeedback.ease,
    cardEntry: GSAP_INTERACTION_TOKENS.listReveal.duration,
    cardEntryEase: "power4.out"
  },
  feedback: {
    duration: GSAP_INTERACTION_TOKENS.asyncFeedback.duration,
    ease: GSAP_INTERACTION_TOKENS.asyncFeedback.ease,
    yStart: -10,
    yEnd: 0,
    scaleStart: 0.98,
    scaleEnd: 1
  },
  dropdown: {
    duration: GSAP_INTERACTION_TOKENS.expansionCollapse.duration,
    ease: GSAP_INTERACTION_TOKENS.expansionCollapse.ease,
    yStart: -8,
    yEnd: 0,
    opacityStart: 0,
    opacityEnd: 1,
    scaleStart: 0.96,
    scaleEnd: 1
  },
  panel: {
    duration: GSAP_INTERACTION_TOKENS.enterExit.duration,
    ease: "power4.out",
    xStart: 20,
    xEnd: 0,
    opacityStart: 0,
    opacityEnd: 1
  },
  fieldStagger: {
    stagger: 0.07,
    delay: GSAP_INTERACTION_TOKENS.controlFeedback.duration,
    duration: GSAP_INTERACTION_TOKENS.listReveal.duration,
    ease: GSAP_INTERACTION_TOKENS.listReveal.ease,
    yStart: 18
  }
};
