import { scoreOf } from "./scoring";
import type { GameState } from "./types";

export type RankedPlayer = { playerId: string; nickname: string; score: number; rank: number };

/**
 * The only place ranks are computed. Callers compute it once per message/view
 * and pass the result to the helpers below.
 * Descending score; ties keep join order. Competition ranking (90, 90, 80 → 1, 1, 3).
 */
export const rankPlayers = (s: GameState): RankedPlayer[] => {
  const scored = s.players.map((p, i) => ({ playerId: p.id, nickname: p.nickname, score: scoreOf(s, p), i }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const ranked: RankedPlayer[] = [];
  scored.forEach(({ i: _i, ...p }, index) => {
    const prev = ranked[index - 1];
    ranked.push({ ...p, rank: prev && prev.score === p.score ? prev.rank : index + 1 });
  });
  return ranked;
};
