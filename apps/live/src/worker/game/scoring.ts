import type { GameState, Player } from "./types";

/** Only questions whose answer has been revealed (or are already past) are scored. */
export const scoreOf = (s: GameState, player: Player): number => {
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
};
