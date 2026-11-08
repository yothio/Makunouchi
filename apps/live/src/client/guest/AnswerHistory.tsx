import type { HistoryEntry } from "../../shared/types";
import { formatHistoryEntry } from "./history";

export const AnswerHistory = ({ history }: { history: HistoryEntry[] }) => {
  if (history.length === 0) return null;
  return (
    <ul className="history" aria-label="これまでの回答">
      {history.map((entry) => {
        const row = formatHistoryEntry(entry);
        return (
          <li key={entry.index} className={row.mark === "○" ? "history-ok" : "history-ng"}>
            <span className="history-q">{row.question}</span>
            <span className="history-choice">{row.choice}</span>
            <span className="history-mark">{row.mark}</span>
          </li>
        );
      })}
    </ul>
  );
};
