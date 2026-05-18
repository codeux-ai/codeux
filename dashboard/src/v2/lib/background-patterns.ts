export type BackgroundPattern = import('../../types.js').BackgroundPattern;

const STROKE = 'rgba(255,255,255,0.07)';

const createSvgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export const BACKGROUND_PATTERNS: Record<BackgroundPattern, string> = {
  NONE: '',
  DIAGONAL_LINES: createSvgUrl(`<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M0 20L20 0M-5 5L5 -5M15 25L25 15" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  HORIZONTAL_LINES: createSvgUrl(`<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="M0 8h16" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  VERTICAL_LINES: createSvgUrl(`<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="M8 0v16" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  CROSSHATCH: createSvgUrl(`<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M10 0v20M0 10h20" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  DOTS: createSvgUrl(`<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="2" fill="${STROKE}"/></svg>`),
  DIAMONDS: createSvgUrl(`<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M10 0L20 10L10 20L0 10Z" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  HEXAGONS: createSvgUrl(`<svg width="28" height="28" xmlns="http://www.w3.org/2000/svg"><path d="M14 0l12.124 7v14L14 28l-12.124-7V7z" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  TRIANGLES: createSvgUrl(`<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg"><path d="M12 0L24 24H0Z" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  WAVES: createSvgUrl(`<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M0 20 Q 10 10 20 20 T 40 20" stroke="${STROKE}" stroke-width="1" fill="none"/></svg>`),
  NOISE: createSvgUrl(`<svg width="4" height="4" xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="1" fill="${STROKE}"/></svg>`)
};
