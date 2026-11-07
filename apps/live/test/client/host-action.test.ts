import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ADVANCE_COOLDOWN_MS,
  ADVANCE_LOCK_MS,
  AdvanceGate,
  hostActionLabel,
  resultsActionMessage,
} from "../../src/client/host/host-action";
import { listHeader } from "../../src/client/screen/list-header";
import type { HostView } from "../../src/shared/types";

const q = { index: 0, total: 5, title: "t", imageUrl: null, choices: ["a", "b", "c", "d"] as [string, string, string, string] };
const v = (screen: HostView["screen"]): HostView => ({ title: "T", phaseKey: "k", playerCount: 3, screen });

describe("hostActionLabel", () => {
  test("lobby", () => expect(hostActionLabel(v({ kind: "lobby" }))).toBe("スタート"));
  test("question open/closed", () => {
    expect(hostActionLabel(v({ kind: "question", question: q, status: "open", answeredCount: 0 }))).toBe("回答を締め切る");
    expect(hostActionLabel(v({ kind: "question", question: q, status: "closed", answeredCount: 0 }))).toBe("正解を発表");
  });
  test("reveal", () => {
    const s: Extract<HostView["screen"], { kind: "reveal" }> = { kind: "reveal", question: q, correctIndex: 0, counts: [0, 0, 0, 0], isLast: false };
    expect(hostActionLabel(v(s))).toBe("次の問題へ");
    expect(hostActionLabel(v({ ...s, isLast: true }))).toBe("結果発表へ");
  });
  test("list", () => {
    expect(hostActionLabel(v({ kind: "list", entries: [], nextRank: 3 }))).toBe("3 位を発表");
    expect(hostActionLabel(v({ kind: "list", entries: [], nextRank: null }))).toBeNull();
  });
  test("podium", () => {
    expect(hostActionLabel(v({ kind: "podium", rank: 3, revealed: false, players: [], nextRank: 2 }))).toBe("めくる");
    expect(hostActionLabel(v({ kind: "podium", rank: 3, revealed: true, players: [], nextRank: 2 }))).toBe("2 位へ");
    expect(hostActionLabel(v({ kind: "podium", rank: 1, revealed: true, players: [], nextRank: null }))).toBeNull();
  });
  test("ranking / ranking_detail では進行ボタンなし", () => {
    expect(hostActionLabel(v({ kind: "ranking", entries: [] }))).toBeNull();
    expect(
      hostActionLabel(
        v({
          kind: "ranking_detail",
          playerId: "p1",
          rank: 1,
          nickname: "a",
          score: 3,
          rankShown: false,
          nameShown: false,
        }),
      ),
    ).toBeNull();
  });
});

describe("resultsActionMessage", () => {
  test("results_action メッセージを組み立てる", () => {
    expect(resultsActionMessage("r:list", { kind: "select", playerId: "p1" })).toEqual({
      type: "results_action",
      from: "r:list",
      action: { kind: "select", playerId: "p1" },
    });
  });
});

describe("listHeader", () => {
  test("derives from entries", () => {
    expect(listHeader([])).toBe("4 位以下はいません");
    expect(listHeader([{ rank: 4, nickname: "a", score: 1 }, { rank: 6, nickname: "b", score: 0 }])).toBe("4 位〜6 位");
    expect(listHeader([{ rank: 5, nickname: "a", score: 1 }, { rank: 5, nickname: "b", score: 1 }, { rank: 7, nickname: "c", score: 0 }])).toBe("5 位〜7 位");
  });
});

describe("AdvanceGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => {
    const gate = new AdvanceGate();
    const onExpired = vi.fn<() => void>();
    gate.setLockExpiredHandler(onExpired);
    const changes = vi.fn<() => void>();
    gate.subscribe(changes);
    return { gate, onExpired, changes };
  };

  test("starts open before any phase arrives", () => {
    const { gate } = make();
    expect(gate.getSnapshot()).toEqual({ cooling: false, locked: false });
  });

  test("input ignored at 999ms after a phase change, accepted at 1000ms", () => {
    const { gate } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS - 1);
    expect(gate.tryAdvance()).toBe(false);
    expect(gate.getSnapshot().cooling).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.getSnapshot().cooling).toBe(false);
    expect(gate.tryAdvance()).toBe(true);
  });

  test("regression: cooldown is cleared by its timer, not by comparing clocks", () => {
    // Old design re-read Date.now() on a re-render after the timer fired; with a clock reading
    // earlier than phaseChangedAt+1000 it still saw cooling=true and never re-rendered.
    const { gate, changes } = make();
    gate.phaseChanged("k1");
    const realNow = Date.now;
    try {
      vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
      Date.now = () => realNow() - 500; // clock reads before phaseChangedAt + 1000
      expect(gate.getSnapshot().cooling).toBe(false);
      expect(gate.tryAdvance()).toBe(true);
    } finally {
      Date.now = realNow;
    }
    // subscribers were notified when the cooldown ended, so a UI would re-render
    expect(changes).toHaveBeenCalled();
  });

  test("same phaseKey does not restart the cooldown", () => {
    const { gate } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
    gate.phaseChanged("k1");
    expect(gate.getSnapshot().cooling).toBe(false);
  });

  test("lock clears on phase change", () => {
    const { gate } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
    expect(gate.tryAdvance()).toBe(true);
    expect(gate.tryAdvance()).toBe(false);
    gate.phaseChanged("k2");
    expect(gate.getSnapshot()).toEqual({ cooling: true, locked: false });
    vi.advanceTimersByTime(ADVANCE_LOCK_MS);
    expect(gate.getSnapshot().locked).toBe(false);
  });

  test("lock clears on disconnect without reconnecting", () => {
    const { gate, onExpired } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
    gate.tryAdvance();
    gate.setConnected(false);
    expect(gate.getSnapshot().locked).toBe(false);
    expect(gate.tryAdvance()).toBe(false); // disconnected
    gate.setConnected(true);
    expect(gate.tryAdvance()).toBe(true);
    vi.advanceTimersByTime(ADVANCE_LOCK_MS);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  test("lock clears after 3000ms and triggers the reconnect callback", () => {
    const { gate, onExpired } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
    gate.tryAdvance();
    vi.advanceTimersByTime(ADVANCE_LOCK_MS - 1);
    expect(gate.getSnapshot().locked).toBe(true);
    expect(onExpired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(gate.getSnapshot().locked).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  test("dispose stops timers", () => {
    const { gate, onExpired } = make();
    gate.phaseChanged("k1");
    vi.advanceTimersByTime(ADVANCE_COOLDOWN_MS);
    gate.tryAdvance();
    gate.dispose();
    vi.advanceTimersByTime(ADVANCE_LOCK_MS * 2);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("AdvanceGate cooldownMs: 0", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => {
    const gate = new AdvanceGate({ cooldownMs: 0 });
    const onExpired = vi.fn<() => void>();
    gate.setLockExpiredHandler(onExpired);
    return { gate, onExpired };
  };

  test("phaseChanged で cooling が立たない", () => {
    const { gate } = make();
    gate.phaseChanged("r:list");
    expect(gate.getSnapshot()).toEqual({ cooling: false, locked: false });
  });

  test("tryAdvance は true（ロック）。同じ phaseKey のうちは 2 回目が false", () => {
    const { gate } = make();
    gate.phaseChanged("r:p1:hidden");
    expect(gate.tryAdvance()).toBe(true);
    expect(gate.getSnapshot().locked).toBe(true);
    expect(gate.tryAdvance()).toBe(false);
  });

  test("新しい phaseKey でロックが解け、直後に tryAdvance が true", () => {
    const { gate } = make();
    gate.phaseChanged("r:p1:hidden");
    expect(gate.tryAdvance()).toBe(true);
    gate.phaseChanged("r:p1:rank");
    expect(gate.getSnapshot().locked).toBe(false);
    expect(gate.tryAdvance()).toBe(true);
  });

  test("3000 ms でロックが解け、解除ハンドラが呼ばれる", () => {
    const { gate, onExpired } = make();
    gate.phaseChanged("r:p1:hidden");
    gate.tryAdvance();
    vi.advanceTimersByTime(ADVANCE_LOCK_MS - 1);
    expect(gate.getSnapshot().locked).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.getSnapshot().locked).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  test("切断でロックが解ける", () => {
    const { gate } = make();
    gate.phaseChanged("r:p1:hidden");
    gate.tryAdvance();
    gate.setConnected(false);
    expect(gate.getSnapshot().locked).toBe(false);
  });
});
