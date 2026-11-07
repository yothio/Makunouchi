import type { Choice, GuestView, HistoryEntry, HostView, PublicQuestion, ScreenView } from "../../shared/types";
import { listEntries, nextPodiumRank, podiumPlayers, rankPlayers } from "./ranking";
import { revealedCount, scoreOf } from "./scoring";
import { phaseKey } from "./state";
import type { GameState, Player } from "./types";

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
        const entries = listEntries(ranked).map(({ rank, nickname, score }) => ({ rank, nickname, score }));
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

/** The projector's view: the host view minus everything that is for the operator only. */
export const screenView = (s: GameState): ScreenView => {
  const { title, playerCount, screen } = hostView(s);
  switch (screen.kind) {
    case "lobby":
      return { kind: "lobby", title, playerCount };
    case "question":
      return { kind: "question", question: screen.question, status: screen.status };
    case "reveal":
      return { kind: "reveal", question: screen.question, correctIndex: screen.correctIndex, counts: screen.counts };
    case "list":
      return { kind: "list", entries: screen.entries };
    case "podium":
      return { kind: "podium", rank: screen.rank, revealed: screen.revealed, players: screen.players };
  }
};

/** The player's own result for every question whose answer has been revealed. Never includes the current open / closed question. */
const answerHistory = (s: GameState, player: Player): HistoryEntry[] => {
  const history: HistoryEntry[] = [];
  for (let index = 0; index < revealedCount(s); index++) {
    const choice: Choice | null = player.answers[index] ?? null;
    history.push({ index, choice, correct: choice !== null && choice === s.quiz.questions[index].correctIndex });
  }
  return history;
};

export const guestView = (s: GameState, playerId: string): GuestView => {
  const player = s.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`unknown player: ${playerId}`);
  const phase = s.phase;
  switch (phase.type) {
    case "lobby":
      return { kind: "lobby", title: s.quiz.title, nickname: player.nickname };
    case "question": {
      const question = publicQuestion(s, phase.index);
      const myChoice: Choice | null = player.answers[phase.index] ?? null;
      const history = answerHistory(s, player);
      if (phase.status !== "revealed") return { kind: "question", question, status: phase.status, myChoice, history };
      const correctIndex = s.quiz.questions[phase.index].correctIndex;
      return {
        kind: "reveal",
        question,
        correctIndex,
        myChoice,
        correct: myChoice === correctIndex,
        score: scoreOf(s, player),
        history,
      };
    }
    case "results":
      return { kind: "results_pending", nickname: player.nickname, history: answerHistory(s, player) };
  }
};
