import { describe, expect, test } from "vitest";
import type { QuizPayload } from "../../src/shared/types";
import { createGameState, joinPlayer, type GameState } from "../../src/worker/game/state";
import { isFinal, listEntries, podiumHasPlayers, podiumPlayers, rankPlayers } from "../../src/worker/game/ranking";

function make(scores: number[], topN = 10): GameState {
  const quiz: QuizPayload = {
    title: "T",
    topN,
    questions: [{ title: "q", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 0, points: 1 }],
  };
  let s = createGameState(quiz);
  scores.forEach((_, i) => {
    const r = joinPlayer(s, `p${i}`, { id: `id${i}`, token: `t${i}` });
    if (!r.ok) throw new Error("join failed");
    s = r.state;
  });
  // Inject scores via per-player answers on question 0 is limited to 1 point; use many questions instead.
  const max = Math.max(0, ...scores);
  const questions = Array.from({ length: max }, (_, i) => ({
    title: `q${i}`, imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string], correctIndex: 0 as const, points: 1,
  }));
  return {
    ...s,
    quiz: { ...s.quiz, questions },
    phase: { type: "results", stage: { kind: "list" } },
    players: s.players.map((p, i) => ({
      ...p,
      answers: Object.fromEntries(Array.from({ length: scores[i] }, (_, k) => [k, 0])),
    })),
  };
}

describe("rankPlayers", () => {
  test("90,90,80,70 → rank 1,1,3,4", () => {
    const r = rankPlayers(make([90, 90, 80, 70]));
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 4]);
    expect(r.map((x) => x.score)).toEqual([90, 90, 80, 70]);
  });
  test("同点は参加順", () => {
    const r = rankPlayers(make([5, 9, 9]));
    expect(r.map((x) => x.nickname)).toEqual(["p1", "p2", "p0"]);
  });
  test("listEntries は 4 位〜topN 位。topN=5 で rank 6 の人は含まない", () => {
    const s = make([7, 6, 5, 4, 3, 2, 1], 5);
    expect(listEntries(s).map((x) => x.rank)).toEqual([4, 5]);
  });
  test("同点で rank が 1 位から 4 位に飛ぶと、2 位・3 位の枠は空", () => {
    const s = make([9, 9, 9, 7]);
    expect(podiumHasPlayers(s, 1)).toBe(true);
    expect(podiumHasPlayers(s, 2)).toBe(false);
    expect(podiumHasPlayers(s, 3)).toBe(false);
    expect(podiumPlayers(s, 1)).toHaveLength(3);
  });
  test("isFinal: 0 人の list は true、1 人の list は false", () => {
    expect(isFinal(make([]))).toBe(true);
    expect(isFinal(make([3]))).toBe(false);
  });
});
