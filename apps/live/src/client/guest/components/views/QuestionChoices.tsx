import type { Choice, PublicQuestion } from "@shared/types";
import { CHOICE_LABELS } from "@client/common/lib/choice-labels";

export const QuestionChoices = ({
  question,
  mine,
  disabled,
  onAnswer,
}: {
  question: PublicQuestion;
  mine: Choice | null;
  disabled: boolean;
  onAnswer(questionIndex: number, choice: Choice): void;
}) => {
  return (
    <div className="choices">
      {question.choices.map((text, i) => (
        <button
          key={i}
          type="button"
          className={`choice${mine === i ? " selected" : ""}`}
          aria-pressed={mine === i}
          disabled={disabled}
          onClick={() => onAnswer(question.index, i as Choice)}
        >
          <span className="label">{CHOICE_LABELS[i]}</span>
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
};
