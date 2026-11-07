import type { GameState, Player } from "./types";

/** How many questions (from the first) have had their answer revealed; these are the ones that are scored. */
export const revealedCount = (s: GameState): number => {
  const phase = s.phase;
  if (phase.type === "lobby") return 0;
  if (phase.type === "results") return s.quiz.questions.length;
  return phase.status === "revealed" ? phase.index + 1 : phase.index;
};

/** Only questions whose answer has been revealed (or are already past) are scored. */
export const scoreOf = (s: GameState, player: Player): number => {
  const scoredUpTo = revealedCount(s);
  let total = 0;
  for (let i = 0; i < scoredUpTo; i++) {
    const q = s.quiz.questions[i];
    if (player.answers[i] === q.correctIndex) total += 1;
  }
  return total;
};
