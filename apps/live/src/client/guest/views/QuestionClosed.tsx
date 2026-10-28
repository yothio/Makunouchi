import type { Choice, PublicQuestion } from "../../../shared/types";
import { CHOICE_LABELS } from "../../choice-labels";

export const QuestionClosed = ({ question, mine }: { question: PublicQuestion; mine: Choice | null }) => {
  return (
    <div className="closed">
      <p className="closed-title">締め切りました</p>
      {mine !== null ? (
        <p>
          あなたの回答: {CHOICE_LABELS[mine]}　{question.choices[mine]}
        </p>
      ) : (
        <p>回答なし</p>
      )}
    </div>
  );
};
