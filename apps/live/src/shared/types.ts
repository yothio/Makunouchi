export type Choice = 0 | 1 | 2 | 3;

export type QuizQuestion = {
  title: string;
  imageUrl: string | null;
  choices: [string, string, string, string];
  correctIndex: Choice;
  points: number;
};

export type QuizPayload = {
  title: string;
  topN: number;
  questions: QuizQuestion[];
};

export type ResultsStage =
  | { kind: "list" }
  | { kind: "podium"; rank: 1 | 2 | 3; revealed: boolean };

export type Phase =
  | { type: "lobby" }
  | { type: "question"; index: number; status: "open" | "closed" | "revealed" }
  | { type: "results"; stage: ResultsStage };

export type PublicQuestion = {
  index: number;
  total: number;
  title: string;
  imageUrl: string | null;
  choices: [string, string, string, string];
};

export type HostView = {
  title: string;
  phaseKey: string;
  playerCount: number;
  screen:
    | { kind: "lobby" }
    | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; answeredCount: number }
    | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; counts: [number, number, number, number]; isLast: boolean }
    | { kind: "list"; entries: { rank: number; nickname: string; score: number }[]; nextRank: 1 | 2 | 3 | null }
    | {
        kind: "podium";
        rank: 1 | 2 | 3;
        revealed: boolean;
        /** empty while revealed=false */
        players: { nickname: string; score: number }[];
        /** next non-empty slot to announce, or null */
        nextRank: 1 | 2 | 3 | null;
      };
};

export type GuestView =
  | { kind: "lobby"; title: string; nickname: string }
  | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; myChoice: Choice | null }
  | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; myChoice: Choice | null; correct: boolean; score: number }
  | { kind: "results_pending"; nickname: string }
  | { kind: "final"; nickname: string; rank: number; score: number; playerCount: number };

export type ClientMessage =
  | { type: "join"; nickname: string }
  | { type: "answer"; questionIndex: number; choice: number }
  | { type: "advance"; from: string };

export type ServerMessage =
  | { type: "host_view"; view: HostView }
  | { type: "guest_view"; view: GuestView }
  | { type: "need_join" }
  | { type: "joined"; playerToken: string }
  | { type: "join_error"; reason: "nickname_taken" | "nickname_invalid" | "closed" };
