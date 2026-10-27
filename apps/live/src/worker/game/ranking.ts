import type { Phase } from "../../shared/types";
import { scoreOf } from "./scoring";
import type { GameState } from "./types";

export type RankedPlayer = { playerId: string; nickname: string; score: number; rank: number };

/**
 * The only place ranks are computed. Callers compute it once per message/view
 * and pass the result to the helpers below.
 * Descending score; ties keep join order. Competition ranking (90, 90, 80 → 1, 1, 3).
 */
export function rankPlayers(s: GameState): RankedPlayer[] {
  const scored = s.players.map((p, i) => ({ playerId: p.id, nickname: p.nickname, score: scoreOf(s, p), i }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const ranked: RankedPlayer[] = [];
  scored.forEach(({ i: _i, ...p }, index) => {
    const prev = ranked[index - 1];
    ranked.push({ ...p, rank: prev && prev.score === p.score ? prev.rank : index + 1 });
  });
  return ranked;
}

export function listEntries(ranked: RankedPlayer[], topN: number): RankedPlayer[] {
  return ranked.filter((p) => p.rank >= 4 && p.rank <= topN);
}

export function podiumPlayers(ranked: RankedPlayer[], rank: 1 | 2 | 3): RankedPlayer[] {
  return ranked.filter((p) => p.rank === rank);
}

export function podiumHasPlayers(ranked: RankedPlayer[], rank: 1 | 2 | 3): boolean {
  return ranked.some((p) => p.rank === rank);
}

/** Next non-empty podium slot strictly below `below` (scanning 3, 2, 1), or null. `below` is 4 for the list stage. */
export function nextPodiumRank(ranked: RankedPlayer[], below: number): 1 | 2 | 3 | null {
  for (let r = Math.min(below, 4) - 1; r >= 1; r--) {
    const rank = r as 1 | 2 | 3;
    if (podiumHasPlayers(ranked, rank)) return rank;
  }
  return null;
}

export function isFinal(phase: Phase, ranked: RankedPlayer[]): boolean {
  if (phase.type !== "results") return false;
  const stage = phase.stage;
  if (stage.kind === "podium") return stage.rank === 1 && stage.revealed;
  return !([3, 2, 1] as const).some((r) => podiumHasPlayers(ranked, r));
}
