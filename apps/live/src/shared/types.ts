export type Choice = 0 | 1 | 2 | 3;

/**
 * Identifies a game phase as a string.
 * Question phases (`lobby`, `q:<index>:<open|closed|revealed>`) must not change encoding.
 * Results phases use `r:list` / `r:<playerId>:<hidden|rank|name|both>`.
 * Two roles: the wire value the host client echoes back as `advance.from` / `results_action.from`,
 * and the key the server compares against the current phase to make those actions idempotent.
 */
export type PhaseKey = string;

export type QuizQuestion = {
  title: string;
  imageUrl: string | null;
  choices: [string, string, string, string];
  correctIndex: Choice;
};

export type QuizPayload = {
  title: string;
  questions: QuizQuestion[];
};

export type ResultsStage =
  | { kind: "list" }
  | { kind: "player"; playerId: string; rankShown: boolean; nameShown: boolean };

export type ResultsAction =
  | { kind: "select"; playerId: string }
  | { kind: "show_rank" }
  | { kind: "show_name" }
  | { kind: "back" };

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
  phaseKey: PhaseKey;
  playerCount: number;
  screen:
    | { kind: "lobby" }
    | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; answeredCount: number }
    | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; counts: [number, number, number, number]; isLast: boolean }
    | { kind: "ranking"; entries: { playerId: string; rank: number; nickname: string; score: number }[] }
    | {
        kind: "ranking_detail";
        playerId: string;
        rank: number;
        nickname: string;
        score: number;
        rankShown: boolean;
        nameShown: boolean;
      };
};

/**
 * What the projector shows. It is derived from the same state as HostView but carries only what may be on the
 * big screen: no answered count, no `correctIndex` before the reveal, and projected rank/name only after the host
 * presses the matching button.
 */
export type ScreenView =
  | { kind: "lobby"; title: string; playerCount: number }
  | { kind: "question"; question: PublicQuestion; status: "open" | "closed" }
  | { kind: "reveal"; question: PublicQuestion; correctIndex: Choice; counts: [number, number, number, number] }
  | { kind: "results_wait"; title: string }
  | { kind: "rank_reveal"; rank: number | null; nickname: string | null };

/** One question whose answer has been revealed, with the viewer's own choice (null = no answer). */
export type HistoryEntry = { index: number; choice: Choice | null; correct: boolean };

/**
 * `history` only ever holds questions whose answer has been revealed, so it never leaks the current question's
 * result. Participants are never sent their rank: it is announced on the projector.
 */
export type GuestView =
  | { kind: "lobby"; title: string; nickname: string }
  | { kind: "question"; question: PublicQuestion; status: "open" | "closed"; myChoice: Choice | null; history: HistoryEntry[] }
  | {
      kind: "reveal";
      question: PublicQuestion;
      correctIndex: Choice;
      myChoice: Choice | null;
      correct: boolean;
      score: number;
      history: HistoryEntry[];
    }
  | { kind: "results_pending"; nickname: string; history: HistoryEntry[] };

export type ClientMessage =
  | { type: "join"; nickname: string }
  | { type: "answer"; questionIndex: number; choice: number }
  | { type: "advance"; from: PhaseKey }
  | { type: "results_action"; from: PhaseKey; action: ResultsAction };

export type ServerMessage =
  | { type: "host_view"; view: HostView }
  | { type: "screen_view"; view: ScreenView }
  | { type: "guest_view"; view: GuestView }
  | { type: "need_join" }
  | { type: "joined"; playerToken: string }
  | { type: "join_error"; reason: "nickname_taken" | "nickname_invalid" | "closed" };
