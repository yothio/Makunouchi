import type { ResultsAction } from "../../shared/types";

type Detail = {
  playerId: string;
  rank: number;
  nickname: string;
  score: number;
  rankShown: boolean;
  nameShown: boolean;
};

export const RankDetailPanel = ({
  detail,
  locked,
  onAction,
}: {
  detail: Detail;
  locked: boolean;
  onAction: (action: ResultsAction) => void;
}) => {
  return (
    <div className="console">
      <h1 className="console-title">選んだ人</h1>
      <p className="console-count">
        {detail.rank} 位 {detail.nickname}（{detail.score} 点）
      </p>
      <div className="console-actions">
        <button
          type="button"
          className="console-action"
          disabled={locked || detail.rankShown}
          onClick={() => onAction({ kind: "show_rank" })}
        >
          {detail.rankShown ? "順位を投影（済）" : "順位を投影"}
        </button>
        <button
          type="button"
          className="console-action"
          disabled={locked || detail.nameShown}
          onClick={() => onAction({ kind: "show_name" })}
        >
          {detail.nameShown ? "名前を投影（済）" : "名前を投影"}
        </button>
        <button
          type="button"
          className="console-action console-action-back"
          disabled={locked}
          onClick={() => onAction({ kind: "back" })}
        >
          戻る
        </button>
      </div>
    </div>
  );
};
