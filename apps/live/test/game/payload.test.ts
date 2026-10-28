import { describe, expect, test } from "vitest";
import { quizPayloadSchema } from "../../src/worker/payload";

function question(over: Record<string, unknown> = {}) {
  return {
    title: "Q",
    imageUrl: null,
    choices: ["a", "b", "c", "d"],
    correctIndex: 0,
    points: 10,
    ...over,
  };
}
function payload(over: Record<string, unknown> = {}, n = 5) {
  return {
    title: "T",
    topN: 10,
    questions: Array.from({ length: n }, () => question()),
    ...over,
  };
}
const withChoices = (n: number) =>
  payload({ questions: Array.from({ length: 5 }, () => question({ choices: Array(n).fill("x") })) });

describe("quizPayloadSchema", () => {
  test("正常な payload は通る", () => expect(quizPayloadSchema.safeParse(payload()).success).toBe(true));
  test("4 択でない問題は拒否", () => {
    expect(quizPayloadSchema.safeParse(withChoices(3)).success).toBe(false);
    expect(quizPayloadSchema.safeParse(withChoices(5)).success).toBe(false);
  });
  test("問題数 4 と 16 は拒否、5 と 15 は通る", () => {
    expect(quizPayloadSchema.safeParse(payload({}, 4)).success).toBe(false);
    expect(quizPayloadSchema.safeParse(payload({}, 16)).success).toBe(false);
    expect(quizPayloadSchema.safeParse(payload({}, 5)).success).toBe(true);
    expect(quizPayloadSchema.safeParse(payload({}, 15)).success).toBe(true);
  });
  test("topN 3 は拒否、4 と 100 は通り 101 と小数は拒否", () => {
    expect(quizPayloadSchema.safeParse(payload({ topN: 3 })).success).toBe(false);
    expect(quizPayloadSchema.safeParse(payload({ topN: 4 })).success).toBe(true);
    expect(quizPayloadSchema.safeParse(payload({ topN: 100 })).success).toBe(true);
    expect(quizPayloadSchema.safeParse(payload({ topN: 101 })).success).toBe(false);
    expect(quizPayloadSchema.safeParse(payload({ topN: 5.5 })).success).toBe(false);
  });
  test("title の長さ", () => {
    expect(quizPayloadSchema.safeParse(payload({ title: "" })).success).toBe(false);
    expect(quizPayloadSchema.safeParse(payload({ title: "a".repeat(101) })).success).toBe(false);
  });
  test("問題 title・選択肢の長さ", () => {
    const bad = (q: Record<string, unknown>) => quizPayloadSchema.safeParse(payload({ questions: Array(5).fill(question(q)) })).success;
    expect(bad({ title: "" })).toBe(false);
    expect(bad({ title: "a".repeat(201) })).toBe(false);
    expect(bad({ choices: ["", "b", "c", "d"] })).toBe(false);
    expect(bad({ choices: ["a".repeat(51), "b", "c", "d"] })).toBe(false);
  });
  test("correctIndex は 0〜3", () => {
    const ok = (v: number) =>
      quizPayloadSchema.safeParse(payload({ questions: Array(5).fill(question({ correctIndex: v })) })).success;
    expect(ok(3)).toBe(true);
    expect(ok(4)).toBe(false);
    expect(ok(-1)).toBe(false);
  });
  test("points は整数 1〜1000", () => {
    const ok = (v: number) =>
      quizPayloadSchema.safeParse(payload({ questions: Array(5).fill(question({ points: v })) })).success;
    expect(ok(1)).toBe(true);
    expect(ok(1000)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(1001)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });
  test("imageUrl は https か null", () => {
    const ok = (v: unknown) =>
      quizPayloadSchema.safeParse(payload({ questions: Array(5).fill(question({ imageUrl: v })) })).success;
    expect(ok("https://example.com/a.png")).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok("http://example.com/a.png")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("not a url")).toBe(false);
  });
});
