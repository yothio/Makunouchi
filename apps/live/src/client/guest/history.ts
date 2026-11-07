import type { HistoryEntry } from "../../shared/types";
import { CHOICE_LABELS } from "../choice-labels";

export type HistoryRow = { question: string; choice: string; mark: "○" | "×" };

/** The server decides correctness; this only formats it (the client never needs the correct answer). */
export const formatHistoryEntry = (entry: HistoryEntry): HistoryRow => {
  return {
    question: `問 ${entry.index + 1}`,
    choice: entry.choice === null ? "未回答" : CHOICE_LABELS[entry.choice],
    mark: entry.correct ? "○" : "×",
  };
};
