import type { Choice, Phase, QuizPayload } from "@shared/types";

export type Player = {
  id: string;
  token: string;
  nickname: string;
  answers: Record<number, Choice>;
};

export type GameState = { quiz: QuizPayload; phase: Phase; players: Player[] };
