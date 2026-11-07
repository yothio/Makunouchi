import { describe, expect, test } from "vitest";
import { fitCandidates } from "../../src/client/screen/useFitToBox";

describe("fitCandidates", () => {
  const all = fitCandidates();
  test("starts with the largest font and a single column", () => {
    expect(all[0]).toEqual({ px: 40, cols: 1 });
  });
  test("tries the fewest columns first at each font size, and larger fonts before smaller ones", () => {
    const expected = Array.from({ length: 40 - 12 + 1 }, (_, i) => 40 - i).flatMap((px) =>
      Array.from({ length: 8 }, (_, c) => ({ px, cols: c + 1 })),
    );
    expect(all).toEqual(expected);
  });
  test("ends with the floor font size and 8 columns, enough for ~117 rows on a projector", () => {
    expect(all.at(-1)).toEqual({ px: 12, cols: 8 });
  });
});
