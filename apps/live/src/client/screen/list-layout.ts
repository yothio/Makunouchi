export type ListBox = { width: number; height: number };
export type ListLayout = { px: number; cols: number; rows: number };

/** The projector is far from the audience: never go below this. Pages are sized (LIST_PAGE_SIZE) so it is enough. */
export const LIST_MIN_PX = 20;
export const LIST_MAX_PX = 40;
export const LIST_MAX_COLS = 4;

// Row dimensions in em. styles.css must use the same values; test/client/list-layout-css.test.ts checks it.
export const ROW_LINE_HEIGHT_EM = 1.3;
export const ROW_PAD_Y_EM = 0.15;
export const ROW_PAD_X_EM = 0.4;
/** gap between rank, name and score inside a row */
export const ROW_INNER_GAP_EM = 0.3;
/** gap between rows (the grid's row gap) */
export const ROW_GAP_EM = 0.2;
/** width of the rank ("120 位" at most) */
export const ROW_RANK_EM = 2.8;
/** width of the score ("15 点" at most; tabular digits) */
export const ROW_SCORE_EM = 3;

export const ROW_HEIGHT_EM = ROW_LINE_HEIGHT_EM + 2 * ROW_PAD_Y_EM;
/** rank + score + the two inner gaps + the left / right padding of one row */
export const ROW_FIXED_WIDTH_EM = ROW_RANK_EM + ROW_SCORE_EM + 2 * ROW_INNER_GAP_EM + 2 * ROW_PAD_X_EM;
/** the nickname gets at least this much (about 6 full-width characters); longer names are cut with an ellipsis */
export const NAME_MIN_WIDTH_EM = 6;

const fits = (count: number, px: number, cols: number, box: ListBox, colGapPx: number): boolean => {
  const rows = Math.ceil(count / cols);
  const height = rows * ROW_HEIGHT_EM * px + Math.max(0, rows - 1) * ROW_GAP_EM * px;
  const colWidth = (box.width - (cols - 1) * colGapPx) / cols;
  return height <= box.height && colWidth >= (ROW_FIXED_WIDTH_EM + NAME_MIN_WIDTH_EM) * px;
};

/**
 * Picks the largest font (LIST_MAX_PX down to LIST_MIN_PX) that fits `count` rows in the box and, for that font,
 * the fewest columns (up to LIST_MAX_COLS). Rows have a constant height (names never wrap), so this is computed,
 * not measured. Returns null when even the minimum font does not fit.
 */
export const chooseListLayout = (count: number, box: ListBox, colGapPx: number): ListLayout | null => {
  if (count <= 0) return { px: LIST_MAX_PX, cols: 1, rows: 0 };
  for (let px = LIST_MAX_PX; px >= LIST_MIN_PX; px--) {
    for (let cols = 1; cols <= LIST_MAX_COLS; cols++) {
      if (fits(count, px, cols, box, colGapPx)) return { px, cols, rows: Math.ceil(count / cols) };
    }
  }
  return null;
};
