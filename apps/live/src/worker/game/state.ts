import type { Choice, Phase, PhaseKey, QuizPayload, ResultsAction } from "@shared/types";
import { CHOICE_COUNT, MAX_PLAYERS, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "./rules";
import type { GameState, Player } from "./types";

export const createGameState = (quiz: QuizPayload): GameState => {
  return { quiz, phase: { type: "lobby" }, players: [] };
};

export const phaseKey = (phase: Phase): PhaseKey => {
  switch (phase.type) {
    case "lobby":
      return "lobby";
    case "question":
      return `q:${phase.index}:${phase.status}`;
    case "results": {
      const stage = phase.stage;
      if (stage.kind === "list") return "r:list";
      const shown =
        stage.rankShown && stage.nameShown
          ? "both"
          : stage.rankShown
            ? "rank"
            : stage.nameShown
              ? "name"
              : "hidden";
      return `r:${stage.playerId}:${shown}`;
    }
  }
};

export const normalizeNickname = (raw: string): string => {
  // NFKC first so fullwidth spaces become trim-able; then strip Cc/Cf (incl. ZWJ).
  return raw
    .normalize("NFKC")
    .replace(/\p{Cc}|\p{Cf}/gu, "")
    .trim();
};

/**
 * Facts about what happened in a transition. They say nothing about who is
 * notified; delivery is decided by the room (SessionRoom.deliver).
 */
export type GameEvent =
  | { type: "phase_changed" }
  | { type: "projection_changed" }
  | { type: "player_joined"; playerId: string }
  | { type: "answer_recorded"; playerId: string };

export type Transition<R extends string, Extra = {}> =
  | ({ ok: true; state: GameState; events: GameEvent[] } & Extra)
  | { ok: false; reason: R };

export const joinPlayer = (
  s: GameState,
  nickname: string,
  ids: { id: string; token: string },
): Transition<"nickname_taken" | "nickname_invalid" | "closed" | "full", { player: Player }> => {
  if (s.phase.type === "results") return { ok: false, reason: "closed" };
  if (s.players.length >= MAX_PLAYERS) return { ok: false, reason: "full" };
  const normalized = normalizeNickname(nickname);
  const length = [...normalized].length;
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) return { ok: false, reason: "nickname_invalid" };
  if (s.players.some((p) => p.nickname === normalized)) return { ok: false, reason: "nickname_taken" };
  const player: Player = { id: ids.id, token: ids.token, nickname: normalized, answers: {} };
  return {
    ok: true,
    state: { ...s, players: [...s.players, player] },
    player,
    events: [{ type: "player_joined", playerId: player.id }],
  };
};

export const submitAnswer = (
  s: GameState,
  playerId: string,
  questionIndex: number,
  choice: number,
): Transition<"not_accepting" | "wrong_question" | "invalid_choice" | "unknown_player"> => {
  const phase = s.phase;
  if (phase.type !== "question" || phase.status !== "open") return { ok: false, reason: "not_accepting" };
  if (phase.index !== questionIndex) return { ok: false, reason: "wrong_question" };
  if (!Number.isInteger(choice) || choice < 0 || choice >= CHOICE_COUNT) return { ok: false, reason: "invalid_choice" };
  const i = s.players.findIndex((p) => p.id === playerId);
  if (i < 0) return { ok: false, reason: "unknown_player" };
  const player = s.players[i];
  const updated: Player = { ...player, answers: { ...player.answers, [questionIndex]: choice as Choice } };
  const players = s.players.slice();
  players[i] = updated;
  return { ok: true, state: { ...s, players }, events: [{ type: "answer_recorded", playerId }] };
};

export const advance = (s: GameState, fromKey: PhaseKey): Transition<"stale_phase" | "no_next_stage"> => {
  if (fromKey !== phaseKey(s.phase)) return { ok: false, reason: "stale_phase" };
  const next = nextPhase(s);
  if (!next) return { ok: false, reason: "no_next_stage" };
  return { ok: true, state: { ...s, phase: next }, events: [{ type: "phase_changed" }] };
};

export const presentResults = (
  s: GameState,
  fromKey: PhaseKey,
  action: ResultsAction,
): Transition<"stale_phase" | "not_in_results" | "unknown_player" | "invalid_action" | "no_change"> => {
  if (s.phase.type !== "results") return { ok: false, reason: "not_in_results" };
  if (fromKey !== phaseKey(s.phase)) return { ok: false, reason: "stale_phase" };
  const stage = s.phase.stage;

  switch (action.kind) {
    case "select": {
      if (stage.kind !== "list") return { ok: false, reason: "invalid_action" };
      if (!s.players.some((p) => p.id === action.playerId)) return { ok: false, reason: "unknown_player" };
      return {
        ok: true,
        state: {
          ...s,
          phase: {
            type: "results",
            stage: { kind: "player", playerId: action.playerId, rankShown: false, nameShown: false },
          },
        },
        events: [{ type: "projection_changed" }],
      };
    }
    case "show_rank": {
      if (stage.kind !== "player") return { ok: false, reason: "invalid_action" };
      if (stage.rankShown) return { ok: false, reason: "no_change" };
      return {
        ok: true,
        state: {
          ...s,
          phase: { type: "results", stage: { ...stage, rankShown: true } },
        },
        events: [{ type: "projection_changed" }],
      };
    }
    case "show_name": {
      if (stage.kind !== "player") return { ok: false, reason: "invalid_action" };
      if (stage.nameShown) return { ok: false, reason: "no_change" };
      return {
        ok: true,
        state: {
          ...s,
          phase: { type: "results", stage: { ...stage, nameShown: true } },
        },
        events: [{ type: "projection_changed" }],
      };
    }
    case "back": {
      if (stage.kind !== "player") return { ok: false, reason: "invalid_action" };
      return {
        ok: true,
        state: { ...s, phase: { type: "results", stage: { kind: "list" } } },
        events: [{ type: "projection_changed" }],
      };
    }
  }
};

const nextPhase = (s: GameState): Phase | null => {
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
    case "results":
      return null;
  }
};
