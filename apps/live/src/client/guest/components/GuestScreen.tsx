import type { Choice, GuestView } from "@shared/types";
import { AnswerHistory } from "./AnswerHistory";
import { JoinForm } from "./JoinForm";
import type { JoinError, PendingAnswer } from "@client/guest/types";
import { QuestionView } from "./views/QuestionView";

type Props = {
  view: GuestView | null;
  needJoin: boolean;
  joinError: JoinError | null;
  pending: PendingAnswer | null;
  disabled: boolean;
  onAnswer(questionIndex: number, choice: Choice): void;
  onJoin(nickname: string): void;
};

export const GuestScreen = ({ view, needJoin, joinError, pending, disabled, onAnswer, onJoin }: Props) => {
  if (view) {
    switch (view.kind) {
      case "lobby":
        return (
          <section className="center">
            <p className="nick">{view.nickname}</p>
            <h1>まもなく始まります</h1>
            <p className="note">{view.title}</p>
          </section>
        );
      case "question":
        return <QuestionView view={view} pending={pending} disabled={disabled} onAnswer={onAnswer} />;
      case "reveal":
        return (
          <section className="center">
            <div className={`mark ${view.correct ? "ok" : "ng"}`} aria-label={view.correct ? "正解" : "不正解"}>
              {view.correct ? "⭕" : "❌"}
            </div>
            <p className="score">{view.score} 点</p>
            <AnswerHistory history={view.history} />
          </section>
        );
      case "results_pending":
        return (
          <section className="center">
            <p className="nick">{view.nickname}</p>
            <h1>結果発表中…</h1>
            <AnswerHistory history={view.history} />
          </section>
        );
    }
  }
  if (needJoin) return <JoinForm error={joinError} disabled={disabled} onSubmit={onJoin} />;
  return <p className="note">接続しています…</p>;
};
