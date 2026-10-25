import { describe, expect, test } from "vitest";
import { buildHostUrl, hostActionLabel, isAdvanceLocked, listHeader } from "../../src/client/host/host-action";
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
});

describe("listHeader", () => {
  test("derives from entries", () => {
    expect(listHeader([])).toBe("4 位以下はいません");
    expect(listHeader([{ rank: 4, nickname: "a", score: 1 }, { rank: 6, nickname: "b", score: 0 }])).toBe("4 位〜6 位");
  });
});

describe("buildHostUrl", () => {
  test("ws/wss with token", () => {
    expect(buildHostUrl({ protocol: "https:", host: "x.dev" }, "s 1", "tk")).toBe("wss://x.dev/ws/s%201/host?token=tk");
    expect(buildHostUrl({ protocol: "http:", host: "localhost:5173" }, "s", "a/b")).toBe("ws://localhost:5173/ws/s/host?token=a%2Fb");
  });
});

describe("isAdvanceLocked", () => {
  const sent = { from: "k1", at: 1000 };
  test("not locked before any send", () => expect(isAdvanceLocked(null, "k1", true, 1000)).toBe(false));
  test("locked after send", () => expect(isAdvanceLocked(sent, "k1", true, 1500)).toBe(true));
  test("unlocks on phaseKey change", () => expect(isAdvanceLocked(sent, "k2", true, 1500)).toBe(false));
  test("unlocks on disconnect", () => expect(isAdvanceLocked(sent, "k1", false, 1500)).toBe(false));
  test("unlocks after 3000ms with same phaseKey", () => {
    expect(isAdvanceLocked(sent, "k1", true, 3999)).toBe(true);
    expect(isAdvanceLocked(sent, "k1", true, 4000)).toBe(false);
  });
});
