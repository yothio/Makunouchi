import { describe, expect, test } from "vitest";
import type { QuizPayload } from "../../shared/types";
import { MAX_PLAYERS } from "./rules";
import { scoreOf } from "./scoring";
import type { GameState } from "./types";
import {
  advance,
  createGameState,
  joinPlayer,
  normalizeNickname,
  phaseKey,
  presentResults,
  submitAnswer,
  type Transition,
} from "./state";

const quiz: QuizPayload = {
  title: "T",
  questions: [
    { title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 1 },
    { title: "q1", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 2 },
  ],
};

const ok = (r: Transition<string>): GameState => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.state;
};
const walk = (s: GameState, n: number): GameState => {
  for (let i = 0; i < n; i++) s = ok(advance(s, phaseKey(s.phase)));
  return s;
};
const withPlayer = (name = "taro", id = "p1") => {
  const r = joinPlayer(createGameState(quiz), name, { id, token: "t" + id });
  if (!r.ok) throw new Error("join failed");
  return r.state;
};

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
  test("問題フェーズの phaseKey は変わらない", () => {
    expect(phaseKey({ type: "lobby" })).toBe("lobby");
    expect(phaseKey({ type: "question", index: 0, status: "open" })).toBe("q:0:open");
    expect(phaseKey({ type: "question", index: 3, status: "closed" })).toBe("q:3:closed");
    expect(phaseKey({ type: "question", index: 14, status: "revealed" })).toBe("q:14:revealed");
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
    s = walk(s, 3);
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
    let s = walk(createGameState(quiz), 3);
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
  test(`参加人数は ${MAX_PLAYERS} 人ちょうどまで可、超えると full`, () => {
    let s = createGameState(quiz);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const r = joinPlayer(s, `n${i}`, { id: `id${i}`, token: `t${i}` });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.players).toHaveLength(MAX_PLAYERS);
    expect(joinPlayer(s, "overflow", { id: "over", token: "tover" })).toEqual({ ok: false, reason: "full" });
  });
  test("制御文字・書式文字は除去してから長さと重複を判定する", () => {
    const s = withPlayer("TARO");
    expect(normalizeNickname("TA\u0000RO\u200B")).toBe("TARO");
    expect(joinPlayer(s, "TA\u0000RO\u200B", { id: "p2", token: "t2" })).toEqual({
      ok: false,
      reason: "nickname_taken",
    });
    expect(joinPlayer(createGameState(quiz), "\u0000\u200B", { id: "a", token: "b" })).toEqual({
      ok: false,
      reason: "nickname_invalid",
    });
  });
  test("ZWJ を含む絵文字結合は分解されて保存される", () => {
    const r = joinPlayer(createGameState(quiz), "👨\u200D👩", { id: "p1", token: "t1" });
    expect(r.ok && r.player.nickname).toBe("👨👩");
  });
});

describe("scoreOf", () => {
  test("点数は正解数。closed の問題を数えず、revealed になって初めて加点", () => {
    let s = walk(withPlayer(), 1);
    s = ok(submitAnswer(s, "p1", 0, 1));
    s = walk(s, 1);
    expect(scoreOf(s, s.players[0])).toBe(0);
    s = walk(s, 1);
    expect(scoreOf(s, s.players[0])).toBe(1);
    s = walk(s, 1);
    s = ok(submitAnswer(s, "p1", 1, 2));
    expect(scoreOf(s, s.players[0])).toBe(1);
    s = walk(s, 2);
    expect(scoreOf(s, s.players[0])).toBe(2);
  });
  test("不正解・未回答は加点なし、results では全問採点", () => {
    let s = walk(withPlayer(), 1);
    s = ok(submitAnswer(s, "p1", 0, 0));
    s = walk(s, 3);
    s = ok(submitAnswer(s, "p1", 1, 2));
    s = walk(s, 3);
    expect(s.phase.type).toBe("results");
    expect(scoreOf(s, s.players[0])).toBe(1);
  });
  test("参加前の問題と未回答の問題は 0 点のまま", () => {
    let s = walk(createGameState(quiz), 4);
    const joined = joinPlayer(s, "late", { id: "late", token: "tlate" });
    if (!joined.ok) throw new Error("join failed");
    s = ok(submitAnswer(joined.state, "late", 1, 2));
    s = walk(s, 2);
    expect(scoreOf(s, s.players[0])).toBe(1);
  });
});

describe("results progression", () => {
  const resultsState = (scores: number[]): GameState => {
    const qs = Array.from({ length: Math.max(0, ...scores) }, (_, i) => ({
      title: `q${i}`,
      imageUrl: null,
      choices: ["a", "b", "c", "d"] as [string, string, string, string],
      correctIndex: 0 as const,
    }));
    return {
      quiz: { title: "T", questions: qs },
      phase: { type: "results", stage: { kind: "list" } },
      players: scores.map((sc, i) => ({
        id: `id${i}`,
        token: `t${i}`,
        nickname: `p${i}`,
        answers: Object.fromEntries(Array.from({ length: sc }, (_, k) => [k, 0])),
      })),
    };
  };

  test("結果フェーズの phaseKey: r:list / r:<id>:hidden|rank|name|both", () => {
    const id = "id0";
    expect(phaseKey({ type: "results", stage: { kind: "list" } })).toBe("r:list");
    expect(
      phaseKey({
        type: "results",
        stage: { kind: "player", playerId: id, rankShown: false, nameShown: false },
      }),
    ).toBe(`r:${id}:hidden`);
    expect(
      phaseKey({
        type: "results",
        stage: { kind: "player", playerId: id, rankShown: true, nameShown: false },
      }),
    ).toBe(`r:${id}:rank`);
    expect(
      phaseKey({
        type: "results",
        stage: { kind: "player", playerId: id, rankShown: false, nameShown: true },
      }),
    ).toBe(`r:${id}:name`);
    expect(
      phaseKey({
        type: "results",
        stage: { kind: "player", playerId: id, rankShown: true, nameShown: true },
      }),
    ).toBe(`r:${id}:both`);
  });

  test("最後の問題の revealed から advance すると r:list。r:list からの advance は no_next_stage", () => {
    const s = walk(createGameState(quiz), 6);
    expect(s.phase).toEqual({ type: "question", index: 1, status: "revealed" });
    const list = ok(advance(s, "q:1:revealed"));
    expect(phaseKey(list.phase)).toBe("r:list");
    expect(advance(list, "r:list")).toEqual({ ok: false, reason: "no_next_stage" });
  });

  test("select で r:<id>:hidden になり events が projection_changed", () => {
    const s = resultsState([2, 1]);
    const r = presentResults(s, "r:list", { kind: "select", playerId: "id0" });
    expect(r).toMatchObject({
      ok: true,
      events: [{ type: "projection_changed" }],
    });
    expect(phaseKey(ok(r).phase)).toBe("r:id0:hidden");
  });

  test("select を同じ from で 2 回送ると 2 回目は stale_phase", () => {
    const s = resultsState([2, 1]);
    const first = ok(presentResults(s, "r:list", { kind: "select", playerId: "id0" }));
    expect(presentResults(first, "r:list", { kind: "select", playerId: "id1" })).toEqual({
      ok: false,
      reason: "stale_phase",
    });
    expect(phaseKey(first.phase)).toBe("r:id0:hidden");
  });

  test("存在しない playerId の select は unknown_player", () => {
    const s = resultsState([2]);
    expect(presentResults(s, "r:list", { kind: "select", playerId: "nobody" })).toEqual({
      ok: false,
      reason: "unknown_player",
    });
    expect(s.phase).toEqual({ type: "results", stage: { kind: "list" } });
  });

  test("show_rank → show_name で both。show_name → show_rank でも both", () => {
    const base = resultsState([2]);
    const selected = ok(presentResults(base, "r:list", { kind: "select", playerId: "id0" }));
    const ranked = ok(presentResults(selected, "r:id0:hidden", { kind: "show_rank" }));
    expect(phaseKey(ranked.phase)).toBe("r:id0:rank");
    const both = ok(presentResults(ranked, "r:id0:rank", { kind: "show_name" }));
    expect(phaseKey(both.phase)).toBe("r:id0:both");

    const named = ok(presentResults(selected, "r:id0:hidden", { kind: "show_name" }));
    expect(phaseKey(named.phase)).toBe("r:id0:name");
    const both2 = ok(presentResults(named, "r:id0:name", { kind: "show_rank" }));
    expect(phaseKey(both2.phase)).toBe("r:id0:both");
  });

  test("show_rank の二度押しは stale_phase。同じ段階で再送は no_change", () => {
    const selected = ok(presentResults(resultsState([2]), "r:list", { kind: "select", playerId: "id0" }));
    const ranked = ok(presentResults(selected, "r:id0:hidden", { kind: "show_rank" }));
    expect(presentResults(ranked, "r:id0:hidden", { kind: "show_rank" })).toEqual({
      ok: false,
      reason: "stale_phase",
    });
    expect(presentResults(ranked, "r:id0:rank", { kind: "show_rank" })).toEqual({
      ok: false,
      reason: "no_change",
    });
  });

  test("連続操作: 古い from のまま show_name を送ると stale_phase で rank のまま", () => {
    const selected = ok(presentResults(resultsState([2]), "r:list", { kind: "select", playerId: "id0" }));
    const ranked = ok(presentResults(selected, "r:id0:hidden", { kind: "show_rank" }));
    expect(presentResults(ranked, "r:id0:hidden", { kind: "show_name" })).toEqual({
      ok: false,
      reason: "stale_phase",
    });
    expect(phaseKey(ranked.phase)).toBe("r:id0:rank");
  });

  test("back で r:list に戻り players と answers は変わらない。一覧での back は invalid_action", () => {
    const s0 = resultsState([2, 1]);
    const selected = ok(presentResults(s0, "r:list", { kind: "select", playerId: "id0" }));
    const back = ok(presentResults(selected, "r:id0:hidden", { kind: "back" }));
    expect(phaseKey(back.phase)).toBe("r:list");
    expect(back.players).toEqual(s0.players);
    expect(presentResults(back, "r:list", { kind: "back" })).toEqual({ ok: false, reason: "invalid_action" });
  });

  test("select 後に from: r:list で別の人を選ぶと stale_phase", () => {
    const selected = ok(presentResults(resultsState([2, 1]), "r:list", { kind: "select", playerId: "id0" }));
    expect(presentResults(selected, "r:list", { kind: "select", playerId: "id1" })).toEqual({
      ok: false,
      reason: "stale_phase",
    });
    expect(phaseKey(selected.phase)).toBe("r:id0:hidden");
  });

  test("results 以外のフェーズでの presentResults は not_in_results", () => {
    const s = createGameState(quiz);
    expect(presentResults(s, "lobby", { kind: "select", playerId: "id0" })).toEqual({
      ok: false,
      reason: "not_in_results",
    });
  });

  test("参加者ゼロの results でも advance で入れ、select は unknown_player", () => {
    const list = ok(advance(walk(createGameState(quiz), 6), "q:1:revealed"));
    expect(phaseKey(list.phase)).toBe("r:list");
    expect(list.players).toHaveLength(0);
    expect(presentResults(list, "r:list", { kind: "select", playerId: "id0" })).toEqual({
      ok: false,
      reason: "unknown_player",
    });
    expect(advance(list, "r:list")).toEqual({ ok: false, reason: "no_next_stage" });
  });
});
