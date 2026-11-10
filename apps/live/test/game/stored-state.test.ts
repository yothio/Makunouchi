import { describe, expect, it } from "vitest";
import { loadStoredState, STATE_SCHEMA_VERSION } from "../../src/worker/stored-state";
import type { GameState } from "../../src/worker/game/types";

const question = (i: number) => ({
  title: `Q${i}`,
  imageUrl: null,
  choices: ["a", "b", "c", "d"] as [string, string, string, string],
  correctIndex: 1 as const,
});

const current = (): GameState => ({
  quiz: { title: "Quiz", questions: [question(0), question(1)] },
  phase: { type: "question", index: 1, status: "closed" },
  players: [{ id: "p1", token: "t1", nickname: "Taro", answers: { 0: 1, 1: 3 } }],
});

// What a DO actually hands back: JSON round-trip turns answer indexes into string keys.
const stored = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("loadStoredState", () => {
  it("returns null without issues when nothing is stored", () => {
    expect(loadStoredState(undefined, undefined)).toEqual({ state: null, issues: [] });
  });

  it("reads the current shape at the current version unchanged", () => {
    const raw = stored(current());
    expect(loadStoredState(raw, STATE_SCHEMA_VERSION)).toEqual({ state: raw, issues: [] });
  });

  it("treats a state without a version key (created before versioning) as the current version", () => {
    const raw = stored(current());
    expect(loadStoredState(raw, undefined)).toEqual({ state: raw, issues: [] });
  });

  it("reads every phase shape", () => {
    const phases = [
      { type: "lobby" },
      { type: "question", index: 0, status: "open" },
      { type: "question", index: 0, status: "revealed" },
      { type: "results", stage: { kind: "list" } },
      { type: "results", stage: { kind: "player", playerId: "p1", rankShown: true, nameShown: false } },
    ];
    for (const phase of phases) {
      expect(loadStoredState(stored({ ...current(), phase }), undefined).issues).toEqual([]);
    }
  });

  it("fills missing optional fields with their empty value", () => {
    const raw = stored(current()) as any;
    delete raw.quiz.questions[0].imageUrl;
    delete raw.players;
    const withoutPlayers = loadStoredState(raw, STATE_SCHEMA_VERSION);
    expect(withoutPlayers.issues).toEqual([]);
    expect(withoutPlayers.state?.players).toEqual([]);
    expect(withoutPlayers.state?.quiz.questions[0].imageUrl).toBeNull();

    const noAnswers = stored(current()) as any;
    delete noAnswers.players[0].answers;
    expect(loadStoredState(noAnswers, STATE_SCHEMA_VERSION).state?.players[0].answers).toEqual({});
  });

  it("keeps fields it does not know", () => {
    const raw = stored({ ...current(), futureField: { a: 1 } });
    expect(loadStoredState(raw, STATE_SCHEMA_VERSION).state).toEqual(raw);
  });

  it("returns a broken shape as stored, with issues that do not echo stored values", () => {
    const raw = stored(current()) as any;
    raw.phase = { type: "question", index: "one", status: "open" };
    // Keep the nickname string so a regression that echoes stored values fails this assertion.
    raw.players[0].token = undefined;
    const result = loadStoredState(raw, STATE_SCHEMA_VERSION);
    expect(result.state).toBe(raw);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.startsWith("phase"))).toBe(true);
    expect(result.issues.some((i) => i.startsWith("players.0.token"))).toBe(true);
    expect(result.issues.join("\n")).not.toContain("Taro");
    expect(result.issues.every((i) => /^[\w.()-]+: [a-z_]+$/.test(i) || i.startsWith("stateVersion:"))).toBe(true);
  });

  it("reports an unknown version but still returns the state", () => {
    const raw = stored(current());
    const result = loadStoredState(raw, STATE_SCHEMA_VERSION + 1);
    expect(result.state).toEqual(raw);
    expect(result.issues).toEqual([`stateVersion: expected ${STATE_SCHEMA_VERSION}, got ${STATE_SCHEMA_VERSION + 1}`]);
  });
});
