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
  }
};
