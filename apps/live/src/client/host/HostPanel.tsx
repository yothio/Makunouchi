import type { HostView, ResultsAction } from "@shared/types";
import { CHOICE_LABELS } from "@client/common/lib/choice-labels";
import { RankDetailPanel } from "./RankDetailPanel";
import { ResultsPanel } from "./ResultsPanel";

/** The operator's status panel: just enough to run the quiz. Big text, QR and bars belong to the projector. */
export const HostPanel = ({
  view,
  resultsLocked,
  onResultsAction,
}: {
  view: HostView | null;
  resultsLocked: boolean;
  onResultsAction: (action: ResultsAction) => void;
}) => {
  if (!view) return <p className="host-wait">接続中…</p>;
  const s = view.screen;
  switch (s.kind) {
    case "lobby":
      return (
        <div className="console">
          <h1 className="console-title">{view.title}</h1>
          <p className="console-count">参加人数 {view.playerCount} 人</p>
        </div>
      );
    case "question":
      return (
        <div className="console">
          <p className="console-progress">
            第 {s.question.index + 1} 問 / 全 {s.question.total} 問
          </p>
          <h1 className="console-title">{s.question.title}</h1>
          <ul className="console-choices">
            {s.question.choices.map((c, i) => (
              <li key={i}>
                {CHOICE_LABELS[i]}: {c}
              </li>
            ))}
          </ul>
          <p className="console-count">
            回答済み {s.answeredCount} / {view.playerCount} 人{s.status === "closed" ? "（締め切りました）" : ""}
          </p>
        </div>
      );
    case "reveal":
      return (
        <div className="console">
          <p className="console-progress">
            第 {s.question.index + 1} 問 / 全 {s.question.total} 問
          </p>
          <h1 className="console-title">{s.question.title}</h1>
          <ul className="console-choices">
            {s.question.choices.map((c, i) => (
              <li key={i} className={i === s.correctIndex ? "console-correct" : undefined}>
                {CHOICE_LABELS[i]}: {c}（{s.counts[i]} 人）
              </li>
            ))}
          </ul>
          <p className="console-count">
            正解は {CHOICE_LABELS[s.correctIndex]}：{s.question.choices[s.correctIndex]}
          </p>
        </div>
      );
    case "ranking":
      return (
        <ResultsPanel
          entries={s.entries}
          locked={resultsLocked}
          onSelect={(playerId) => onResultsAction({ kind: "select", playerId })}
        />
      );
    case "ranking_detail":
      return <RankDetailPanel detail={s} locked={resultsLocked} onAction={onResultsAction} />;
  }
};
