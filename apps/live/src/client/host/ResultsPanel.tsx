type Entry = { playerId: string; rank: number; nickname: string; score: number };

export const ResultsPanel = ({
  entries,
  locked,
  onSelect,
}: {
  entries: Entry[];
  locked: boolean;
  onSelect: (playerId: string) => void;
}) => {
  return (
    <div className="console">
      <h1 className="console-title">結果発表: 順位一覧</h1>
      <p className="console-count">投影する人を選んでください</p>
      <ul className="console-ranking">
        {entries.map((e) => (
          <li key={e.playerId}>
            <button
              type="button"
              className="console-ranking-row"
              disabled={locked}
              onClick={() => onSelect(e.playerId)}
            >
              <span className="console-ranking-rank">{e.rank} 位</span>
              <span className="console-ranking-name">{e.nickname}</span>
              <span className="console-ranking-score">{e.score} 点</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
