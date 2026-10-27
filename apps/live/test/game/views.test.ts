import { describe, expect, test } from "vitest";
import type { QuizPayload, ResultsStage } from "../../src/shared/types";
import { advance, createGameState, joinPlayer, phaseKey, submitAnswer, type GameState } from "../../src/worker/game/state";
import { guestView, hostView } from "../../src/worker/game/views";

const quiz: QuizPayload = {
  title: "T",
  topN: 10,
  questions: [
    { title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 1, points: 10 },
    { title: "q1", imageUrl: "https://x/y.png", choices: ["a", "b", "c", "d"], correctIndex: 2, points: 30 },
  ],
};

function join(s: GameState, name: string, id: string): GameState {
  const r = joinPlayer(s, name, { id, token: "t" + id });
  if (!r.ok) throw new Error("join failed");
  return r.state;
}
function step(s: GameState, n = 1): GameState {
  for (let i = 0; i < n; i++) s = advance(s, phaseKey(s.phase));
  return s;
}
/** Players with scores injected via answers; phase set to results list. */
function results(scores: number[], topN = 10): GameState {
  const questions = Array.from({ length: Math.max(0, ...scores) }, (_, i) => ({
    title: `q${i}`, imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string], correctIndex: 0 as const, points: 1,
  }));
  let s = createGameState({ title: "T", topN, questions });
  scores.forEach((_, i) => (s = join(s, `n${i}`, `id${i}`)));
  return {
    ...s,
    phase: { type: "results", stage: { kind: "list" } },
    players: s.players.map((p, i) => ({ ...p, answers: Object.fromEntries(Array.from({ length: scores[i] }, (_, k) => [k, 0])) })),
  };
}
const at = (s: GameState, stage: ResultsStage): GameState => ({ ...s, phase: { type: "results", stage } });

describe("answer leakage", () => {
  test("open・closed の段階では、guestView と hostView の JSON に correctIndex が含まれない", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = step(s); // open
    s = submitAnswer(s, "p1", 0, 1);
    for (const st of [s, step(s)]) {
      expect(JSON.stringify(guestView(st, "p1"))).not.toContain("correctIndex");
      expect(JSON.stringify(hostView(st))).not.toContain("correctIndex");
      expect(JSON.stringify(hostView(st))).not.toContain("points");
    }
  });
  test("guestView に他人のニックネームや回答が含まれない（final 以外）", () => {
    let s = join(join(createGameState(quiz), "alice", "p1"), "bobby", "p2");
    s = submitAnswer(step(s), "p2", 0, 3);
    for (const st of [s, step(s), step(s, 2)]) {
      const json = JSON.stringify(guestView(st, "p1"));
      expect(json).not.toContain("bobby");
    }
    expect(JSON.stringify(guestView(results([3, 2]), "id0"))).not.toContain("n1");
  });
});

describe("hostView", () => {
  test("lobby", () => {
    const s = join(createGameState(quiz), "a", "p1");
    expect(hostView(s)).toEqual({ title: "T", phaseKey: "lobby", playerCount: 1, screen: { kind: "lobby" } });
  });
  test("question: answeredCount は現在の問題に回答した人数", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = submitAnswer(step(s), "p1", 0, 0);
    const v = hostView(s);
    expect(v.screen).toMatchObject({ kind: "question", status: "open", answeredCount: 1 });
    expect(v.phaseKey).toBe("q:0:open");
    expect((v.screen as { question: object }).question).toEqual({ index: 0, total: 2, title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"] });
  });
  test("reveal の counts は選択肢ごとの回答数、isLast は最後の問題のとき true", () => {
    let s = ["a", "b", "c"].reduce((acc, n, i) => join(acc, n, `p${i}`), createGameState(quiz));
    s = step(s); // q0 open
    s = submitAnswer(submitAnswer(submitAnswer(s, "p0", 0, 1), "p1", 0, 1), "p2", 0, 3);
    const r0 = hostView(step(s, 2));
    expect(r0.screen).toMatchObject({ kind: "reveal", correctIndex: 1, counts: [0, 2, 0, 1], isLast: false });
    const last = hostView(step(s, 5)); // q1 revealed
    expect(last.screen).toMatchObject({ kind: "reveal", isLast: true, counts: [0, 0, 0, 0] });
  });
  test("list の nextRank は空でない最初の枠（90,90,90,70 なら 1）", () => {
    const v = hostView(results([9, 9, 9, 7]));
    expect(v.screen).toEqual({ kind: "list", entries: [{ rank: 4, nickname: "n3", score: 7 }], nextRank: 1 });
    expect(hostView(results([9, 8, 7, 6])).screen).toMatchObject({ nextRank: 3 });
    expect(hostView(results([])).screen).toMatchObject({ kind: "list", entries: [], nextRank: null });
  });
  test("podium で revealed=false の hostView には players が空で、ニックネームが含まれない", () => {
    const s = at(results([3, 2, 1]), { kind: "podium", rank: 3, revealed: false });
    const v = hostView(s);
    expect(v.screen).toEqual({ kind: "podium", rank: 3, revealed: false, players: [], nextRank: 2 });
    expect(JSON.stringify(v)).not.toContain("n2");
  });
  test("podium revealed: players と nextRank。1 位(表) の nextRank は null", () => {
    const s = results([3, 3, 1]);
    expect(hostView(at(s, { kind: "podium", rank: 1, revealed: true })).screen).toEqual({
      kind: "podium", rank: 1, revealed: true, players: [{ nickname: "n0", score: 3 }, { nickname: "n1", score: 3 }], nextRank: null,
    });
    // rank 3 is n2; rank 2 slot empty -> next is 1
    expect(hostView(at(s, { kind: "podium", rank: 3, revealed: true })).screen).toMatchObject({ nextRank: 1 });
  });
});

describe("guestView", () => {
  test("lobby", () => {
    const s = join(createGameState(quiz), "a", "p1");
    expect(guestView(s, "p1")).toEqual({ kind: "lobby", title: "T", nickname: "a" });
  });
  test("question: myChoice", () => {
    let s = join(createGameState(quiz), "a", "p1");
    s = step(s);
    expect(guestView(s, "p1")).toMatchObject({ kind: "question", status: "open", myChoice: null });
    expect(guestView(submitAnswer(s, "p1", 0, 2), "p1")).toMatchObject({ myChoice: 2 });
  });
  test("reveal: correct と score", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = submitAnswer(step(s), "p1", 0, 1);
    s = step(s, 2);
    expect(guestView(s, "p1")).toMatchObject({ kind: "reveal", correctIndex: 1, myChoice: 1, correct: true, score: 10 });
    expect(guestView(s, "p2")).toMatchObject({ kind: "reveal", myChoice: null, correct: false, score: 0 });
  });
  test("最終発表の途中（1 位を伏せている段階まで）は results_pending、1 位をめくった後は final", () => {
    const s = results([3, 2, 2, 1]);
    expect(guestView(s, "id0")).toEqual({ kind: "results_pending", nickname: "n0" });
    expect(guestView(at(s, { kind: "podium", rank: 1, revealed: false }), "id0")).toEqual({ kind: "results_pending", nickname: "n0" });
    expect(guestView(at(s, { kind: "podium", rank: 1, revealed: true }), "id2")).toEqual({
      kind: "final", nickname: "n2", rank: 2, score: 2, playerCount: 4,
    });
  });
  test("未知の playerId は例外", () => {
    expect(() => guestView(createGameState(quiz), "nope")).toThrow("unknown player: nope");
  });
});
