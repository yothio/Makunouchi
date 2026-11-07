import type { HostView } from "../../shared/types";
import { CHOICE_LABELS } from "../choice-labels";
import { listHeader } from "../screen/list-header";

/** The operator's status panel: just enough to run the quiz. Big text, QR and bars belong to the projector. */
export const HostPanel = ({ view }: { view: HostView | null }) => {
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
    case "list":
      return (
        <div className="console">
          <h1 className="console-title">結果発表: {listHeader(s.entries)}</h1>
          <ol className="console-list">
            {s.entries.map((e) => (
              <li key={`${e.rank}:${e.nickname}`}>
                {e.rank} 位 {e.nickname}（{e.score} 点）
              </li>
            ))}
          </ol>
        </div>
      );
    case "podium":
      return (
        <div className="console">
          <h1 className="console-title">{s.rank} 位</h1>
          <ul className="console-list">
            {s.revealed ? (
              s.players.map((p, i) => (
                <li key={i}>
                  {p.nickname}（{p.score} 点）
                </li>
              ))
            ) : (
              <li>（まだ投影していません）</li>
            )}
          </ul>
        </div>
      );
  }
};
