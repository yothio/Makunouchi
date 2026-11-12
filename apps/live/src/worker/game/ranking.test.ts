import { describe, expect, test } from "vitest";
import type { QuizPayload } from "../../shared/types";
import { createGameState, joinPlayer } from "./state";
import type { GameState } from "./types";
import { rankPlayers } from "./ranking";

const make = (scores: number[]): GameState => {
  const quiz: QuizPayload = {
    title: "T",
    questions: [{ title: "q", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 0 }],
  };
  let s = createGameState(quiz);
  scores.forEach((_, i) => {
    const r = joinPlayer(s, `p${i}`, { id: `id${i}`, token: `t${i}` });
    if (!r.ok) throw new Error("join failed");
    s = r.state;
  });
  const max = Math.max(0, ...scores);
  const questions = Array.from({ length: max }, (_, i) => ({
    title: `q${i}`,
    imageUrl: null,
    choices: ["a", "b", "c", "d"] as [string, string, string, string],
    correctIndex: 0 as const,
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
};

describe("rankPlayers", () => {
  test("90,90,80,70 → rank 1,1,3,4", () => {
    const r = rankPlayers(make([90, 90, 80, 70]));
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3, 4]);
    expect(r.map((x) => x.score)).toEqual([90, 90, 80, 70]);
  });
  test("100,90,90,90,80,80,70 → 1,2,2,2,5,5,7 で同点は参加順", () => {
    const r = rankPlayers(make([100, 90, 90, 90, 80, 80, 70]));
    expect(r.map((x) => x.rank)).toEqual([1, 2, 2, 2, 5, 5, 7]);
    expect(r.map((x) => x.nickname)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
    const shuffled = rankPlayers(make([80, 90, 70, 100, 90, 80, 90]));
    expect(shuffled.map((x) => [x.nickname, x.rank])).toEqual([
      ["p3", 1],
      ["p1", 2],
      ["p4", 2],
      ["p6", 2],
      ["p0", 5],
      ["p5", 5],
      ["p2", 7],
    ]);
  });
  test("同点は参加順", () => {
    const r = rankPlayers(make([5, 9, 9]));
    expect(r.map((x) => x.nickname)).toEqual(["p1", "p2", "p0"]);
  });
});
