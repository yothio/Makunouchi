import { scoreOf, type GameState } from "./state";

export type RankedPlayer = { playerId: string; nickname: string; score: number; rank: number };

/** Descending score; ties keep join order. Competition ranking (90, 90, 80 → 1, 1, 3). */
export function rankPlayers(s: GameState): RankedPlayer[] {
  const scored = s.players.map((p, i) => ({ playerId: p.id, nickname: p.nickname, score: scoreOf(s, p), i }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ i: _i, ...p }) => ({
    ...p,
    rank: scored.filter((o) => o.score > p.score).length + 1,
  }));
}

export function listEntries(s: GameState): RankedPlayer[] {
  return rankPlayers(s).filter((p) => p.rank >= 4 && p.rank <= s.quiz.topN);
}

export function podiumPlayers(s: GameState, rank: 1 | 2 | 3): RankedPlayer[] {
  return rankPlayers(s).filter((p) => p.rank === rank);
}

export function podiumHasPlayers(s: GameState, rank: 1 | 2 | 3): boolean {
  return podiumPlayers(s, rank).length > 0;
}

/** Next non-empty podium slot strictly below `below` (scanning 3, 2, 1), or null. `below` is 4 for the list stage. */
export function nextPodiumRank(s: GameState, below: number): 1 | 2 | 3 | null {
  for (let r = Math.min(below, 4) - 1; r >= 1; r--) {
    const rank = r as 1 | 2 | 3;
    if (podiumHasPlayers(s, rank)) return rank;
  }
  return null;
}

export function isFinal(s: GameState): boolean {
  const phase = s.phase;
  if (phase.type !== "results") return false;
  const stage = phase.stage;
  if (stage.kind === "podium") return stage.rank === 1 && stage.revealed;
  return !([3, 2, 1] as const).some((r) => podiumHasPlayers(s, r));
}
