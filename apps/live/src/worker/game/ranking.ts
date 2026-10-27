import type { Phase, PodiumRank } from "../../shared/types";
import { LIST_FIRST_RANK, PODIUM_RANKS } from "./rules";
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

export const listEntries = (ranked: RankedPlayer[], topN: number): RankedPlayer[] => {
  return ranked.filter((p) => p.rank >= LIST_FIRST_RANK && p.rank <= topN);
};

export const podiumPlayers = (ranked: RankedPlayer[], rank: PodiumRank): RankedPlayer[] => {
  return ranked.filter((p) => p.rank === rank);
};

export const podiumHasPlayers = (ranked: RankedPlayer[], rank: PodiumRank): boolean => {
  return ranked.some((p) => p.rank === rank);
};

/**
 * Next non-empty podium slot announced after `current` (scanning 3, 2, 1), or null.
 * `current` is the slot announced last; null means the list stage (nothing on the podium announced yet).
 */
export const nextPodiumRank = (ranked: RankedPlayer[], current: PodiumRank | null): PodiumRank | null => {
  const before = current ?? LIST_FIRST_RANK;
  return PODIUM_RANKS.find((rank) => rank < before && podiumHasPlayers(ranked, rank)) ?? null;
};

export const isFinal = (phase: Phase, ranked: RankedPlayer[]): boolean => {
  if (phase.type !== "results") return false;
  const stage = phase.stage;
  if (stage.kind === "podium") return stage.rank === 1 && stage.revealed;
  return !PODIUM_RANKS.some((r) => podiumHasPlayers(ranked, r));
};
