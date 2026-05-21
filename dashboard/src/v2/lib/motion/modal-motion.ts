export const MODAL_MOTION = {
  entry: {
    duration: 0.45,
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
    duration: 0.3,
    ease: "power3.in",
    yEnd: 10,
    opacityEnd: 0,
    scaleEnd: 0.985,
    filterEnd: "blur(14px)"
  },
  backdrop: {
    duration: 0.3,
    ease: "power2.out"
  },
  collapse: {
    duration: 0.4,
    ease: "power4.inOut"
  },
  overlay: {
    entry: 0.3,
    entryEase: "power2.out",
    exit: 0.2,
    exitEase: "power2.in",
    cardEntry: 0.6,
    cardEntryEase: "power4.out"
  },
  feedback: {
    duration: 0.4,
    ease: "power3.out",
    yStart: -10,
    yEnd: 0,
    scaleStart: 0.98,
    scaleEnd: 1
  },
  dropdown: {
    duration: 0.3,
    ease: "power2.out",
    yStart: -8,
    yEnd: 0,
    opacityStart: 0,
    opacityEnd: 1,
    scaleStart: 0.96,
    scaleEnd: 1
  },
  panel: {
    duration: 0.4,
    ease: "power4.out",
    xStart: 20,
    xEnd: 0,
    opacityStart: 0,
    opacityEnd: 1
  },
  fieldStagger: {
    stagger: 0.07,
    delay: 0.25,
    duration: 0.45,
    ease: "power3.out",
    yStart: 18
  }
};
