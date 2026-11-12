import { CHOICE_LABELS } from "@client/choice-labels";
import { QuestionBlock } from "@client/screen/QuestionBlock";
import type { ScreenOf } from "@client/screen/types";

export const QuestionScreen = ({ screen: s }: { screen: ScreenOf<"question"> }) => {
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
      {s.status === "closed" && <p className="host-count">締め切りました</p>}
    </div>
  );
};
