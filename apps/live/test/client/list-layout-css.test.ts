import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  NAME_MIN_WIDTH_EM,
  ROW_FIXED_WIDTH_EM,
  ROW_GAP_EM,
  ROW_HEIGHT_EM,
  ROW_INNER_GAP_EM,
  ROW_LINE_HEIGHT_EM,
  ROW_PAD_X_EM,
  ROW_PAD_Y_EM,
  ROW_RANK_EM,
  ROW_SCORE_EM,
} from "../../src/client/screen/list-layout";

const css = readFileSync(new URL("../../src/client/styles.css", import.meta.url), "utf8");

/** The declarations of the (single) rule with exactly this selector. */
const rule = (selector: string): Map<string, string> => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`rule not found: ${selector}`);
  const decls = new Map<string, string>();
  for (const part of match[1].split(";")) {
    const i = part.indexOf(":");
    if (i > 0) decls.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return decls;
};
const em = (value: string | undefined): number => {
  const m = /^([\d.]+)em$/.exec(value ?? "");
  if (!m) throw new Error(`not an em value: ${value}`);
  return Number(m[1]);
};

describe("list-layout constants match styles.css", () => {
  const row = rule(".host-list-grid li");
  const grid = rule(".host-list-grid");

  test("line-height and vertical padding give ROW_HEIGHT_EM", () => {
    expect(Number(row.get("line-height"))).toBe(ROW_LINE_HEIGHT_EM);
    const [padY] = (row.get("padding") ?? "").split(/\s+/);
    expect(em(padY)).toBe(ROW_PAD_Y_EM);
    expect(ROW_HEIGHT_EM).toBeCloseTo(ROW_LINE_HEIGHT_EM + 2 * ROW_PAD_Y_EM, 10);
  });

  test("the gap between rows is ROW_GAP_EM", () => {
    const [rowGap] = (grid.get("gap") ?? "").split(/\s+/);
    expect(em(rowGap)).toBe(ROW_GAP_EM);
  });

  test("horizontal padding, the gap between rank / name / score and the rank width add up to the fixed width", () => {
    const [, padX] = (row.get("padding") ?? "").split(/\s+/);
    expect(em(padX)).toBe(ROW_PAD_X_EM);
    expect(em(row.get("gap"))).toBe(ROW_INNER_GAP_EM);
    expect(em(rule(".host-list-grid .host-rank").get("width"))).toBe(ROW_RANK_EM);
    expect(ROW_FIXED_WIDTH_EM).toBeCloseTo(ROW_RANK_EM + ROW_SCORE_EM + 2 * ROW_INNER_GAP_EM + 2 * ROW_PAD_X_EM, 10);
  });

  test("the name is a single ellipsised line, the score does not shrink and the list never scrolls", () => {
    const name = rule(".host-list-grid .host-name");
    expect(name.get("white-space")).toBe("nowrap");
    expect(name.get("text-overflow")).toBe("ellipsis");
    expect(rule(".host-list-grid .host-score").get("flex")).toBe("none");
    expect(grid.get("overflow")).toBe("hidden");
  });

  test("the name keeps a sensible minimum width", () => {
    expect(NAME_MIN_WIDTH_EM).toBeGreaterThanOrEqual(6);
  });
});
