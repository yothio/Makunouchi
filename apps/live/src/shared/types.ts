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
