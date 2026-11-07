import { useLayoutEffect, useRef } from "react";
import { chooseListLayout, LIST_MAX_COLS, LIST_MIN_PX } from "./list-layout";

/** Mirrors the list's max-height in styles.css (100vh - 34vh) for the unlikely case the computed value is unreadable. */
const FALLBACK_HEIGHT_RATIO = 0.66;

/**
 * Applies the font size and column count that `chooseListLayout` computes for `count` rows to the list element.
 * Rows have a constant height (names are cut with an ellipsis, never wrapped), so nothing is measured per
 * candidate. The list never scrolls: if nothing fits at the minimum font the minimum is applied (pages are sized
 * so that does not happen). Re-computed on window resize.
 */
export const useFitToBox = (count: number) => {
  const ref = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const style = getComputedStyle(el);
      const maxHeight = parseFloat(style.maxHeight);
      const colGap = parseFloat(style.columnGap);
      const box = {
        width: el.clientWidth,
        height: Number.isFinite(maxHeight) ? maxHeight : window.innerHeight * FALLBACK_HEIGHT_RATIO,
      };
      const layout = chooseListLayout(count, box, Number.isFinite(colGap) ? colGap : 0);
      el.style.fontSize = `${layout?.px ?? LIST_MIN_PX}px`;
      el.style.gridTemplateColumns = `repeat(${layout?.cols ?? LIST_MAX_COLS}, minmax(0, 1fr))`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [count]);

  return ref;
};
