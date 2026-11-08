import type { GameState, Player } from "./types";

// revealed までの問題だけ得点に入る（結果フェーズは全問）。
export const revealedCount = (s: GameState): number => {
  const phase = s.phase;
  if (phase.type === "lobby") return 0;
  if (phase.type === "results") return s.quiz.questions.length;
  return phase.status === "revealed" ? phase.index + 1 : phase.index;
};

export const scoreOf = (s: GameState, player: Player): number => {
  const scoredUpTo = revealedCount(s);
  let total = 0;
  for (let i = 0; i < scoredUpTo; i++) {
    const q = s.quiz.questions[i];
    if (player.answers[i] === q.correctIndex) total += 1;
  }
  return total;
};
