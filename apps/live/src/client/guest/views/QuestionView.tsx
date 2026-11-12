import type { Choice } from "@shared/types";
import type { GuestViewOf, PendingAnswer } from "@client/guest/types";
import { QuestionChoices } from "./QuestionChoices";
import { QuestionClosed } from "./QuestionClosed";

export const QuestionView = ({
  view,
  pending,
  disabled,
  onAnswer,
}: {
  view: GuestViewOf<"question">;
  pending: PendingAnswer | null;
  disabled: boolean;
  onAnswer(questionIndex: number, choice: Choice): void;
}) => {
  const q = view.question;
  const mine = view.myChoice ?? (pending && pending.index === q.index ? pending.choice : null);
  return (
    <section>
      <p className="progress">
        第 {q.index + 1} 問 / {q.total}
      </p>
      <h1 className="q-title">{q.title}</h1>
      {q.imageUrl && <img className="q-image" src={q.imageUrl} alt="" />}
      {view.status === "open" ? (
        <QuestionChoices question={q} mine={mine} disabled={disabled} onAnswer={onAnswer} />
      ) : (
        <QuestionClosed question={q} mine={mine} history={view.history} />
      )}
    </section>
  );
};
