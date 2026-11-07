import { describe, expect, test } from "vitest";
import { formatHistoryEntry } from "../../src/client/guest/history";

describe("formatHistoryEntry", () => {
  test("a correct answer shows the question number, the choice label and ○", () => {
    expect(formatHistoryEntry({ index: 0, choice: 1, correct: true })).toEqual({ question: "問 1", choice: "B", mark: "○" });
  });
  test("a wrong answer shows ×", () => {
    expect(formatHistoryEntry({ index: 1, choice: 2, correct: false })).toEqual({ question: "問 2", choice: "C", mark: "×" });
  });
  test("no answer shows 未回答 and ×", () => {
    expect(formatHistoryEntry({ index: 2, choice: null, correct: false })).toEqual({ question: "問 3", choice: "未回答", mark: "×" });
  });
  test("covers all four choices", () => {
    expect([0, 1, 2, 3].map((c) => formatHistoryEntry({ index: 0, choice: c as 0 | 1 | 2 | 3, correct: false }).choice)).toEqual(["A", "B", "C", "D"]);
  });
});
