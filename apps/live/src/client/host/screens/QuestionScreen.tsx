import { CHOICE_LABELS } from "../../choice-labels";
import { QuestionBlock } from "../QuestionBlock";
import type { HostScreenOf } from "../types";

export const QuestionScreen = ({ screen: s, playerCount }: { screen: HostScreenOf<"question">; playerCount: number }) => {
  return (
    <div>
      <QuestionBlock q={s.question} />
      <ul className="host-choices">
        {s.question.choices.map((c, i) => (
          <li key={i} className="host-choice">
            <span className="host-label">{CHOICE_LABELS[i]}</span>
            {c}
          </li>
        ))}
      </ul>
      <p className="host-count">
        回答済み {s.answeredCount} / {playerCount} 人{s.status === "closed" ? "（締め切りました）" : ""}
      </p>
    </div>
  );
};
