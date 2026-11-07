import { useLayoutEffect, useRef } from "react";

const FIT_MAX_PX = 40;
const FIT_MIN_PX = 12;
const FIT_MAX_COLS = 4;

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
      for (let px = FIT_MAX_PX; px >= FIT_MIN_PX; px--) {
        el.style.fontSize = `${px}px`;
        for (let cols = 1; cols <= FIT_MAX_COLS; cols++) {
          el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
          if (fits()) return;
        }
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
