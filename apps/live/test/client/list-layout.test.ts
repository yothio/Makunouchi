import { describe, expect, test } from "vitest";
import { LIST_PAGE_SIZE } from "../../src/worker/game/rules";
import { chooseListLayout, LIST_MIN_PX, type ListBox } from "../../src/client/screen/list-layout";

/** The list box on each projector size: 90vw x 66vh with a 1.2vw column gap (see styles.css). */
const screens = [
  { name: "1920x1080", box: { width: 1728, height: 712.8 }, colGap: 23.04 },
  { name: "1366x768", box: { width: 1229.4, height: 506.88 }, colGap: 16.39 },
  { name: "1280x720", box: { width: 1152, height: 475.2 }, colGap: 15.36 },
];

/** Independent re-check of "does this layout fit", written without using the module under test. */
const fitsBox = (n: number, px: number, cols: number, box: ListBox, colGap: number): boolean => {
  const rows = Math.ceil(n / cols);
  const height = rows * 1.6 * px + Math.max(0, rows - 1) * 0.2 * px;
  const colWidth = (box.width - (cols - 1) * colGap) / cols;
  // fixed part of a row 7.2em (rank 2.8 + score 3 + gaps 0.6 + padding 0.8) plus at least 6em for the name
  return height <= box.height && colWidth >= (7.2 + 6) * px;
};

describe.each(screens)("chooseListLayout on $name", ({ box, colGap }) => {
  const counts = Array.from({ length: LIST_PAGE_SIZE }, (_, i) => i + 1);

  test("every page size up to the page limit fits at 20px or larger", () => {
    for (const n of counts) {
      const layout = chooseListLayout(n, box, colGap);
      expect(layout, `n=${n}`).not.toBeNull();
      expect(layout!.px, `n=${n}`).toBeGreaterThanOrEqual(LIST_MIN_PX);
    }
  });

  test("the chosen layout really fits the box", () => {
    for (const n of counts) {
      const { px, cols } = chooseListLayout(n, box, colGap)!;
      expect(fitsBox(n, px, cols, box, colGap), `n=${n}`).toBe(true);
    }
  });

  test("the font never grows and the column count never shrinks as people are added", () => {
    let prev = chooseListLayout(1, box, colGap)!;
    for (const n of counts.slice(1)) {
      const cur = chooseListLayout(n, box, colGap)!;
      expect(cur.px, `n=${n}`).toBeLessThanOrEqual(prev.px);
      expect(cur.cols, `n=${n}`).toBeGreaterThanOrEqual(prev.cols);
      prev = cur;
    }
  });

  test("for 15-40 people, one more person never adds more than one column", () => {
    for (let n = 15; n < LIST_PAGE_SIZE; n++) {
      const a = chooseListLayout(n, box, colGap)!;
      const b = chooseListLayout(n + 1, box, colGap)!;
      expect(b.cols - a.cols, `n=${n}`).toBeLessThanOrEqual(1);
    }
  });

  test("a font larger than the minimum is only used if it still fits (no needless shrinking)", () => {
    for (const n of counts) {
      const { px, cols } = chooseListLayout(n, box, colGap)!;
      // one pixel larger must not fit in any allowed column count (up to 4)
      const larger = [1, 2, 3, 4].some((c) => fitsBox(n, px + 1, c, box, colGap));
      expect(larger && px < 40, `n=${n}`).toBe(false);
      expect(cols).toBeLessThanOrEqual(4);
    }
  });
});

describe("chooseListLayout edge cases", () => {
  const { box, colGap } = screens[2];
  test("nobody to show is a valid empty layout", () => {
    expect(chooseListLayout(0, box, colGap)).toMatchObject({ rows: 0 });
  });
  test("one person gets a large font in a single column", () => {
    expect(chooseListLayout(1, box, colGap)).toMatchObject({ cols: 1, rows: 1 });
  });
  test("far more people than a page cannot fit and is reported as null", () => {
    expect(chooseListLayout(200, box, colGap)).toBeNull();
  });
  test("a tiny box cannot fit anything", () => {
    expect(chooseListLayout(10, { width: 300, height: 100 }, 10)).toBeNull();
  });
});
