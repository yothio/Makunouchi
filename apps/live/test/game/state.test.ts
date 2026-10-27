import { describe, expect, test } from "vitest";
import type { QuizPayload } from "../../src/shared/types";
import { isFinal, rankPlayers } from "../../src/worker/game/ranking";
import { scoreOf } from "../../src/worker/game/scoring";
import type { GameState } from "../../src/worker/game/types";
import { advance, createGameState, joinPlayer, phaseKey, submitAnswer, type Transition } from "../../src/worker/game/state";

const quiz: QuizPayload = {
  title: "T",
  topN: 10,
  questions: [
    { title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 1, points: 10 },
    { title: "q1", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 2, points: 30 },
  ],
};

function ok(r: Transition<string>): GameState {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.state;
}
function walk(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = ok(advance(s, phaseKey(s.phase)));
  return s;
}
function withPlayer(name = "taro", id = "p1") {
  const r = joinPlayer(createGameState(quiz), name, { id, token: "t" + id });
  if (!r.ok) throw new Error("join failed");
  return r.state;
}

describe("advance", () => {
  test("lobby → q:0:open → q:0:closed → q:0:revealed → q:1:open", () => {
    let s = createGameState(quiz);
    const keys = [phaseKey(s.phase)];
    for (let i = 0; i < 4; i++) {
      s = ok(advance(s, phaseKey(s.phase)));
      keys.push(phaseKey(s.phase));
    }
    expect(keys).toEqual(["lobby", "q:0:open", "q:0:closed", "q:0:revealed", "q:1:open"]);
  });
  test("古い fromKey での advance は何もしない（二度押し）", () => {
    const s0 = createGameState(quiz);
    const r = advance(s0, "lobby");
    expect(r).toMatchObject({ ok: true, events: [{ type: "phase_changed" }] });
    const s1 = ok(r);
    expect(s1.phase).toEqual({ type: "question", index: 0, status: "open" });
    expect(advance(s1, "lobby")).toEqual({ ok: false, reason: "stale_phase" });
  });
  test("最後の問題の revealed から results list へ", () => {
    const s = walk(createGameState(quiz), 6);
    expect(s.phase).toEqual({ type: "question", index: 1, status: "revealed" });
    expect(ok(advance(s, "q:1:revealed")).phase).toEqual({ type: "results", stage: { kind: "list" } });
  });
  test("phaseKey の形式", () => {
    expect(phaseKey({ type: "results", stage: { kind: "list" } })).toBe("r:list");
    expect(phaseKey({ type: "results", stage: { kind: "podium", rank: 3, revealed: false } })).toBe("r:3:hidden");
    expect(phaseKey({ type: "results", stage: { kind: "podium", rank: 1, revealed: true } })).toBe("r:1:shown");
  });
});

describe("submitAnswer", () => {
  test("締切まで回答を上書きでき、締切後は変わらない", () => {
    let s = walk(withPlayer(), 1);
    const first = submitAnswer(s, "p1", 0, 1);
    expect(first).toMatchObject({ ok: true, events: [{ type: "answer_recorded", playerId: "p1" }] });
    s = ok(submitAnswer(ok(first), "p1", 0, 3));
    expect(s.players[0].answers[0]).toBe(3);
    const closed = walk(s, 1);
    expect(submitAnswer(closed, "p1", 0, 2)).toEqual({ ok: false, reason: "not_accepting" });
    expect(closed.players[0].answers[0]).toBe(3);
  });
  test("前の問題 index への回答は無視", () => {
    let s = walk(withPlayer(), 1);
    s = ok(submitAnswer(s, "p1", 0, 1));
    s = walk(s, 3); // q:1:open
    expect(phaseKey(s.phase)).toBe("q:1:open");
    expect(submitAnswer(s, "p1", 0, 2)).toEqual({ ok: false, reason: "wrong_question" });
    expect(s.players[0].answers[0]).toBe(1);
    expect(s.players[0].answers[1]).toBeUndefined();
  });
  test("choice 4 や -1 や小数は無視", () => {
    const s = walk(withPlayer(), 1);
    const invalid = { ok: false, reason: "invalid_choice" };
    expect(submitAnswer(s, "p1", 0, 4)).toEqual(invalid);
    expect(submitAnswer(s, "p1", 0, -1)).toEqual(invalid);
    expect(submitAnswer(s, "p1", 0, 1.5)).toEqual(invalid);
  });
  test("不明な playerId は無視、lobby では無視", () => {
    const s = walk(withPlayer(), 1);
    expect(submitAnswer(s, "nobody", 0, 1)).toEqual({ ok: false, reason: "unknown_player" });
    expect(submitAnswer(withPlayer(), "p1", 0, 1)).toEqual({ ok: false, reason: "not_accepting" });
  });
  test("元の state を変更しない", () => {
    const s = walk(withPlayer(), 1);
    const s2 = ok(submitAnswer(s, "p1", 0, 1));
    expect(s.players[0].answers).toEqual({});
    expect(s2).not.toBe(s);
  });
});

describe("joinPlayer", () => {
  test("ニックネームは NFKC・trim 後に重複判定", () => {
    const s = withPlayer("TARO");
    const r = joinPlayer(s, "ＴＡＲＯ ", { id: "p2", token: "t2" });
    expect(r).toEqual({ ok: false, reason: "nickname_taken" });
  });
  test("保存される nickname は正規化後", () => {
    const r = joinPlayer(createGameState(quiz), " ＴＡＲＯ ", { id: "p1", token: "t" });
    expect(r.ok && r.player.nickname).toBe("TARO");
  });
  test("大文字小文字は別物", () => {
    const r = joinPlayer(withPlayer("TARO"), "taro", { id: "p2", token: "t2" });
    expect(r.ok).toBe(true);
  });
  test("空白だけ・21 文字は nickname_invalid、20 文字は可", () => {
    const s = createGameState(quiz);
    expect(joinPlayer(s, "   ", { id: "a", token: "b" })).toEqual({ ok: false, reason: "nickname_invalid" });
    expect(joinPlayer(s, "あ".repeat(21), { id: "a", token: "b" })).toEqual({ ok: false, reason: "nickname_invalid" });
    expect(joinPlayer(s, "あ".repeat(20), { id: "a", token: "b" }).ok).toBe(true);
  });
  test("文字数は code point で数える", () => {
    const s = createGameState(quiz);
    expect(joinPlayer(s, "😀".repeat(20), { id: "a", token: "b" }).ok).toBe(true);
    expect(joinPlayer(s, "😀".repeat(21), { id: "a", token: "b" }).ok).toBe(false);
  });
  test("スタート後の参加は可、参加前の問題は 0 点", () => {
    let s = walk(createGameState(quiz), 3); // q:0:revealed
    const r = joinPlayer(s, "late", { id: "p9", token: "t9" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([{ type: "player_joined", playerId: "p9" }]);
    expect(r.state.players).toHaveLength(1);
    expect(r.state.players[0]).toEqual(r.player);
    expect(scoreOf(r.state, r.player)).toBe(0);
  });
  test("results 中の参加は closed", () => {
    const s = walk(createGameState(quiz), 7);
    expect(s.phase.type).toBe("results");
    expect(joinPlayer(s, "late", { id: "p9", token: "t9" })).toEqual({ ok: false, reason: "closed" });
  });
});

describe("scoreOf", () => {
  test("closed の問題を数えず、revealed になって初めて加点（配点 10 と 30）", () => {
    let s = walk(withPlayer(), 1);
    s = ok(submitAnswer(s, "p1", 0, 1)); // correct
    s = walk(s, 1); // closed
    expect(scoreOf(s, s.players[0])).toBe(0);
    s = walk(s, 1); // revealed
    expect(scoreOf(s, s.players[0])).toBe(10);
    s = walk(s, 1); // q1 open
    s = ok(submitAnswer(s, "p1", 1, 2)); // correct
    expect(scoreOf(s, s.players[0])).toBe(10);
    s = walk(s, 2); // q1 revealed
    expect(scoreOf(s, s.players[0])).toBe(40);
  });
  test("不正解は加点なし、results では全問採点", () => {
    let s = walk(withPlayer(), 1);
    s = ok(submitAnswer(s, "p1", 0, 0));
    s = walk(s, 3);
    s = ok(submitAnswer(s, "p1", 1, 2));
    s = walk(s, 4);
    expect(s.phase.type).toBe("results");
    expect(scoreOf(s, s.players[0])).toBe(30);
  });
});

describe("results progression", () => {
  function resultsState(scores: number[]): GameState {
    const qs = Array.from({ length: Math.max(0, ...scores) }, (_, i) => ({
      title: `q${i}`, imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string], correctIndex: 0 as const, points: 1,
    }));
    return {
      quiz: { title: "T", topN: 10, questions: qs },
      phase: { type: "results", stage: { kind: "list" } },
      players: scores.map((sc, i) => ({
        id: `id${i}`, token: `t${i}`, nickname: `p${i}`,
        answers: Object.fromEntries(Array.from({ length: sc }, (_, k) => [k, 0])),
      })),
    };
  }
  const keys = (s: GameState, n: number) => {
    const out = [phaseKey(s.phase)];
    for (let i = 0; i < n; i++) { s = ok(advance(s, phaseKey(s.phase))); out.push(phaseKey(s.phase)); }
    return out;
  };
  test("results: list → 3 位(伏せ) → 3 位(表) → 2 位(伏せ) → 2 位(表) → 1 位(伏せ) → 1 位(表)", () => {
    expect(keys(resultsState([9, 8, 7, 6]), 6)).toEqual(["r:list", "r:3:hidden", "r:3:shown", "r:2:hidden", "r:2:shown", "r:1:hidden", "r:1:shown"]);
  });
  test("空の発表枠は飛ばす（90,90,90,70 なら list → 1 位(伏せ)）", () => {
    expect(keys(resultsState([9, 9, 9, 7]), 2)).toEqual(["r:list", "r:1:hidden", "r:1:shown"]);
  });
  test("1 位(表) からの advance は何もしない。isFinal は true", () => {
    const s = walk(resultsState([9, 8, 7]), 6);
    expect(phaseKey(s.phase)).toBe("r:1:shown");
    expect(isFinal(s.phase, rankPlayers(s))).toBe(true);
    expect(advance(s, "r:1:shown")).toEqual({ ok: false, reason: "no_next_stage" });
  });
  test("参加者 0 人でも最後まで進められる（list で isFinal）", () => {
    const s = resultsState([]);
    expect(isFinal(s.phase, rankPlayers(s))).toBe(true);
    expect(advance(s, "r:list")).toEqual({ ok: false, reason: "no_next_stage" });
  });
  test("results 中の古い fromKey は stale_phase", () => {
    const s = resultsState([9, 8, 7]);
    expect(advance(s, "r:3:hidden")).toEqual({ ok: false, reason: "stale_phase" });
  });
});
