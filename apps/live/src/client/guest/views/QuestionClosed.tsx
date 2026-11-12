import type { Choice, HistoryEntry, PublicQuestion } from "@shared/types";
import { CHOICE_LABELS } from "@client/choice-labels";
import { AnswerHistory } from "@client/guest/AnswerHistory";

export const QuestionClosed = ({
  question,
  mine,
  history,
}: {
  question: PublicQuestion;
  mine: Choice | null;
  history: HistoryEntry[];
}) => {
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
      <AnswerHistory history={history} />
    </div>
  );
};
