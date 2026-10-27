import { nextPodiumRank } from "./ranking";
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

/**
 * Facts about what happened in a transition. They say nothing about who is
 * notified; delivery is decided by the room (SessionRoom.deliver).
 */
export type GameEvent =
  | { type: "phase_changed" }
  | { type: "player_joined"; playerId: string }
  | { type: "answer_recorded"; playerId: string };

export type Transition<R extends string, Extra = {}> =
  | ({ ok: true; state: GameState; events: GameEvent[] } & Extra)
  | { ok: false; reason: R };

export function joinPlayer(
  s: GameState,
  nickname: string,
  ids: { id: string; token: string },
): Transition<"nickname_taken" | "nickname_invalid" | "closed", { player: Player }> {
  if (s.phase.type === "results") return { ok: false, reason: "closed" };
  const normalized = normalizeNickname(nickname);
  const length = [...normalized].length;
  if (length < 1 || length > 20) return { ok: false, reason: "nickname_invalid" };
  if (s.players.some((p) => p.nickname === normalized)) return { ok: false, reason: "nickname_taken" };
  const player: Player = { id: ids.id, token: ids.token, nickname: normalized, answers: {} };
  return {
    ok: true,
    state: { ...s, players: [...s.players, player] },
    player,
    events: [{ type: "player_joined", playerId: player.id }],
  };
}

export function submitAnswer(
  s: GameState,
  playerId: string,
  questionIndex: number,
  choice: number,
): Transition<"not_accepting" | "wrong_question" | "invalid_choice" | "unknown_player"> {
  const phase = s.phase;
  if (phase.type !== "question" || phase.status !== "open") return { ok: false, reason: "not_accepting" };
  if (phase.index !== questionIndex) return { ok: false, reason: "wrong_question" };
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return { ok: false, reason: "invalid_choice" };
  const i = s.players.findIndex((p) => p.id === playerId);
  if (i < 0) return { ok: false, reason: "unknown_player" };
  const player = s.players[i];
  const updated: Player = { ...player, answers: { ...player.answers, [questionIndex]: choice as Choice } };
  const players = s.players.slice();
  players[i] = updated;
  return { ok: true, state: { ...s, players }, events: [{ type: "answer_recorded", playerId }] };
}

export function advance(s: GameState, fromKey: string): Transition<"stale_phase" | "no_next_stage"> {
  if (fromKey !== phaseKey(s.phase)) return { ok: false, reason: "stale_phase" };
  const next = nextPhase(s);
  if (!next) return { ok: false, reason: "no_next_stage" };
  return { ok: true, state: { ...s, phase: next }, events: [{ type: "phase_changed" }] };
}

function nextPhase(s: GameState): Phase | null {
  const phase = s.phase;
  switch (phase.type) {
    case "lobby":
      return { type: "question", index: 0, status: "open" };
    case "question": {
      if (phase.status === "open") return { ...phase, status: "closed" };
      if (phase.status === "closed") return { ...phase, status: "revealed" };
      if (phase.index + 1 < s.quiz.questions.length) return { type: "question", index: phase.index + 1, status: "open" };
      return { type: "results", stage: { kind: "list" } };
    }
    case "results": {
      const stage = phase.stage;
      if (stage.kind === "podium" && !stage.revealed) {
        return { type: "results", stage: { ...stage, revealed: true } };
      }
      const below = stage.kind === "list" ? 4 : stage.rank;
      const rank = nextPodiumRank(s, below);
      if (rank !== null) return { type: "results", stage: { kind: "podium", rank, revealed: false } };
      return null;
    }
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
