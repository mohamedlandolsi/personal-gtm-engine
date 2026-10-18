// The console's one motion moment (gtm-console-ui section 8): a decision landing.
// Web Animations ignore the CSS reduced-motion override in globals.css, so every
// animation asks here first and runs with a zero duration when motion is reduced.

export const CHIP_FADE_MS = 150;
export const ROW_COLLAPSE_MS = 180;

export function motionMs(ms: number): number {
  if (typeof window === "undefined") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}
