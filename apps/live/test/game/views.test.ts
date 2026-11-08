import { describe, expect, test } from "vitest";
import type { QuizPayload, ResultsStage } from "../../src/shared/types";
import { advance, createGameState, joinPlayer, phaseKey, submitAnswer, type Transition } from "../../src/worker/game/state";
import type { GameState } from "../../src/worker/game/types";
import { guestView, hostView, screenView } from "../../src/worker/game/views";

const quiz: QuizPayload = {
  title: "T",
  questions: [
    { title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"], correctIndex: 1 },
    { title: "q1", imageUrl: "https://x/y.png", choices: ["a", "b", "c", "d"], correctIndex: 2 },
  ],
};

const ok = (r: Transition<string>): GameState => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.state;
};
const join = (s: GameState, name: string, id: string): GameState => {
  const r = joinPlayer(s, name, { id, token: "t" + id });
  if (!r.ok) throw new Error("join failed");
  return r.state;
};
const step = (s: GameState, n = 1): GameState => {
  for (let i = 0; i < n; i++) s = ok(advance(s, phaseKey(s.phase)));
  return s;
};
const results = (scores: number[]): GameState => {
  const questions = Array.from({ length: Math.max(0, ...scores) }, (_, i) => ({
    title: `q${i}`, imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string], correctIndex: 0 as const,
  }));
  let s = createGameState({ title: "T", questions });
  scores.forEach((_, i) => (s = join(s, `n${i}`, `id${i}`)));
  return {
    ...s,
    phase: { type: "results", stage: { kind: "list" } },
    players: s.players.map((p, i) => ({ ...p, answers: Object.fromEntries(Array.from({ length: scores[i] }, (_, k) => [k, 0])) })),
  };
};
const at = (s: GameState, stage: ResultsStage): GameState => ({ ...s, phase: { type: "results", stage } });

describe("answer leakage", () => {
  test("open・closed の段階では、guestView と hostView の JSON に correctIndex が含まれない", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = step(s);
    s = ok(submitAnswer(s, "p1", 0, 1));
    for (const st of [s, step(s)]) {
      expect(JSON.stringify(guestView(st, "p1"))).not.toContain("correctIndex");
      expect(JSON.stringify(hostView(st))).not.toContain("correctIndex");
      expect(JSON.stringify(hostView(st))).not.toContain("points");
    }
  });
  test("guestView に他人のニックネームや回答が含まれない（final 以外）", () => {
    let s = join(join(createGameState(quiz), "alice", "p1"), "bobby", "p2");
    s = ok(submitAnswer(step(s), "p2", 0, 3));
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
    s = ok(submitAnswer(step(s), "p1", 0, 0));
    const v = hostView(s);
    expect(v.screen).toMatchObject({ kind: "question", status: "open", answeredCount: 1 });
    expect(v.phaseKey).toBe("q:0:open");
    expect((v.screen as { question: object }).question).toEqual({ index: 0, total: 2, title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"] });
  });
  test("reveal の counts は選択肢ごとの回答数、isLast は最後の問題のとき true", () => {
    let s = ["a", "b", "c"].reduce((acc, n, i) => join(acc, n, `p${i}`), createGameState(quiz));
    s = step(s);
    s = ok(submitAnswer(ok(submitAnswer(ok(submitAnswer(s, "p0", 0, 1)), "p1", 0, 1)), "p2", 0, 3));
    const r0 = hostView(step(s, 2));
    expect(r0.screen).toMatchObject({ kind: "reveal", correctIndex: 1, counts: [0, 2, 0, 1], isLast: false });
    const last = hostView(step(s, 5));
    expect(last.screen).toMatchObject({ kind: "reveal", isLast: true, counts: [0, 0, 0, 0] });
  });
});

describe("screenView", () => {
  test("lobby: タイトルと参加人数。参加が増えると playerCount も増える", () => {
    const s = join(createGameState(quiz), "a", "p1");
    expect(screenView(s)).toEqual({ kind: "lobby", title: "T", playerCount: 1 });
    expect(screenView(join(s, "b", "p2"))).toEqual({ kind: "lobby", title: "T", playerCount: 2 });
  });
  test("question: open / closed で status が変わり、JSON に correctIndex も answeredCount も含まれない", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = ok(submitAnswer(step(s), "p1", 0, 1));
    const open = screenView(s);
    expect(open).toEqual({
      kind: "question",
      status: "open",
      question: { index: 0, total: 2, title: "q0", imageUrl: null, choices: ["a", "b", "c", "d"] },
    });
    expect(screenView(step(s))).toMatchObject({ kind: "question", status: "closed" });
    for (const st of [s, step(s)]) {
      const json = JSON.stringify(screenView(st));
      expect(json).not.toContain("correctIndex");
      expect(json).not.toContain("answeredCount");
    }
    expect(screenView(s)).not.toHaveProperty("answeredCount");
  });
  test("reveal: correctIndex と選択肢ごとの counts", () => {
    let s = ["a", "b", "c"].reduce((acc, n, i) => join(acc, n, `p${i}`), createGameState(quiz));
    s = step(s);
    s = ok(submitAnswer(ok(submitAnswer(ok(submitAnswer(s, "p0", 0, 1)), "p1", 0, 1)), "p2", 0, 3));
    expect(screenView(step(s, 2))).toMatchObject({ kind: "reveal", correctIndex: 1, counts: [0, 2, 0, 1] });
  });
});

describe("guestView history", () => {
  const entry = (index: number, choice: number | null, correct: boolean) => ({ index, choice, correct });
  const started = () => ["a", "b", "c"].reduce((acc, n, i) => join(acc, n, `p${i}`), createGameState(quiz));

  test("出題中（open）は空。締め切り後（closed）も空で、現在の問題の正誤を JSON に出さない", () => {
    let s = step(started());
    s = ok(submitAnswer(s, "p0", 0, 1));
    for (const st of [s, step(s)]) {
      const view = guestView(st, "p0");
      expect(view).toMatchObject({ kind: "question", history: [] });
      expect(JSON.stringify(view)).not.toContain('"correct"');
      expect(JSON.stringify(view)).not.toContain("correctIndex");
    }
  });
  test("正解発表のあとに、本人の選択と正誤が入る（正解・誤答・未回答）", () => {
    let s = step(started());
    s = ok(submitAnswer(s, "p0", 0, 1));
    s = ok(submitAnswer(s, "p1", 0, 3));
    s = step(s, 2);
    expect(guestView(s, "p0")).toMatchObject({ kind: "reveal", history: [entry(0, 1, true)] });
    expect(guestView(s, "p1")).toMatchObject({ kind: "reveal", history: [entry(0, 3, false)] });
    expect(guestView(s, "p2")).toMatchObject({ kind: "reveal", history: [entry(0, null, false)] });
  });
  test("次の問題が open の間は、現在の問題を含まず前の問題だけ", () => {
    let s = step(started());
    s = ok(submitAnswer(s, "p0", 0, 1));
    s = step(s, 3);
    s = ok(submitAnswer(s, "p0", 1, 2));
    expect(guestView(s, "p0")).toMatchObject({ kind: "question", status: "open", history: [entry(0, 1, true)] });
    expect(guestView(step(s), "p0")).toMatchObject({ kind: "question", status: "closed", history: [entry(0, 1, true)] });
  });
  test("結果発表では全問ぶんが index 昇順で入る", () => {
    let s = step(started());
    s = ok(submitAnswer(s, "p0", 0, 1));
    s = step(s, 3);
    s = ok(submitAnswer(s, "p0", 1, 0));
    s = step(s, 3);
    expect(s.phase.type).toBe("results");
    expect(guestView(s, "p0")).toEqual({
      kind: "results_pending",
      nickname: "a",
      history: [entry(0, 1, true), entry(1, 0, false)],
    });
  });
  test("途中参加の人は、参加前の問題が未回答として入る", () => {
    let s = step(createGameState(quiz), 4);
    s = join(s, "late", "late");
    s = ok(submitAnswer(s, "late", 1, 2));
    s = step(s, 2);
    expect(guestView(s, "late")).toMatchObject({ kind: "reveal", history: [entry(0, null, false), entry(1, 2, true)] });
  });
  test("history には本人の回答だけが入り、他人のニックネームや回答が出ない", () => {
    let s = step(join(join(createGameState(quiz), "alice", "p1"), "bobby", "p2"));
    s = ok(submitAnswer(ok(submitAnswer(s, "p1", 0, 1)), "p2", 0, 3));
    s = step(s, 2);
    const view = guestView(s, "p1");
    expect(JSON.stringify(view)).not.toContain("bobby");
    expect(view).toMatchObject({ history: [entry(0, 1, true)] });
  });
  test("lobby の guest_view に history はない", () => {
    expect(guestView(join(createGameState(quiz), "a", "p1"), "p1")).not.toHaveProperty("history");
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
    expect(guestView(ok(submitAnswer(s, "p1", 0, 2)), "p1")).toMatchObject({ myChoice: 2 });
  });
  test("reveal: correct と score", () => {
    let s = join(join(createGameState(quiz), "a", "p1"), "b", "p2");
    s = ok(submitAnswer(step(s), "p1", 0, 1));
    s = step(s, 2);
    expect(guestView(s, "p1")).toMatchObject({ kind: "reveal", correctIndex: 1, myChoice: 1, correct: true, score: 1 });
    expect(guestView(s, "p2")).toMatchObject({ kind: "reveal", myChoice: null, correct: false, score: 0 });
  });
  test("結果発表の間は、どの段階でも results_pending で、順位は送らない", () => {
    const s = results([3, 2, 2, 1]);
    const stages: ResultsStage[] = [
      { kind: "list" },
      { kind: "player", playerId: "id0", rankShown: false, nameShown: false },
      { kind: "player", playerId: "id0", rankShown: true, nameShown: false },
      { kind: "player", playerId: "id0", rankShown: true, nameShown: true },
    ];
    for (const stage of stages) {
      const view = guestView(at(s, stage), "id2");
      expect(view).toMatchObject({ kind: "results_pending", nickname: "n2" });
      expect(JSON.stringify(view)).not.toContain("rank");
      expect(JSON.stringify(view)).not.toContain("n0");
    }
  });
  test("未知の playerId は例外", () => {
    expect(() => guestView(createGameState(quiz), "nope")).toThrow("unknown player: nope");
  });
});

describe("free-order results views", () => {
  test("r:list は ranking で、全員が順位の昇順（1,1,3,4）。playerId と score を含む", () => {
    const v = hostView(results([9, 9, 7, 6]));
    expect(v.screen).toEqual({
      kind: "ranking",
      entries: [
        { playerId: "id0", rank: 1, nickname: "n0", score: 9 },
        { playerId: "id1", rank: 1, nickname: "n1", score: 9 },
        { playerId: "id2", rank: 3, nickname: "n2", score: 7 },
        { playerId: "id3", rank: 4, nickname: "n3", score: 6 },
      ],
    });
  });

  test("ranking_detail は選んだ人の rank / nickname / score と rankShown / nameShown を含む", () => {
    const s = at(results([9, 7]), {
      kind: "player",
      playerId: "id1",
      rankShown: true,
      nameShown: false,
    });
    expect(hostView(s).screen).toEqual({
      kind: "ranking_detail",
      playerId: "id1",
      rank: 2,
      nickname: "n1",
      score: 7,
      rankShown: true,
      nameShown: false,
    });
  });

  test("参加者ゼロなら ranking の entries は空配列", () => {
    expect(hostView(results([])).screen).toEqual({ kind: "ranking", entries: [] });
  });

  test("r:list と :hidden は results_wait。JSON に選んだ人のニックネームと順位が含まれない", () => {
    const list = results([9, 7]);
    expect(screenView(list)).toEqual({ kind: "results_wait", title: "T" });
    const hidden = at(list, { kind: "player", playerId: "id0", rankShown: false, nameShown: false });
    const wait = screenView(hidden);
    expect(wait).toEqual({ kind: "results_wait", title: "T" });
    expect(JSON.stringify(wait)).not.toContain("n0");
    expect(JSON.stringify(wait)).not.toContain('"rank"');
  });

  test(":rank は rank_reveal で nickname null。JSON にニックネームが含まれない", () => {
    const s = at(results([9, 7]), { kind: "player", playerId: "id0", rankShown: true, nameShown: false });
    const view = screenView(s);
    expect(view).toEqual({ kind: "rank_reveal", rank: 1, nickname: null });
    expect(JSON.stringify(view)).not.toContain("n0");
  });

  test(":name は nickname のみ。JSON にその人の順位が現れない", () => {
    const s = at(results([9, 7]), { kind: "player", playerId: "id0", rankShown: false, nameShown: true });
    const view = screenView(s);
    expect(view).toEqual({ kind: "rank_reveal", rank: null, nickname: "n0" });
    expect(JSON.stringify(view)).toContain('"rank":null');
  });

  test(":both は両方入る", () => {
    const s = at(results([9, 7]), { kind: "player", playerId: "id0", rankShown: true, nameShown: true });
    expect(screenView(s)).toEqual({ kind: "rank_reveal", rank: 1, nickname: "n0" });
  });

  test("同順位の 2 人のうち一方を投影しても、もう一方のニックネームは JSON に含まれない", () => {
    const s = at(results([9, 9, 7]), {
      kind: "player",
      playerId: "id0",
      rankShown: true,
      nameShown: true,
    });
    const json = JSON.stringify(screenView(s));
    expect(json).toContain("n0");
    expect(json).not.toContain("n1");
  });
});
