import type { Choice, Phase, QuizPayload } from "../../shared/types";

export type Player = {
  id: string;
  token: string;
  nickname: string;
  /** keyed by question index */
  answers: Record<number, Choice>;
};

export type GameState = { quiz: QuizPayload; phase: Phase; players: Player[] };

export function createGameState(quiz: QuizPayload): GameState {
  return { quiz, phase: { type: "lobby" }, players: [] };
}

export function phaseKey(phase: Phase): string {
  switch (phase.type) {
    case "lobby":
      return "lobby";
    case "question":
      return `q:${phase.index}:${phase.status}`;
    case "results":
      return phase.stage.kind === "list"
        ? "r:list"
        : `r:${phase.stage.rank}:${phase.stage.revealed ? "shown" : "hidden"}`;
  }
}

export function normalizeNickname(raw: string): string {
  return raw.normalize("NFKC").trim();
}

export function joinPlayer(
  s: GameState,
  nickname: string,
  ids: { id: string; token: string },
):
  | { ok: true; state: GameState; player: Player }
  | { ok: false; reason: "nickname_taken" | "nickname_invalid" | "closed" } {
  if (s.phase.type === "results") return { ok: false, reason: "closed" };
  const normalized = normalizeNickname(nickname);
  const length = [...normalized].length;
  if (length < 1 || length > 20) return { ok: false, reason: "nickname_invalid" };
  if (s.players.some((p) => p.nickname === normalized)) return { ok: false, reason: "nickname_taken" };
  const player: Player = { id: ids.id, token: ids.token, nickname: normalized, answers: {} };
  return { ok: true, state: { ...s, players: [...s.players, player] }, player };
}

export function submitAnswer(s: GameState, playerId: string, questionIndex: number, choice: number): GameState {
  const phase = s.phase;
  if (phase.type !== "question" || phase.status !== "open" || phase.index !== questionIndex) return s;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return s;
  const i = s.players.findIndex((p) => p.id === playerId);
  if (i < 0) return s;
  const player = s.players[i];
  const updated: Player = { ...player, answers: { ...player.answers, [questionIndex]: choice as Choice } };
  const players = s.players.slice();
  players[i] = updated;
  return { ...s, players };
}

export function advance(s: GameState, fromKey: string): GameState {
  if (fromKey !== phaseKey(s.phase)) return s;
  const phase = s.phase;
  switch (phase.type) {
    case "lobby":
      return { ...s, phase: { type: "question", index: 0, status: "open" } };
    case "question": {
      if (phase.status === "open") return { ...s, phase: { ...phase, status: "closed" } };
      if (phase.status === "closed") return { ...s, phase: { ...phase, status: "revealed" } };
      if (phase.index + 1 < s.quiz.questions.length) {
        return { ...s, phase: { type: "question", index: phase.index + 1, status: "open" } };
      }
      return { ...s, phase: { type: "results", stage: { kind: "list" } } };
    }
    case "results":
      // Task 3 replaces this with the results-stage progression.
      return s;
  }
}

/** Only questions whose answer has been revealed (or are already past) are scored. */
export function scoreOf(s: GameState, player: Player): number {
  const phase = s.phase;
  let scoredUpTo: number; // exclusive
  if (phase.type === "lobby") scoredUpTo = 0;
  else if (phase.type === "results") scoredUpTo = s.quiz.questions.length;
  else scoredUpTo = phase.status === "revealed" ? phase.index + 1 : phase.index;
  let total = 0;
  for (let i = 0; i < scoredUpTo; i++) {
    const q = s.quiz.questions[i];
    if (player.answers[i] === q.correctIndex) total += q.points;
  }
  return total;
}
