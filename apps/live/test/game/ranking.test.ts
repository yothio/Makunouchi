import { describe, expect, test } from "vitest";
import type { QuizPayload } from "../../src/shared/types";
import { createGameState, joinPlayer } from "../../src/worker/game/state";
import type { GameState } from "../../src/worker/game/types";
import { isFinal, listEntries, listPageCount, listPageEntries, podiumHasPlayers, podiumPlayers, rankPlayers } from "../../src/worker/game/ranking";

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
  // Inject scores via per-player answers on question 0 is limited to 1 point; use many questions instead.
  const max = Math.max(0, ...scores);
  const questions = Array.from({ length: max }, (_, i) => ({
    title: `q${i}`, imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string], correctIndex: 0 as const,
  }));
  return {
    ...s,
    quiz: { ...s.quiz, questions },
    phase: { type: "results", stage: { kind: "list", page: 0 } },
    players: s.players.map((p, i) => ({
      ...p,
      answers: Object.fromEntries(Array.from({ length: scores[i] }, (_, k) => [k, 0])),
    })),
  };
};

const isFinalOf = (s: GameState) => isFinal(s.phase, rankPlayers(s));

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
      ["p3", 1], ["p1", 2], ["p4", 2], ["p6", 2], ["p0", 5], ["p5", 5], ["p2", 7],
    ]);
  });
  test("同点は参加順", () => {
    const r = rankPlayers(make([5, 9, 9]));
    expect(r.map((x) => x.nickname)).toEqual(["p1", "p2", "p0"]);
  });
  test("listEntries は 4 位以下の全員（topN で切らない）", () => {
    const s = make([7, 6, 5, 4, 3, 2, 1]);
    expect(listEntries(rankPlayers(s)).map((x) => x.rank)).toEqual([4, 5, 6, 7]);
  });
  test("同点で rank が 1 位から 4 位に飛ぶと、2 位・3 位の枠は空", () => {
    const s = make([9, 9, 9, 7]);
    expect(podiumHasPlayers(rankPlayers(s), 1)).toBe(true);
    expect(podiumHasPlayers(rankPlayers(s), 2)).toBe(false);
    expect(podiumHasPlayers(rankPlayers(s), 3)).toBe(false);
    expect(podiumPlayers(rankPlayers(s), 1)).toHaveLength(3);
    expect(listEntries(rankPlayers(s)).map((x) => x.rank)).toEqual([4]);
  });
  test("isFinal: 0 人の list は true、1 人の list は false", () => {
    expect(isFinalOf(make([]))).toBe(true);
    expect(isFinalOf(make([3]))).toBe(false);
  });
});

describe("list paging", () => {
  /** 3 podium players followed by `n` players ranked 4th or lower. */
  const rankedWithList = (n: number) => {
    const total = 3 + n;
    return rankPlayers(make(Array.from({ length: total }, (_, i) => total - i)));
  };

  test.each([
    [0, 1],
    [1, 1],
    [40, 1],
    [41, 2],
    [80, 2],
    [81, 3],
    [117, 3],
  ])("listPageCount: 一覧が %i 人なら %i ページ", (n, pages) => {
    expect(listPageCount(rankedWithList(n))).toBe(pages);
  });
  test("listPageEntries: 40 行ずつで、最後は端数。順位の昇順で重複も欠落もない", () => {
    const ranked = rankedWithList(97);
    const pages = [0, 1, 2].map((p) => listPageEntries(ranked, p));
    expect(pages.map((p) => p.length)).toEqual([40, 40, 17]);
    const all = pages.flat();
    expect(all.map((x) => x.rank)).toEqual(Array.from({ length: 97 }, (_, i) => i + 4));
    expect(new Set(all.map((x) => x.playerId)).size).toBe(97);
  });
  test("listPageEntries: 範囲外のページは空", () => {
    expect(listPageEntries(rankedWithList(5), 3)).toEqual([]);
    expect(listPageEntries(rankedWithList(5), -1)).toEqual([]);
  });
  test("isFinal: 一覧は、表彰台に人がいない（参加者 0 人）ときだけ true。人がいればどのページも false", () => {
    const at = (n: number, page: number) => {
      const s = make(Array.from({ length: n }, (_, i) => n - i));
      return isFinal({ type: "results", stage: { kind: "list", page } }, rankPlayers(s));
    };
    expect(at(0, 0)).toBe(true);
    expect(at(1, 0)).toBe(false); // a rank-1 player is still to be announced
    expect(at(44, 0)).toBe(false);
    expect(at(44, 1)).toBe(false); // last list page, podium still to come
  });
});

