import type { Choice, GuestView, HostView, PublicQuestion } from "../../shared/types";
import { isFinal, listEntries, nextPodiumRank, podiumPlayers, rankPlayers, type RankedPlayer } from "./ranking";
import { scoreOf } from "./scoring";
import { phaseKey } from "./state";
import type { GameState } from "./types";

const publicQuestion = (s: GameState, index: number): PublicQuestion => {
  const q = s.quiz.questions[index];
  return { index, total: s.quiz.questions.length, title: q.title, imageUrl: q.imageUrl, choices: q.choices };
};

export const hostView = (s: GameState): HostView => {
  const base = { title: s.quiz.title, phaseKey: phaseKey(s.phase), playerCount: s.players.length };
  const phase = s.phase;
  switch (phase.type) {
    case "lobby":
      return { ...base, screen: { kind: "lobby" } };
    case "question": {
      const question = publicQuestion(s, phase.index);
      if (phase.status !== "revealed") {
        const answeredCount = s.players.filter((p) => p.answers[phase.index] !== undefined).length;
        return { ...base, screen: { kind: "question", question, status: phase.status, answeredCount } };
      }
      const counts: [number, number, number, number] = [0, 0, 0, 0];
      for (const p of s.players) {
        const c = p.answers[phase.index];
        if (c !== undefined) counts[c]++;
      }
      return {
        ...base,
        screen: {
          kind: "reveal",
          question,
          correctIndex: s.quiz.questions[phase.index].correctIndex,
          counts,
          isLast: phase.index === s.quiz.questions.length - 1,
        },
      };
    }
    case "results": {
      const stage = phase.stage;
      const ranked = rankPlayers(s);
      if (stage.kind === "list") {
        const entries = listEntries(ranked, s.quiz.topN).map(({ rank, nickname, score }) => ({ rank, nickname, score }));
        return { ...base, screen: { kind: "list", entries, nextRank: nextPodiumRank(ranked, null) } };
      }
      const players = stage.revealed
        ? podiumPlayers(ranked, stage.rank).map(({ nickname, score }) => ({ nickname, score }))
        : [];
      return {
        ...base,
        screen: { kind: "podium", rank: stage.rank, revealed: stage.revealed, players, nextRank: nextPodiumRank(ranked, stage.rank) },
      };
    }
  }
};

/** `ranked` may be passed by callers rendering many guests from one state (results stages only use it). */
export const guestView = (s: GameState, playerId: string, ranked?: RankedPlayer[]): GuestView => {
  const player = s.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  const phase = s.phase;
  switch (phase.type) {
    case "lobby":
      return { kind: "lobby", title: s.quiz.title, nickname: player.nickname };
    case "question": {
      const question = publicQuestion(s, phase.index);
      const myChoice: Choice | null = player.answers[phase.index] ?? null;
      if (phase.status !== "revealed") return { kind: "question", question, status: phase.status, myChoice };
      const correctIndex = s.quiz.questions[phase.index].correctIndex;
      return { kind: "reveal", question, correctIndex, myChoice, correct: myChoice === correctIndex, score: scoreOf(s, player) };
    }
    case "results": {
      const all = ranked ?? rankPlayers(s);
      if (!isFinal(phase, all)) return { kind: "results_pending", nickname: player.nickname };
      const me = all.find((r) => r.playerId === playerId)!;
      return { kind: "final", nickname: player.nickname, rank: me.rank, score: me.score, playerCount: s.players.length };
    }
  }
};
