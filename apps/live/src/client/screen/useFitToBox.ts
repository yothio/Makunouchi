import { useLayoutEffect, useRef } from "react";

const FIT_MAX_PX = 40;
const FIT_MIN_PX = 12;
// Up to ~117 rows (ranks 4..120) must fit a 16:9 projector without anyone operating it, so allow many columns.
const FIT_MAX_COLS = 8;

export type FitCandidate = { px: number; cols: number };

/** Layouts to try in order: the largest font first and, for each font size, the fewest columns first. */
export const fitCandidates = (): FitCandidate[] => {
  const candidates: FitCandidate[] = [];
  for (let px = FIT_MAX_PX; px >= FIT_MIN_PX; px--) {
    for (let cols = 1; cols <= FIT_MAX_COLS; cols++) candidates.push({ px, cols });
  }
  return candidates;
};

/**
 * Measure-and-fit for a grid list: try the largest font first and the fewest columns for it, and
 * only if nothing fits at the floor font size fall back to a visible scroll. `entries` is the data
 * rendered inside the element; re-fits whenever it changes.
 */
export const useFitToBox = (entries: unknown) => {
  const ref = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = () => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth;
    const fit = () => {
      el.style.overflowY = "hidden";
      for (const { px, cols } of fitCandidates()) {
        el.style.fontSize = `${px}px`;
        el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        if (fits()) return;
      }
      el.style.overflowY = "auto"; // cannot fit even at the floor: make the overflow visible and scrollable
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // `entries` is not read in the effect but drives the DOM being measured: re-fit whenever it changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [entries]);

  return ref;
};
