import { describe, expect, test } from "vitest";
import { listHeader } from "../../src/client/screen/list-header";

const e = (rank: number) => ({ rank, nickname: `n${rank}`, score: 0 });

describe("listHeader", () => {
  test("empty list", () => {
    expect(listHeader([], 0, 1)).toBe("4 位以下はいません");
  });
  test("a single page shows only the rank range", () => {
    expect(listHeader([e(4), e(6)], 0, 1)).toBe("4 位〜6 位");
  });
  test("when every row has the same rank, the range collapses to that rank", () => {
    expect(listHeader([e(43), e(43)], 1, 3)).toBe("43 位（2/3）");
    expect(listHeader([e(5), e(5)])).toBe("5 位");
  });
  test("several pages add the page number", () => {
    expect(listHeader([e(16), e(55)], 0, 3)).toBe("16 位〜55 位（1/3）");
    expect(listHeader([e(96)], 2, 3)).toBe("96 位（3/3）");
  });
  test("page arguments default to a single page", () => {
    expect(listHeader([e(4), e(5)])).toBe("4 位〜5 位");
  });
});
